import { createServer } from 'node:http'
import { createHash, createHmac, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { createLogger, configManager, metricsRegistry, httpRequestLogger, httpResponseLogger, recordCriticalLog, setupDefaultHealthChecks, analyze, writeAggregationReport, checkProductionSecurity, extractPathname, postJson, sendJson } from '@agent-harness/shared'
import { identityResolver } from './services/identity-resolver'
import { sessionMapper } from './services/session-mapper'
import { validateFileForImport, sanitizeFileName, validateTextContent } from './services/file-validator'
import { gatewayState } from './services/gateway-state'

import type { Pool } from 'pg'

const logger = createLogger('gateway-adapter', {
  logFile: process.env.LOG_FILE || 'logs/gateway-adapter.log'
})

const DB_POOL_MAX = Number(process.env.DB_POOL_MAX || 10)
const MAX_INFLIGHT_REQUESTS = Number(process.env.MAX_INFLIGHT_REQUESTS || 50)
let inflightCounter = 0

let sharedDbPool: Pool | null = null
async function getSharedDbPool(): Promise<Pool | null> {
  if (sharedDbPool) return sharedDbPool
  try {
    const { Pool } = await import('pg')
    sharedDbPool = new Pool({ connectionString: process.env.DATABASE_URL, max: DB_POOL_MAX })
    return sharedDbPool
  } catch (err) {
    logger.error('db.pool.failed', 'Failed to create database pool', { error: String(err) })
    return null
  }
}

metricsRegistry.registerAlert({
  metric: 'http.requests.errors',
  operator: 'gt',
  value: 100,
  severity: 'error',
  message: 'HTTP error rate exceeded threshold (100+ errors)',
  cooldownMs: 60000
});

metricsRegistry.registerAlert({
  metric: 'http.requests.server_errors',
  operator: 'gt',
  value: 10,
  severity: 'warn',
  message: 'Server-side errors detected (10+)',
  cooldownMs: 30000
});
const port = Number(process.env.SERVER_PORT || configManager.getPath<number>('server.port') || 3000);
const workflowUrl = process.env.WORKFLOW_URL || '';
const litellmUrl = process.env.LITELLM_URL || '';
const litellmModel = process.env.LITELLM_MODEL || 'minimax-m2.7';
const litellmApiKey = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '';
if (!litellmApiKey) logger.warn('config.missing', 'LITELLM_MASTER_KEY or LITELLM_API_KEY environment variable is not set');
if (!process.env.MINIMAX_API_KEY && !process.env.DASHSCOPE_API_KEY) {
  logger.warn('config.missing', 'Both MINIMAX_API_KEY and DASHSCOPE_API_KEY are empty. LiteLLM cannot authenticate with any LLM provider. All LLM calls will fail.');
}
function isPlaceholderValue(val: string | undefined): boolean {
  if (!val) return true
  const trimmed = val.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return true
  if (trimmed.includes('需要配置') || trimmed.includes('CHANGE_ME') || trimmed.includes('changeme')) return true
  return false
}
if (isPlaceholderValue(process.env.MINIMAX_API_KEY) && isPlaceholderValue(process.env.DASHSCOPE_API_KEY)) {
  logger.warn('config.missing', 'MINIMAX_API_KEY and DASHSCOPE_API_KEY are placeholder values. Please set real API keys in .env file, then restart with: docker compose --profile app up -d');
}
const hermesUrl = process.env.HERMES_URL || 'http://hermes-adapter:3000';
const resourceSchedulerUrl = process.env.RESOURCE_SCHEDULER_URL || '';
const mobileAppUrl = process.env.MOBILE_APP_URL || '';
if (!workflowUrl) logger.warn('config.missing', 'WORKFLOW_URL environment variable is not set');
if (!litellmUrl) logger.warn('config.missing', 'LITELLM_URL environment variable is not set');

const FEISHU_API_BASE_MAP: Record<string, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com'
};

function getFeishuApiBase(): string {
  const domain = (process.env.FEISHU_DOMAIN || 'feishu').trim().toLowerCase()
  const base = FEISHU_API_BASE_MAP[domain]
  if (base) return base
  logger.warn('feishu.domain.unknown', 'Unknown FEISHU_DOMAIN, falling back to feishu.cn', { domain })
  return FEISHU_API_BASE_MAP['feishu']
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(rawBody: string): Record<string, unknown> | null {
  if (!rawBody || !rawBody.trim()) return null;
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sendText(res: import('node:http').ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function isDuplicateEvent(eventId: string): boolean {
  return gatewayState.checkAndSetDedupe(eventId);
}

function maskSensitive(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function safeCompareSignature(signature: string, expected: string): boolean {
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function normalizeMessage(body: Record<string, unknown>): Record<string, unknown> {
  const channelIdentity = String(body.channel_identity || 'unknown');
  const sessionHint = (body.session_hint as Record<string, unknown> | undefined) || {};
  const channelType = String(sessionHint.channel_type || 'web_portal');
  const requestText = String((body.raw_message as Record<string, unknown> | undefined)?.text || body.request_text || '');
  const sessionRef = sessionMapper.createSessionRef(channelIdentity, {
    channel_type: channelType,
    channel_account_id: String(sessionHint.channel_account_id || 'default'),
    conversation_id: typeof sessionHint.conversation_id === 'string' ? sessionHint.conversation_id : undefined,
    thread_id: typeof sessionHint.thread_id === 'string' ? sessionHint.thread_id : undefined
  });

  return {
    channel_identity: channelIdentity,
    channel_type: channelType,
    request_text: requestText,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    session_ref: sessionRef,
    session_hint: { ...sessionHint },
    identity_binding_state: 'pending',
    binding_action: 'binding_required'
  };
}

async function resolveIdentity(normalized: Record<string, unknown>): Promise<Record<string, unknown>> {
  const channelIdentity = String(normalized.channel_identity || 'unknown');
  const channelType = String(normalized.channel_type || 'web_portal');

  const identity = await identityResolver.resolve(channelIdentity, channelType);

  let policySnapshotHash = '';
  if (identity.identity_binding_state === 'bound' && identity.user_id) {
    try {
      const { policyManager } = await import('@agent-harness/policy');
      await policyManager.initialize();
      const snapshot = policyManager.generateSnapshot({ user_id: identity.user_id, role: 'user' });
      policySnapshotHash = snapshot.snapshot_hash;
    } catch {
      const { createHash } = await import('crypto');
      policySnapshotHash = `sha256:${createHash('sha256').update(`policy:${identity.user_id}:${Date.now()}`).digest('hex')}`;
    }
  }

  const sessionHint = (normalized.session_hint || (normalized as Record<string, unknown>)) as Record<string, unknown>;
  const orgScopedSessionRef = sessionMapper.createSessionRef(channelIdentity, {
    channel_type: channelType,
    channel_account_id: String(sessionHint.channel_account_id || 'default'),
    conversation_id: typeof sessionHint.conversation_id === 'string' ? sessionHint.conversation_id : undefined,
    thread_id: typeof sessionHint.thread_id === 'string' ? sessionHint.thread_id : undefined,
    org_id: identity.org_id || undefined,
  });

  return {
    ...normalized,
    user_id: identity.user_id,
    org_id: identity.org_id,
    identity_binding_state: identity.identity_binding_state,
    binding_action: identity.binding_action,
    policy_snapshot_hash: policySnapshotHash,
    session_ref: orgScopedSessionRef
  };
}

function isTaskIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /^(请|帮我|麻烦|执行|创建|生成|实现|修复|分析|整理|制定)/,
    /^(please|help me|create|build|implement|fix|analyze|plan|draft)/,
    /(任务|计划|执行|workflow|dispatch|todo|里程碑|roadmap|方案|report)/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isTaskDispatchIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /(通知.*提交|下发.*任务|下发.*工作|分配.*任务|派发.*任务)/,
    /(全员.*提交|团队.*完成|要求.*提交|要求.*完成|安排.*工作)/,
    /(通知所有人|通知全员|通知团队|给.*下发|给.*分配)/,
    /(dispatch.*task|assign.*task|notify.*team|team.*submit)/,
    /(周报|日报|月报|总结|汇报).*(提交|完成|上交)/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

// isKnowledgeSubmitIntent: 基于关键词检测用户是否在主动提交知识
// 匹配「我想提交一条知识」「这是客户信息」「分享一个知识点」等模式
function isKnowledgeSubmitIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /(提交.*知识|分享.*知识|记录.*知识|录入.*知识|新增.*知识)/,
    /(这是.*客户|这是.*联系人|这是.*项目.*信息|这是.*公司)/,
    /(补充.*信息|添加.*信息|记录.*信息)/,
    /(submit.*knowledge|share.*knowledge|record.*fact|add.*entry)/,
    /^(知识点|知识条目|客户信息|公司信息|联系人)/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

// isQuickLookupIntent: 检测用户快速信息查询（非长任务、非对话闲聊）
// 识别「XX的电话多少？」「查一下XX公司的信息」等快速检索场景
function isQuickLookupIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (isTaskIntent(text)) return false;
  const patterns = [
    /^(查|查一下|查找|搜索|检索|查询|帮我查|帮我找|帮我搜)/,
    /(的电话|的联系方式|的邮箱|的地址|的信息|的简介|的报价)/,
    /^(\/find|\/search|\/lookup|\/查)/,
    /^(find |search |lookup |query |what is |who is |how many )/i
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

interface IntentClassification {
  is_task: boolean;
  task_type_hint: 'development' | 'analysis' | 'knowledge' | 'sales' | 'implementation';
  risk_level: 'low' | 'medium' | 'high';
  confidence: number;
  intent_type: 'chat' | 'task' | 'knowledge_submit' | 'quick_lookup' | 'task_dispatch';
}

async function classifyIntentWithLLM(text: string): Promise<IntentClassification> {
  const fallback: IntentClassification = {
    is_task: isTaskIntent(text),
    task_type_hint: 'knowledge',
    risk_level: 'medium',
    confidence: 0.0,
    intent_type: isTaskDispatchIntent(text) ? 'task_dispatch' : (isKnowledgeSubmitIntent(text) ? 'knowledge_submit' : (isQuickLookupIntent(text) ? 'quick_lookup' : (isTaskIntent(text) ? 'task' : 'chat')))
  };

  const litellmUrl = process.env.LITELLM_URL || '';
  const litellmApiKey = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '';
  const litellmModel = process.env.LITELLM_MODEL || 'minimax-m2.7';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${litellmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${litellmApiKey}`
      },
      body: JSON.stringify({
        model: litellmModel,
        messages: [
          {
            role: 'system',
            content: `Classify the user message. Output JSON with:
- "is_task": boolean - true if the user wants to execute a workflow or dispatch a task to others, false for chat or knowledge submission
- "task_type_hint": one of "development", "analysis", "knowledge", "sales", "implementation"
- "risk_level": one of "low", "medium", "high"
- "confidence": 0.0-1.0
- "intent_type": one of "chat" (casual conversation), "task" (execute workflow), "knowledge_submit" (user is sharing a piece of knowledge), "quick_lookup" (simple fact lookup), "task_dispatch" (admin dispatching/assigning a task to team members)

KEY DISTINCTION:
- "task_dispatch": admin/manager is ASSIGNING a task to team members (e.g. "通知所有人提交周报", "给团队下发任务：完成Q3总结", "下发工作要求：每日拜访总结")
- "task": user wants the AI to EXECUTE a workflow for them (e.g. "帮我分析销售数据")
- "knowledge_submit": user is PROVIDING information (e.g. "这是客户张三的信息", "A公司的联系方式是...", "我想提交一条知识")
- "knowledge" task_type_hint: user is ASKING for information (e.g. "什么是RAG?", "查一下销售数据")

Examples:
"帮我分析一下销售数据" -> {"is_task":true,"task_type_hint":"analysis","risk_level":"medium","confidence":0.9,"intent_type":"task"}
"修复登录页面的bug" -> {"is_task":true,"task_type_hint":"development","risk_level":"medium","confidence":0.85,"intent_type":"task"}
"今天天气怎么样" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.95,"intent_type":"chat"}
"请制定Q2营销方案" -> {"is_task":true,"task_type_hint":"sales","risk_level":"high","confidence":0.8,"intent_type":"task"}
"张三是A公司的技术总监，电话138xxxx" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.9,"intent_type":"knowledge_submit"}
"我想提交一条知识：B公司最近融资了5000万" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.95,"intent_type":"knowledge_submit"}
"什么是RAG?" -> {"is_task":true,"task_type_hint":"knowledge","risk_level":"low","confidence":0.7,"intent_type":"task"}
"查一下A公司的联系电话" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.95,"intent_type":"quick_lookup"}
"张三的邮箱是多少？" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.9,"intent_type":"quick_lookup"}
"通知全员提交周报" -> {"is_task":true,"task_type_hint":"implementation","risk_level":"low","confidence":0.9,"intent_type":"task_dispatch"}
"给销售团队下发任务：本周五前提交客户拜访报告" -> {"is_task":true,"task_type_hint":"sales","risk_level":"low","confidence":0.95,"intent_type":"task_dispatch"}
"下发工作要求：每天20点提交当日总结" -> {"is_task":true,"task_type_hint":"implementation","risk_level":"low","confidence":0.95,"intent_type":"task_dispatch"}`
          },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('intent.classify_failed', 'LLM intent classification HTTP error', {
        status: response.status,
        status_text: response.statusText
      });
      return fallback;
    }

    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn('intent.classify_no_content', 'LLM intent classification returned empty content');
      return fallback;
    }

    try {
      let jsonContent = content;
      const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch && fenceMatch[1]) {
        jsonContent = fenceMatch[1].trim();
      }
      const parsed = JSON.parse(jsonContent) as Partial<IntentClassification>;
      return {
        is_task: typeof parsed.is_task === 'boolean' ? parsed.is_task : fallback.is_task,
        task_type_hint: ['development', 'analysis', 'knowledge', 'sales', 'implementation'].includes(parsed.task_type_hint as string) ? parsed.task_type_hint as IntentClassification['task_type_hint'] : fallback.task_type_hint,
        risk_level: ['low', 'medium', 'high'].includes(parsed.risk_level as string) ? parsed.risk_level as IntentClassification['risk_level'] : fallback.risk_level,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        intent_type: ['chat', 'task', 'knowledge_submit', 'quick_lookup', 'task_dispatch'].includes(parsed.intent_type as string) ? parsed.intent_type as IntentClassification['intent_type'] : fallback.intent_type
      };
    } catch (parseError) {
      logger.warn('intent.classify_parse_error', 'LLM intent classification JSON parse error', {
        error: String(parseError),
        raw_content: content.substring(0, 300)
      });
      return fallback;
    }
  } catch (error) {
    logger.warn('intent.classify_exception', 'LLM intent classification exception', {
      error: String(error),
      is_abort: error instanceof Error && error.name === 'AbortError'
    });
    return fallback;
  }
}

async function rememberContext(ownerUserId: string, sessionId: string, role: string, content: string): Promise<void> {
  try {
    const res = await fetch(`${hermesUrl}/internal/memory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: ownerUserId, session_id: sessionId, role, content })
    });
    if (!res.ok) {
      logger.warn('memory.persist.degraded', 'Memory persist returned non-2xx', { status: res.status });
    }
  } catch {
    logger.warn('memory.persist.failed', 'Memory persist failed');
  }
}

