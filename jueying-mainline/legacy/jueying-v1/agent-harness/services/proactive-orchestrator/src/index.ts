import { createServer } from 'node:http';
import { createLogger, httpRequestLogger, httpResponseLogger, setupDefaultHealthChecks, analyze, writeAggregationReport, readJson, sendJson } from '@agent-harness/shared';
import { Pool } from 'pg';
import { getDatabaseSslConfig } from '@agent-harness/shared';
import { ProactiveOrchestratorService } from './service';
import { proactiveInsightReviewSchema, proactiveMissionDispatchSchema } from './domain';

const logger = createLogger('proactive-orchestrator', { logFile: process.env.LOG_FILE || 'logs/proactive-orchestrator.log' });
const port = Number(process.env.PORT || 3010);
const databaseUrl = process.env.DATABASE_URL || '';
const internalToken = process.env.INTERNAL_TOKEN || '';
const service = new ProactiveOrchestratorService(
  databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        max: Number(process.env.DB_POOL_MAX || 6),
        ssl: getDatabaseSslConfig(),
      })
    : null,
  {
    factRetrievalUrl: process.env.FACT_RETRIEVAL_URL || 'http://fact-retrieval:3000',
    hermesUrl: process.env.HERMES_URL || 'http://hermes-adapter:3000',
    gatewayUrl: process.env.GATEWAY_URL || 'http://gateway-adapter:3000',
    internalToken,
    ownerUserId: process.env.PROACTIVE_OWNER_USER_ID || 'u_proactive_orchestrator',
    timeoutMs: Number(process.env.PROACTIVE_TIMEOUT_MS || 15000),
  }
);

function isInternalAuthorized(req: import('node:http').IncomingMessage): boolean {
  if (!internalToken) return true;
  return req.headers['x-internal-token'] === internalToken;
}

async function startScheduler(): Promise<void> {
  const intervalMs = Math.max(60000, Number(process.env.PROACTIVE_SCAN_INTERVAL_MS || 900000));
  const run = async () => {
    try {
      await service.startScheduledScan();
      const report = analyze();
      writeAggregationReport(report);
    } catch (error) {
      logger.warn('scheduler.scan_failed', 'Scheduled proactive scan failed', { error: String(error) });
    }
  };
  void run();
  const timer = setInterval(() => { void run(); }, intervalMs);
  if (timer.unref) timer.unref();
}

