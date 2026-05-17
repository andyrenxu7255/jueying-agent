import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { closeDbPool } from './db';
import { type FactWriteInput, factRetrievalService, type RetrievalQueryInput } from './service';
import { configManager, createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, analyze, writeAggregationReport } from '@agent-harness/shared';

const logger = createLogger('fact-retrieval', {
  logFile: process.env.LOG_FILE || 'logs/fact-retrieval.log'
});
const port = Number(process.env.PORT || process.env.SERVER_PORT || configManager.getPath<number>('server.port') || 3004);

async function readJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  const MAX_BODY_SIZE = 3 * 1024 * 1024;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new Error('request_body_too_large');
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
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

const MAX_CONTENT_TEXT_SIZE = 2 * 1024 * 1024;

const OWNER_USER_ID_PATTERN = /^u_[a-z0-9][a-z0-9_-]{0,62}$/;

function validateOwnerUserId(ownerUserId: string, res: import('node:http').ServerResponse): boolean {
  if (!ownerUserId || !OWNER_USER_ID_PATTERN.test(ownerUserId)) {
    sendJson(res, 400, { ok: false, error: 'invalid_owner_user_id', message: 'owner_user_id must match pattern u_[a-z0-9][a-z0-9_-]{0,62}' });
    return false;
  }
  return true;
}

