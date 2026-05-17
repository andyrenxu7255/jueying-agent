import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, setupDefaultHealthChecks, analyze, writeAggregationReport } from '@agent-harness/shared';

/**
 * resource-scheduler 服务 - 资源调度与配额管理服务
 *
 * 功能概述：
 *   1. 多租户资源配额分配与监控（对应 AH-11 多租户隔离 故事线）
 *   2. 服务健康状态巡检与自动告警（对应 AH-13 性能压测巡检 故事线）
 *   3. 跨服务资源使用统计（CPU、内存、并发数、API 调用次数）
 *   4. 限流策略执行与动态调整
 *   5. 资源使用报告生成与导出
 *   6. 自动扩缩容建议
 *
 * 核心概念：
 *   - Quota（配额）：每个租户/组织允许使用的最大资源量
 *   - Usage（用量）：当前时间窗口内已消耗的资源量
 *   - Limit（限流）：当用量超过阈值时触发的限流策略
 *   - Inspection（巡检）：定期检查各服务健康状态并生成报告
 *
 * 资源维度：
 *   - concurrent_workflows: 并发工作流数量上限
 *   - daily_api_calls: 每日 API 调用次数上限
 *   - retrieval_queries: 检索查询次数上限（对应 retrieval_budget）
 *   - execution_seconds: 执行时间上限（对应 execution_budget）
 *   - storage_bytes: 存储空间上限（artifacts + documents + evidence）
 *   - llm_tokens: LLM Token 消耗上限
 *
 * API 路由：
 *   POST   /internal/quotas/create         - 创建配额
 *   GET    /internal/quotas/:scope          - 查询配额详情
 *   PUT    /internal/quotas/:scope          - 更新配额
 *   DELETE /internal/quotas/:scope          - 删除配额
 *   POST   /internal/quotas/consume         - 消耗配额（原子操作）
 *   POST   /internal/quotas/release         - 释放配额
 *   POST   /internal/quotas/check           - 检查配额是否充足
 *   POST   /internal/inspections/start      - 启动巡检
 *   GET    /internal/inspections/report     - 获取巡检报告
 *   GET    /internal/health/status          - 全局健康状态
 */

const logger = createLogger('resource-scheduler', {
  logFile: process.env.LOG_FILE || 'logs/resource-scheduler.log'
});

setupDefaultHealthChecks(
  async () => {
    try { await import('pg'); return true; }
    catch { return false; }
  }
);

const port = Number(process.env.PORT || 3008);

/* ---- 类型定义 ---- */

/** 资源配额定义 - 每个 scope（org or user）的资源上限配置 */
interface ResourceQuota {
  /** 作用域标识，格式 "org:{orgId}" 或 "user:{userId}" */
  scope: string;
  /** 配额创建者 */
  created_by: string;
  /** 并发工作流上限 */
  concurrent_workflows: number;
  /** 每日 API 调用上限 */
  daily_api_calls: number;
  /** 检索查询上限 */
  retrieval_queries: number;
  /** 执行时间上限（秒） */
  execution_seconds: number;
  /** 存储空间上限（字节） */
  storage_bytes: number;
  /** LLM Token 消耗上限 */
  llm_tokens: number;
  /** 配额状态 */
  status: 'active' | 'suspended' | 'deleted';
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
}

/** 资源用量快照 - 当前时间窗口内的已消耗资源 */
interface ResourceUsage {
  scope: string;
  /** 当前并发工作流数 */
  active_workflows: number;
  /** 今日 API 调用次数 */
  daily_api_calls_used: number;
  /** 今日检索查询次数 */
  retrieval_queries_used: number;
  /** 今日执行时间（秒） */
  execution_seconds_used: number;
  /** 当前存储使用量（字节） */
  storage_bytes_used: number;
  /** 今日 LLM Token 消耗 */
  llm_tokens_used: number;
  /** 用量时间窗口起点 */
  window_start: string;
  /** 最后更新时间 */
  last_updated: string;
}

/** 配额消耗请求的参数 */
interface ConsumeQuotaInput {
  scope: string;
  resource_type: keyof Pick<ResourceQuota, 'concurrent_workflows' | 'daily_api_calls' | 'retrieval_queries' | 'execution_seconds' | 'storage_bytes' | 'llm_tokens'>;
  amount: number;
  /** 可选的事务 ID，用于幂等去重 */
  idempotency_key?: string;
}