interface UserPersona {
  soul: string | null;
  identity: string | null;
  toneStyle: string | null;
  behaviorBoundary: string | null;
  skillTags: string;
}

async function loadUserPersona(ownerUserId: string): Promise<UserPersona | null> {
  try {
    const pool = await getSharedDbPool();
    if (!pool) return null;
    const result = await pool.query(
      `SELECT soul, identity, tone_style, behavior_boundary, skill_tags FROM user_profile WHERE user_id = $1 LIMIT 1`,
      [ownerUserId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const tags = typeof row.skill_tags === 'string' ? JSON.parse(row.skill_tags) : (Array.isArray(row.skill_tags) ? row.skill_tags.join(', ') : '');
    return {
      soul: typeof row.soul === 'string' ? row.soul : null,
      identity: typeof row.identity === 'string' ? row.identity : null,
      toneStyle: typeof row.tone_style === 'string' ? row.tone_style : null,
      behaviorBoundary: typeof row.behavior_boundary === 'string' ? row.behavior_boundary : null,
      skillTags: typeof tags === 'string' ? tags : String(tags || '')
    };
  } catch {
    return null;
  }
}

interface WorkspaceInfo {
  docCount: number;
  factCount: number;
  memoryCount: number;
}

async function getWorkspaceInfo(ownerUserId: string): Promise<WorkspaceInfo | null> {
  try {
    const pool = await getSharedDbPool();
    if (!pool) return { docCount: 0, factCount: 0, memoryCount: 0 };
    const [docR, factR, memR] = await Promise.all([
      pool.query(`SELECT COUNT(*) as cnt FROM document WHERE owner_user_id = $1`, [ownerUserId]),
      pool.query(`SELECT COUNT(*) as cnt FROM fact WHERE owner_user_id = $1 AND status = 'active'`, [ownerUserId]),
      pool.query(`SELECT COUNT(*) as cnt FROM hermes_memory WHERE owner_user_id = $1`, [ownerUserId])
    ]);
    return {
      docCount: Number(docR.rows[0]?.cnt || 0),
      factCount: Number(factR.rows[0]?.cnt || 0),
      memoryCount: Number(memR.rows[0]?.cnt || 0)
    };
  } catch {
    return { docCount: 0, factCount: 0, memoryCount: 0 };
  }
}

function fireAndForget(promise: Promise<unknown>, tag: string): void {
  promise.catch(err => logger.warn(`${tag}.failed`, `Fire-and-forget operation failed`, { error: String(err) }));
}

async function recallContext(ownerUserId: string, sessionId: string): Promise<{ context: string; degraded: boolean; reason?: string }> {
  try {
    const res = await fetch(`${hermesUrl}/internal/memory/recall`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: ownerUserId, session_id: sessionId, limit: 20 }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return { context: '', degraded: true, reason: `memory_recall_http_${res.status}` };
    const body = await res.json() as { compressed_context?: string };
    return { context: body.compressed_context || '', degraded: false };
  } catch {
    return { context: '', degraded: true, reason: 'memory_recall_timeout_or_network' };
  }
}

// checkOrgQuota：通过 resource-scheduler 服务校验组织资源配额
// 当资源调度器不可用时，自动降级到数据库直查；网络异常时放行以避免阻塞业务
// 参数:
//   orgId - 组织ID
//   ownerUserId - 发起请求的用户ID
// 返回:
//   allowed - 是否允许操作
//   reason - 被拒绝时的原因说明
//   remaining - 剩余配额详情
async function checkOrgQuota(orgId: string, ownerUserId: string): Promise<{ allowed: boolean; reason?: string; remaining?: Record<string, number> }> {
  if (!resourceSchedulerUrl) {
    const pool = await getSharedDbPool();
    if (!pool) return { allowed: false, reason: 'db_unavailable' };
    try {
      const orgResult = await pool.query(
        `SELECT settings FROM organization WHERE id = $1 AND status = 'active'`,
        [orgId]
      );
      if (orgResult.rows.length > 0) {
        const settings = (orgResult.rows[0].settings as Record<string, unknown>) || {};
        const maxWorkflowsPerDay = Number(settings.max_workflows_per_day || 0);
        if (maxWorkflowsPerDay > 0) {
          const todayCount = await pool.query(
            `SELECT COUNT(*) as cnt FROM audit_event
             WHERE action = 'workflow.create'
               AND org_id = $1
               AND occurred_at >= date_trunc('day', now())`,
            [orgId]
          );
          const currentCount = Number(todayCount.rows[0]?.cnt || 0);
          if (currentCount >= maxWorkflowsPerDay) {
            return {
              allowed: false,
              reason: `组织今日任务配额已用尽（${currentCount}/${maxWorkflowsPerDay}），请明日再试或联系管理员。`,
              remaining: { daily_workflows: 0 }
            };
          }
        }
      }
    } catch (error) {
      logger.warn('org.quota.check_db_fallback_failed', 'DB fallback quota check failed', { org_id: orgId, error: String(error) });
    }
    return { allowed: true };
  }

  try {
    const response = await fetch(`${resourceSchedulerUrl}/internal/quotas/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: orgId,
        user_id: ownerUserId,
        action: 'create_workflow',
        idempotency_key: `${orgId}:${Date.now()}`,
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      logger.warn('org.quota.check_scheduler_failed', 'Resource scheduler check failed, allowing request', {
        org_id: orgId,
        status: response.status
      });
      return { allowed: true };
    }

    const body = await response.json() as { allowed?: boolean; reason?: string; remaining?: Record<string, number> };
    if (!body.allowed) {
      return {
        allowed: false,
        reason: body.reason || '资源配额不足',
        remaining: body.remaining
      };
    }
    return { allowed: true, remaining: body.remaining };
  } catch (error) {
    logger.warn('org.quota.check_scheduler_unavailable', 'Resource scheduler unreachable, allowing request', {
      org_id: orgId,
      error: String(error)
    });
    return { allowed: true };
  }
}

// sendMobilePushNotification：通过 mobile-app 服务向用户推送移动设备通知
// 在 workflow 完成/失败时异步触发，不阻塞主流程
// 参数:
//   userId - 目标用户ID
//   title - 推送标题
//   body - 推送正文
//   data - 附加数据（如 workflow_ref）
async function sendMobilePushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!mobileAppUrl) return;

  try {
    await fetch(`${mobileAppUrl}/internal/notifications/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        title,
        body,
        data: data || {},
        priority: 'high',
      }),
      signal: AbortSignal.timeout(5000)
    });
    logger.info('mobile.push.sent', 'Mobile push notification sent', { user_id: userId, title });
  } catch (error) {
    logger.warn('mobile.push.failed', 'Failed to send mobile push notification', {
      user_id: userId,
      error: String(error)
    });
  }
}