function verifyHmacAuth(authHeader: string | undefined, maxAgeSec: number = 300): boolean {
  const resetSecret = process.env.TEST_RESET_SECRET;
  if (!resetSecret) return !!process.env.TEST_RESET_TOKEN;
  if (!authHeader || !authHeader.startsWith('HMAC ')) return false;
  const token = authHeader.slice(5);
  const parts = token.split(':');
  if (parts.length !== 2) return false;
  const [timestampStr, providedSig] = parts;
  const timestamp = Number(timestampStr);
  if (isNaN(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > maxAgeSec) return false;
  const expectedSig = createHmac('sha256', resetSecret)
    .update(`reset:${timestamp}`)
    .digest('hex');
  try {
    return timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let rBody = '';
  const cE = res.end.bind(res);
  const chunks: Buffer[] = [];
  const cW = res.write.bind(res);
  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    return (cW as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
  } as typeof res.write;
  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    rBody = Buffer.concat(chunks).toString('utf-8').slice(0, 2000);
    return (cE as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
  } as typeof res.end;

  const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  try {
    if (pathname === '/health' || pathname === '/health/live' || pathname === '/health/ready') {
      sendJson(res, 200, { ok: true, service: 'fact-retrieval' });
      return;
    }

    if (pathname === '/internal/test/reset' && req.method === 'POST') {
      if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
        sendJson(res, 404, { ok: false, error: 'not_found' });
        return;
      }
      const resetSecret = process.env.TEST_RESET_SECRET;
      const resetToken = process.env.TEST_RESET_TOKEN;
      const authHeader = req.headers['authorization'];
      let authorized = false;
      if (resetSecret) {
        authorized = verifyHmacAuth(authHeader);
      } else if (resetToken) {
        authorized = authHeader === `Bearer ${resetToken}`;
      }
      if (!authorized) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      await factRetrievalService.resetAllData();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/internal/documents/index' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      if (!validateOwnerUserId(ownerUserId, res)) return;
      const contentText = String(body.content_text || '');
      if (contentText.length > MAX_CONTENT_TEXT_SIZE) {
        sendJson(res, 400, { ok: false, error: 'content_text_too_large', message: `content_text exceeds ${MAX_CONTENT_TEXT_SIZE} bytes` });
        return;
      }
      const result = await factRetrievalService.indexDocument({
        owner_user_id: ownerUserId,
        title: String(body.title || ''),
        content_text: contentText,
        source_type: String(body.source_kind || body.source_type || 'manual'),
        source_uri: typeof body.source_uri === 'string' ? body.source_uri : '',
        scope: Array.isArray(body.scope) ? body.scope.map((item: unknown) => String(item)) : [body.scope_type === 'public' ? 'public' : 'private'],
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/internal/retrieval/query' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      if (!validateOwnerUserId(ownerUserId, res)) return;
      const result = await factRetrievalService.query({
        owner_user_id: ownerUserId,
        org_id: typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined,
        query_text: String(body.query_text || ''),
        intent_type: (body.intent_type as RetrievalQueryInput['intent_type']) || 'object-status',
        allowed_scopes: Array.isArray(body.allowed_scopes) ? body.allowed_scopes.map((item: unknown) => String(item)) : ['private'],
      });
      const items = result.items.map(item => ({
        item_type: item.fact_id ? 'fact' : 'document_chunk',
        item_ref: item.chunk_id || item.fact_id || '',
        evidence_ref: item.chunk_id || item.fact_id || '',
        content: item.content,
        score: item.score,
        source_scope: item.source_scope
      }));
      sendJson(res, 200, {
        ok: true,
        evidence_pack: {
          id: result.evidence_pack_id,
          hash: result.evidence_pack_hash,
          evidence_pack_hash: result.evidence_pack_hash,
          items
        },
        retrieval_trace_id: result.retrieval_trace_id || result.evidence_pack_id,
        evidence_pack_hash: result.evidence_pack_hash,
        degraded: result.degraded,
        degradation_reasons: result.degradation_reasons,
        retrieval_steps: result.retrieval_steps
      });
      return;
    }

    if (pathname === '/internal/facts/write' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      if (!validateOwnerUserId(ownerUserId, res)) return;
      const result = await factRetrievalService.writeFact({
        owner_user_id: ownerUserId,
        org_id: typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined,
        fact_text: String(body.object_value || body.fact_text || ''),
        subject_ref: typeof body.subject_ref === 'string' ? body.subject_ref : undefined,
        predicate: typeof body.predicate === 'string' ? body.predicate : undefined,
        object_value: typeof body.object_value === 'string' ? body.object_value : undefined,
        scope: Array.isArray(body.scope) ? body.scope.map((item: unknown) => String(item)) : [body.scope_type === 'public' ? 'public' : 'private'],
        mode: (body.mode as FactWriteInput['mode']) || 'insert',
        target_fact_id: typeof body.target_fact_id === 'string' ? body.target_fact_id : undefined,
        evidence_refs: Array.isArray(body.evidence_refs)
          ? body.evidence_refs.map((ref: Record<string, unknown>) => ({
              evidence_pack_id: String(ref.evidence_ref || ref.evidence_pack_id || ''),
              evidence_pack_hash: String(ref.evidence_pack_hash || ref.evidence_type || '')
            }))
          : undefined,
        confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/internal/artifacts/write' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      if (!validateOwnerUserId(ownerUserId, res)) return;
      const contentText = String(body.content_text || '');
      if (contentText.length > MAX_CONTENT_TEXT_SIZE) {
        sendJson(res, 400, { ok: false, error: 'content_text_too_large', message: `content_text exceeds ${MAX_CONTENT_TEXT_SIZE} bytes` });
        return;
      }
      const result = await factRetrievalService.writeArtifact({
        owner_user_id: ownerUserId,
        org_id: typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined,
        artifact_type: String(body.artifact_type || 'text'),
        content_text: contentText,
        scope: Array.isArray(body.scope) ? body.scope.map((item: unknown) => String(item)) : [body.scope_type === 'public' ? 'public' : 'private'],
        metadata: (body.metadata as Record<string, unknown> | undefined) || {},
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/internal/artifacts/read' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      if (!validateOwnerUserId(ownerUserId, res)) return;
      const result = await factRetrievalService.readArtifact({
        owner_user_id: ownerUserId,
        artifact_id: String(body.artifact_id || ''),
        scope: Array.isArray(body.scope) ? body.scope.map((item: unknown) => String(item)) : ['private'],
        org_id: typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined,
      });
      if ('error' in result) {
        const statusCode = result.error === 'not_found' ? 404 : 403;
        sendJson(res, statusCode, { ok: false, error: result.error });
        return;
      }
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/internal/embeddings/backfill' && req.method === 'POST') {
      const body = await readJson(req);
      const limit = typeof body.limit === 'number' ? Math.min(body.limit, 500) : 100;
      const result = await factRetrievalService.backfillAllPendingEmbeddings(limit);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/internal/entities/write' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      if (!validateOwnerUserId(ownerUserId, res)) return;
      const entityInput: Array<{ name: string; type: string; attributes?: Record<string, string> }> = Array.isArray(body.entities) ? body.entities : [];
      if (entityInput.length === 0) {
        sendJson(res, 400, { ok: false, error: 'missing_entities', message: 'entities array is required and must not be empty' });
        return;
      }
      const result = await factRetrievalService.writeEntities({
        owner_user_id: ownerUserId,
        org_id: typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined,
        entities: entityInput,
        slots: Array.isArray(body.slots) ? body.slots : undefined,
        scope: Array.isArray(body.scope) ? body.scope.map((item: unknown) => String(item)) : [body.scope_type === 'public' ? 'public' : 'private'],
        source_ref: typeof body.source_ref === 'string' ? body.source_ref : undefined,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    // 用户通过飞书/企微主动提交知识 — 写入 unconfirmed 待审核池
    if (pathname === '/internal/fact/submit' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      if (!validateOwnerUserId(ownerUserId, res)) return;
      const sourceText = String(body.source_text || '');
      if (!sourceText.trim()) {
        sendJson(res, 400, { ok: false, error: 'missing_source_text' });
        return;
      }
      const result = await factRetrievalService.submitUserFact({
        owner_user_id: ownerUserId,
        org_id: typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined,
        source_text: sourceText,
        source: String(body.source || 'user_submitted'),
      });
      sendJson(res, 200, { ok: true, fact_id: result.fact_id, message: '知识已提交至审核池' });
      return;
    }

    // 知识审核台: 查询 unconfirmed 知识列表
    if (pathname === '/internal/fact/review' && req.method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost');
      const orgId = url.searchParams.get('org_id') || '';
      const status = url.searchParams.get('status') || 'unconfirmed';
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
      const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
      const result = await factRetrievalService.listFactsForReview({
        org_id: orgId || undefined,
        status,
        limit,
        offset
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    // 知识审核台: 批准/拒绝/退回 知识条目
    if (pathname === '/internal/fact/review' && req.method === 'POST') {
      const body = await readJson(req);
      const factId = String(body.fact_id || '');
      const action = String(body.action || '');
      const reviewerId = String(body.reviewer_id || '');
      if (!factId || !['approve', 'approve_shared', 'approve_org', 'reject', 'return'].includes(action)) {
        sendJson(res, 400, { ok: false, error: 'invalid_params', message: 'fact_id and valid action required' });
        return;
      }
      const result = await factRetrievalService.reviewFact({
        fact_id: factId,
        action: action as 'approve' | 'approve_shared' | 'approve_org' | 'reject' | 'return',
        reviewer_id: reviewerId || 'system',
        review_note: String(body.review_note || ''),
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    // 定时知识抽取: 从对话记忆中提取结构化知识
    if (pathname === '/internal/knowledge/extract' && req.method === 'POST') {
      const body = await readJson(req);
      const orgId = String(body.org_id || '');
      const limit = typeof body.limit === 'number' ? Math.min(body.limit, 100) : 20;
      const result = await factRetrievalService.extractKnowledgeFromMemory({
        org_id: orgId || undefined,
        limit,
        requested_by: String(body.requested_by || 'system')
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    // ── 用户文件管理 ──
    if (pathname === '/internal/files' && req.method === 'GET') {
      const pUrl = new URL(req.url || '/', `http://localhost:${port}`);
      const ownerUserId = pUrl.searchParams.get('owner_user_id') || '';
      const orgId = pUrl.searchParams.get('org_id') || null;
      const category = pUrl.searchParams.get('category') || '';
      const scope = pUrl.searchParams.get('scope') || '';
      const limit = Math.min(Number(pUrl.searchParams.get('limit') || 50), 200);
      const offset = Number(pUrl.searchParams.get('offset') || 0);
      if (!ownerUserId) { sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' }); return; }
      const result = await factRetrievalService.listUserFiles({
        owner_user_id: ownerUserId,
        org_id: orgId,
        category: category || undefined,
        scope: scope || undefined,
        limit,
        offset
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/internal/files/upload' && req.method === 'POST') {
      const body = await readJson(req);
      const bufferBase64 = String(body.file_buffer_b64 || '');
      const result = await factRetrievalService.uploadAndStoreFile({
        owner_user_id: String(body.owner_user_id || ''),
        org_id: body.org_id ? String(body.org_id) : null,
        file_buffer_b64: bufferBase64,
        original_name: String(body.original_name || 'unknown.bin'),
        mime_type: String(body.mime_type || 'application/octet-stream'),
        source: String(body.source || 'user_upload'),
        scope: String(body.scope || 'private'),
        file_category: String(body.file_category || 'upload'),
      });
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error });
        return;
      }
      sendJson(res, 201, { ok: true, file: result.file });
      return;
    }

    if (pathname.startsWith('/internal/files/') && pathname.endsWith('/download') && req.method === 'GET') {
      const fileId = pathname.split('/')[3];
      if (!fileId) { sendJson(res, 400, { ok: false, error: 'missing_file_id' }); return; }
      const pUrl = new URL(req.url || '/', `http://localhost:${port}`);
      const requestingUserId = pUrl.searchParams.get('user_id') || '';
      const result = await factRetrievalService.downloadUserFile(fileId, requestingUserId);
      if (!result.file) {
        sendJson(res, 404, { ok: false, error: result.error || 'file_not_found' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        original_name: result.file.original_name,
        mime_type: result.file.mime_type,
        buffer_b64: result.file.buffer_b64,
      });
      return;
    }

    if (pathname.startsWith('/internal/files/') && pathname.endsWith('/share') && req.method === 'POST') {
      const fileId = pathname.split('/')[3];
      const body = await readJson(req);
      const newScope = String(body.scope || 'shared');
      if (!['private', 'shared', 'public'].includes(newScope)) {
        sendJson(res, 400, { ok: false, error: 'invalid_scope' });
        return;
      }
      const result = await factRetrievalService.updateFileScope(fileId, String(body.requested_by || ''), newScope);
      sendJson(res, result.ok ? 200 : 404, result);
      return;
    }

    if (pathname.startsWith('/internal/files/') && req.method === 'DELETE') {
      const fileId = pathname.split('/')[3];
      const pUrl = new URL(req.url || '/', `http://localhost:${port}`);
      const requestingUserId = pUrl.searchParams.get('user_id') || '';
      const result = await factRetrievalService.deleteUserFile(fileId, requestingUserId);
      sendJson(res, result.ok ? 200 : 404, result);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.failed', 'Fact retrieval request failed', { pathname, error: String(error) });
    sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
  await httpResponseLogger(req, res, rBody);
});

let aggT_: ReturnType<typeof setInterval> | null = null;

server.listen(port, () => {
  logger.info('service.started', 'Fact retrieval service started', { port });

  aggT_ = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') writeAggregationReport(report);
  }, 15000);
  if (aggT_.unref) aggT_.unref();

  const projectionInterval = Number(process.env.PROJECTION_APPLY_INTERVAL_SEC || 60) * 1000;
  const projectionTimer = setInterval(async () => {
    try {
      const result = await factRetrievalService.applyPendingProjectionEvents();
      if (result.applied > 0 || result.failed > 0) {
        logger.info('projection.tick', 'Projection apply tick', result);
      }
    } catch (error) {
      logger.warn('projection.tick_failed', 'Projection apply tick failed', { error: String(error) });
    }
  }, projectionInterval);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      clearInterval(projectionTimer);
      if (aggT_) { clearInterval(aggT_); aggT_ = null; }
      writeAggregationReport(analyze());
      metricsRegistry.shutdown();
      server.close(async () => {
        await logger.shutdown();
        await closeDbPool();
        process.exit(0);
      });
    });
  }
});