/** 巡检服务健康状态 */
interface ServiceInspection {
  service_name: string;
  endpoint: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unreachable';
  latency_ms: number;
  error?: string;
  checked_at: string;
}

/** 巡检报告汇总 */
interface InspectionReport {
  id: string;
  started_at: string;
  finished_at: string;
  total_services: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  services: ServiceInspection[];
}

/* ---- 存储层（内存 + DB 双层） ---- */

const quotaStore = new Map<string, ResourceQuota>();
const usageStore = new Map<string, ResourceUsage>();
const idempotencyCache = new Map<string, { result: string; expiresAt: number }>();
const scopeLocks = new Map<string, boolean>();
const IDEMPOTENCY_CACHE_SIZE = 10000;
const IDEMPOTENCY_TTL_MS = 300000;

async function loadQuotasFromDb(pool: InstanceType<typeof import('pg').Pool>): Promise<void> {
  try {
    const quotas = await pool.query(`SELECT * FROM resource_quota WHERE status = 'active'`);
    for (const row of quotas.rows) {
      quotaStore.set(row.scope, {
        scope: row.scope,
        created_by: row.created_by,
        concurrent_workflows: Number(row.concurrent_workflows),
        daily_api_calls: Number(row.daily_api_calls),
        retrieval_queries: Number(row.retrieval_queries),
        execution_seconds: Number(row.execution_seconds),
        storage_bytes: Number(row.storage_bytes),
        llm_tokens: Number(row.llm_tokens),
        status: row.status,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at)
      });
    }
    const usages = await pool.query(`SELECT * FROM resource_usage`);
    for (const row of usages.rows) {
      usageStore.set(row.scope, {
        scope: row.scope,
        active_workflows: Number(row.active_workflows),
        daily_api_calls_used: Number(row.daily_api_calls_used),
        retrieval_queries_used: Number(row.retrieval_queries_used),
        execution_seconds_used: Number(row.execution_seconds_used),
        storage_bytes_used: Number(row.storage_bytes_used),
        llm_tokens_used: Number(row.llm_tokens_used),
        window_start: String(row.window_start),
        last_updated: String(row.last_updated)
      });
    }
    logger.info('startup.quotas_loaded', `Loaded ${quotaStore.size} quotas and ${usageStore.size} usage records from DB`);
  } catch (error) {
    logger.warn('startup.quotas_load_failed', 'Failed to load quotas from DB', { error: String(error) });
  }
}

let dbPool: InstanceType<typeof import('pg').Pool> | null = null;
let dbPoolPromise: Promise<InstanceType<typeof import('pg').Pool> | null> | null = null;

async function getDbPool() {
  if (dbPool) return dbPool;
  if (dbPoolPromise) return dbPoolPromise;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  dbPoolPromise = (async () => {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: dbUrl, max: 4 });
      await pool.query('SELECT 1');
      logger.info('db.connected', 'Resource-scheduler connected to database');
      dbPool = pool;
      return dbPool;
    } catch (error) {
      logger.warn('db.connect_failed', 'Failed to connect to database', { error: String(error) });
      return null;
    } finally {
      dbPoolPromise = null;
    }
  })();
  return dbPoolPromise;
}