setupDefaultHealthChecks(
  async () => service.healthCheck(),
  undefined
);

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';
  const end = res.end.bind(res);
  const write = res.write.bind(res);
  const chunks: Buffer[] = [];
  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    return (write as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
  } as typeof res.write;
  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    responseBody = Buffer.concat(chunks).toString('utf8').slice(0, 2000);
    return end(chunk as never, encoding as never, cb as never);
  } as typeof res.end;

  const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  try {
    if (pathname === '/health' || pathname === '/health/live') {
      sendJson(res, 200, { ok: true, service: 'proactive-orchestrator' });
      return;
    }

    if (pathname === '/health/ready') {
      const ready = await service.healthCheck();
      sendJson(res, ready ? 200 : 503, { ok: ready, service: 'proactive-orchestrator' });
      return;
    }

    if (!pathname.startsWith('/internal/')) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }

    if (!isInternalAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (pathname === '/internal/dashboard' && req.method === 'GET') {
      const orgId = new URL(req.url || '/', 'http://localhost').searchParams.get('org_id') || undefined;
      const dashboard = await service.getDashboard(orgId);
      sendJson(res, 200, { ok: true, ...dashboard });
      return;
    }

    if (pathname === '/internal/rules' && req.method === 'GET') {
      const orgId = new URL(req.url || '/', 'http://localhost').searchParams.get('org_id') || undefined;
      const rules = await service.listRules(orgId || null);
      sendJson(res, 200, { ok: true, rules });
      return;
    }

    if (pathname === '/internal/rules' && req.method === 'POST') {
      const body = await readJson(req);
      const rule = await service.createRule(body);
      sendJson(res, 201, { ok: true, rule });
      return;
    }

    if (pathname.startsWith('/internal/rules/') && req.method === 'GET') {
      const ruleId = pathname.slice('/internal/rules/'.length);
      const rule = await service.getRule(ruleId);
      if (!rule) {
        sendJson(res, 404, { ok: false, error: 'rule_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, rule });
      return;
    }

    if (pathname.startsWith('/internal/rules/') && req.method === 'PUT') {
      const ruleId = pathname.slice('/internal/rules/'.length);
      const body = await readJson(req);
      const rule = await service.updateRule(ruleId, body);
      if (!rule) {
        sendJson(res, 404, { ok: false, error: 'rule_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, rule });
      return;
    }

    if (pathname.startsWith('/internal/rules/') && pathname.endsWith('/archive') && req.method === 'POST') {
      const ruleId = pathname.slice('/internal/rules/'.length, -'/archive'.length);
      const rule = await service.archiveRule(ruleId);
      if (!rule) {
        sendJson(res, 404, { ok: false, error: 'rule_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, rule });
      return;
    }

    if (pathname.startsWith('/internal/rules/') && req.method === 'DELETE') {
      const ruleId = pathname.slice('/internal/rules/'.length);
      const deleted = await service.deleteRule(ruleId);
      if (!deleted) {
        sendJson(res, 404, { ok: false, error: 'rule_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/internal/runs' && req.method === 'GET') {
      const orgId = new URL(req.url || '/', 'http://localhost').searchParams.get('org_id') || undefined;
      const runs = await service.listRuns(orgId || null);
      sendJson(res, 200, { ok: true, runs });
      return;
    }

    if (pathname === '/internal/runs' && req.method === 'POST') {
      const body = await readJson(req);
      const result = await service.startRun({
        rule_id: typeof body.rule_id === 'string' ? body.rule_id : undefined,
        org_id: typeof body.org_id === 'string' ? body.org_id : undefined,
        triggered_by: typeof body.triggered_by === 'string' ? body.triggered_by : undefined,
        dry_run: Boolean(body.dry_run),
      });
      sendJson(res, 200, { ok: true, results: result });
      return;
    }

    if (pathname.startsWith('/internal/runs/') && pathname.endsWith('/scan') && req.method === 'POST') {
      const runId = pathname.slice('/internal/runs/'.length, -'/scan'.length);
      const run = await service.getById('run', runId);
      if (!run) {
        sendJson(res, 404, { ok: false, error: 'run_not_found' });
        return;
      }
      const rule = await service.getRule(String(run.rule_id));
      if (!rule) {
        sendJson(res, 404, { ok: false, error: 'rule_not_found' });
        return;
      }
      const result = await service.scanRule(rule, String(rule.created_by), false);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/internal/insights' && req.method === 'GET') {
      const search = new URL(req.url || '/', 'http://localhost').searchParams;
      const orgId = search.get('org_id') || undefined;
      const status = search.get('review_status') || undefined;
      const insights = await service.listInsights(orgId || null, status || null);
      sendJson(res, 200, { ok: true, insights });
      return;
    }

    if (pathname.startsWith('/internal/insights/') && pathname.endsWith('/review') && req.method === 'POST') {
      const insightId = pathname.slice('/internal/insights/'.length, -'/review'.length);
      const body = await readJson(req);
      const parsed = proactiveInsightReviewSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { ok: false, error: 'invalid_review_payload', detail: parsed.error.flatten() });
        return;
      }
      const insight = await service.reviewInsight(insightId, parsed.data);
      if (!insight) {
        sendJson(res, 404, { ok: false, error: 'insight_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, insight });
      return;
    }

    if (pathname === '/internal/missions' && req.method === 'GET') {
      const search = new URL(req.url || '/', 'http://localhost').searchParams;
      const orgId = search.get('org_id') || undefined;
      const status = search.get('status') || undefined;
      const missions = await service.listMissions(orgId || null, status || null);
      sendJson(res, 200, { ok: true, missions });
      return;
    }

    if (pathname.startsWith('/internal/missions/') && pathname.endsWith('/dispatch') && req.method === 'POST') {
      const missionId = pathname.slice('/internal/missions/'.length, -'/dispatch'.length);
      const body = await readJson(req);
      const parsed = proactiveMissionDispatchSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { ok: false, error: 'invalid_dispatch_payload', detail: parsed.error.flatten() });
        return;
      }
      const mission = await service.dispatchMission(missionId, parsed.data);
      if (!mission) {
        sendJson(res, 404, { ok: false, error: 'mission_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, mission });
      return;
    }

    if (pathname.startsWith('/internal/missions/') && pathname.endsWith('/complete') && req.method === 'POST') {
      const assignmentId = pathname.slice('/internal/missions/'.length, -'/complete'.length);
      const mission = await service.completeMissionByAssignment(assignmentId);
      if (!mission) {
        sendJson(res, 404, { ok: false, error: 'mission_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, mission });
      return;
    }

    if (pathname === '/internal/reports' && req.method === 'GET') {
      const orgId = new URL(req.url || '/', 'http://localhost').searchParams.get('org_id') || undefined;
      const reports = await service.listReports(orgId || null);
      sendJson(res, 200, { ok: true, reports });
      return;
    }

    if (pathname.startsWith('/internal/reports/') && pathname.endsWith('/publish') && req.method === 'POST') {
      const reportId = pathname.slice('/internal/reports/'.length, -'/publish'.length);
      const report = await service.publishReport(reportId);
      if (!report) {
        sendJson(res, 404, { ok: false, error: 'report_not_found' });
        return;
      }
      sendJson(res, 200, { ok: true, report });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.failed', 'Unhandled proactive orchestrator request error', { error: String(error), pathname });
    sendJson(res, 500, { ok: false, error: 'internal_error' });
  } finally {
    await httpResponseLogger(req, res, responseBody);
  }
});

server.listen(port, () => {
  logger.info('server.started', `Proactive orchestrator listening on ${port}`);
});

void startScheduler();

async function shutdown(): Promise<void> {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