// extractWorkflowAsSkillCandidate: 工作流成功后，分析stage链并生成Skill候选
// 异步调用 skill-library 创建 draft 状态的技能条目
async function extractWorkflowAsSkillCandidate(workflowRef: string, userId: string, orgId: string): Promise<void> {
  const skillLibraryUrl = process.env.SKILL_LIBRARY_URL || '';
  const workflowUrl = process.env.WORKFLOW_URL || '';
  if (!skillLibraryUrl || !workflowUrl) return;

  try {
    // 获取工作流完整信息（含stage_chain）
    const wfRes = await fetch(`${workflowUrl}/internal/workflows/${workflowRef}?detail_mode=full`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!wfRes.ok) return;
    const wf = await wfRes.json() as { status?: string; stages?: Array<Record<string, unknown>>; user_goal?: string };

    if (!wf.stages || wf.stages.length === 0) return;

    // 提取阶段名称作为技能描述
    const stageNames = wf.stages.map(s => String(s.stage_type || '')).filter(Boolean);
    const goal = String(wf.user_goal || '未命名任务');

    // 向 skill-library 提交候选技能
    await fetch(`${skillLibraryUrl}/internal/skills/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `[候选] ${goal.substring(0, 40)}`,
        skill_type: 'workflow',
        description: `从工作流 ${workflowRef} 自动提取。阶段链: ${stageNames.join(' → ')}`,
        definition: {
          stage_chain: wf.stages,
          source_workflow: workflowRef,
          extracted_stages: stageNames
        },
        owner_user_id: userId,
        org_id: orgId
      }),
      signal: AbortSignal.timeout(5000)
    });

    logger.info('skill.candidate_extracted', 'Skill candidate extracted from workflow', {
      workflow_ref: workflowRef
    });
  } catch {
    // 静默失败，不影响主流程
  }
}

// submitKnowledge: 将用户主动提交的知识写入 fact-retrieval
// 知识条目以 status='unconfirmed' 入库，管理员可在审核台审批
// 参数:
//   text - 用户原始消息文本
//   ownerUserId - 用户ID
//   orgId - 组织ID
// 返回:
//   factId - 创建的知识条目ID
//   error - 错误信息(成功时为null)
async function submitKnowledge(text: string, ownerUserId: string, orgId: string): Promise<{ factId: string | null; error: string | null }> {
  const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || '';
  if (!factRetrievalUrl) {
    return { factId: null, error: '知识服务暂不可用' };
  }

  try {
    const res = await fetch(`${factRetrievalUrl}/internal/fact/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: ownerUserId,
        org_id: orgId,
        source_text: text,
        source: 'user_submitted',
        status: 'unconfirmed'
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      logger.warn('knowledge.submit_failed', 'Knowledge submit returned non-2xx', { status: res.status });
      return { factId: null, error: `知识提交失败 (HTTP ${res.status})` };
    }

    const body = await res.json() as { fact_id?: string };
    return { factId: body.fact_id || null, error: null };
  } catch (error) {
    logger.warn('knowledge.submit_exception', 'Knowledge submit exception', { error: String(error) });
    return { factId: null, error: '知识提交服务异常，已记录重试' };
  }
}

async function generateChatReply(userText: string, ownerUserId: string, context?: string): Promise<{ text: string; modelCallOk: boolean }> {
  const personaInfo = await loadUserPersona(ownerUserId);
  const workspaceInfo = await getWorkspaceInfo(ownerUserId);

  const personaBlock = personaInfo
    ? `\n\n【你的身份与行为准则 - 此为你的soul/brain配置】\n- 核心性格(soul): ${personaInfo.soul || '专业、高效、贴心的企业AI助手'}\n- 身份定位(identity): ${personaInfo.identity || '企业级AI智能助手'}\n- 语气风格(tone): ${personaInfo.toneStyle || '专业、简洁、准确'}\n- 行为边界: ${personaInfo.behaviorBoundary || '保护用户隐私，不泄露敏感信息'}\n- 技能标签: ${personaInfo.skillTags || '通用知识问答'}`
    : '';

  const workspaceBlock = workspaceInfo
    ? `\n\n【你的独立工作区信息】\n- 工作区目录: /workspace/${ownerUserId}\n- 知识库访问: PGSQL (事实/文档/记忆) ✅\n- 向量检索: pgvector ✅\n- 图数据库: Apache AGE ✅\n- 已有文档数: ${workspaceInfo.docCount}\n- 已有事实数: ${workspaceInfo.factCount}\n- 已存储记忆条数: ${workspaceInfo.memoryCount}\n- 你可以通过知识检索、记忆召回等功能访问和操作这些数据`
    : '';

  const systemPrompt = `你是一个企业级AI智能助手。${personaBlock}${workspaceBlock}

核心行为准则:
- 用中文回复，专业、简洁、准确
- 优先从组织知识库中查找答案，其次依赖你的通用知识
- 若用户问及"你的工作区"或"你能访问什么"，请参考【你的独立工作区信息】如实回答
- 若用户主要提知识片段，鼓励并引导其通过「提交知识」功能录入系统
- 对不确定的信息明确标注"待确认"
- 保护用户隐私，不向其他用户泄露敏感信息
- 涉及价格、合同等敏感内容时提醒用户核实`;

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  if (context) {
    messages.push({ role: 'system', content: `对话历史摘要:\n${context}` });
  }

  messages.push({ role: 'user', content: userText });

  const response = await postJson(`${litellmUrl}/v1/chat/completions`, {
    model: litellmModel,
    messages,
    temperature: 0.3
  }, 120000, {
    Authorization: `Bearer ${litellmApiKey}`
  });

  if (!response.ok || !response.body) {
    logger.warn('model.call.failed', 'LiteLLM call failed', { status: response.status });
    return { text: '模型暂不可用，已收到你的消息。', modelCallOk: false };
  }

  const choices = response.body.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === 'string' ? message.content : '';
  if (!content) {
    logger.warn('model.call.empty', 'LiteLLM call returned empty content', {});
    return { text: '模型返回为空，已记录重试。', modelCallOk: false };
  }

  logger.info('model.call.success', 'LiteLLM call succeeded', { model: litellmModel });
  return { text: content, modelCallOk: true };
}

// quickLookup: 快速信息查询 — 通过 workflow 单阶段 rapid-retrieval 获得即时结果
// 与完整 task 路径不同：使用短超时(15s)、少量检索预算、失败后降级到 chat
async function quickLookup(text: string, ownerUserId: string, orgId: string): Promise<{ replyText: string; modelCallOk: boolean }> {
  const workflowUrl = process.env.WORKFLOW_URL || '';
  if (!workflowUrl) return { replyText: '', modelCallOk: false };

  try {
    // 创建精简版 plan（仅 retrieval 阶段）
    const planRes = await fetch(`${workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: ownerUserId,
        task_type_hint: 'knowledge',
        risk_level: 'low',
        user_goal: text,
        budget: { time_sec: 15, retrieval: 3, execution: 1 },
        policy_snapshot_hash: ''
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!planRes.ok) return { replyText: '', modelCallOk: false };

    const planBody = await planRes.json() as { workflow_instance_ref?: string };
    const wfRef = planBody.workflow_instance_ref;
    if (!wfRef) return { replyText: '', modelCallOk: false };

    // 快速调度
    await fetch(`${workflowUrl}/internal/workflows/${wfRef}/dispatch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'quick_lookup' }),
      signal: AbortSignal.timeout(5000)
    });

    // 短轮询（最多3轮，每5秒一次）
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const wfRes = await fetch(`${workflowUrl}/internal/workflows/${wfRef}?detail_mode=short`, {
        signal: AbortSignal.timeout(3000)
      });
      if (!wfRes.ok) continue;
      const wf = await wfRes.json() as { status?: string; stages?: Array<{ last_output_preview?: string }> };
      const status = wf.status;
      if (status === 'succeeded' || status === 'completed') {
        const preview = wf.stages?.[wf.stages.length - 1]?.last_output_preview || '';
        return {
          replyText: `🔍 查询结果:\n${preview.substring(0, 800)}${preview.length > 800 ? '\n...(结果已截断)' : ''}`,
          modelCallOk: true
        };
      }
      if (status === 'failed') break;
    }

    return { replyText: '', modelCallOk: false };
  } catch {
    return { replyText: '', modelCallOk: false };
  }
}