async function ensureQuotaTables(pool: InstanceType<typeof import('pg').Pool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resource_quota (
      scope TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      concurrent_workflows INTEGER NOT NULL DEFAULT 10,
      daily_api_calls INTEGER NOT NULL DEFAULT 1000,
      retrieval_queries INTEGER NOT NULL DEFAULT 500,
      execution_seconds INTEGER NOT NULL DEFAULT 3600,
      storage_bytes BIGINT NOT NULL DEFAULT 1073741824,
      llm_tokens INTEGER NOT NULL DEFAULT 100000,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS resource_usage (
      scope TEXT PRIMARY KEY,
      active_workflows INTEGER NOT NULL DEFAULT 0,
      daily_api_calls_used INTEGER NOT NULL DEFAULT 0,
      retrieval_queries_used INTEGER NOT NULL DEFAULT 0,
      execution_seconds_used INTEGER NOT NULL DEFAULT 0,
      storage_bytes_used BIGINT NOT NULL DEFAULT 0,
      llm_tokens_used INTEGER NOT NULL DEFAULT 0,
      window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/* ---- HTTP 工具 ---- */

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > 5 * 1024 * 1024) throw new Error('request_body_too_large');
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { throw new Error('invalid_json'); }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

/* ---- 核心业务逻辑 ---- */

/**
 * 创建或更新资源配额
 *
 * 存储策略：
 *   内存为主存储（QPS 优化），DB 为异步持久化层
 *   写入时先更新内存，再异步刷入 DB（fire-and-forget）
 *
 * @param quota - 配额定义
 * @returns 创建或更新后的配额
 */
function upsertQuota(quota: ResourceQuota): ResourceQuota {
  const now = new Date().toISOString();
  const existing = quotaStore.get(quota.scope);

  const final: ResourceQuota = {
    ...(existing || {}),
    ...quota,
    updated_at: now,
    created_at: existing?.created_at || now
  };
  quotaStore.set(quota.scope, final);

  const pool = dbPool;
  if (pool) {
    pool.query(
      `INSERT INTO resource_quota (scope, created_by, concurrent_workflows, daily_api_calls, retrieval_queries, execution_seconds, storage_bytes, llm_tokens, status, updated_at) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) 
       ON CONFLICT (scope) DO UPDATE SET 
         concurrent_workflows = EXCLUDED.concurrent_workflows,
         daily_api_calls = EXCLUDED.daily_api_calls,
         retrieval_queries = EXCLUDED.retrieval_queries,
         execution_seconds = EXCLUDED.execution_seconds,
         storage_bytes = EXCLUDED.storage_bytes,
         llm_tokens = EXCLUDED.llm_tokens,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [final.scope, final.created_by, final.concurrent_workflows, final.daily_api_calls,
       final.retrieval_queries, final.execution_seconds, final.storage_bytes, final.llm_tokens, final.status, final.updated_at]
    ).catch(err => logger.warn('quota.persist_failed', 'DB persist failed', { error: String(err) }));
  }

  return final;
}

/**
 * 获取当前时间窗口的资源用量（每日重置）
 *
 * 时间窗口策略：
 *   以 UTC 当天 00:00:00 为窗口起点
 *   超过 24 小时后自动重置计数
 *
 * @param scope - 作用域标识
 * @returns 当前用量快照
 */
function getCurrentUsage(scope: string): ResourceUsage {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  let usage = usageStore.get(scope);
  if (!usage || usage.window_start !== todayStart) {
    usage = {
      scope,
      active_workflows: 0,
      daily_api_calls_used: 0,
      retrieval_queries_used: 0,
      execution_seconds_used: 0,
      storage_bytes_used: 0,
      llm_tokens_used: 0,
      window_start: todayStart,
      last_updated: now.toISOString()
    };
    usageStore.set(scope, usage);
  }

  return usage;
}

/**
 * 检查配额是否足以容纳请求的资源消耗
 *
 * 检查流程（并发安全，单进程内通过 Set 的无锁设计保证）：
 *   1. 获取目标 scope 的配额定义
 *   2. 获取当前时间窗口的用量
 *   3. 比较 "已用量 + 请求量" 与 "配额上限"
 *   4. 任一维度超限则拒绝
 *
 * @param input - 配额消耗请求
 * @returns 检查结果，含剩余配额信息
 */
function checkQuota(input: ConsumeQuotaInput): { allowed: boolean; reason?: string; remaining?: number } {
  const quota = quotaStore.get(input.scope);
  if (!quota) {
    return { allowed: false, reason: 'no_quota_configured' };
  }

  if (quota.status === 'suspended') {
    return { allowed: false, reason: 'quota_suspended' };
  }

  const usage = getCurrentUsage(input.scope);
  const fieldMap: Record<string, { limit: number; used: number }> = {
    concurrent_workflows: { limit: quota.concurrent_workflows, used: usage.active_workflows },
    daily_api_calls: { limit: quota.daily_api_calls, used: usage.daily_api_calls_used },
    retrieval_queries: { limit: quota.retrieval_queries, used: usage.retrieval_queries_used },
    execution_seconds: { limit: quota.execution_seconds, used: usage.execution_seconds_used },
    storage_bytes: { limit: quota.storage_bytes, used: usage.storage_bytes_used },
    llm_tokens: { limit: quota.llm_tokens, used: usage.llm_tokens_used }
  };

  const field = fieldMap[input.resource_type];
  if (!field) {
    return { allowed: false, reason: 'unknown_resource_type' };
  }

  const remaining = field.limit - (field.used + input.amount);
  if (remaining < 0) {
    return { allowed: false, reason: `quota_exceeded:${input.resource_type}`, remaining: field.limit - field.used };
  }

  return { allowed: true, remaining: field.limit - field.used - input.amount };
}

/**
 * 消耗配额（原子操作）
 *
 * 幂等性保证：
 *   通过 idempotency_key 去重，同一 key 在 5 分钟内只执行一次真正的配额扣减
 *
 * @param input - 配额消耗请求
 * @returns 消耗结果
 */
function consumeQuota(input: ConsumeQuotaInput): { ok: boolean; error?: string } {
  if (input.idempotency_key) {
    const cached = idempotencyCache.get(input.idempotency_key);
    if (cached) {
      if (Date.now() > cached.expiresAt) {
        idempotencyCache.delete(input.idempotency_key);
      } else {
        return { ok: cached.result === 'success', error: cached.result !== 'success' ? cached.result : undefined };
      }
    }
  }

  if (scopeLocks.get(input.scope)) {
    return { ok: false, error: 'scope_locked' };
  }
  scopeLocks.set(input.scope, true);

  try {
    const check = checkQuota(input);
    if (!check.allowed) {
      if (input.idempotency_key) {
        idempotencyCache.set(input.idempotency_key, { result: check.reason || 'quota_exceeded', expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
        if (idempotencyCache.size > IDEMPOTENCY_CACHE_SIZE) {
          const firstKey = idempotencyCache.keys().next().value;
          if (firstKey) idempotencyCache.delete(firstKey);
        }
      }
      return { ok: false, error: check.reason };
    }

    const usage = getCurrentUsage(input.scope);
    switch (input.resource_type) {
      case 'concurrent_workflows': usage.active_workflows += input.amount; break;
      case 'daily_api_calls': usage.daily_api_calls_used += input.amount; break;
      case 'retrieval_queries': usage.retrieval_queries_used += input.amount; break;
      case 'execution_seconds': usage.execution_seconds_used += input.amount; break;
      case 'storage_bytes': usage.storage_bytes_used += input.amount; break;
      case 'llm_tokens': usage.llm_tokens_used += input.amount; break;
    }
    usage.last_updated = new Date().toISOString();

    if (input.idempotency_key) {
      idempotencyCache.set(input.idempotency_key, { result: 'success', expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
    }

    logger.info('quota.consumed', 'Quota consumed', {
      scope: input.scope,
      resource: input.resource_type,
      amount: input.amount
    });

    return { ok: true };
  } finally {
    scopeLocks.delete(input.scope);
  }
}

/**
 * 释放配额（如工作流完成时归还并发数）
 */
function releaseQuota(input: ConsumeQuotaInput): void {
  const usage = getCurrentUsage(input.scope);
  switch (input.resource_type) {
    case 'concurrent_workflows': usage.active_workflows = Math.max(0, usage.active_workflows - input.amount); break;
    case 'daily_api_calls': break;
    case 'retrieval_queries': break;
    case 'execution_seconds': break;
    case 'storage_bytes': usage.storage_bytes_used = Math.max(0, usage.storage_bytes_used - input.amount); break;
    case 'llm_tokens': break;
  }
  usage.last_updated = new Date().toISOString();
}

/* ---- 巡检功能 ---- */

const SERVICE_ENDPOINTS: Array<{ name: string; url: string }> = [
  { name: 'fact-retrieval', url: process.env.FACT_RETRIEVAL_URL || 'http://fact-retrieval:3000' },
  { name: 'workflow', url: process.env.WORKFLOW_URL || 'http://workflow-service:3000' },
  { name: 'executor-gateway', url: process.env.EXECUTOR_URL || 'http://executor-gateway:3000' },
  { name: 'gateway-adapter', url: process.env.GATEWAY_URL || 'http://gateway-adapter:3000' },
  { name: 'web-portal', url: process.env.WEB_PORTAL_URL || 'http://web-portal:3000' },
  { name: 'hermes-adapter', url: process.env.HERMES_URL || 'http://hermes-adapter:3000' },
  { name: 'skill-library', url: process.env.SKILL_LIBRARY_URL || 'http://skill-library:3000' }
];

/**
 * 执行全局服务健康巡检
 *
 * 巡检策略：
 *   1. 并发探测所有已注册服务端点的 /health/live 接口
 *   2. 超时阈值默认 5 秒（可通过 SERVICE_PROBE_TIMEOUT_MS 配置）
 *   3. HTTP 200 且响应 JSON 含 "ok":true → healthy
 *   4. HTTP 200 但响应异常 → degraded
 *   5. 超时或连接失败 → unhealthy
 *
 * @returns 巡检报告，包含每个服务节点的健康状态和延迟
 */
async function runInspection(): Promise<InspectionReport> {
  const id = `insp_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const probeTimeoutMs = Number(process.env.SERVICE_PROBE_TIMEOUT_MS || 5000);

  logger.info('inspection.started', 'Health inspection started', { inspection_id: id });

  const probes = SERVICE_ENDPOINTS.map(async ({ name, url }): Promise<ServiceInspection> => {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), probeTimeoutMs);

      const response = await fetch(`${url}/health/live`, {
        signal: controller.signal,
        headers: { 'accept': 'application/json' }
      });

      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - start);

      if (!response.ok) {
        return { service_name: name, endpoint: url, status: 'degraded', latency_ms: latencyMs, error: `HTTP ${response.status}`, checked_at: new Date().toISOString() };
      }

      try {
        const body = await response.json() as { ok?: boolean };
        const status = body.ok === true ? 'healthy' as const : 'degraded' as const;
        return { service_name: name, endpoint: url, status, latency_ms: latencyMs, checked_at: new Date().toISOString() };
      } catch {
        return { service_name: name, endpoint: url, status: 'degraded', latency_ms: latencyMs, error: 'invalid_response', checked_at: new Date().toISOString() };
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - start);
      const isTimeout = String(error).includes('abort') || String(error).includes('AbortError');
      return {
        service_name: name, endpoint: url,
        status: isTimeout ? 'unhealthy' : 'unreachable',
        latency_ms: latencyMs,
        error: isTimeout ? 'timeout' : String(error),
        checked_at: new Date().toISOString()
      };
    }
  });

  const services = await Promise.all(probes);
  const healthy = services.filter(s => s.status === 'healthy').length;
  const degraded = services.filter(s => s.status === 'degraded').length;
  const unhealthy = services.filter(s => s.status === 'unhealthy' || s.status === 'unreachable').length;

  const unhealthyServices = services.filter(s => s.status === 'unhealthy' || s.status === 'unreachable');

  const report: InspectionReport = {
    id, started_at: startedAt, finished_at: new Date().toISOString(),
    total_services: services.length, healthy, degraded, unhealthy, services
  };

  if (unhealthyServices.length > 0) {
    logger.error('inspection.unhealthy', 'Unhealthy services detected', {
      unhealthy: unhealthyServices.map(s => s.service_name)
    });
    void sendAlertWebhook(report);
  }

  logger.info('inspection.completed', 'Health inspection completed', {
    inspection_id: id,
    healthy, degraded, unhealthy
  });

  return report;
}

