import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, analyze, writeAggregationReport } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import { createDefaultStage } from '@agent-harness/contracts';
import { genericExecutor } from './executor/generic-executor';
import { retrievalAwareExecutor } from './executor/retrieval-aware-executor';
import { approvalExecutor } from './executor/approval-executor';
import { codeExecutor } from './executor/code-executor';
import { verificationExecutor } from './executor/verification-executor';
import { repairExecutor } from './executor/repair-executor';

const logger = createLogger('executor-gateway', {
  logFile: process.env.LOG_FILE || 'logs/executor-gateway.log'
});
const port = Number(process.env.PORT || 3002);
const workflowUrl = process.env.WORKFLOW_URL || '';
if (!workflowUrl) {
  logger.warn('config.missing', 'WORKFLOW_URL environment variable is not set');
}

async function postWorkflowWithRetry(path: string, payload: Record<string, unknown>, attempts = 5): Promise<{ ok: boolean; status: number }> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${workflowUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status < 500) return { ok: false, status: res.status };
    } catch {
      // retry
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
  return { ok: false, status: 0 };
}

async function readJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  const MAX_BODY_SIZE = 50 * 1024 * 1024;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new Error('request_body_too_large');
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('invalid_json');
  }
}

function sendJson(res: import('node:http').ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';
  const cEnd = res.end.bind(res);
  const chunks: Buffer[] = [];
  const cWrite = res.write.bind(res);
  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    return (cWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
  } as typeof res.write;
  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    responseBody = Buffer.concat(chunks).toString('utf-8').slice(0, 2000);
    return (cEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
  } as typeof res.end;

  try {
  if (req.url === '/health' || req.url === '/health/live' || req.url === '/health/ready') {
    sendJson(res, 200, { ok: true, service: 'executor-gateway' });
    return;
  }

  if (req.url === '/internal/executor/dispatch' && req.method === 'POST') {
    const body = await readJson(req);
    const workflowRef = body.workflow_instance_ref as string | undefined;
    if (!workflowRef || typeof workflowRef !== 'string' || !workflowRef.trim()) {
      sendJson(res, 400, { ok: false, error: 'missing_workflow_instance_ref', message: 'workflow_instance_ref is required' });
      return;
    }
    const trigger = (body.trigger as string) || 'manual';

    const runRef = `run_${Date.now()}_${randomUUID().substring(0, 6)}`;

    await auditWriter.write({
      user_id: 'system',
      action: 'code.session.created',
      resource_type: 'execution_session',
      resource_ref: runRef,
      resource_scope: 'system',
      result: 'success',
      detail_json: {
        workflow_instance_ref: workflowRef,
        trigger
      }
    });

    logger.info('executor.dispatch.accepted', 'Execution dispatch accepted', {
      workflow_instance_ref: workflowRef,
      executor_run_ref: runRef
    });

    sendJson(res, 200, {
      dispatch_status: 'accepted',
      executor_run_ref: runRef,
      state: 'queued'
    });

    void autoExecuteWorkflowStages(workflowRef, runRef);
    return;
  }

  if (req.url === '/internal/executor/execute' && req.method === 'POST') {
    const body = await readJson(req);

    const policySnapshotHash = body.policy_snapshot_hash as string | undefined;
    if (!policySnapshotHash || !policySnapshotHash.startsWith('sha256:')) {
      sendJson(res, 400, {
        ok: false,
        error: 'missing_policy_snapshot_hash',
        message: 'policy_snapshot_hash must be provided and start with sha256:'
      });
      return;
    }

    const workflowInstanceId = (body.workflow_instance_id as string) || `wf_${Date.now()}`;
    const workflowStageId = (body.workflow_stage_id as string) || `st_${Date.now()}`;
    const userGoal = (body.user_goal as string) || '';
    if (!userGoal.trim()) {
      sendJson(res, 400, { ok: false, error: 'missing_user_goal', message: 'user_goal must not be empty' });
      return;
    }
    const stage = (body.stage as Record<string, unknown>) || createDefaultStage(workflowStageId, userGoal);

    const executor = stage.assigned_executor === 'retrieval-aware-executor'
      ? retrievalAwareExecutor
      : stage.assigned_executor === 'approval-executor'
        ? approvalExecutor
        : stage.assigned_executor === 'code-executor'
          ? codeExecutor
          : stage.assigned_executor === 'verification-executor'
            ? verificationExecutor
            : stage.assigned_executor === 'repair-executor'
              ? repairExecutor
              : genericExecutor;

    const result = await executor.execute({
      workflow_instance_id: workflowInstanceId,
      workflow_stage_id: workflowStageId,
      stage: stage as unknown as import('@agent-harness/contracts').Stage,
      user_goal: userGoal,
      policy_snapshot_hash: policySnapshotHash,
      context: body.context as Record<string, unknown> | undefined
    });

    sendJson(res, 200, {
      ok: result.status === 'completed' || result.status === 'succeeded',
      workflow_instance_id: workflowInstanceId,
      workflow_stage_id: workflowStageId,
      execution_status: result.status,
      output: result.output,
      artifacts: result.artifacts || [],
      fact_refs: result.fact_refs || [],
      retrieval_trace_id: result.retrieval_trace_id,
      evidence_pack_hash: result.evidence_pack_hash,
      degraded: result.degraded || false,
      degradation_reasons: result.degradation_reasons || [],
      next_action: result.next_action,
      error: result.error,
      model_call_ok: result.model_call_ok
    });
    return;
  }

  if (req.url?.startsWith('/internal/executor/sessions/') && req.method === 'POST') {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const sessionId = pathname.split('/')[4];

    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'missing_session_id' });
      return;
    }

    const body = await readJson(req);
    const action = body.action as string;
    const ALLOWED_SESSION_ACTIONS = new Set(['terminate', 'status', 'cancel', 'pause', 'resume']);
    if (!action || !ALLOWED_SESSION_ACTIONS.has(action)) {
      sendJson(res, 400, { ok: false, error: 'invalid_action', message: `action must be one of: ${Array.from(ALLOWED_SESSION_ACTIONS).join(', ')}` });
      return;
    }

    await auditWriter.write({
      user_id: 'system',
      action: 'code.session.created',
      resource_type: 'execution_session',
      resource_ref: sessionId,
      resource_scope: 'system',
      result: 'success',
      detail_json: { action }
    });

    sendJson(res, 200, {
      ok: true,
      session_id: sessionId,
      action,
      status: action === 'terminate' ? 'terminated' : 'active'
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.unhandled_error', 'Unhandled request error', {
      error: (error as Error).message,
      stack: (error as Error).stack?.slice(0, 500)
    });
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    }
  }
  await httpResponseLogger(req, res, responseBody);
});