async function processIncomingText(normalized: Record<string, unknown>): Promise<{ requestType: 'chat' | 'task' | 'knowledge_submit' | 'quick_lookup' | 'task_dispatch'; replyText: string; modelCallOk: boolean; workflowRef?: string; runRef?: string }> {
  if (inflightCounter >= MAX_INFLIGHT_REQUESTS) {
    logger.warn('inflight.limit_exceeded', 'Request rejected due to inflight limit', {
      current: inflightCounter,
      max: MAX_INFLIGHT_REQUESTS
    })
    return {
      requestType: 'chat',
      replyText: '系统当前繁忙，请稍后重试。',
      modelCallOk: false
    }
  }
  inflightCounter++
  try {
    const text = String(normalized.request_text || '');
    const ownerUserId = String(normalized.user_id || normalized.session_ref || 'anonymous');
    const sessionId = String(normalized.session_ref || 'default');
    const orgId = String(normalized.org_id || '');

    const intent = await classifyIntentWithLLM(text);
    const requestType: 'chat' | 'task' | 'knowledge_submit' | 'quick_lookup' | 'task_dispatch' = intent.intent_type;

    logger.info('ingress.request.classified', 'Classified incoming request', {
      request_type: requestType,
      task_type_hint: intent.task_type_hint,
      risk_level: intent.risk_level,
      confidence: intent.confidence,
      channel_type: normalized.channel_type
    });

  // knowledge_submit 路径: 用户主动提交知识 → 写入临时审核池 → 回复确认
  if (requestType === 'knowledge_submit') {
    if (normalized.identity_binding_state !== 'bound') {
      const replyText = '身份尚未绑定，请先完成身份验证后再提交知识。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }

    const { factId, error } = await submitKnowledge(text, ownerUserId, orgId);
    if (error || !factId) {
      const replyText = error || '知识提交失败，已记录。请稍后重试。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }
    const replyText = `📝 知识已收到并提交审核！\n知识编号: ${factId}\n管理员将在审核后将其正式收录到组织知识库中。`;
    fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
    fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
    return { requestType, replyText, modelCallOk: true };
  }

  // quick_lookup 路径: 快速查询 → retrieval-aware 单轮执行 → 返回结果
  if (requestType === 'quick_lookup') {
    if (normalized.identity_binding_state !== 'bound') {
      const replyText = '身份尚未绑定，请先完成身份验证后再进行查询。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }

    const { replyText, modelCallOk } = await quickLookup(text, ownerUserId, orgId);
    if (!replyText) {
      // quickLookup 降级为空 → 回退到 chat 路径
      const chatResult = await generateChatReply(text, ownerUserId);
      const finalReply = chatResult.text;
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', finalReply), '');
      return { requestType: 'chat' as const, replyText: finalReply, modelCallOk: chatResult.modelCallOk };
    }
    fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
    fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
    return { requestType, replyText, modelCallOk };
  }

  if (requestType === 'task') {
    if (normalized.identity_binding_state !== 'bound') {
      const replyText = '身份尚未绑定，请先完成身份验证后再创建任务。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }

    const orgId = String(normalized.org_id || '');
    if (orgId) {
      const quotaCheck = await checkOrgQuota(orgId, ownerUserId);
      if (!quotaCheck.allowed) {
        logger.warn('org.quota.exceeded', 'Organization quota exceeded via resource scheduler', {
          org_id: orgId,
          reason: quotaCheck.reason
        });
        const replyText = quotaCheck.reason || '资源配额不足，请稍后重试或联系管理员。';
        fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
        fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
        return { requestType, replyText, modelCallOk: false };
      }
    }

    const policySnapshotHash = String(normalized.policy_snapshot_hash || '');
    if (!policySnapshotHash || !policySnapshotHash.startsWith('sha256:')) {
      logger.warn('policy.snapshot.missing', 'Missing or invalid policy_snapshot_hash, rejecting workflow creation', {
        user_id: normalized.user_id
      });
      const replyText = '权限策略校验暂不可用，请稍后重试。若持续出现请联系管理员。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }

    const plan = await postJson(`${workflowUrl}/internal/workflows/plan`, {
      user_id: normalized.user_id || 'u_placeholder',
      task_type_hint: intent.task_type_hint,
      risk_level: intent.risk_level,
      user_goal: text,
      budget: { time_sec: Number(process.env.WORKFLOW_PLAN_BUDGET_SEC || 3600), retrieval: 15, execution: 30 },
      policy_snapshot_hash: policySnapshotHash
    }, 30000, {}, 2);

    if (!plan.ok) {
      logger.warn('workflow.plan.failed', 'Workflow plan failed from gateway', { status: plan.status });
      const replyText = '任务受理失败：规划服务暂不可用。请稍后重试，若持续失败请联系管理员并提供时间与账号。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }

    const workflowRef = (plan.body?.workflow_instance_ref as string | undefined) || `wf_${Date.now()}`;
    const dispatch = await postJson(`${workflowUrl}/internal/workflows/${workflowRef}/dispatch`, {
      trigger: 'channel_ingress'
    }, 15000, {}, 1);

    if (!dispatch.ok) {
      logger.warn('workflow.dispatch.failed', 'Workflow dispatch failed from gateway', {
        workflow_instance_ref: workflowRef,
        status: dispatch.status
      });
      const replyText = `任务已创建（${workflowRef}），但派发执行失败。请稍后重试，或联系管理员手动重派。`;
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false, workflowRef };
    }

    const runRef = (dispatch.body?.executor_run_ref as string | undefined) || `run_${Date.now()}`;
    const replyText = `✅ 已受理您的任务，正在规划执行中...\n任务编号: ${workflowRef}`;
    fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
    fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
    return { requestType, replyText, modelCallOk: true, workflowRef, runRef };
  }

  // task_dispatch 路径: 管理员通过LUI下发工作要求 → 创建org_task → 分配+通知
  if (requestType === 'task_dispatch') {
    if (normalized.identity_binding_state !== 'bound') {
      const replyText = '身份尚未绑定，请先完成身份验证后再下发任务。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }
    const pool = await getSharedDbPool();
    if (!pool) {
      const replyText = '系统暂不可用，请稍后重试。';
      return { requestType, replyText, modelCallOk: false };
    }

    const roleCheck = await pool.query(
      `SELECT role FROM "user" WHERE username = $1 LIMIT 1`,
      [ownerUserId]
    );
    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== 'admin') {
      const replyText = '只有管理员才有权限下发工作任务。如需此权限请联系系统管理员。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }
    try {
      const taskResult = await pool.query(
        `INSERT INTO org_task (org_id, created_by, title, description, task_type, schedule_type, status, prompt_message, target_channels, required_fields, metadata)
         VALUES ($1,$2,$3,$4,'form','once','active',$5,ARRAY['wecom','feishu'],'[]'::jsonb,jsonb_build_object('source','lui','channel',$6))
         RETURNING *`,
        [orgId || null, ownerUserId, text.substring(0, 100), text, text, String(normalized.channel_type || 'unknown')]
      );
      const task = taskResult.rows[0];
      const assignResult = await postJson(`http://localhost:${port}/internal/tasks/assign`, { task_id: task.id }, 15000);
      const notifyResult = await postJson(`http://localhost:${port}/internal/tasks/notify`, { task_id: task.id }, 15000);
      const assignedCount = (assignResult.body as Record<string, unknown>)?.assigned || 0;
      const notifiedCount = (notifyResult.body as Record<string, unknown>)?.notified || 0;
      const replyText = `✅ 工作要求已创建并下发！\n📋 任务: ${task.title}\n👥 已分配: ${assignedCount} 人\n📢 已通知: ${notifiedCount} 人\n任务编号: ${task.id}`;
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: true };
    } catch (err) {
      logger.error('task_dispatch.create_failed', 'Failed to create and dispatch task from LUI', { error: String(err) });
      const replyText = '任务下发失败，请稍后重试或通过Web管理门户手动创建。';
      fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
      fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', replyText), '');
      return { requestType, replyText, modelCallOk: false };
    }
  }

  const recalled = await recallContext(ownerUserId, sessionId);
    const chat = await generateChatReply(text, ownerUserId, recalled.context || undefined);
    const degradedPrefix = recalled.degraded ? '（提示：历史上下文暂不可用，本次按当前消息回复）\n' : '';
    fireAndForget(rememberContext(ownerUserId, sessionId, 'user', text), '');
    fireAndForget(rememberContext(ownerUserId, sessionId, 'assistant', chat.text), '');
    return { requestType, replyText: `${degradedPrefix}${chat.text}`, modelCallOk: chat.modelCallOk };
  } finally {
    inflightCounter--
  }
}

async function handleFeishuEvent(body: Record<string, unknown>): Promise<void> {
  const header = (body.header as Record<string, unknown> | undefined) || {};
  const event = (body.event as Record<string, unknown> | undefined) || {};
  const sender = (event.sender as Record<string, unknown> | undefined) || {};
  const senderId = (sender.sender_id as Record<string, unknown> | undefined) || {};
  const message = (event.message as Record<string, unknown> | undefined) || {};

  const eventId = typeof header.event_id === 'string'
    ? header.event_id
    : (typeof body.event_id === 'string' ? body.event_id : null);

  logger.info('feishu.event.received', 'Feishu event received by gateway', {
    eventId,
    eventType: body.type,
    chatId: maskSensitive(message.chat_id),
    openId: maskSensitive(senderId.open_id),
    unionId: maskSensitive(senderId.union_id),
    userId: maskSensitive(senderId.user_id)
  });

  if (eventId && isDuplicateEvent(`feishu:${eventId}`)) {
    return;
  }

  const contentRaw = typeof message.content === 'string' ? message.content : '{}';
  const content = parseJson(contentRaw) || {};
  const msgType = typeof message.msg_type === 'string' ? message.msg_type : 'text';
  const text = typeof content.text === 'string' ? content.text : '';
  const channelIdentity =
    typeof senderId.open_id === 'string'
      ? senderId.open_id
      : (typeof senderId.union_id === 'string' ? senderId.union_id : 'unknown');

  if (msgType === 'file' || msgType === 'image') {
    const fileKey = String(content.file_key || content.image_key || '');
    const fileName = String(content.file_name || (msgType === 'image' ? 'image.png' : 'file.bin'));

    if (fileKey) {
      logger.info('feishu.file.received', 'Received file message from Feishu', {
        msg_type: msgType, file_key: fileKey, file_name: fileName
      });

      const fileBuffer = await downloadFeishuFile(fileKey, msgType);
      if (fileBuffer) {
        const resolved = await resolveIdentity(normalizeMessage({
          channel_identity: channelIdentity,
          session_hint: {
            channel_type: 'feishu',
            channel_account_id: String(header.tenant_key || body.tenant_key || 'default'),
            conversation_id: message.chat_id
          },
          raw_message: { text: `[文件导入] ${fileName}` },
          attachments: [{ type: msgType, file_key: fileKey, file_name: fileName }]
        }));

        const userId = String(resolved.user_id || '');
        if (userId && resolved.identity_binding_state === 'bound') {
          const importResult = await importFileAsKnowledge(fileBuffer, fileName, userId, 'feishu');
          const replyText = importResult.ok
            ? `文件"${fileName}"已导入知识库 (document_id: ${importResult.document_id})`
            : `文件"${fileName}"导入失败: ${importResult.error}`;

          const chatId = String(message.chat_id || '');
          if (chatId) {
            fireAndForget(sendFeishuTextReply(chatId, 'chat_id', replyText), '');
          }
        } else {
          const chatId = String(message.chat_id || '');
          if (chatId) {
            fireAndForget(sendFeishuTextReply(chatId, 'chat_id', '身份尚未绑定，请先完成身份验证后再导入文件。'), '');
          }
        }
      }
    }

    return;
  }

  if (!text) {
    logger.warn('feishu.event.empty_text', 'Feishu event has no text content');
    return;
  }

  const normalized = normalizeMessage({
    channel_identity: channelIdentity,
    session_hint: {
      channel_type: 'feishu',
      channel_account_id: String(header.tenant_key || body.tenant_key || 'default'),
      conversation_id: message.chat_id,
      thread_id: message.thread_id
    },
    raw_message: { text },
    attachments: []
  });

  const resolved = await resolveIdentity(normalized);
  const processed = await processIncomingText(resolved);
  const finalReply = processed.replyText;
  const receiveTargets: Array<{ receiveIdType: FeishuReceiveIdType; receiveId: string }> = [];
  if (typeof message.chat_id === 'string' && message.chat_id) {
    receiveTargets.push({ receiveIdType: 'chat_id', receiveId: message.chat_id });
  }
  if (typeof senderId.user_id === 'string' && senderId.user_id) {
    receiveTargets.push({ receiveIdType: 'user_id', receiveId: senderId.user_id });
  }
  if (typeof senderId.open_id === 'string' && senderId.open_id) {
    receiveTargets.push({ receiveIdType: 'open_id', receiveId: senderId.open_id });
  }
  if (typeof senderId.union_id === 'string' && senderId.union_id) {
    receiveTargets.push({ receiveIdType: 'union_id', receiveId: senderId.union_id });
  }

  let delivered = false;
  let deliveredVia: FeishuReceiveIdType | null = null;
  logger.info('feishu.reply.attempt', 'Trying Feishu reply targets', {
    targetCount: receiveTargets.length,
    targetTypes: receiveTargets.map((target) => target.receiveIdType)
  });
  for (const target of receiveTargets) {
    delivered = await sendFeishuTextReply(target.receiveId, target.receiveIdType, finalReply);
    if (delivered) {
      deliveredVia = target.receiveIdType;
      break;
    }
  }

  if (processed.requestType === 'task' && processed.workflowRef) {
    fireAndForget(pollAndReplyWorkflowResult(processed.workflowRef, receiveTargets), '');
  }

  logger.info('feishu.event.completed', 'Feishu event processing completed', {
    session_ref: resolved.session_ref,
    delivered,
    delivered_via: deliveredVia,
    request_type: processed.requestType
  });
}

function verifyWecomSignature(requestUrl: URL, rawBody?: string): boolean {
  const token = process.env.WECOM_TOKEN;
  if (!token) {
    logger.warn('wecom.signature.skipped', 'WECOM_TOKEN not set, rejecting request');
    return false;
  }

  const signature = requestUrl.searchParams.get('msg_signature') || '';
  const timestamp = requestUrl.searchParams.get('timestamp') || '';
  const nonce = requestUrl.searchParams.get('nonce') || '';
  if (!signature || !timestamp || !nonce) return false;

  if (rawBody && process.env.WECOM_ENCODING_AES_KEY) {
    const echostr = requestUrl.searchParams.get('echostr') || '';
    const encryptType = requestUrl.searchParams.get('encrypt_type');
    if (encryptType === 'aes' || echostr) {
      try {
        const aesKey = Buffer.from(process.env.WECOM_ENCODING_AES_KEY + '=', 'base64');
        const iv = aesKey.slice(0, 16);
        if (echostr) {
          const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
          decipher.setAutoPadding(false);
          const decrypted = Buffer.concat([decipher.update(Buffer.from(echostr, 'base64')), decipher.final()]);
          const msg = decrypted.slice(16);
          const msgLen = msg.readUInt32BE(0);
          const result = msg.slice(4, 4 + msgLen).toString('utf8');
          return result.length > 0;
        }
      } catch {
        logger.warn('wecom.decrypt.echostr_failed', 'Failed to decrypt WeCom echostr');
        return false;
      }
    }
  }

  const source = [token, timestamp, nonce].sort().join('');
  const expected = createHash('sha1').update(source).digest('hex');
  return safeCompareSignature(signature, expected);
}

function tryDecryptWecomMessage(rawBody: string): Record<string, unknown> | null {
  if (!process.env.WECOM_ENCODING_AES_KEY) return null;

  try {
    const body = parseJson(rawBody);
    if (!body || !body.encrypt) return null;

    const aesKey = Buffer.from(process.env.WECOM_ENCODING_AES_KEY + '=', 'base64');
    const iv = aesKey.slice(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(String(body.encrypt), 'base64')), decipher.final()]);
    const msg = decrypted.slice(16);
    const msgLen = msg.readUInt32BE(0);
    const xmlStr = msg.slice(4, 4 + msgLen).toString('utf8');

    const fields: Record<string, string> = {};
    const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(xmlStr)) !== null) {
      fields[match[1]] = match[2];
    }

    return {
      msgtype: fields.MsgType || 'text',
      from_user_id: fields.FromUserName || '',
      to_user_id: fields.ToUserName || '',
      msgid: fields.MsgId || '',
      content: fields.Content || '',
      text: { content: fields.Content || '' },
    };
  } catch (error) {
    logger.warn('wecom.decrypt.failed', 'Failed to decrypt WeCom message', { error: String(error) });
    return null;
  }
}

function verifyFeishuSignature(req: import('node:http').IncomingMessage, rawBody: string): boolean {
  const signingSecret = process.env.FEISHU_SIGNING_SECRET;
  if (!signingSecret) {
    logger.warn('feishu.signature.skipped', 'FEISHU_SIGNING_SECRET not set, rejecting request');
    return false;
  }

  const timestamp = req.headers['x-lark-request-timestamp'];
  const rawSignature = req.headers['x-lark-signature'];
  const nonce = req.headers['x-lark-request-nonce'];

  if (typeof timestamp !== 'string' || typeof rawSignature !== 'string') {
    return false;
  }

  const signature = rawSignature.startsWith('sha256=') ? rawSignature.slice('sha256='.length) : rawSignature;
  if (!signature || signature.length !== 64) {
    return false;
  }

  const payload = typeof nonce === 'string'
    ? `${timestamp}:${nonce}:${rawBody}`
    : `${timestamp}\n${rawBody}`;
  const digest = createHmac('sha256', signingSecret).update(payload).digest('hex');

  return safeCompareSignature(signature, digest);
}

async function getFeishuTenantAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (gatewayState.feishuTokenCache.token && gatewayState.feishuTokenCache.expiresAtMs > now + 10_000) {
    return gatewayState.feishuTokenCache.token;
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return null;

  try {
    const response = await fetch(`${getFeishuApiBase()}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(10000)
    });

    const body = await response.json() as {
      code?: number;
      tenant_access_token?: string;
      expire?: number;
      msg?: string;
    };

    if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
      logger.warn('feishu.token.fetch_failed', 'Failed to fetch Feishu tenant token', {
        status: response.status,
        code: body.code,
        msg: body.msg
      });
      return null;
    }

    const expireSec = typeof body.expire === 'number' && body.expire > 0 ? body.expire : 7200;
    gatewayState.feishuTokenCache.token = body.tenant_access_token;
    gatewayState.feishuTokenCache.expiresAtMs = now + (expireSec * 1000);
    return gatewayState.feishuTokenCache.token;
  } catch (error) {
    logger.warn('feishu.token.fetch_error', 'Unexpected error when fetching Feishu tenant token', {
      error: String(error)
    });
    return null;
  }
}

type FeishuReceiveIdType = 'chat_id' | 'user_id' | 'open_id' | 'union_id';

async function sendFeishuTextReply(receiveId: string, receiveIdType: FeishuReceiveIdType, text: string): Promise<boolean> {
  const token = await getFeishuTenantAccessToken();
  if (!token) return false;

  try {
    const response = await fetch(`${getFeishuApiBase()}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text })
      }),
      signal: AbortSignal.timeout(10000)
    });

    const body = await response.json() as { code?: number; msg?: string };
    if (response.ok && body.code === 0) return true;

    logger.warn('feishu.reply.failed', 'Failed to send Feishu reply message', {
      receiveIdType,
      status: response.status,
      code: body.code,
      msg: body.msg
    });
    return false;
  } catch (error) {
    logger.warn('feishu.reply.error', 'Unexpected error when sending Feishu reply', {
      receiveIdType,
      error: String(error)
    });
    return false;
  }
}