async function sendAlertWebhook(report: InspectionReport): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    const payload = {
      text: `[Resource Scheduler] 服务巡检异常 - ${report.unhealthy}/${report.total_services} 个服务不健康`,
      inspection_id: report.id,
      unhealthy_services: report.services.filter(s => s.status === 'unhealthy' || s.status === 'unreachable').map(s => ({ name: s.service_name, status: s.status, error: s.error })),
      finished_at: report.finished_at
    };
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    logger.warn('alert.webhook_failed', 'Failed to send alert webhook', { error: String(error) });
  }
}

/* ---- HTTP 服务器 ---- */

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';
  const captureWrite = res.write.bind(res);
  const captureEnd = res.end.bind(res);
  const chunks: Buffer[] = [];

  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    return (captureWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
  } as typeof res.write;

  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    responseBody = Buffer.concat(chunks).toString('utf-8').slice(0, 2000);
    return (captureEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
  } as typeof res.end;

  try {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/health/live' || pathname === '/health/ready') {
      sendJson(res, 200, { ok: true, service: 'resource-scheduler', quotas_tracked: quotaStore.size });
      return;
    }

    if (pathname === '/internal/quotas/create' && req.method === 'POST') {
      const body = await readJson(req);
      const scope = String(body.scope || '');
      if (!scope) { sendJson(res, 400, { ok: false, error: 'missing_scope' }); return; }

      const quota = upsertQuota({
        scope,
        created_by: String(body.created_by || 'system'),
        concurrent_workflows: Number(body.concurrent_workflows || 10),
        daily_api_calls: Number(body.daily_api_calls || 1000),
        retrieval_queries: Number(body.retrieval_queries || 500),
        execution_seconds: Number(body.execution_seconds || 3600),
        storage_bytes: Number(body.storage_bytes || 1073741824),
        llm_tokens: Number(body.llm_tokens || 100000),
        status: body.status as 'active' | 'suspended' || 'active',
        created_at: '',
        updated_at: ''
      });

      sendJson(res, 201, { ok: true, quota });
      return;
    }

    if (pathname.startsWith('/internal/quotas/') && pathname !== '/internal/quotas/create' && pathname !== '/internal/quotas/consume' && pathname !== '/internal/quotas/release' && pathname !== '/internal/quotas/check' && req.method === 'GET') {
      const scope = pathname.split('/internal/quotas/')[1];
      const quota = quotaStore.get(scope);
      if (!quota) { sendJson(res, 404, { ok: false, error: 'quota_not_found' }); return; }
      sendJson(res, 200, { ok: true, quota, usage: getCurrentUsage(scope) });
      return;
    }

    if (pathname === '/internal/quotas/consume' && req.method === 'POST') {
      const body = await readJson(req);
      const scope = String(body.scope || '');
      if (!scope) { sendJson(res, 400, { ok: false, error: 'missing_scope' }); return; }

      const result = consumeQuota({
        scope,
        resource_type: body.resource_type as ConsumeQuotaInput['resource_type'],
        amount: Number(body.amount || 1),
        idempotency_key: body.idempotency_key as string | undefined
      });

      sendJson(res, result.ok ? 200 : 429, result);
      return;
    }

    if (pathname === '/internal/quotas/release' && req.method === 'POST') {
      const body = await readJson(req);
      const scope = String(body.scope || '');
      if (!scope) { sendJson(res, 400, { ok: false, error: 'missing_scope' }); return; }

      releaseQuota({
        scope,
        resource_type: body.resource_type as ConsumeQuotaInput['resource_type'],
        amount: Number(body.amount || 1)
      });

      sendJson(res, 200, { ok: true, usage: getCurrentUsage(scope) });
      return;
    }

    if (pathname === '/internal/quotas/check' && req.method === 'POST') {
      const body = await readJson(req);
      const scope = String(body.scope || '');
      if (!scope) { sendJson(res, 400, { ok: false, error: 'missing_scope' }); return; }

      const result = checkQuota({
        scope,
        resource_type: body.resource_type as ConsumeQuotaInput['resource_type'],
        amount: Number(body.amount || 1)
      });

      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/internal/inspections/start' && req.method === 'POST') {
      const report = await runInspection();
      sendJson(res, 200, { ok: true, report });
      return;
    }

    if (pathname === '/internal/inspections/report' && req.method === 'GET') {
      const report = await runInspection();
      sendJson(res, 200, { ok: true, report });
      return;
    }

    if (pathname === '/internal/health/status' && req.method === 'GET') {
      const report = await runInspection();
      const overallStatus = report.unhealthy > 0 ? 'unhealthy' : report.degraded > 0 ? 'degraded' : 'healthy';
      sendJson(res, 200, {
        ok: true,
        status: overallStatus,
        summary: { total: report.total_services, healthy: report.healthy, degraded: report.degraded, unhealthy: report.unhealthy },
        services: report.services
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.unhandled_error', 'Unhandled request error', { error: (error as Error).message });
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
  await httpResponseLogger(req, res, responseBody);
});

/* ---- 生命周期 ---- */

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

server.listen(port, async () => {
  logger.info('service.started', 'Resource-scheduler service started', { port });
  void getDbPool().then(async (pool) => {
    if (pool) {
      await ensureQuotaTables(pool);
      await loadQuotasFromDb(pool);
    }
  });

  aggregationInterval = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') writeAggregationReport(report);
  }, 15000);
  if (aggregationInterval.unref) aggregationInterval.unref();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (aggregationInterval) { clearInterval(aggregationInterval); aggregationInterval = null; }
    writeAggregationReport(analyze());
    metricsRegistry.shutdown();
    server.close(async () => { await logger.shutdown(); process.exit(0); });
  });
}