let aggTimer: ReturnType<typeof setInterval> | null = null;

server.listen(port, () => {
  logger.info('service.started', 'Executor gateway started', { port });
  aggTimer = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') writeAggregationReport(report);
  }, 15000);
  if (aggTimer.unref) aggTimer.unref();
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info('service.shutting_down', `Received ${signal}, shutting down gracefully`);
  if (aggTimer) { clearInterval(aggTimer); aggTimer = null; }
  writeAggregationReport(analyze());
  metricsRegistry.shutdown();
  await logger.shutdown();
  await auditWriter.shutdown();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

async function autoExecuteWorkflowStages(workflowRef: string, runRef: string): Promise<void> {
  try {
    const workflowResponse = await fetch(`${workflowUrl}/internal/workflows/${workflowRef}`);
    if (!workflowResponse.ok) {
      logger.warn('auto.execute.workflow_fetch_failed', 'Failed to fetch workflow for auto-execution', {
        workflow_instance_ref: workflowRef,
        status: workflowResponse.status
      });
      return;
    }

    const workflowBody = await workflowResponse.json() as Record<string, unknown>;
    const workflow = (workflowBody.workflow || workflowBody) as Record<string, unknown>;
    const plan = (workflow.plan || {}) as Record<string, unknown>;
    const stageChain = Array.isArray(plan.stage_chain) ? plan.stage_chain : [];
    const stages = (workflow.stages || stageChain || []) as Array<Record<string, unknown>>;
    const goal = plan.goal as Record<string, unknown> | undefined;
    const userGoal = String((plan.user_goal as string) || goal?.user_goal || goal?.description || goal?.summary || workflowRef);
    const policySnapshotHash = String(plan.policy_snapshot_hash || '');

    if (!stages || stages.length === 0) {
      logger.warn('auto.execute.no_stages', 'No stages found for auto-execution', {
        workflow_instance_ref: workflowRef
      });
      return;
    }

    let chainStoppedEarly = false;

    for (const stage of stages) {
      const stageId = String(stage.stage_id || stage.id || `st_${Date.now()}`);
      const stageStatus = String(stage.status || 'pending');

      if (stageStatus !== 'running' && stageStatus !== 'pending') continue;

      const executorName = String(stage.assigned_executor || 'generic-executor');
      const executor = executorName === 'retrieval-aware-executor'
        ? retrievalAwareExecutor
        : executorName === 'approval-executor'
          ? approvalExecutor
          : executorName === 'code-executor'
            ? codeExecutor
            : executorName === 'verification-executor'
              ? verificationExecutor
              : executorName === 'repair-executor'
                ? repairExecutor
                : genericExecutor;

      logger.info('auto.execute.stage_start', 'Auto-executing stage', {
        workflow_instance_ref: workflowRef,
        stage_id: stageId,
        stage_type: stage.stage_type
      });

      const result = await executor.execute({
        workflow_instance_id: workflowRef,
        workflow_stage_id: stageId,
        stage: stage as unknown as import('@agent-harness/contracts').Stage,
        user_goal: userGoal,
        policy_snapshot_hash: policySnapshotHash,
        context: { owner_user_id: workflow.owner_user_id, run_ref: runRef }
      });

      try {
        const report = await postWorkflowWithRetry(
          `/internal/workflows/${workflowRef}/stages/${stageId}/dispatch`,
          {
            status: result.status === 'completed' || result.status === 'succeeded' ? 'completed'
              : result.status === 'waiting_user' ? 'waiting_user'
              : result.status === 'blocked' ? 'blocked'
              : result.status === 'failed' ? 'failed' : 'completed',
            output: result.output?.slice(0, 5000) || '',
            artifacts: result.artifacts || [],
            fact_refs: result.fact_refs || []
          }
        );
        if (!report.ok) {
          logger.warn('auto.execute.report_failed', 'Failed to report stage result to workflow service', {
            workflow_instance_ref: workflowRef,
            stage_id: stageId,
            status: report.status
          });
          chainStoppedEarly = true;
          break;
        }
      } catch (reportError) {
        logger.warn('auto.execute.report_failed', 'Failed to report stage result to workflow service', {
          workflow_instance_ref: workflowRef,
          stage_id: stageId,
          error: String(reportError)
        });
        chainStoppedEarly = true;
        break;
      }

      if (result.status === 'failed' || result.status === 'waiting_user' || result.status === 'blocked') {
        logger.info('auto.execute.chain_stopped', 'Auto-execution chain stopped', {
          workflow_instance_ref: workflowRef,
          stage_id: stageId,
          status: result.status
        });
        chainStoppedEarly = true;
        break;
      }
    }

    if (chainStoppedEarly) {
      logger.info('auto.execute.chain_stopped_early', 'Auto-execution chain stopped early, skipping complete callback', {
        workflow_instance_ref: workflowRef,
        run_ref: runRef
      });
      return;
    }

    logger.info('auto.execute.completed', 'Auto-execution completed for workflow', {
      workflow_instance_ref: workflowRef,
      run_ref: runRef
    });

    try {
      const complete = await postWorkflowWithRetry(`/internal/workflows/${workflowRef}/complete`, { run_ref: runRef });
      if (!complete.ok) {
        logger.warn('auto.execute.complete_callback_failed', 'Failed to send completion callback to workflow service', {
          workflow_instance_ref: workflowRef,
          status: complete.status
        });
      }
    } catch (completeError) {
      logger.warn('auto.execute.complete_callback_failed', 'Failed to send completion callback to workflow service', {
        workflow_instance_ref: workflowRef,
        error: String(completeError)
      });
    }
  } catch (error) {
    logger.error('auto.execute.error', 'Auto-execution error', {
      workflow_instance_ref: workflowRef,
      error: String(error)
    });
  }
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