async function pollAndReplyWorkflowResult(workflowRef: string, targets: Array<{ receiveIdType: FeishuReceiveIdType; receiveId: string }>): Promise<void> {
  let lastProgressStatus = '';
  let progressSentCount = 0;
  const maxIterations = Number(process.env.WORKFLOW_POLL_MAX_ITERATIONS || 72);
  for (let i = 0; i < maxIterations; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const res = await fetch(`${workflowUrl}/internal/workflows/${workflowRef}`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) continue;
      const body = await res.json() as { ok?: boolean; workflow?: { status: string; stages?: Array<{ last_output_preview?: string; status: string; stage_key?: string }> } };
      const wf = body.workflow || (body as unknown as { status: string; stages?: Array<{ last_output_preview?: string; status: string }> });
      const status = wf.status;

      if (status !== lastProgressStatus && (status === 'running' || status === 'verifying' || status === 'reporting' || status === 'paused' || status === 'waiting_user' || status === 'blocked') && progressSentCount < 3) {
        const progressLine = `⏳ 任务进行中：${status}\n任务编号: ${workflowRef}`;
        for (const target of targets) {
          const delivered = await sendFeishuTextReply(target.receiveId, target.receiveIdType, progressLine);
          if (delivered) break;
        }
        progressSentCount += 1;
      }
      lastProgressStatus = status;

      if (status === 'succeeded' || status === 'completed' || status === 'failed' || status === 'cancelled') {
        const stages = wf.stages || [];
        const lastStage = stages[stages.length - 1];
        const preview = lastStage?.last_output_preview || '';
        const resultLine = status === 'succeeded' || status === 'completed'
          ? `✅ 任务执行完成！\n任务编号: ${workflowRef}\n\n${preview.substring(0, 800)}`
          : `❌ 任务执行失败 (${status})\n任务编号: ${workflowRef}`;

        for (const target of targets) {
          const delivered = await sendFeishuTextReply(target.receiveId, target.receiveIdType, resultLine);
          if (delivered) break;
        }
        // 异步发送移动推送通知，不阻塞轮询退出
        const userId = (wf as Record<string, unknown>).owner_user_id || '';
        if (userId) {
          fireAndForget(sendMobilePushNotification(
            String(userId),
            status === 'succeeded' || status === 'completed' ? '任务执行完成' : '任务执行失败',
            resultLine.replace(/[#*`]/g, '').substring(0, 200),
            { workflow_ref: workflowRef, status }
          ), 'mobile_push');
        }
        if (status === 'succeeded' || status === 'completed') {
          const wfOrgId = (wf as Record<string, unknown>).org_id || '';
          fireAndForget(extractWorkflowAsSkillCandidate(workflowRef, String(userId || ''), String(wfOrgId)), 'skill_extract');
        }
        return;
      }
    } catch {
      // continue polling
    }
  }

  const timeoutMsg = `⏳ 任务仍在执行中，请稍后查看结果。\n任务编号: ${workflowRef}`;
  for (const target of targets) {
    const delivered = await sendFeishuTextReply(target.receiveId, target.receiveIdType, timeoutMsg);
    if (delivered) break;
  }
}

async function pollAndReplyWorkflowResultWecom(workflowRef: string, wecomUserId: string, agentId?: string): Promise<void> {
  let lastProgressStatus = '';
  let progressSentCount = 0;
  const maxIterations = Number(process.env.WORKFLOW_POLL_MAX_ITERATIONS || 72);
  for (let i = 0; i < maxIterations; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const res = await fetch(`${workflowUrl}/internal/workflows/${workflowRef}`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) continue;
      const body = await res.json() as { ok?: boolean; workflow?: { status: string; stages?: Array<{ last_output_preview?: string; status: string; stage_key?: string }> } };
      const wf = body.workflow || (body as unknown as { status: string; stages?: Array<{ last_output_preview?: string; status: string }> });
      const status = wf.status;

      if (status !== lastProgressStatus && (status === 'running' || status === 'verifying' || status === 'reporting' || status === 'paused' || status === 'waiting_user' || status === 'blocked') && progressSentCount < 3) {
        const progressLine = `⏳ 任务进行中：${status}\n任务编号: ${workflowRef}`;
        await sendWecomTextMessage(wecomUserId, progressLine, agentId);
        progressSentCount += 1;
      }
      lastProgressStatus = status;

      if (status === 'succeeded' || status === 'completed' || status === 'failed' || status === 'cancelled') {
        const stages = wf.stages || [];
        const lastStage = stages[stages.length - 1];
        const preview = lastStage?.last_output_preview || '';
        const resultLine = status === 'succeeded' || status === 'completed'
          ? `✅ 任务执行完成！\n任务编号: ${workflowRef}\n\n${preview.substring(0, 800)}`
          : `❌ 任务执行失败 (${status})\n任务编号: ${workflowRef}`;

        fireAndForget(sendWecomTextMessage(wecomUserId, resultLine, agentId), '');
        // 异步发送移动推送通知
        const userId = (wf as Record<string, unknown>).owner_user_id || '';
        if (userId) {
          fireAndForget(sendMobilePushNotification(
            String(userId),
            status === 'succeeded' || status === 'completed' ? '任务执行完成' : '任务执行失败',
            resultLine.replace(/[#*`]/g, '').substring(0, 200),
            { workflow_ref: workflowRef, status }
          ), 'mobile_push');
        }
        return;
      }
    } catch {
      // continue polling
    }
  }

  const timeoutMsg = `⏳ 任务仍在执行中，请稍后查看结果。\n任务编号: ${workflowRef}`;
  fireAndForget(sendWecomTextMessage(wecomUserId, timeoutMsg, agentId), '');
}
async function getWecomAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (gatewayState.wecomTokenCache.token && gatewayState.wecomTokenCache.expiresAtMs > now + 10_000) {
    return gatewayState.wecomTokenCache.token;
  }

  const corpId = process.env.WECOM_CORP_ID;
  const corpSecret = process.env.WECOM_CORP_SECRET;
  if (!corpId || !corpSecret) return null;

  try {
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    const body = await response.json() as {
      errcode?: number;
      access_token?: string;
      expires_in?: number;
      errmsg?: string;
    };

    if (!response.ok || body.errcode !== 0 || !body.access_token) {
      logger.warn('wecom.token.fetch_failed', 'Failed to fetch WeCom access token', {
        status: response.status,
        errcode: body.errcode,
        errmsg: body.errmsg
      });
      return null;
    }

    const expireSec = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 7200;
    gatewayState.wecomTokenCache.token = body.access_token;
    gatewayState.wecomTokenCache.expiresAtMs = now + (expireSec * 1000);
    return gatewayState.wecomTokenCache.token;
  } catch (error) {
    logger.warn('wecom.token.fetch_error', 'Unexpected error when fetching WeCom access token', {
      error: String(error)
    });
    return null;
  }
}

async function sendWecomTextMessage(userId: string, text: string, agentId?: string): Promise<boolean> {
  const token = await getWecomAccessToken();
  if (!token) return false;

  const msgAgentId = agentId || process.env.WECOM_AGENT_ID || '';
  if (!msgAgentId) {
    logger.warn('wecom.reply.no_agent', 'WECOM_AGENT_ID not set, cannot send message');
    return false;
  }

  try {
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          touser: userId,
          msgtype: 'text',
          agentid: Number(msgAgentId),
          text: { content: text }
        }),
        signal: AbortSignal.timeout(10000)
      }
    );

    const body = await response.json() as { errcode?: number; errmsg?: string; invaliduser?: string };
    if (response.ok && body.errcode === 0) return true;

    logger.warn('wecom.reply.failed', 'Failed to send WeCom message', {
      status: response.status,
      errcode: body.errcode,
      errmsg: body.errmsg,
      invaliduser: body.invaliduser
    });
    return false;
  } catch (error) {
    logger.warn('wecom.reply.error', 'Unexpected error when sending WeCom reply', {
      error: String(error)
    });
    return false;
  }
}

