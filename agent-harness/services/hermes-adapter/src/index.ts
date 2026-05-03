import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, analyze, writeAggregationReport } from '@agent-harness/shared';
import { hermesMemories } from '@agent-harness/shared';
import { db } from './db';

const logger = createLogger('hermes-adapter', {
  logFile: process.env.LOG_FILE || 'logs/hermes-adapter.log'
});
const port = Number(process.env.PORT || 3005);

interface MemoryEntry {
  id: string;
  owner_user_id: string;
  org_id: string | null;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  token_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface SkillRecord {
  id: string;
  skill_name: string;
  description: string;
  skill_type: string;
  scope_type: string;
  status: string;
  version: number;
  definition_json: Record<string, unknown>;
}

const memoryStore = new Map<string, MemoryEntry[]>();
const MAX_MEMORY_PER_SESSION = Number(process.env.MAX_MEMORY_PER_SESSION || 100);
const MEMORY_SUMMARY_THRESHOLD = Number(process.env.MEMORY_SUMMARY_THRESHOLD || 50);
const FACT_RETRIEVAL_URL = process.env.FACT_RETRIEVAL_URL || 'http://fact-retrieval:3000';
const LITELLM_URL = process.env.LITELLM_URL || process.env.LLM_API_URL || 'http://litellm:4000';
const LITELLM_MODEL = process.env.LITELLM_MODEL || 'gpt-4o-mini';
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY || process.env.LLM_API_KEY || '';
if (!LITELLM_MASTER_KEY) logger.warn('config.missing', 'LITELLM_MASTER_KEY or LLM_API_KEY environment variable is not set');

let dbPool: InstanceType<typeof import('pg').Pool> | null = null;

async function getDbPool() {
  if (dbPool) return dbPool;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  try {
    const { Pool } = await import('pg');
    dbPool = new Pool({ connectionString: dbUrl, max: 4 });
    await dbPool.query('SELECT 1');
    logger.info('db.connected', 'Hermes adapter connected to database');
    return dbPool;
  } catch (error) {
    logger.warn('db.connect_failed', 'Failed to connect to database', { error: String(error) });
    dbPool = null;
    return null;
  }
}

async function ensureMemoryTable(pool: InstanceType<typeof import('pg').Pool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hermes_memory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id TEXT NOT NULL,
      org_id UUID,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hermes_memory_owner_session ON hermes_memory (owner_user_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_hermes_memory_created ON hermes_memory (created_at);
  `);
}

function getMemoryKey(ownerUserId: string, sessionId: string): string {
  return `${ownerUserId}::${sessionId}`;
}

function generateId(): string {
  return crypto.randomUUID();
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function estimateTokenCount(text: string): number {
  // 改进的 token 估算：中文约 1.5 字符/token，英文约 4 字符/token，混合文本取中间值
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

async function compressMemory(entries: MemoryEntry[]): Promise<string> {
  if (entries.length < MEMORY_SUMMARY_THRESHOLD) {
    return entries.map(e => `${e.role}: ${e.content}`).join('\n');
  }

  try {
    const conversationText = entries.map(e => `${e.role}: ${e.content}`).join('\n');
    const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(LITELLM_MASTER_KEY ? { authorization: `Bearer ${LITELLM_MASTER_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: LITELLM_MODEL,
        messages: [
          { role: 'system', content: 'Summarize the following conversation history concisely, preserving key facts, decisions, and context. Output only the summary.' },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      logger.warn('memory.compress_failed', 'LLM compression failed, using raw text', { status: response.status });
      return conversationText;
    }

    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return result.choices?.[0]?.message?.content || conversationText;
  } catch (error) {
    logger.warn('memory.compress_error', 'LLM compression error, using raw text', { error: String(error) });
    return entries.map(e => `${e.role}: ${e.content}`).join('\n');
  }
}

async function fetchSkillsFromDb(ownerUserId: string, query?: string): Promise<SkillRecord[]> {
  const pool = await getDbPool();
  if (!pool) return [];

  try {
    const conditions: string[] = ["s.status != 'deleted'"];
    const params: unknown[] = [];
    let paramIdx = 1;
    if (query) {
      conditions.push(`(s.skill_name ILIKE $${paramIdx} OR s.description ILIKE $${paramIdx})`);
      params.push(`%${query}%`);
      paramIdx++;
    }

    const sql = `
      SELECT s.id, s.skill_name, s.description, s.skill_type, s.scope_type, s.status,
             sv.version, sv.definition_json
      FROM skill s
      LEFT JOIN LATERAL (
        SELECT version, definition_json FROM skill_version
        WHERE skill_id = s.id
        ORDER BY version DESC LIMIT 1
      ) sv ON true
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.skill_name
      LIMIT 20
    `;

    const result = await pool.query(sql, params);
    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      skill_name: String(row.skill_name || ''),
      description: String(row.description || ''),
      skill_type: String(row.skill_type || 'prompt'),
      scope_type: String(row.scope_type || 'private'),
      status: String(row.status || 'active'),
      version: Number(row.version || 1),
      definition_json: typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : (row.definition_json as Record<string, unknown> || {}),
    }));
  } catch (error) {
    logger.warn('skills.fetch_error', 'Failed to fetch skills from DB', { error: String(error) });
    return [];
  }
}