async function downloadFeishuFile(fileKey: string, fileType: string = 'file'): Promise<Buffer | null> {
  const token = await getFeishuTenantAccessToken();
  if (!token) return null;

  try {
    const endpoint = fileType === 'image'
      ? `${getFeishuApiBase()}/open-apis/im/v1/images/${fileKey}`
      : `${getFeishuApiBase()}/open-apis/im/v1/files/${fileKey}`;

    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      logger.warn('feishu.file.download_failed', 'Failed to download Feishu file', {
        file_key: fileKey, file_type: fileType, status: response.status
      });
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    logger.warn('feishu.file.download_error', 'Error downloading Feishu file', {
      file_key: fileKey, error: String(error)
    });
    return null;
  }
}

async function downloadWecomFile(mediaId: string): Promise<Buffer | null> {
  const token = await getWecomAccessToken();
  if (!token) return null;

  try {
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`,
      { signal: AbortSignal.timeout(60000) }
    );

    if (!response.ok) {
      logger.warn('wecom.file.download_failed', 'Failed to download WeCom file', {
        media_id: mediaId, status: response.status
      });
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json() as { errcode?: number; errmsg?: string };
      logger.warn('wecom.file.download_error', 'WeCom file download returned error', {
        media_id: mediaId, errcode: body.errcode, errmsg: body.errmsg
      });
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    logger.warn('wecom.file.download_error', 'Error downloading WeCom file', {
      media_id: mediaId, error: String(error)
    });
    return null;
  }
}

async function extractTextFromFile(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (['txt', 'md', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'go', 'rs', 'sql', 'sh', 'log', 'conf', 'ini', 'env'].includes(ext)) {
    return buffer.toString('utf-8');
  }

  if (['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'odt', 'odp', 'ods', 'rtf'].includes(ext)) {
    try {
      const officeParser = await import('officeparser');
      const parseFn = officeParser.parseOffice || officeParser.default?.parseOffice || officeParser.default;
      if (typeof parseFn === 'function') {
        const result: unknown = await parseFn(buffer);
        if (typeof result === 'string' && result.trim()) return result;
        if (result && typeof result === 'object') {
          const ast = result as unknown as Record<string, unknown>;
          const children = (ast.children || ast.slides || ast.sheets || []) as Array<Record<string, unknown>>;
          const parts: string[] = [];
          for (const child of children) {
            const textParts: string[] = [];
            const extractText = (node: Record<string, unknown>): void => {
              if (typeof node.text === 'string' && node.text.trim()) textParts.push(node.text.trim());
              if (typeof node.value === 'string' && node.value.trim()) textParts.push(node.value.trim());
              const kids = (node.children || node.content || []) as Array<Record<string, unknown>>;
              for (const kid of kids) extractText(kid);
            };
            extractText(child);
            if (textParts.length > 0) parts.push(textParts.join('\n'));
          }
          if (parts.length > 0) {
            const separator = ext === 'pptx' ? '\n\n--- Slide ---\n\n' : (ext === 'xlsx' || ext === 'xls' ? '\n\n--- Sheet ---\n\n' : '\n\n');
            return parts.join(separator);
          }
        }
      }
    } catch (error) {
      logger.warn('file.parse.office_failed', `officeparser failed for .${ext}, falling back to legacy parser`, {
        file_name: fileName, error: String(error)
      });
    }

    if (ext === 'pdf') {
      try {
        const pdfParse = await import('pdf-parse');
        const data = await pdfParse.default(buffer);
        return data.text || '';
      } catch (error) {
        logger.warn('file.parse.pdf_fallback_failed', 'PDF fallback parsing failed', { file_name: fileName, error: String(error) });
      }
    }

    if (ext === 'docx') {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return result.value || '';
      } catch (error) {
        logger.warn('file.parse.docx_fallback_failed', 'DOCX fallback parsing failed', { file_name: fileName, error: String(error) });
      }
    }

    return buffer.toString('utf-8').replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
  }

  return buffer.toString('utf-8').replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
}

async function importFileAsKnowledge(
  buffer: Buffer,
  fileName: string,
  ownerUserId: string,
  channelType: string,
  scope: string[] = ['private']
): Promise<{ ok: boolean; document_id?: string; error?: string }> {
  const sanitized = sanitizeFileName(fileName);
  const validation = validateFileForImport(buffer, sanitized.sanitized);
  if (!validation.valid) {
    logger.warn('file.import.validation_failed', 'File failed validation', {
      original_name: sanitized.original.slice(0, 100),
      reason: validation.reason,
      file_size: buffer.byteLength
    });
    return { ok: false, error: validation.reason || 'file_validation_failed' };
  }

  const contentText = await extractTextFromFile(buffer, sanitized.sanitized);
  const textValidation = validateTextContent(contentText);
  if (!textValidation.valid) {
    return { ok: false, error: textValidation.reason || 'content_validation_failed' };
  }

  const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || '';

  try {
    const response = await fetch(`${factRetrievalUrl}/internal/documents/index`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: ownerUserId,
        title: `[${channelType}] ${sanitized.sanitized}`,
        content_text: contentText,
        source_type: `${channelType}_file`,
        source_uri: sanitized.sanitized,
        scope
      }),
      signal: AbortSignal.timeout(30000)
    });

    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      return { ok: false, error: String(result.error || 'indexing_failed') };
    }

    return { ok: true, document_id: String(result.document_id || '') };
  } catch (error) {
    return { ok: false, error: `indexing_service_error: ${(error as Error).message}` };
  }
}

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';

  const captureWrite = res.write.bind(res);
  const captureEnd = res.end.bind(res);
  const chunks: Buffer[] = [];

   res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
     if (chunk) {
       const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
       chunks.push(buf);
     }
     return (captureWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
   } as typeof res.write;

   res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
     if (chunk) {
       const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
       chunks.push(buf);
     }
     responseBody = Buffer.concat(chunks).toString('utf-8').slice(0, 2000);
     return (captureEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
   } as typeof res.end;

  try {
    const pathname = extractPathname(req.url);

  if (pathname === '/health' || pathname === '/health/live' || pathname === '/health/ready') {
    sendJson(res, 200, {
      ok: true,
      service: 'gateway-adapter',
      stats: {
        dedupe_cache_size: gatewayState.dedupeCache.size,
        dedupe_ttl_ms: gatewayState.dedupeTtlMs,
        token_cached: Boolean(gatewayState.feishuTokenCache.token && gatewayState.feishuTokenCache.expiresAtMs > Date.now()),
        inflight_requests: inflightCounter,
        inflight_max: MAX_INFLIGHT_REQUESTS,
        db_pool_max: DB_POOL_MAX
      }
    });
    return;
  }

  if (pathname === '/internal/channel-ingress/normalize' && req.method === 'POST') {
    const rawBody = await readBody(req);
    const body = parseJson(rawBody);
    if (!body) {
      sendJson(res, 400, { ok: false, error: 'invalid_json' });
      return;
    }
    sendJson(res, 200, normalizeMessage(body));
    return;
  }

  if ((pathname === '/channels/feishu/webhook' || pathname === '/webhook/feishu') && req.method === 'POST') {
    const rawBody = await readBody(req);
    const body = parseJson(rawBody);
    if (!body) {
      sendJson(res, 400, { ok: false, error: 'invalid_json' });
      return;
    }

    if (!verifyFeishuSignature(req, rawBody)) {
      sendJson(res, 401, { ok: false, error: 'signature_invalid' });
      return;
    }

    const challenge = body.challenge;
    if (body.type === 'url_verification' && typeof challenge === 'string') {
      sendJson(res, 200, { challenge });
      return;
    }

    sendJson(res, 200, { ok: true, received: true });
    setImmediate(() => { handleFeishuEvent(body).catch(e => logger.error('feishu.webhook.async_error', 'Async webhook event processing failed', { error: String(e) })); });
    return;
  }

  if (pathname === '/channels/feishu/longconn/event' && req.method === 'POST') {
    const rawBody = await readBody(req);
    const body = parseJson(rawBody);
    if (!body) {
      sendJson(res, 400, { ok: false, error: 'invalid_json' });
      return;
    }

    const feishuAppId = process.env.FEISHU_APP_ID || '';
    if (feishuAppId && body.header && (body.header as Record<string, unknown>).app_id !== feishuAppId) {
      logger.warn('feishu.longconn.invalid_app', 'Feishu longconn event from unexpected app_id', { app_id: (body.header as Record<string, unknown>).app_id });
      sendJson(res, 403, { ok: false, error: 'invalid_app_id' });
      return;
    }

    sendJson(res, 200, { ok: true, received: true });
    setImmediate(() => { handleFeishuEvent(body).catch(e => logger.error('feishu.event.async_error', 'Async Feishu event processing failed', { error: String(e) })); });
    return;
  }

  if ((pathname === '/channels/wecom/webhook' || pathname === '/webhook/wecom')) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');

    if (req.method === 'GET') {
      const rawBody = await readBody(req);
      if (!verifyWecomSignature(requestUrl, rawBody)) {
        sendText(res, 401, 'signature_invalid');
        return;
      }
      const echoStr = requestUrl.searchParams.get('echostr') || '';
      sendText(res, 200, echoStr);
      return;
    }

    if (req.method === 'POST') {
      const rawBody = await readBody(req);
      if (!verifyWecomSignature(requestUrl, rawBody)) {
        sendJson(res, 401, { ok: false, error: 'signature_invalid' });
        return;
      }

      const decrypted = tryDecryptWecomMessage(rawBody);
      const body = decrypted || parseJson(rawBody);
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' });
        return;
      }

      const eventId =
        typeof body.msgid === 'string'
          ? body.msgid
          : (typeof body.event_id === 'string' ? body.event_id : null);
      if (eventId && isDuplicateEvent(`wecom:${eventId}`)) {
        sendJson(res, 200, { errcode: 0, errmsg: 'ok', duplicate: true });
        return;
      }

      const textSource = (body.text as Record<string, unknown> | undefined) || {};
      const text =
        typeof textSource.content === 'string'
          ? textSource.content
          : (typeof body.content === 'string' ? body.content : '');
      const channelIdentity = typeof body.from_user_id === 'string'
        ? body.from_user_id
        : (typeof body.external_userid === 'string' ? body.external_userid : 'unknown');

      const msgType = String(body.msgtype || body.MsgType || 'text');

      if (msgType === 'file' || msgType === 'image' || msgType === 'voice') {
        const fileBody = (body[msgType] as Record<string, unknown> | undefined) || {};
        const mediaId = String(fileBody.media_id || fileBody.file_key || '');
        const fileName = String(fileBody.file_name || fileBody.filename || `${msgType}_${Date.now()}.${msgType === 'image' ? 'png' : msgType === 'voice' ? 'amr' : 'bin'}`);

        if (mediaId) {
          logger.info('wecom.file.received', 'Received file message from WeCom', {
            msg_type: msgType, media_id: mediaId, file_name: fileName
          });

          const fileBuffer = await downloadWecomFile(mediaId);
          if (fileBuffer) {
            const resolved = await resolveIdentity(normalizeMessage({
              channel_identity: channelIdentity,
              session_hint: {
                channel_type: 'wecom',
                channel_account_id: String(body.to_user_id || body.agentid || 'default'),
                conversation_id: body.conversation_id || body.chatid
              },
              raw_message: { text: `[文件导入] ${fileName}` },
              attachments: [{ type: msgType, media_id: mediaId, file_name: fileName }]
            }));

            const userId = String(resolved.user_id || '');
            if (userId && resolved.identity_binding_state === 'bound') {
              const importResult = await importFileAsKnowledge(fileBuffer, fileName, userId, 'wecom');
              const replyText = importResult.ok
                ? `文件"${fileName}"已导入知识库 (document_id: ${importResult.document_id})`
                : `文件"${fileName}"导入失败: ${importResult.error}`;

              const wecomUserId = typeof body.from_user_id === 'string' ? body.from_user_id : '';
              if (wecomUserId) {
                fireAndForget(sendWecomTextMessage(wecomUserId, replyText), '');
              }
            } else {
              const wecomUserId = typeof body.from_user_id === 'string' ? body.from_user_id : '';
              if (wecomUserId) {
                fireAndForget(sendWecomTextMessage(wecomUserId, '身份尚未绑定，请先完成身份验证后再导入文件。'), '');
              }
            }
          }
        }

        sendJson(res, 200, { errcode: 0, errmsg: 'ok', processed: 'file_import' });
        return;
      }

      if (!text) {
        sendJson(res, 400, { ok: false, error: 'invalid_payload' });
        return;
      }

      const normalized = normalizeMessage({
        channel_identity: channelIdentity,
        session_hint: {
          channel_type: 'wecom',
          channel_account_id: String(body.to_user_id || body.agentid || 'default'),
          conversation_id: body.conversation_id || body.chatid,
          thread_id: body.thread_id
        },
        raw_message: { text },
        attachments: []
      });

      const resolved = await resolveIdentity(normalized);
      const processed = await processIncomingText(resolved);
      const finalReply = processed.replyText;

      const wecomUserId = typeof body.from_user_id === 'string' ? body.from_user_id : '';
      let delivered = false;
      if (wecomUserId) {
        delivered = await sendWecomTextMessage(wecomUserId, finalReply);
      }

      if (processed.requestType === 'task' && processed.workflowRef && wecomUserId) {
        fireAndForget(pollAndReplyWorkflowResultWecom(processed.workflowRef, wecomUserId), '');
      }

      sendJson(res, 200, {
        errcode: 0,
        errmsg: 'ok',
        session_ref: resolved.session_ref,
        reply_text: finalReply,
        delivered,
        request_type: processed.requestType,
        model_call_ok: processed.modelCallOk
      });
      return;
    }
  }

  // Internal: send WeChat Work notification (from web-portal task scheduler)
  if (pathname === '/internal/notify/wecom' && req.method === 'POST') {
    const body = await readBody(req).then(raw => parseJson(raw) || {});
    const userId = String(body.user_id || '');
    const content = String(body.content || '');
    if (!userId || !content) {
      sendJson(res, 400, { ok: false, error: 'missing_user_id_or_content' });
      return;
    }
    let delivered = false;
    try {
      delivered = await sendWecomTextMessage(userId, content);
    } catch { /* ignore */ }
    sendJson(res, 200, { ok: true, delivered });
    return;
  }

  // Admin: Create org task
  if (pathname === '/admin/tasks' && req.method === 'POST') {
    const body = await readBody(req).then(raw => parseJson(raw) || {});
    const { title, description, task_type, schedule_type, cron_expression, prompt_message, target_channels, org_id, created_by } = body;
    if (!title || !task_type || !schedule_type) {
      sendJson(res, 400, { ok: false, error: 'missing_required_fields', message: 'title, task_type, schedule_type 为必填项' });
      return;
    }
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      const result = await pool.query(
        `INSERT INTO org_task (org_id, created_by, title, description, task_type, schedule_type, cron_expression, status, prompt_message, target_channels, required_fields, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,'[]'::jsonb,'{}'::jsonb) RETURNING *`,
        [org_id || null, created_by || null, title, description || '', task_type, schedule_type, cron_expression || null, prompt_message || '', target_channels || ['wecom']]
      );
      sendJson(res, 201, { ok: true, task: result.rows[0] });
    } catch (err) {
      logger.error('admin_tasks.create_failed', 'Failed to create org task', { error: String(err) });
      sendJson(res, 500, { ok: false, error: 'create_failed' });
    }
    return;
  }

  // Admin: List org tasks
  if (pathname === '/admin/tasks' && req.method === 'GET') {
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      const result = await pool.query(`SELECT t.*, (SELECT COUNT(*) FROM org_task_assignment a WHERE a.task_id = t.id AND a.status = 'completed') as completed_count, (SELECT COUNT(*) FROM org_task_assignment a WHERE a.task_id = t.id) as total_count FROM org_task t ORDER BY t.created_at DESC`);
      sendJson(res, 200, { ok: true, tasks: result.rows });
    } catch (err) {
      logger.error('admin_tasks.list_failed', 'Failed to list org tasks', { error: String(err) });
      sendJson(res, 500, { ok: false, error: 'list_failed' });
    }
    return;
  }

  // Admin: Update org task
  if (pathname.startsWith('/admin/tasks/') && req.method === 'PUT') {
    const taskId = pathname.slice('/admin/tasks/'.length);
    const body = await readBody(req).then(raw => parseJson(raw) || {});
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;
      for (const [k, v] of Object.entries(body)) {
        if (['title', 'description', 'status', 'prompt_message', 'cron_expression', 'target_channels'].includes(k)) {
          sets.push(`"${k}" = $${idx}`);
          vals.push(v);
          idx++;
        }
      }
      if (sets.length === 0) { sendJson(res, 400, { ok: false, error: 'no_fields_to_update' }); return; }
      sets.push(`updated_at = now()`);
      vals.push(taskId);
      const result = await pool.query(`UPDATE org_task SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, vals);
      if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'task_not_found' }); return; }
      sendJson(res, 200, { ok: true, task: result.rows[0] });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'update_failed' });
    }
    return;
  }

  // Admin: Delete org task
  if (pathname.startsWith('/admin/tasks/') && req.method === 'DELETE') {
    const taskId = pathname.slice('/admin/tasks/'.length);
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      await pool.query(`DELETE FROM org_task_assignment WHERE task_id = $1`, [taskId]);
      const result = await pool.query(`DELETE FROM org_task WHERE id = $1 RETURNING id`, [taskId]);
      if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'task_not_found' }); return; }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'delete_failed' });
    }
    return;
  }

  // Internal: Assign task to users
  if (pathname === '/internal/tasks/assign' && req.method === 'POST') {
    const body = await readBody(req).then(raw => parseJson(raw) || {});
    const taskId = String(body.task_id || '');
    if (!taskId) { sendJson(res, 400, { ok: false, error: 'missing_task_id' }); return; }
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      const taskResult = await pool.query(`SELECT * FROM org_task WHERE id = $1`, [taskId]);
      if (taskResult.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'task_not_found' }); return; }
      const task = taskResult.rows[0];
      const taskOrgId = task.org_id;
      let users: Array<Record<string, unknown>> = [];
      if (taskOrgId) {
        const userResult = await pool.query(`SELECT id, username FROM "user" WHERE org_id = $1`, [taskOrgId]);
        users = userResult.rows;
      } else {
        const userResult = await pool.query(`SELECT id, username FROM "user" LIMIT 100`);
        users = userResult.rows;
      }
      let assigned = 0;
      for (const user of users) {
        const existing = await pool.query(`SELECT id FROM org_task_assignment WHERE task_id = $1 AND user_id = $2 AND status IN ('pending','notified')`, [taskId, user.id]);
        if (existing.rows.length > 0) continue;
        await pool.query(
          `INSERT INTO org_task_assignment (task_id, user_id, org_id, status, response_data, metadata) VALUES ($1,$2,$3,'pending','{}'::jsonb,'{}'::jsonb)`,
          [taskId, user.id, taskOrgId || null]
        );
        assigned++;
      }
      sendJson(res, 200, { ok: true, assigned, total_users: users.length });
    } catch (err) {
      logger.error('tasks.assign_failed', 'Failed to assign task', { error: String(err) });
      sendJson(res, 500, { ok: false, error: 'assign_failed' });
    }
    return;
  }

  // Internal: Notify assigned users
  if (pathname === '/internal/tasks/notify' && req.method === 'POST') {
    const body = await readBody(req).then(raw => parseJson(raw) || {});
    const taskId = String(body.task_id || '');
    if (!taskId) { sendJson(res, 400, { ok: false, error: 'missing_task_id' }); return; }
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      const taskResult = await pool.query(`SELECT * FROM org_task WHERE id = $1`, [taskId]);
      if (taskResult.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'task_not_found' }); return; }
      const task = taskResult.rows[0];
      const pendingResult = await pool.query(`SELECT a.*, u.username FROM org_task_assignment a JOIN "user" u ON u.id = a.user_id WHERE a.task_id = $1 AND a.status = 'pending'`, [taskId]);
      let notified = 0;
      for (const assignment of pendingResult.rows) {
        const content = `📋 **${task.title}**\n${task.prompt_message || task.description}\n请及时提交您的反馈。`;
        let delivered = false;
        const channels = (task.target_channels || ['wecom']) as string[];
        if (channels.includes('wecom')) {
          try { delivered = await sendWecomTextMessage(String(assignment.username), content); } catch { /* ignore */ }
        }
        if (channels.includes('feishu')) {
          try { delivered = await sendFeishuTextReply(String(assignment.username), 'open_id', content) || delivered; } catch { /* ignore */ }
        }
        try {
          await fetch(`${mobileAppUrl}/internal/notifications/send`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: assignment.user_id, title: task.title, body: task.prompt_message || task.description, category: 'task_dispatch', deep_link: `/my-tasks` })
          });
        } catch { /* ignore mobile push failure */ }
        await pool.query(`UPDATE org_task_assignment SET status = 'notified', notified_at = now() WHERE id = $1`, [assignment.id]);
        notified++;
      }
      sendJson(res, 200, { ok: true, notified });
    } catch (err) {
      logger.error('tasks.notify_failed', 'Failed to notify users', { error: String(err) });
      sendJson(res, 500, { ok: false, error: 'notify_failed' });
    }
    return;
  }

  // User: List my tasks
  if (pathname === '/tasks' && req.method === 'GET') {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const userId = requestUrl.searchParams.get('user_id') || '';
    if (!userId) { sendJson(res, 400, { ok: false, error: 'missing_user_id' }); return; }
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      const result = await pool.query(
        `SELECT a.*, t.title, t.description, t.task_type, t.prompt_message, t.schedule_type FROM org_task_assignment a JOIN org_task t ON t.id = a.task_id WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
        [userId]
      );
      sendJson(res, 200, { ok: true, assignments: result.rows });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'list_failed' });
    }
    return;
  }

  // User: Submit task response
  if (pathname.match(/^\/tasks\/[^/]+\/submit$/) && req.method === 'POST') {
    const assignmentId = pathname.split('/')[2];
    const body = await readBody(req).then(raw => parseJson(raw) || {});
    const pool = await getSharedDbPool();
    if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
    try {
      const existing = await pool.query(`SELECT * FROM org_task_assignment WHERE id = $1`, [assignmentId]);
      if (existing.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'assignment_not_found' }); return; }
      if (existing.rows[0].status === 'completed') { sendJson(res, 400, { ok: false, error: 'already_completed' }); return; }
      await pool.query(
        `UPDATE org_task_assignment SET status = 'completed', completed_at = now(), response_data = $1 WHERE id = $2`,
        [JSON.stringify(body.response_data || {}), assignmentId]
      );
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'submit_failed' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.unhandled_error', 'Unhandled request error', {
      error: (error as Error).message,
      stack: (error as Error).stack?.slice(0, 500)
    });
    recordCriticalLog('gateway.error');
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    }
  }
  await httpResponseLogger(req, res, responseBody);
});

setupDefaultHealthChecks(
  async () => {
    try {
      const res = await fetch(`${workflowUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  },
  async () => {
    try {
      const res = await fetch(`${hermesUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  }
);

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

server.listen(port, () => {
  checkProductionSecurity();
  logger.info('service.started', 'Gateway adapter started', { port });

  aggregationInterval = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') {
      writeAggregationReport(report);
    }
  }, 30000);
  if (aggregationInterval.unref) aggregationInterval.unref();
});

const gracefulShutdown = async (signal: string) => {
  logger.info('service.shutdown', 'Gateway adapter shutting down', { signal });
  if (aggregationInterval) { clearInterval(aggregationInterval); aggregationInterval = null; }
  const finalReport = analyze();
  writeAggregationReport(finalReport);
  metricsRegistry.shutdown();
  await logger.shutdown();
  server.close(() => {
    logger.info('service.shutdown.complete', 'Gateway adapter shutdown complete', {});
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