async function persistMemoryToDb(entries: MemoryEntry[]): Promise<void> {
  if (!db || entries.length === 0) return;

  try {
    for (const entry of entries) {
      await db.insert(hermesMemories).values({
        ownerUserId: entry.owner_user_id,
        orgId: entry.org_id,
        sessionId: entry.session_id,
        role: entry.role,
        content: entry.content,
        tokenCount: entry.token_count,
        metadata: entry.metadata,
        createdAt: new Date(entry.created_at),
      }).onConflictDoNothing();
    }
  } catch (error) {
    logger.warn('memory.persist_db_error', 'Failed to persist memory to DB', { error: String(error) });
  }
}

async function persistMemoryToFactRetrieval(ownerUserId: string, orgId: string | null, sessionId: string, entries: MemoryEntry[]): Promise<void> {
  if (entries.length === 0) return;

  try {
    const summaryText = entries.slice(-5).map(e => `${e.role}: ${e.content}`).join('\n');
    const res = await fetch(`${FACT_RETRIEVAL_URL}/internal/facts/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: ownerUserId,
        org_id: orgId,
        fact_text: `[session:${sessionId}] ${summaryText}`,
        scope: ['private'],
        mode: 'insert',
        subject_ref: `session:${sessionId}`,
        predicate: 'has_context',
        object_value: summaryText,
        confidence: 0.7,
      }),
    });
    if (!res.ok) {
      logger.warn('memory.persist_error', 'Fact-retrieval rejected memory persistence', { status: res.status });
    }
  } catch (error) {
    logger.warn('memory.persist_error', 'Failed to persist memory to fact-retrieval', { error: String(error) });
  }
}

async function recallMemoryFromDb(ownerUserId: string, sessionId: string, limit: number, orgId?: string): Promise<MemoryEntry[]> {
  const pool = await getDbPool();
  if (!pool) return [];

  try {
    const params: Array<string | number> = [ownerUserId, sessionId, limit];
    let orgCondition = '';
    if (orgId) {
      orgCondition = ' AND org_id = $4';
      params.push(orgId);
    }
    const result = await pool.query(
      `SELECT id, owner_user_id, org_id, session_id, role, content, token_count, metadata, created_at
       FROM hermes_memory
       WHERE owner_user_id = $1 AND session_id = $2${orgCondition}
       ORDER BY created_at DESC LIMIT $3`,
      params
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      owner_user_id: String(row.owner_user_id),
      org_id: row.org_id ? String(row.org_id) : null,
      session_id: String(row.session_id),
      role: String(row.role) as MemoryEntry['role'],
      content: String(row.content),
      token_count: Number(row.token_count),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown> || {}),
      created_at: String(row.created_at),
    })).reverse();
  } catch (error) {
    logger.warn('memory.recall_db_error', 'Failed to recall memory from DB', { error: String(error) });
    return [];
  }
}

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';
  const originalEnd = res.end.bind(res);
  const responseChunks: Buffer[] = [];
  const originalWrite = res.write.bind(res);
  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) responseChunks.push(Buffer.from(String(chunk)));
    return (originalWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
  } as typeof res.write;
  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) responseChunks.push(Buffer.from(String(chunk)));
    responseBody = Buffer.concat(responseChunks).toString('utf-8').slice(0, 2000);
    return (originalEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
  } as typeof res.end;

  const pathname = new URL(req.url || '/', `http://localhost:${port}`).pathname;

  if (pathname === '/health/live' || pathname === '/health/ready') {
    sendJson(res, 200, { ok: true, service: 'hermes-adapter' });
    return;
  }

  if (pathname === '/internal/memory' && req.method === 'POST') {
    const body = await readJson(req);
    const ownerUserId = String(body.owner_user_id || '');
    const orgId = body.org_id ? String(body.org_id) : null;
    const sessionId = String(body.session_id || 'default');
    const role = String(body.role || 'user') as MemoryEntry['role'];
    const content = String(body.content || '');

    if (!ownerUserId || !content) {
      sendJson(res, 400, { ok: false, error: 'missing_required_fields', required: ['owner_user_id', 'content'] });
      return;
    }

    const key = getMemoryKey(ownerUserId, sessionId);
    let entries = memoryStore.get(key) || [];

    const entry: MemoryEntry = {
      id: generateId(),
      owner_user_id: ownerUserId,
      org_id: orgId,
      session_id: sessionId,
      role,
      content,
      token_count: estimateTokenCount(content),
      metadata: (body.metadata as Record<string, unknown>) || {},
      created_at: new Date().toISOString(),
    };

    entries.push(entry);

    void persistMemoryToDb([entry]).catch(err => logger.warn('hermes.persist.db_failed', 'Failed to persist memory to DB', { error: String(err) }));
    void persistMemoryToFactRetrieval(ownerUserId, orgId, sessionId, [entry]).catch(err => logger.warn('hermes.persist.fact_failed', 'Failed to persist to fact retrieval', { error: String(err) }));

    if (entries.length > MAX_MEMORY_PER_SESSION) {
      const overflow = entries.slice(0, entries.length - MEMORY_SUMMARY_THRESHOLD);
      await persistMemoryToDb(overflow);
      await persistMemoryToFactRetrieval(ownerUserId, orgId, sessionId, overflow);
      entries = entries.slice(-MEMORY_SUMMARY_THRESHOLD);
    }

    memoryStore.set(key, entries);

    sendJson(res, 200, {
      ok: true,
      memory_id: entry.id,
      session_id: sessionId,
      entry_count: entries.length,
      total_tokens: entries.reduce((sum, e) => sum + e.token_count, 0),
    });
    return;
  }

  if (pathname === '/internal/memory/recall' && req.method === 'POST') {
    const body = await readJson(req);
    const ownerUserId = String(body.owner_user_id || '');
    const sessionId = String(body.session_id || 'default');
    const orgId = typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined;
    const limit = Math.min(Number(body.limit || 20), MAX_MEMORY_PER_SESSION);

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' });
      return;
    }

    const key = getMemoryKey(ownerUserId, sessionId);
    const inMemoryEntries = memoryStore.get(key) || [];
    const dbEntries = await recallMemoryFromDb(ownerUserId, sessionId, limit, orgId);

    const allEntries = [...dbEntries, ...inMemoryEntries];
    const recalled = allEntries.slice(-limit);

    const compressed = await compressMemory(recalled);

    sendJson(res, 200, {
      ok: true,
      session_id: sessionId,
      entry_count: recalled.length,
      total_tokens: recalled.reduce((sum, e) => sum + e.token_count, 0),
      compressed_context: compressed,
      entries: recalled.map(e => ({
        id: e.id,
        role: e.role,
        content: e.content,
        token_count: e.token_count,
        created_at: e.created_at,
      })),
    });
    return;
  }

  if (pathname === '/internal/memory/clear' && req.method === 'POST') {
    const body = await readJson(req);
    const ownerUserId = String(body.owner_user_id || '');
    const sessionId = String(body.session_id || '');

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' });
      return;
    }

    const pool = await getDbPool();

    if (sessionId) {
      const key = getMemoryKey(ownerUserId, sessionId);
      const entries = memoryStore.get(key) || [];
      await persistMemoryToFactRetrieval(ownerUserId, null, sessionId, entries);
      memoryStore.delete(key);
      if (pool) {
        try { await pool.query('DELETE FROM hermes_memory WHERE owner_user_id = $1 AND session_id = $2', [ownerUserId, sessionId]); } catch { /* table may not exist */ }
      }
      sendJson(res, 200, { ok: true, cleared_session: sessionId, cleared_count: entries.length });
    } else {
      let totalCleared = 0;
      for (const [key, entries] of memoryStore.entries()) {
        if (key.startsWith(`${ownerUserId}::`)) {
          await persistMemoryToFactRetrieval(ownerUserId, null, key.split('::')[1], entries);
          memoryStore.delete(key);
          totalCleared += entries.length;
        }
      }
      if (pool) {
        try { const r = await pool.query('DELETE FROM hermes_memory WHERE owner_user_id = $1', [ownerUserId]); totalCleared += Number(r.rowCount || 0); } catch { /* table may not exist */ }
      }
      sendJson(res, 200, { ok: true, cleared_all_sessions: true, cleared_count: totalCleared });
    }
    return;
  }

  if (pathname === '/internal/skills/search' && req.method === 'POST') {
    const body = await readJson(req);
    const ownerUserId = String(body.owner_user_id || '');
    const query = String(body.query || '');

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' });
      return;
    }

    const skills = await fetchSkillsFromDb(ownerUserId, query);

    sendJson(res, 200, {
      ok: true,
      query,
      total: skills.length,
      skills: skills.map(s => ({
        id: s.id,
        skill_name: s.skill_name,
        description: s.description,
        skill_type: s.skill_type,
        scope_type: s.scope_type,
        status: s.status,
        version: s.version,
        definition_json: s.definition_json,
      })),
    });
    return;
  }

  if (pathname.startsWith('/internal/skills/') && req.method === 'GET' && pathname !== '/internal/skills/search') {
    const skillId = pathname.split('/internal/skills/')[1];
    if (!skillId) {
      sendJson(res, 400, { ok: false, error: 'missing_skill_id' });
      return;
    }

    const pool = await getDbPool();
    if (!pool) {
      sendJson(res, 503, { ok: false, error: 'database_not_available' });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT s.id, s.skill_name, s.description, s.skill_type, s.scope_type, s.status,
                sv.version, sv.definition_json
         FROM skill s
         LEFT JOIN LATERAL (
           SELECT version, definition_json FROM skill_version
           WHERE skill_id = s.id ORDER BY version DESC LIMIT 1
         ) sv ON true
         WHERE s.id = $1 AND s.status != 'deleted'`,
        [skillId]
      );

      if (result.rows.length === 0) {
        sendJson(res, 404, { ok: false, error: 'skill_not_found' });
        return;
      }

      const row = result.rows[0];
      sendJson(res, 200, {
        ok: true,
        skill: {
          id: String(row.id),
          skill_name: String(row.skill_name),
          description: String(row.description),
          skill_type: String(row.skill_type),
          scope_type: String(row.scope_type),
          status: String(row.status),
          version: Number(row.version || 1),
          definition_json: typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json,
        },
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: 'database_error', detail: String(error) });
    }
    return;
  }

  if (pathname === '/internal/context/compress' && req.method === 'POST') {
    const body = await readJson(req);
    const ownerUserId = String(body.owner_user_id || '');
    const sessionId = String(body.session_id || 'default');
    const orgId = typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined;
    const maxTokens = Number(body.max_tokens || 2048);

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' });
      return;
    }

    const key = getMemoryKey(ownerUserId, sessionId);
    const inMemoryEntries = memoryStore.get(key) || [];
    const dbEntries = await recallMemoryFromDb(ownerUserId, sessionId, 50, orgId);
    const entries = [...dbEntries, ...inMemoryEntries];
    const totalTokens = entries.reduce((sum, e) => sum + e.token_count, 0);

    if (totalTokens <= maxTokens) {
      sendJson(res, 200, {
        ok: true,
        compressed: false,
        original_tokens: totalTokens,
        context: entries.map(e => `${e.role}: ${e.content}`).join('\n'),
      });
      return;
    }

    const compressed = await compressMemory(entries);
    const compressedTokens = estimateTokenCount(compressed);

    sendJson(res, 200, {
      ok: true,
      compressed: true,
      original_tokens: totalTokens,
      compressed_tokens: compressedTokens,
      compression_ratio: totalTokens > 0 ? compressedTokens / totalTokens : 1,
      context: compressed,
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  await httpResponseLogger(req, res, responseBody);
});

let aT_: ReturnType<typeof setInterval> | null = null;

server.listen(port, () => {
  logger.info('service.started', 'Hermes adapter started', { port });
  void getDbPool();
  aT_ = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') writeAggregationReport(report);
  }, 15000);
  if (aT_.unref) aT_.unref();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (aT_) { clearInterval(aT_); aT_ = null; }
    writeAggregationReport(analyze());
    metricsRegistry.shutdown();
    server.close(async () => {
      await logger.shutdown();
      process.exit(0);
    });
  });
}
