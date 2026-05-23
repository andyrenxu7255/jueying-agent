import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import YAML from 'yaml';
import { createLogger, configManager, checkProductionSecurity, t, tf } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';

function execDocker(args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('docker', args, { timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(stdout);
    });
  });
}

const logger = createLogger('web-portal');
const port = Number(process.env.PORT || configManager.getPath<number>('server.port') || 3000);
const gatewayUrl = process.env.GATEWAY_URL || '';
const workflowUrl = process.env.WORKFLOW_URL || '';
const executorUrl = process.env.EXECUTOR_URL || '';
const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || '';
const skillLibraryUrl = process.env.SKILL_LIBRARY_URL || '';
const resourceSchedulerUrl = process.env.RESOURCE_SCHEDULER_URL || 'http://resource-scheduler:3000';
const proactiveOrchestratorUrl = process.env.PROACTIVE_ORCHESTRATOR_URL || 'http://proactive-orchestrator:3000';
const mobileAppUrl = process.env.MOBILE_APP_URL || '';
const hermesUrl = process.env.HERMES_URL || '';

const STATIC_DIR = resolve(__dirname, '../static');

type SessionRole = 'admin' | 'user' | 'guest';
type PortalLang = 'zh-CN' | 'en';

interface Session {
  user_id: string;
  username: string;
  role: SessionRole;
  org_id: string | null;
  created_at: number;
  context_workflows: Record<string, string>;
}

interface ConfigSection {
  key: string;
  label: string;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'number' | 'select' | 'checkbox';
    options?: string[];
    default?: string;
    sensitive?: boolean;
    hint?: string;
  }>;
}

function getRequestLang(req: IncomingMessage): PortalLang {
  const header = req.headers['accept-language'];
  const value = Array.isArray(header) ? header.join(',') : String(header || '');
  return value.toLowerCase().includes('en') ? 'en' : 'zh-CN';
}

function getConfigSections(lang: PortalLang): ConfigSection[] {
  const label = (key: string) => t(lang, key);
  return [
    {
      key: 'feishu',
      label: label('config.label.feishu'),
      fields: [
        { key: 'FEISHU_APP_ID', label: 'App ID', type: 'text' },
        { key: 'FEISHU_APP_SECRET', label: 'App Secret', type: 'password', sensitive: true },
        { key: 'FEISHU_SIGNING_SECRET', label: label('config.field.signing_secret'), type: 'password', sensitive: true, hint: label('config.field.signing_secret_hint') },
        { key: 'FEISHU_DOMAIN', label: label('config.field.domain'), type: 'select', options: ['feishu', 'lark'], default: 'feishu' },
      ],
    },
    {
      key: 'wecom',
      label: label('config.label.wecom'),
      fields: [
        { key: 'WECOM_CORP_ID', label: label('config.field.corp_id'), type: 'text' },
        { key: 'WECOM_TOKEN', label: label('config.field.callback_token'), type: 'password', sensitive: true },
        { key: 'WECOM_ENCODING_AES_KEY', label: label('config.field.aes_key'), type: 'password', sensitive: true },
        { key: 'WECOM_AGENT_ID', label: label('config.field.agent_id'), type: 'text' },
        { key: 'WECOM_SECRET', label: label('config.field.app_secret'), type: 'password', sensitive: true },
      ],
    },
    {
      key: 'llm',
      label: label('config.label.llm'),
      fields: [
        { key: 'LITELLM_URL', label: label('config.field.litellm_url'), type: 'text', default: 'http://localhost:4000' },
        { key: 'LITELLM_MASTER_KEY', label: 'Master Key', type: 'password', sensitive: true },
        { key: 'LITELLM_MODEL', label: label('config.field.default_model'), type: 'text', default: 'minimax-m2.7' },
        { key: 'LITELLM_FALLBACK_MODELS', label: label('config.field.fallback_models'), type: 'text', default: '' },
      ],
    },
    {
      key: 'embedding',
      label: label('config.label.embedding'),
      fields: [
        { key: 'EMBEDDING_MODE', label: label('config.field.mode'), type: 'select', options: ['deterministic', 'provider'], default: 'deterministic' },
        { key: 'EMBEDDING_PROVIDER_URL', label: 'Provider URL', type: 'text' },
        { key: 'EMBEDDING_PROVIDER_MODEL', label: 'Provider Model', type: 'text' },
        { key: 'EMBEDDING_PROVIDER_API_KEY', label: 'API Key', type: 'password', sensitive: true },
        { key: 'EMBEDDING_PROVIDER_DIMENSIONS', label: label('config.field.dimensions'), type: 'number', hint: label('config.field.dimensions_hint') },
        { key: 'EMBEDDING_PROVIDER_TIMEOUT_MS', label: label('config.field.timeout_ms'), type: 'number', hint: label('config.field.timeout_ms_hint') },
      ],
    },
    {
      key: 'rerank',
      label: label('config.label.rerank'),
      fields: [
        { key: 'RERANK_MODE', label: label('config.field.mode'), type: 'select', options: ['deterministic', 'provider'], default: 'deterministic' },
        { key: 'RERANK_PROVIDER_URL', label: 'Provider URL', type: 'text' },
        { key: 'RERANK_PROVIDER_MODEL', label: 'Provider Model', type: 'text' },
        { key: 'RERANK_PROVIDER_API_KEY', label: 'API Key', type: 'password', sensitive: true },
        { key: 'RERANK_PROVIDER_TIMEOUT_MS', label: label('config.field.timeout_ms'), type: 'number', hint: label('config.field.timeout_ms_hint') },
      ],
    },
    {
      key: 'clawhub',
      label: label('config.label.clawhub'),
      fields: [
        { key: 'CLAWHUB_SITE', label: label('config.field.clawhub_site'), type: 'text', default: 'https://clawhub.ai' },
        { key: 'CLAWHUB_REGISTRY', label: label('config.field.clawhub_registry'), type: 'text' },
        { key: 'CLAWHUB_ADMIN_TOKEN', label: label('config.field.clawhub_admin_token'), type: 'password', sensitive: true, hint: label('config.field.clawhub_admin_token_hint') },
      ],
    },
  ];
}

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin';
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 10000;
const MAX_AUDIT_ROWS = 500;
const MAX_RETRIEVAL_ROWS = 300;
const ENV_FILE_PATH = process.env.PORTAL_ENV_FILE || resolve(process.cwd(), '.env');
const CONFIG_ENV_KEYS = Array.from(new Set(getConfigSections('zh-CN').flatMap(section => section.fields.map(field => field.key))));
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_COST = 16384;
const DEFAULT_QUOTAS = {
  concurrent_workflows: 10,
  daily_api_calls: 1000,
  retrieval_queries: 500,
  execution_seconds: 3600,
  storage_bytes: 1073741824,
  llm_tokens: 100000,
};

const CURATED_CLAWHUB_SKILLS: Array<{
  name: string;
  type: string;
  description: string;
  source: string;
  category: string;
  rating: number;
  installCount: number;
  risk: 'low' | 'medium';
  definition: Record<string, unknown>;
}> = [
  {
    name: 'Document Pro',
    type: 'document',
    category: 'office',
    rating: 4.9,
    installCount: 3200,
    risk: 'low',
    description: 'Office document toolkit for PDF, Word, PowerPoint, Excel, CSV, Markdown, and plain text parsing. No API key required.',
    source: 'https://clawhub.ai/skills/document-pro',
    definition: {
      tools: ['office_parser', 'pdf_reader', 'excel_reader', 'mammoth_docx', 'markdown_parser'],
      capabilities: ['read_pdf', 'read_docx', 'read_xlsx', 'read_pptx', 'read_csv', 'extract_text', 'extract_tables'],
      risk_profile: { api_key_required: false, external_network: false, overlaps_memory: false }
    }
  },
  {
    name: 'Office to Markdown',
    type: 'document',
    category: 'office',
    rating: 4.8,
    installCount: 2400,
    risk: 'low',
    description: 'Converts common office documents into clean Markdown for review, indexing, or downstream workflows. No API key required.',
    source: 'https://clawhub.ai/skills/office-to-markdown',
    definition: {
      tools: ['office_parser', 'markdown_writer'],
      capabilities: ['docx_to_markdown', 'pptx_to_markdown', 'xlsx_to_markdown', 'pdf_to_markdown'],
      risk_profile: { api_key_required: false, external_network: false, overlaps_memory: false }
    }
  },
  {
    name: 'PDF Generator',
    type: 'document',
    category: 'office',
    rating: 4.7,
    installCount: 1700,
    risk: 'low',
    description: 'Creates PDFs from Markdown or structured text and supports basic merge/split operations. Local processing; no API key required.',
    source: 'https://clawhub.ai/skills/pdf-generator',
    definition: {
      tools: ['pdf_renderer', 'pdf_merge', 'pdf_split'],
      capabilities: ['markdown_to_pdf', 'text_to_pdf', 'merge_pdfs', 'split_pdf'],
      risk_profile: { api_key_required: false, external_network: false, overlaps_memory: false }
    }
  },
  {
    name: 'URL Fetcher',
    type: 'search',
    category: 'search',
    rating: 4.7,
    installCount: 1900,
    risk: 'medium',
    description: 'Fetches public web pages and extracts readable text for research and knowledge import. Requires network access, no API key.',
    source: 'https://clawhub.ai/skills/url-fetcher',
    definition: {
      tools: ['http_fetch', 'html_readability'],
      capabilities: ['fetch_url', 'extract_page_text', 'normalize_links'],
      risk_profile: { api_key_required: false, external_network: true, overlaps_memory: false }
    }
  },
  {
    name: 'Search Intelligence',
    type: 'search',
    category: 'search',
    rating: 4.8,
    installCount: 2400,
    risk: 'medium',
    description: 'Plans multi-step web research using free search sources, de-duplicates results, and summarizes evidence. No API key required.',
    source: 'https://clawhub.ai/skills/search-intelligence',
    definition: {
      tools: ['query_decomposer', 'free_web_search', 'answer_synthesizer'],
      capabilities: ['decompose_question', 'multi_round_search', 'synthesize_findings', 'cite_sources'],
      risk_profile: { api_key_required: false, external_network: true, overlaps_memory: false }
    }
  },
  {
    name: 'Weather',
    type: 'utility',
    category: 'office',
    rating: 4.6,
    installCount: 1100,
    risk: 'low',
    description: 'Uses public weather data for current weather and short forecasts. No API key required.',
    source: 'https://clawhub.ai/skills/weather',
    definition: {
      tools: ['open_meteo_api'],
      capabilities: ['current_weather', 'weekly_forecast', 'humidity_wind'],
      risk_profile: { api_key_required: false, external_network: true, overlaps_memory: false }
    }
  },
  {
    name: 'Skill Vetter',
    type: 'security',
    category: 'security',
    rating: 4.9,
    installCount: 1600,
    risk: 'low',
    description: 'Reviews skill definitions for permissions, suspicious patterns, and conflict risk before installation.',
    source: 'https://clawhub.ai/skills/skill-vetter',
    definition: {
      tools: ['permission_scanner', 'code_auditor'],
      capabilities: ['scan_permissions', 'check_reputation', 'identify_risks', 'approve_or_block'],
      risk_profile: { api_key_required: false, external_network: false, overlaps_memory: false }
    }
  },
  {
    name: 'MEDDIC B2B Sales Review',
    type: 'workflow',
    category: 'sales',
    rating: 4.9,
    installCount: 468,
    risk: 'low',
    description: 'B2B销售机会复盘、Pipeline Review、拜访复盘和销售辅导技能，以MEDDIC和销售六步法为核心。No API key required.',
    source: 'https://clawhub.ai/andyrenxu7255/meddic-b2b-sales-review',
    definition: {
      tools: [],
      capabilities: ['deal_review', 'pipeline_review', 'visit_debrief', 'forecast_calibration', 'next_best_action'],
      clawhub_slug: 'meddic-b2b-sales-review',
      risk_profile: { api_key_required: false, external_network: false, overlaps_memory: false }
    }
  },
  {
    name: 'Customer Research',
    type: 'search',
    category: 'sales',
    rating: 4.8,
    installCount: 645,
    risk: 'medium',
    description: '客户调研与竞品情报技能，生成调研报告和场景破冰PPT。Uses public web search; no API key required.',
    source: 'https://clawhub.ai/andyrenxu7255/customer-research',
    definition: {
      tools: ['web_search', 'web_fetch', 'document_writer', 'presentation_builder'],
      capabilities: ['customer_research', 'competitor_intel', 'procurement_record_search', 'scenario_ppt'],
      clawhub_slug: 'customer-research',
      risk_profile: { api_key_required: false, external_network: true, overlaps_memory: false }
    }
  }
];

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_COST }).toString('hex');
  return `scrypt:${SCRYPT_COST}:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): { valid: boolean; needsMigration: boolean; newHash?: string } {
  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return { valid: false, needsMigration: false };
    const cost = Number(parts[1]);
    const salt = parts[2];
    const expected = parts[3];
    const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, { N: cost || SCRYPT_COST }).toString('hex');
    try {
      return { valid: timingSafeEqual(Buffer.from(derived), Buffer.from(expected)), needsMigration: false };
    } catch {
      return { valid: false, needsMigration: false };
    }
  }
  if (storedHash.startsWith('sha256:')) {
    const plain = storedHash.slice(7);
    const computed = createHash('sha256').update(password).digest('hex');
    try {
      const valid = timingSafeEqual(Buffer.from(plain), Buffer.from(computed));
      return { valid, needsMigration: valid, newHash: valid ? hashPassword(password) : undefined };
    } catch {
      return { valid: false, needsMigration: false };
    }
  }
  const computed = createHash('sha256').update(password).digest('hex');
  try {
    const valid = timingSafeEqual(Buffer.from(storedHash), Buffer.from(computed));
    return { valid, needsMigration: valid, newHash: valid ? hashPassword(password) : undefined };
  } catch {
    return { valid: false, needsMigration: false };
  }
}

function validatePasswordStrength(password: string, lang: PortalLang): { valid: boolean; score: number; message: string } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  const valid = score >= 3;
  const message = score < 3
    ? t(lang, 'portal.pwd.too_weak')
    : score < 5
      ? t(lang, 'portal.pwd.medium')
      : t(lang, 'portal.pwd.good');
  return { valid, score, message };
}

async function ensureDefaultAdmin(): Promise<void> {
  const pool = await getDbPool();
  if (!pool) return;

  await pool.query(
    `INSERT INTO organization (id, org_name, display_name, status, settings, metadata)
     VALUES ($1::uuid, 'default', 'Default Organization', 'active', '{}'::jsonb, '{"source":"default_admin","auto_created":true}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_ORG_ID]
  );

  const desiredMetadata = {
    password_hash: hashPassword(ADMIN_PASSWORD),
    source: 'default_admin',
    must_change_password: true,
  };
  const userResult = await pool.query(
    `SELECT id, metadata
       FROM "user"
      WHERE org_id = $1::uuid
        AND username = $2
      LIMIT 1`,
    [DEFAULT_ORG_ID, DEFAULT_ADMIN_USERNAME]
  );
  if (userResult.rows.length === 0) {
    await pool.query(
      `INSERT INTO "user" (org_id, username, display_name, role, status, metadata)
       VALUES ($1::uuid, $2, 'Default Admin', 'admin', 'active', $3::jsonb)`,
      [DEFAULT_ORG_ID, DEFAULT_ADMIN_USERNAME, JSON.stringify(desiredMetadata)]
    );
    return;
  }
  const existingMetadata = userResult.rows[0].metadata || {};
  const source = String(existingMetadata.source || '');
  if (['default_admin', 'local_default_reset', 'migration'].includes(source)) {
    await pool.query(
      `UPDATE "user"
          SET role = 'admin',
              status = 'active',
              metadata = $2::jsonb
        WHERE id = $1`,
      [userResult.rows[0].id, JSON.stringify(desiredMetadata)]
    );
  }
}

const sessionStore = new Map<string, Session>();

const REDIS_URL = process.env.REDIS_URL || '';
let redisClient: { get(key: string): Promise<string | null>; set(key: string, value: string, mode?: string, duration?: number): Promise<string | null>; del(key: string): Promise<number> } | null = null;

interface RedisModule {
  createClient(options: { url: string }): {
    on(event: 'error', listener: (err: Error) => void): void;
    connect(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode?: string, duration?: number): Promise<string | null>;
    del(key: string): Promise<number>;
  };
}

async function initRedisSessionStore(): Promise<void> {
  if (!REDIS_URL) return;
  try {
    const redis = await import('redis') as unknown as RedisModule;
    const client = redis.createClient({ url: REDIS_URL });
    client.on('error', (err: Error) => logger.warn('redis.session.error', 'Redis session store error', { error: String(err) }));
    await client.connect();
    redisClient = client;
    logger.info('redis.session.connected', 'Redis session store connected', { url: REDIS_URL.replace(/\/\/.*@/, '//***@') });
  } catch (error) {
    logger.warn('redis.session.unavailable', 'Redis session store unavailable, falling back to memory', { error: String(error) });
    redisClient = null;
  }
}

async function getSessionFromStore(sessionId: string): Promise<Session | null> {
  if (redisClient) {
    try {
      const raw = await redisClient.get(`ah:session:${sessionId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Session;
        if (parsed.created_at + SESSION_TTL_MS > Date.now()) return parsed;
        await redisClient.del(`ah:session:${sessionId}`);
        return null;
      }
      return null;
    } catch {
      return sessionStore.get(sessionId) || null;
    }
  }
  return sessionStore.get(sessionId) || null;
}

async function setSessionToStore(sessionId: string, session: Session): Promise<void> {
  sessionStore.set(sessionId, session);
  if (redisClient) {
    try {
      await redisClient.set(`ah:session:${sessionId}`, JSON.stringify(session), 'EX', Math.floor(SESSION_TTL_MS / 1000));
    } catch { /* fallback to memory only */ }
  }
}

async function deleteSessionFromStore(sessionId: string): Promise<void> {
  sessionStore.delete(sessionId);
  if (redisClient) {
    try { await redisClient.del(`ah:session:${sessionId}`); } catch { /* ignore */ }
  }
}

let dbPool: Pool | null = null;
let dbPoolPromise: Promise<Pool | null> | null = null;

async function getDbPool(): Promise<Pool | null> {
  if (dbPool) return dbPool;
  if (dbPoolPromise) return dbPoolPromise;

  dbPoolPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return null;
    try {
      const newPool = new Pool({ connectionString: databaseUrl, max: 5 });
      const client = await newPool.connect();
      client.release();
      logger.info('db.connected', 'Database pool connected');
      dbPool = newPool;
      return dbPool;
    } catch (error) {
      logger.warn('db.connect_failed', 'Database connection failed', { error: String(error) });
      return null;
    } finally {
      dbPoolPromise = null;
    }
  })();

  return dbPoolPromise;
}

async function evictExpiredSessions(): Promise<void> {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.created_at > SESSION_TTL_MS) {
      await deleteSessionFromStore(sessionId);
    }
  }
}

const MAX_BODY_SIZE = 12 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_SIZE) {
    throw new Error('request_body_too_large');
  }
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new Error('request_body_too_large');
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'");
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  });
  res.end(body);
}

function sendFile(res: ServerResponse, filePath: string, contentType: string): void {
  try {
    const content = readFileSync(filePath);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'");
    const noCache = contentType.includes('text/html') || contentType.includes('javascript');
    const cacheControl = noCache ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': cacheControl,
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function getSessionId(req: IncomingMessage): string | null {
  const headerValue = req.headers['x-session-id'];
  return typeof headerValue === 'string' && headerValue ? headerValue : null;
}

async function validateSession(req: IncomingMessage): Promise<Session | null> {
  const sessionId = getSessionId(req);
  if (!sessionId) return null;
  const session = await getSessionFromStore(sessionId);
  if (!session) return null;
  if (Date.now() - session.created_at > SESSION_TTL_MS) {
    await deleteSessionFromStore(sessionId);
    return null;
  }
  return session;
}

async function requireSession(req: IncomingMessage, res: ServerResponse): Promise<Session | null> {
  const session = await validateSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return session;
}

async function requireAdmin(req: IncomingMessage, res: ServerResponse): Promise<Session | null> {
  const session = await requireSession(req, res);
  if (!session) return null;
  if (session.role !== 'admin') {
    sendJson(res, 403, { ok: false, error: 'forbidden', message: t(getRequestLang(req), 'portal.admin.required') });
    return null;
  }
  return session;
}

function toPortalOwnerUserId(session: Session): string {
  return toWorkflowUserId(session);
}

function toPortalFileOwnerUserId(session: Session): string {
  return toWorkflowUserId(session);
}

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_BASE_MS = 30000;
const LOGIN_LOCKOUT_MAX_MS = 900000;
const LOGIN_WINDOW_MS = 300000;

function cleanupLoginAttempts(now: number = Date.now()): void {
  for (const [key, val] of loginAttempts.entries()) {
    if (val.lockedUntil > 0 && now > val.lockedUntil + LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    } else if (val.lockedUntil === 0 && val.count < LOGIN_MAX_ATTEMPTS) {
      loginAttempts.delete(key);
    }
  }
}

function checkLoginRateLimit(identifier: string, lang: PortalLang): { blocked: boolean; retryAfterMs?: number; message?: string } {
  const now = Date.now();
  if (loginAttempts.size > 50000) cleanupLoginAttempts(now);

  const entry = loginAttempts.get(identifier);
  if (!entry) return { blocked: false };

  if (now < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      blocked: true,
      retryAfterMs: entry.lockedUntil - now,
      message: tf(lang, 'portal.login.rate_limited', { remaining: String(remaining) })
    };
  }

  return { blocked: false };
}

function recordLoginFailure(identifier: string, lang: PortalLang): { blocked: boolean; retryAfterMs?: number; message?: string } {
  const now = Date.now();
  let entry = loginAttempts.get(identifier);

  if (!entry) {
    entry = { count: 1, lockedUntil: 0 };
    loginAttempts.set(identifier, entry);
    return { blocked: false };
  }

  entry.count += 1;

  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    const lockoutMs = Math.min(
      LOGIN_LOCKOUT_BASE_MS * Math.pow(2, entry.count - LOGIN_MAX_ATTEMPTS),
      LOGIN_LOCKOUT_MAX_MS
    );
    entry.lockedUntil = now + lockoutMs;
    const seconds = Math.ceil(lockoutMs / 1000);
    return {
      blocked: true,
      retryAfterMs: lockoutMs,
      message: tf(lang, 'portal.login.rate_limited', { remaining: String(seconds) })
    };
  }

  return { blocked: false };
}

function clearLoginAttempts(identifier: string): void {
  loginAttempts.delete(identifier);
}

function maskSensitive(value: string, fieldType?: string): string {
  if (!value || value.length === 0) return '';
  if (fieldType === 'password') return '********';
  if (value.length <= 4) return '****';
  return value.slice(0, 2) + '****' + value.slice(-2);
}

function maskUrlPassword(url: string): string {
  if (!url || !url.includes('://')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function redactConfigValue(key: string, value: unknown, fieldType?: string): unknown {
  if (typeof value !== 'string' || !value) return value || '';
  const lowerKey = key.toLowerCase();
  for (const indicator of ['secret', 'key', 'token', 'password', 'aes_key']) {
    if (lowerKey.includes(indicator)) return maskSensitive(value, 'password');
  }
    if ((lowerKey.includes('_url') || lowerKey.includes('database') || lowerKey.includes('registry') || lowerKey.includes('site')) && String(value).includes('://')) {
      return maskUrlPassword(value);
    }
  if (fieldType === 'password') return maskSensitive(value, 'password');
  return value;
}

function serviceHeaders(headers?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {}),
    ...(headers || {})
  };
}

function getResourceSchedulerUrl(): string {
  const raw = (process.env.RESOURCE_SCHEDULER_URL || resourceSchedulerUrl || '').trim();
  if (!raw) return 'http://resource-scheduler:3000';
  try {
    const parsed = new URL(raw);
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return 'http://resource-scheduler:3000';
    return raw;
  } catch {
    return 'http://resource-scheduler:3000';
  }
}

function getProactiveOrchestratorUrl(): string {
  const raw = (process.env.PROACTIVE_ORCHESTRATOR_URL || proactiveOrchestratorUrl || '').trim();
  if (!raw) return 'http://proactive-orchestrator:3000';
  try {
    const parsed = new URL(raw);
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return 'http://proactive-orchestrator:3000';
    return raw;
  } catch {
    return 'http://proactive-orchestrator:3000';
  }
}

async function fetchFromService(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; data: unknown }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: serviceHeaders(options?.headers),
      body: options?.body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }
    return { status: response.status, data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 504, data: { ok: false, error: 'service_timeout' } };
    }
    logger.warn('service.fetch_failed', 'Failed to fetch from service', { url, error: String(error) });
    return { status: 502, data: { ok: false, error: 'service_unavailable' } };
  }
}

function toWorkflowUserId(session: Session): string {
  if (/^u_[a-z0-9][a-z0-9_-]{1,62}$/.test(session.user_id)) return session.user_id;
  const source = session.username || session.user_id || 'portal_user';
  const normalized = source.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56) || 'portal_user';
  return `u_${normalized}`;
}

function getWorkflowGoal(workflow: Record<string, unknown>): string {
  const plan = workflow.plan as Record<string, unknown> | undefined;
  const goal = plan?.goal as Record<string, unknown> | undefined;
  return String(goal?.user_goal || workflow.goal || workflow.id || '-');
}

function getConfigRoot(): string {
  if (process.env.AGENT_HARNESS_CONFIG_ROOT) return resolve(process.env.AGENT_HARNESS_CONFIG_ROOT);
  let current = resolve(process.cwd());
  for (;;) {
    if (existsSync(resolve(current, 'config/default.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(process.cwd());
    current = parent;
  }
}

function loadLiteLlmCatalog(): Array<Record<string, unknown>> {
  const configPath = resolve(getConfigRoot(), 'config/litellm_config.yaml');
  if (!existsSync(configPath)) return [];
  try {
    const parsed = YAML.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const modelList = Array.isArray(parsed.model_list) ? parsed.model_list as Array<Record<string, unknown>> : [];
    return modelList.map((item) => {
      const params = (item.litellm_params || {}) as Record<string, unknown>;
      const info = (item.model_info || {}) as Record<string, unknown>;
      const mode = String(info.mode || 'chat');
      return {
        id: String(info.id || item.model_name || params.model || ''),
        name: String(item.model_name || info.id || params.model || ''),
        provider_model: String(params.model || ''),
        api_base: String(params.api_base || ''),
        mode,
        context_window: Number(info.context_window || 0) || undefined,
        max_output_tokens: Number(info.max_output_tokens || 0) || undefined,
        dimensions: Number(info.dimensions || info.embedding_dimensions || 0) || undefined,
        capabilities: Array.isArray(info.capabilities) ? info.capabilities : [],
        supports_reasoning: Array.isArray(info.capabilities) && info.capabilities.includes('reasoning'),
        supports_thinking: Array.isArray(info.capabilities) && info.capabilities.includes('reasoning')
      };
    }).filter((item) => item.name);
  } catch (error) {
    logger.warn('litellm.catalog_failed', 'Failed to load LiteLLM catalog', { error: String(error) });
    return [];
  }
}

function getLiteLlmCatalogByName(): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of loadLiteLlmCatalog()) {
    const names = [item.name, item.id, item.provider_model].map((value) => String(value || '').toLowerCase()).filter(Boolean);
    for (const name of names) map.set(name, item);
  }
  return map;
}

function parseLlmModels(env: Record<string, string>): Array<Record<string, unknown>> {
  const catalog = getLiteLlmCatalogByName();
  const models = parseJsonEnv<Array<Record<string, unknown>>>(env.LLM_MODELS || process.env.LLM_MODELS, []);
  const validModels = Array.isArray(models) ? models : [];
  if (validModels.length > 0) {
    return validModels.map((model, index) => enrichLlmModel(model, index, catalog));
  }
  const litellmUrl = env.LITELLM_URL || process.env.LITELLM_URL || 'http://localhost:4000';
  const litellmKey = env.LITELLM_MASTER_KEY || process.env.LITELLM_MASTER_KEY || '';
  const defaultModel = env.LITELLM_MODEL || process.env.LITELLM_MODEL || 'minimax-m2.7';
  const fallbackStr = env.LITELLM_FALLBACK_MODELS || process.env.LITELLM_FALLBACK_MODELS || '';
  const fallbacks = fallbackStr ? fallbackStr.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
  return [defaultModel, ...fallbacks].map((name, index) => enrichLlmModel({
    id: `model-${index}`,
    name,
    url: litellmUrl,
    api_key: litellmKey,
  }, index, catalog));
}

function enrichLlmModel(model: Record<string, unknown>, index: number, catalog: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const name = String(model.name || '').trim();
  const metadata = catalog.get(name.toLowerCase()) || {};
  return {
    ...metadata,
    ...model,
    id: String(model.id || `model-${index}`),
    name,
    priority: index + 1,
    is_fallback: index > 0,
    context_window: Number(model.context_window || metadata.context_window || 0) || undefined,
    max_output_tokens: Number(model.max_output_tokens || model.max_tokens || metadata.max_output_tokens || 0) || undefined,
    max_tokens: Number(model.max_tokens || model.max_output_tokens || metadata.max_output_tokens || 0) || undefined,
    supports_thinking: Boolean(model.supports_thinking ?? model.thinking_enabled ?? metadata.supports_thinking),
    supports_reasoning: Boolean(model.supports_reasoning ?? metadata.supports_reasoning),
    thinking_enabled: Boolean(model.thinking_enabled),
    thinking_strength: String(model.thinking_strength || ''),
  };
}

function sanitizeLlmModel(model: Record<string, unknown>): Record<string, unknown> {
  return {
    ...model,
    url: maskUrlPassword(String(model.url || '')),
    api_key: String(model.api_key || '') ? '********' : ''
  };
}

function persistLlmModels(env: Record<string, string>, models: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const normalized: Array<Record<string, unknown>> = models.map((model, index) => ({
    ...model,
    priority: index + 1,
    is_fallback: index > 0
  }));
  env.LLM_MODELS = JSON.stringify(normalized);
  if (normalized.length > 0) env.LITELLM_MODEL = String(normalized[0].name || '');
  env.LITELLM_FALLBACK_MODELS = normalized.slice(1).map((m) => String(m.name || '')).filter(Boolean).join(',');
  return normalized;
}

function persistConfigEnv(env: Record<string, string>): Record<string, string> {
  const persistedEnv = exportConfigEnv(env);
  saveEnvFile(persistedEnv);
  syncRuntimeEnv(persistedEnv);
  reloadRuntimeConfig();
  return persistedEnv;
}

function getModelCatalogByKind(kind: 'chat' | 'embedding' | 'rerank'): Array<Record<string, unknown>> {
  const wantedMode = kind === 'chat' ? 'chat' : (kind === 'embedding' ? 'embeddings' : 'rerank');
  return loadLiteLlmCatalog()
    .filter((item) => String(item.mode || 'chat') === wantedMode)
    .map((item) => ({ ...item, source: 'catalog' }));
}

function normalizeCatalogMode(value: unknown): string {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'embedding') return 'embeddings';
  return mode;
}

function normalizeModelCapabilityString(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeThinkingStrength(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (['low', 'medium', 'high', 'auto', 'off'].includes(raw)) return raw;
  return '';
}

function normalizeModelRecord(model: Record<string, unknown>, fallbackId: string): Record<string, unknown> {
  const contextWindow = Number(model.context_window || model.contextWindow || 0) || undefined;
  const maxOutputTokens = Number(model.max_output_tokens || model.maxOutputTokens || model.max_tokens || 0) || undefined;
  const maxTokens = Number(model.max_tokens || model.max_output_tokens || model.maxOutputTokens || 0) || undefined;
  const thinkingEnabled = Boolean(model.thinking_enabled ?? model.supports_thinking);
  const supportsThinking = Boolean(model.supports_thinking ?? model.thinking_enabled);
  return {
    id: String(model.id || fallbackId),
    name: String(model.name || model.id || fallbackId).trim(),
    url: String(model.url || '').trim(),
    api_key: String(model.api_key || '').trim(),
    context_window: contextWindow,
    max_output_tokens: maxOutputTokens,
    max_tokens: maxTokens,
    temperature: model.temperature === '' || model.temperature === undefined || model.temperature === null ? undefined : Number(model.temperature),
    supports_thinking: supportsThinking,
    thinking_enabled: thinkingEnabled,
    thinking_strength: normalizeThinkingStrength(model.thinking_strength),
    capabilities: normalizeModelCapabilityString(model.capabilities),
    mode: String(model.mode || 'chat'),
    provider_model: String(model.provider_model || model.name || ''),
    priority: Number(model.priority || 0) || undefined,
    is_fallback: Boolean(model.is_fallback),
  };
}

function buildModelUpsertPayload(body: Record<string, unknown>, base: Record<string, string>, index: number): Record<string, unknown> {
  const name = String(body.name || '').trim();
  const providerModel = String(body.provider_model || body.model || name).trim();
  const url = String(body.url || base.LITELLM_URL || process.env.LITELLM_URL || 'http://localhost:4000').trim();
  const apiKey = String(body.api_key || base.LITELLM_MASTER_KEY || process.env.LITELLM_MASTER_KEY || '').trim();
  const temperatureRaw = body.temperature;
  const temperature = temperatureRaw === '' || temperatureRaw === undefined || temperatureRaw === null ? undefined : Number(temperatureRaw);
  return normalizeModelRecord({
    id: String(body.id || `model-${Date.now()}-${index}`),
    name,
    provider_model: providerModel,
    url,
    api_key: apiKey,
    context_window: body.context_window,
    max_output_tokens: body.max_output_tokens,
    max_tokens: body.max_tokens,
    temperature: Number.isFinite(temperature as number) ? temperature : undefined,
    supports_thinking: body.supports_thinking,
    thinking_enabled: body.thinking_enabled,
    thinking_strength: body.thinking_strength,
    capabilities: body.capabilities,
  }, `model-${index}`);
}

async function fetchProviderModelCatalog(baseUrl: string, apiKey: string): Promise<Array<Record<string, unknown>>> {
  if (!baseUrl) return [];
  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        response = await fetch(buildProviderUrl(baseUrl, '/models'), {
          headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) break;
        if (attempt === 3) return [];
      } catch {
        if (attempt === 3) return [];
      }
      await sleep(250 * (attempt + 1));
    }
    if (!response || !response.ok) return [];
    const body = await response.json() as { data?: Array<Record<string, unknown>> };
    return Array.isArray(body.data)
      ? body.data.map((item) => ({ id: String(item.id || ''), name: String(item.id || '') })).filter((item) => item.name)
      : [];
  } catch {
    return [];
  }
}

function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && /^(\*+|••••+)$/.test(value.trim());
}

function overlayProviderEnv(base: Record<string, string>, body: Record<string, unknown>): Record<string, string> {
  const env = { ...base };
  const keys = [
    'EMBEDDING_PROVIDER_URL',
    'EMBEDDING_PROVIDER_MODEL',
    'EMBEDDING_PROVIDER_API_KEY',
    'EMBEDDING_PROVIDER_DIMENSIONS',
    'EMBEDDING_PROVIDER_TIMEOUT_MS',
    'RERANK_PROVIDER_URL',
    'RERANK_PROVIDER_MODEL',
    'RERANK_PROVIDER_API_KEY',
    'RERANK_PROVIDER_TIMEOUT_MS',
    'LITELLM_URL',
    'LITELLM_MASTER_KEY'
  ];
  for (const key of keys) {
    if (body[key] !== undefined && !isMaskedSecret(body[key])) {
      env[key] = String(body[key]);
    }
  }
  return env;
}

function modelLooksLikeKind(model: Record<string, unknown>, kind: 'chat' | 'embedding' | 'rerank'): boolean {
  const mode = normalizeCatalogMode(model.mode);
  if (kind === 'rerank') {
    if (mode && mode !== 'rerank') return false;
    if (mode === 'rerank') return true;
  }
  if (kind === 'embedding') {
    if (mode && mode !== 'embeddings') return false;
    if (mode === 'embeddings') return true;
  }
  const text = [
    model.mode,
    model.name,
    model.id,
    model.provider_model,
    ...(Array.isArray(model.capabilities) ? model.capabilities : [])
  ].map((item) => String(item || '').toLowerCase()).join(' ');
  if (kind === 'chat') return !/\b(embed|embedding|rerank|ranker|reranker)\b/.test(text);
  if (kind === 'embedding') return /\b(embed|embedding|bge-m3|bce-embedding)\b/.test(text);
  return /\b(rerank|ranker|reranker)\b/.test(text);
}

function buildProviderUrl(baseUrl: string, path: string): string {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedBase.endsWith('/v1')
    ? `${normalizedBase}${normalizedPath}`
    : `${normalizedBase}/v1${normalizedPath}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProviderJson(
  baseUrl: string,
  paths: string[],
  init: RequestInit,
): Promise<{ response: Response | null; body: Record<string, unknown> }> {
  let lastResponse: Response | null = null;
  let lastBody: Record<string, unknown> = {};
  for (const path of paths) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(buildProviderUrl(baseUrl, path), init);
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        lastResponse = response;
        lastBody = body;
        if (response.ok) return { response, body };
        if ([404, 405].includes(response.status)) break;
        if (attempt === 3) return { response, body };
      } catch (error) {
        lastBody = { error: String(error) };
        if (attempt === 3) break;
      }
      await sleep(250 * (attempt + 1));
    }
  }
  return { response: lastResponse, body: lastBody };
}

async function testChatModel(model: Record<string, unknown>, env: Record<string, string>): Promise<Record<string, unknown>> {
  const baseUrl = String(model.url || env.LITELLM_URL || process.env.LITELLM_URL || 'http://localhost:4000').replace(/\/$/, '');
  const apiKey = String(model.api_key || env.LITELLM_MASTER_KEY || process.env.LITELLM_MASTER_KEY || '');
  const name = String(model.name || env.LITELLM_MODEL || process.env.LITELLM_MODEL || '');
  const started = Date.now();
  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        response = await fetch(buildProviderUrl(baseUrl, '/chat/completions'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify({
            model: name,
            messages: [{ role: 'user', content: 'Reply with ok.' }],
            max_tokens: 8,
            temperature: 0
          }),
          signal: AbortSignal.timeout(15000)
        });
        if (response.ok) break;
        if (attempt === 3) break;
      } catch {
        if (attempt === 3) throw new Error('fetch_failed');
      }
      await sleep(250 * (attempt + 1));
    }
    if (!response) throw new Error('fetch_failed');
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, status: response.status, latency_ms: latencyMs, error: text.slice(0, 300) || `http_${response.status}` };
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: true, status: response.status, latency_ms: latencyMs, model: name, response_preview: JSON.stringify(body).slice(0, 300) };
  } catch (error) {
    return { ok: false, status: 0, latency_ms: Date.now() - started, error: String(error).slice(0, 300) };
  }
}

async function testEmbeddingProvider(env: Record<string, string>): Promise<Record<string, unknown>> {
  const baseUrl = String(env.EMBEDDING_PROVIDER_URL || process.env.EMBEDDING_PROVIDER_URL || '').replace(/\/$/, '');
  if (!baseUrl) return { ok: false, error: 'missing_embedding_provider_url' };
  const started = Date.now();
  try {
    const { response, body } = await fetchProviderJson(baseUrl, ['/embeddings', '/rerank/embeddings'], {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...((env.EMBEDDING_PROVIDER_API_KEY || process.env.EMBEDDING_PROVIDER_API_KEY) ? { authorization: `Bearer ${env.EMBEDDING_PROVIDER_API_KEY || process.env.EMBEDDING_PROVIDER_API_KEY}` } : {})
      },
      body: JSON.stringify({
        model: env.EMBEDDING_PROVIDER_MODEL || process.env.EMBEDDING_PROVIDER_MODEL || undefined,
        input: 'embedding test',
        ...(Number(env.EMBEDDING_PROVIDER_DIMENSIONS || process.env.EMBEDDING_PROVIDER_DIMENSIONS || 0) > 0
          ? { dimensions: Number(env.EMBEDDING_PROVIDER_DIMENSIONS || process.env.EMBEDDING_PROVIDER_DIMENSIONS) }
          : {})
      }),
      signal: AbortSignal.timeout(Number(env.EMBEDDING_PROVIDER_TIMEOUT_MS || process.env.EMBEDDING_PROVIDER_TIMEOUT_MS || 15000))
    });
    const latencyMs = Date.now() - started;
    const typedBody = body as { data?: Array<{ embedding?: unknown[] }>; model?: string };
    const dims = Array.isArray(typedBody.data?.[0]?.embedding) ? typedBody.data[0].embedding.length : 0;
    return { ok: Boolean(response?.ok) && dims > 0, status: response?.status || 0, latency_ms: latencyMs, dimensions: dims || undefined, model: typedBody.model };
  } catch (error) {
    return { ok: false, status: 0, latency_ms: Date.now() - started, error: String(error).slice(0, 300) };
  }
}

async function testRerankProvider(env: Record<string, string>): Promise<Record<string, unknown>> {
  const baseUrl = String(env.RERANK_PROVIDER_URL || process.env.RERANK_PROVIDER_URL || '').replace(/\/$/, '');
  if (!baseUrl) return { ok: false, error: 'missing_rerank_provider_url' };
  const started = Date.now();
  try {
    const { response, body } = await fetchProviderJson(baseUrl, ['/rerank'], {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...((env.RERANK_PROVIDER_API_KEY || process.env.RERANK_PROVIDER_API_KEY) ? { authorization: `Bearer ${env.RERANK_PROVIDER_API_KEY || process.env.RERANK_PROVIDER_API_KEY}` } : {})
      },
      body: JSON.stringify({
        model: env.RERANK_PROVIDER_MODEL || process.env.RERANK_PROVIDER_MODEL || undefined,
        query: 'alpha',
        documents: ['alpha beta', 'gamma delta'],
        top_n: 2,
        return_documents: false
      }),
      signal: AbortSignal.timeout(Number(env.RERANK_PROVIDER_TIMEOUT_MS || process.env.RERANK_PROVIDER_TIMEOUT_MS || 15000))
    });
    const latencyMs = Date.now() - started;
    const typedBody = body as { results?: unknown[] };
    return { ok: Boolean(response?.ok) && Array.isArray(typedBody.results), status: response?.status || 0, latency_ms: latencyMs, result_count: Array.isArray(typedBody.results) ? typedBody.results.length : 0 };
  } catch (error) {
    return { ok: false, status: 0, latency_ms: Date.now() - started, error: String(error).slice(0, 300) };
  }
}

function normalizeWorkflowList(data: unknown, status?: string): { ok: boolean; workflows: Array<Record<string, unknown>> } {
  const body = data as { workflows?: Array<Record<string, unknown>> };
  const rawWorkflows = Array.isArray(body?.workflows) ? body.workflows : [];
  const filtered = status ? rawWorkflows.filter(w => String(w.status || '') === status) : rawWorkflows;
  return {
    ok: true,
    workflows: filtered.map(w => ({
      ...w,
      ref: w.id || w.ref,
      goal: getWorkflowGoal(w),
    })),
  };
}

function normalizeWorkflowDetail(data: unknown): { ok: boolean; workflow?: Record<string, unknown>; error?: string } {
  const body = data as { workflow?: Record<string, unknown>; error?: string };
  if (!body?.workflow) return { ok: false, error: body?.error || 'workflow_not_found' };
  const workflow = body.workflow;
  const plan = workflow.plan as Record<string, unknown> | undefined;
  const stageChain = Array.isArray(plan?.stage_chain) ? plan.stage_chain as Array<Record<string, unknown>> : [];
  const stages = Array.isArray(workflow.stages) ? workflow.stages as Array<Record<string, unknown>> : [];
  return {
    ok: true,
    workflow: {
      ...workflow,
      ref: workflow.id,
      goal: getWorkflowGoal(workflow),
      stages: stages.map((stage, index) => {
        const planned = stageChain[index] || {};
        return {
          ...stage,
          name: planned.purpose || stage.id || `Stage ${index + 1}`,
          stage_type: planned.stage_type || planned.stage_key || '-',
        };
      }),
    },
  };
}

function getQuotaScope(session: Session): string {
  return session.org_id ? `org:${session.org_id}` : `user:${toWorkflowUserId(session)}`;
}

function normalizeQuotaResponse(data: unknown): { ok: boolean; scope: string; quotas: Record<string, { limit: number; used: number }> } {
  const body = data as { quota?: Record<string, unknown>; usage?: Record<string, unknown> };
  const quota = body.quota || {};
  const usage = body.usage || {};
  const quotas: Record<string, { limit: number; used: number }> = {};
  for (const [key, defaultLimit] of Object.entries(DEFAULT_QUOTAS)) {
    const usedKey = key === 'concurrent_workflows' ? 'active_workflows' : `${key}_used`;
    quotas[key] = {
      limit: Number(quota[key] || defaultLimit),
      used: Number(usage[usedKey] || 0),
    };
  }
  return { ok: true, scope: String(quota.scope || ''), quotas };
}

function loadEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE_PATH)) return {};
  const content = readFileSync(ENV_FILE_PATH, 'utf8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\\"/g, '"').replace(/\\'/g, "'");
      env[key] = value;
    }
  }
  return env;
}

function saveEnvFile(env: Record<string, string>): void {
  const dir = dirname(ENV_FILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const jsonKeys = new Set(['LLM_MODELS']);
  const lines = Object.entries(env).map(([k, v]) => {
    const raw = jsonKeys.has(k) ? v : v;
    if (jsonKeys.has(k)) {
      return `${k}=${JSON.stringify(raw)}`;
    }
    if (raw.includes(' ') || raw.includes('"') || raw.includes("'") || raw.includes('#') || raw.includes('=') || raw.startsWith('{') || raw.startsWith('[')) {
      return `${k}=${JSON.stringify(raw)}`;
    }
    return `${k}=${raw}`;
  });
  writeFileSync(ENV_FILE_PATH, lines.join('\n') + '\n', 'utf8');
}

function syncHostEnvFile(): { synced: boolean; path?: string; error?: string } {
  const hostEnvPath = process.env.PORTAL_HOST_ENV_FILE || '/workspace/.env';
  if (!existsSync(hostEnvPath) || resolve(hostEnvPath) === resolve(ENV_FILE_PATH)) {
    return { synced: false, path: hostEnvPath };
  }
  try {
    copyFileSync(ENV_FILE_PATH, hostEnvPath);
    return { synced: true, path: hostEnvPath };
  } catch (error) {
    logger.warn('env.host_sync_failed', 'Failed to sync host env file', { hostEnvPath, error: String(error) });
    return { synced: false, path: hostEnvPath, error: 'host_env_sync_failed' };
  }
}

function parseJsonEnv<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function syncRuntimeEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

function exportConfigEnv(env: Record<string, string>): Record<string, string> {
  const exported = { ...env };
  for (const key of CONFIG_ENV_KEYS) {
    if (exported[key] === undefined && process.env[key] !== undefined) {
      exported[key] = String(process.env[key] || '');
    }
  }
  return exported;
}

function reloadRuntimeConfig(): void {
  try {
    configManager.reload();
  } catch (error) {
    logger.warn('config.reload_failed', 'Runtime config reload failed', { error: String(error) });
  }
}

function dockerComposeProjectArgs(): string[] {
  return ['compose', '--profile', 'app'];
}

function restartServiceByName(serviceName: string): { ok: boolean; message?: string; error?: string } {
  const allowed = new Set(['web-portal', 'feishu-longconn', 'fact-retrieval', 'skill-library', 'resource-scheduler', 'hermes-adapter', 'gateway-adapter']);
  if (!allowed.has(serviceName)) {
    return { ok: false, error: 'service_restart_not_allowed' };
  }
  try {
    execFileSync('docker', [...dockerComposeProjectArgs(), 'restart', serviceName], { timeout: 120000, stdio: 'pipe' });
    return { ok: true, message: 'restarted' };
  } catch (error) {
    logger.error('service.restart_failed', 'Service restart failed', { service: serviceName, error: String(error) });
    return { ok: false, error: 'restart_failed' };
  }
}

function getRestartTargetsForConfigKeys(keys: string[]): string[] {
  const services = new Set<string>();
  for (const key of keys) {
    if (key.startsWith('FEISHU_')) {
      services.add('gateway-adapter');
      services.add('feishu-longconn');
    } else if (key.startsWith('WECOM_')) {
      services.add('gateway-adapter');
    } else if (key.startsWith('EMBEDDING_') || key.startsWith('RERANK_')) {
      services.add('fact-retrieval');
    } else if (key.startsWith('LITELLM_')) {
      services.add('gateway-adapter');
    }
  }
  return Array.from(services);
}

async function parseKnowledgeFileContent(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (['txt', 'md', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'py', 'java', 'go', 'rs', 'sql', 'sh', 'log', 'conf', 'ini', 'env'].includes(ext)) {
    return buffer.toString('utf8');
  }
  if (['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'odt', 'odp', 'ods', 'rtf'].includes(ext) || mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('sheet') || mimeType.includes('presentation')) {
    try {
      const officeParser = await import('officeparser');
      const parseFn = (officeParser as Record<string, unknown>).parseOffice || (officeParser as Record<string, { parseOffice?: unknown }>).default?.parseOffice || (officeParser as Record<string, unknown>).default;
      if (typeof parseFn === 'function') {
        const result = await (parseFn as (buf: Buffer) => Promise<unknown>)(buffer);
        if (typeof result === 'string' && result.trim()) return result;
        if (result && typeof result === 'object') {
          const objectResult = result as Record<string, unknown>;
          const parts: string[] = [];
          const extractText = (node: Record<string, unknown>): void => {
            if (typeof node.text === 'string' && node.text.trim()) parts.push(node.text.trim());
            if (typeof node.value === 'string' && node.value.trim()) parts.push(node.value.trim());
            const kids = (node.children || node.content || node.items || []) as Array<Record<string, unknown>>;
            for (const child of kids) extractText(child);
          };
          const roots = (objectResult.children || objectResult.slides || objectResult.sheets || []) as Array<Record<string, unknown>>;
          for (const root of roots) extractText(root);
          if (parts.length > 0) return parts.join('\n');
        }
      }
    } catch (error) {
      logger.warn('knowledge.file.office_parse_failed', 'Office parser failed, falling back', { file_name: fileName, error: String(error) });
    }
    if (ext === 'pdf') {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        const doc = await (pdfjsLib as { getDocument: (src: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage(page: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }> }> } }).getDocument({ data: new Uint8Array(buffer) }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i += 1) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map((item) => item.str || '').join(' '));
        }
        return pages.join('\n');
      } catch (error) {
        logger.warn('knowledge.file.pdf_parse_failed', 'PDF parse failed', { file_name: fileName, error: String(error) });
      }
    }
    if (ext === 'docx') {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        if (result.value.trim()) return result.value;
      } catch (error) {
        logger.warn('knowledge.file.docx_parse_failed', 'DOCX parse failed', { file_name: fileName, error: String(error) });
      }
    }
  }
  return buffer.toString('utf8').replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
}

function normalizeKnowledgeSourceType(sourceType: string): string {
  const normalized = sourceType.trim().toLowerCase();
  if (!normalized) return 'manual';
  if (['manual', 'upload', 'workflow', 'channel', 'external'].includes(normalized)) return normalized;
  if (['document', 'file', 'attachment'].includes(normalized)) return 'upload';
  if (['conversation', 'chat', 'message'].includes(normalized)) return 'channel';
  if (['template', 'guide', 'reference', 'url', 'web'].includes(normalized)) return 'external';
  return 'manual';
}

function normalizeClawHubSlug(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  let slug = '';
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').map(part => part.trim()).filter(Boolean);
    slug = parts[parts.length - 1] || '';
  } catch {
    slug = raw.split('/').map(part => part.trim()).filter(Boolean).pop() || raw;
  }
  slug = slug.replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug) || slug.includes('..')) return '';
  return slug;
}

function parseVersionParts(version: string): number[] {
  return version.split(/[^\d]+/).filter(Boolean).map(part => Number(part)).filter(num => Number.isFinite(num));
}

function compareVersions(a: string, b: string): number {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i += 1) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return a.localeCompare(b);
}

function summarizeClawHubChangelog(changelog: string, currentVersion: string, latestVersion: string): string {
  const text = changelog.trim();
  if (!text) return currentVersion === latestVersion ? '当前版本已是最新。' : '发现新版本，但上游未提供明确变更说明，请在升级前查看详情。';
  const lower = text.toLowerCase();
  if (lower.includes('no feature') || lower.includes('no functional') || lower.includes('no changes to code') || lower.includes('only metadata')) {
    return '主要是文档或版本元数据同步，未声明功能或安全逻辑变化。';
  }
  if (text.includes('竞品') || lower.includes('competitor')) return '新增或调整竞品情报、采购记录和客户调研路由能力。';
  if (text.includes('SOUL') || lower.includes('removed all') || lower.includes('security') || lower.includes('dangerous')) {
    return '包含安全清理或高风险内容移除，建议优先查看并升级。';
  }
  if (text.includes('visit') || text.includes('拜访')) return '增强拜访复盘、销售流程评估或行动建议相关能力。';
  return text.split(/\r?\n/).map(line => line.replace(/^[-*\s]+/, '').trim()).filter(Boolean).slice(0, 2).join('；').slice(0, 240);
}

function buildClawHubEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const token = env.CLAWHUB_ADMIN_TOKEN || process.env.CLAWHUB_ADMIN_TOKEN || '';
  const site = env.CLAWHUB_SITE || process.env.CLAWHUB_SITE || 'https://clawhub.ai';
  const registry = env.CLAWHUB_REGISTRY || process.env.CLAWHUB_REGISTRY || '';
  return {
    ...process.env,
    ...(token ? { CLAWHUB_TOKEN: token, CLAWHUB_ADMIN_TOKEN: token, CLAWDHUB_TOKEN: token } : {}),
    ...(site ? { CLAWHUB_SITE: site } : {}),
    ...(registry ? { CLAWHUB_REGISTRY: registry } : {})
  };
}

function getClawHubApiBase(env: Record<string, string>): string {
  return (env.CLAWHUB_REGISTRY || process.env.CLAWHUB_REGISTRY || env.CLAWHUB_SITE || process.env.CLAWHUB_SITE || 'https://clawhub.ai').replace(/\/+$/, '');
}

function getClawHubToken(env: Record<string, string>): string {
  return env.CLAWHUB_ADMIN_TOKEN || process.env.CLAWHUB_ADMIN_TOKEN || process.env.CLAWHUB_TOKEN || process.env.CLAWDHUB_TOKEN || '';
}

function getClawHubOptionValue(options: string[], key: string, fallback: string): string {
  const index = options.indexOf(key);
  if (index >= 0 && options[index + 1]) return options[index + 1];
  return fallback;
}

async function fetchClawHubJson(apiBase: string, path: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'agent-harness-web-portal',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`clawhub_http_${response.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

function buildCachedClawHubInspect(slug: string, options: string[], detail: string): { ok: boolean; data?: Record<string, unknown>; text?: string; error?: string } | null {
  const cached = CURATED_CLAWHUB_SKILLS.find((skill) => normalizeClawHubSlug(skill.source) === slug || skill.name === slug);
  if (!cached) return null;
  const definition = cached.definition || {};
  const maintenance = (definition.maintenance || {}) as Record<string, unknown>;
  const latestVersion = String(maintenance.latest_checked_version || '');
  if (!latestVersion) return null;
  const latestChangelog = String(maintenance.latest_changelog || '');
  const owner = String(cached.source).split('/').filter(Boolean).slice(-2, -1)[0] || 'skills';
  const baseData: Record<string, unknown> = {
    skill: {
      slug,
      displayName: cached.name,
      summary: cached.description,
      tags: { latest: latestVersion },
      stats: {
        comments: 0,
        downloads: cached.installCount,
        installsAllTime: cached.installCount,
        installsCurrent: cached.installCount,
        stars: Math.round(cached.rating),
        versions: 1
      },
      createdAt: null,
      updatedAt: null
    },
    latestVersion: {
      version: latestVersion,
      createdAt: null,
      changelog: latestChangelog,
      license: 'MIT-0'
    },
    owner: { handle: owner, displayName: owner, image: null },
    moderation: {
      isSuspicious: false,
      isMalwareBlocked: false,
      verdict: 'clean',
      reasonCodes: [],
      updatedAt: null,
      engineVersion: null,
      summary: 'Using curated built-in metadata because live ClawHub inspection is unavailable.'
    },
    version: null,
    versions: null,
    file: null,
    offline_cache: true,
    offline_detail: detail
  };
  if (options.includes('--versions')) {
    baseData.versions = [{ version: latestVersion, createdAt: null, changelog: latestChangelog, changelogSource: 'cache' }];
  }
  if (options.includes('--files')) {
    baseData.version = {
      version: latestVersion,
      createdAt: null,
      changelog: latestChangelog,
      changelogSource: 'cache',
      license: 'MIT-0',
      files: []
    };
  }
  return { ok: true, data: baseData, text: detail };
}

async function runClawHubInspectHttp(slug: string, options: string[], cliError: string): Promise<{ ok: boolean; data?: Record<string, unknown>; text?: string; error?: string }> {
  const env = loadEnvFile();
  const apiBase = getClawHubApiBase(env);
  const token = getClawHubToken(env);
  try {
    const detail = await fetchClawHubJson(apiBase, `/api/v1/skills/${encodeURIComponent(slug)}`, token);
    const result: Record<string, unknown> = {
      skill: detail.skill || null,
      latestVersion: detail.latestVersion || null,
      owner: detail.owner || null,
      moderation: detail.moderation || null,
      version: null,
      versions: null,
      file: null
    };
    if (options.includes('--versions')) {
      const limit = encodeURIComponent(getClawHubOptionValue(options, '--limit', '25'));
      const versions = await fetchClawHubJson(apiBase, `/api/v1/skills/${encodeURIComponent(slug)}/versions?limit=${limit}`, token);
      result.versions = Array.isArray(versions.items) ? versions.items : [];
    }
    if (options.includes('--files')) {
      const latestVersion = String(((detail.latestVersion || {}) as Record<string, unknown>).version || ((detail.skill as Record<string, unknown> | undefined)?.tags as Record<string, unknown> | undefined)?.latest || '');
      if (latestVersion) {
        const versionDetail = await fetchClawHubJson(apiBase, `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(latestVersion)}`, token);
        result.version = versionDetail.version || null;
      }
    }
    return { ok: true, data: result, text: cliError ? `cli_fallback: ${cliError}` : 'http' };
  } catch (error) {
    const detail = `${cliError ? `${cliError}; ` : ''}${String(error)}`.slice(0, 800);
    const cached = buildCachedClawHubInspect(slug, options, detail);
    if (cached) return cached;
    return { ok: false, error: 'clawhub_inspect_failed', text: detail };
  }
}

async function runClawHubInspect(slugOrUrl: string, options: string[] = []): Promise<{ ok: boolean; data?: Record<string, unknown>; text?: string; error?: string }> {
  const slug = normalizeClawHubSlug(slugOrUrl);
  if (!slug) return { ok: false, error: 'missing_clawhub_slug' };
  const env = loadEnvFile();
  try {
    const output = execFileSync('clawhub', ['inspect', slug, '--json', ...options], {
      timeout: 90000,
      encoding: 'utf8',
      env: buildClawHubEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const jsonStart = output.indexOf('{');
    const jsonEnd = output.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd >= jsonStart) {
      return { ok: true, data: JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>, text: output };
    }
    return { ok: false, error: 'invalid_clawhub_json', text: output.slice(0, 500) };
  } catch (error) {
    return runClawHubInspectHttp(slug, options, String(error).slice(0, 800));
  }
}

function normalizeClawHubInspect(data: Record<string, unknown>, slugFallback: string): Record<string, unknown> {
  const skill = (data.skill || {}) as Record<string, unknown>;
  const latest = ((data.latestVersion || data.version || {}) as Record<string, unknown>);
  const moderation = (data.moderation || {}) as Record<string, unknown>;
  const owner = (data.owner || {}) as Record<string, unknown>;
  const stats = (skill.stats || {}) as Record<string, unknown>;
  const slug = String(skill.slug || slugFallback);
  const latestVersion = String(latest.version || (skill.tags as Record<string, unknown> | undefined)?.latest || '');
  const changelog = String(latest.changelog || '');
  return {
    slug,
    display_name: String(skill.displayName || slug),
    summary: String(skill.summary || ''),
    owner: String(owner.handle || ''),
    latest_version: latestVersion,
    latest_changelog: changelog,
    changelog_summary: summarizeClawHubChangelog(changelog, '', latestVersion),
    license: String(latest.license || ''),
    updated_at: skill.updatedAt || latest.createdAt || null,
    downloads: Number(stats.downloads || 0),
    stars: Number(stats.stars || 0),
    versions: Number(stats.versions || 0),
    moderation: {
      verdict: String(moderation.verdict || ''),
      summary: String(moderation.summary || ''),
      is_suspicious: Boolean(moderation.isSuspicious),
      is_malware_blocked: Boolean(moderation.isMalwareBlocked)
    },
    source_uri: `https://clawhub.ai/${owner.handle || 'skills'}/${slug}`
  };
}

function extractInstalledClawHubInfo(skill: Record<string, unknown>): { slug: string; sourceUri: string; currentVersion: string } {
  const metadata = (skill.metadata || {}) as Record<string, unknown>;
  const definition = (skill.definition_json || {}) as Record<string, unknown>;
  const maintenance = (definition.maintenance || {}) as Record<string, unknown>;
  const sourceUri = String(metadata.source || metadata.source_uri || metadata.clawhub_url || '');
  const slug = String(metadata.clawhub_slug || definition.clawhub_slug || normalizeClawHubSlug(sourceUri));
  const currentVersion = String(metadata.clawhub_version || maintenance.latest_checked_version || '');
  return { slug, sourceUri, currentVersion };
}

function inferClawHubSkillType(meta: Record<string, unknown>, fallback = 'workflow'): string {
  const text = `${meta.slug || ''} ${meta.summary || ''}`.toLowerCase();
  if (text.includes('research') || text.includes('search') || text.includes('调研') || text.includes('竞品')) return 'search';
  if (text.includes('document') || text.includes('word') || text.includes('ppt') || text.includes('报告')) return 'document';
  if (text.includes('security') || text.includes('vet')) return 'security';
  if (text.includes('weather')) return 'utility';
  return fallback;
}

function buildSkillDefinitionFromClawHub(meta: Record<string, unknown>, fileList: Array<Record<string, unknown>> = []): Record<string, unknown> {
  const moderation = (meta.moderation || {}) as Record<string, unknown>;
  return {
    source_type: 'clawhub',
    clawhub_slug: meta.slug,
    entrypoint: 'SKILL.md',
    capabilities: [],
    files: fileList.map(file => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      content_type: file.contentType
    })),
    risk_profile: {
      api_key_required: false,
      external_network: false,
      overlaps_memory: false
    },
    maintenance: {
      latest_checked_version: meta.latest_version,
      latest_changelog: meta.latest_changelog,
      changelog_summary: meta.changelog_summary,
      moderation
    }
  };
}

async function createSkillFromClawHub(session: Session, slugOrUrl: string, scopeType = 'private'): Promise<{ status: number; body: Record<string, unknown> }> {
  const slug = normalizeClawHubSlug(slugOrUrl);
  if (!slug) return { status: 400, body: { ok: false, error: 'invalid_clawhub_slug' } };
  const inspected = await runClawHubInspect(slugOrUrl, ['--files']);
  if (!inspected.ok || !inspected.data) return { status: 502, body: { ok: false, error: inspected.error || 'clawhub_unavailable', detail: inspected.text } };
  const meta = normalizeClawHubInspect(inspected.data, slug);
  const version = (inspected.data.version || {}) as Record<string, unknown>;
  const files = Array.isArray(version.files) ? version.files as Array<Record<string, unknown>> : [];
  const definition = buildSkillDefinitionFromClawHub(meta, files);
  const risk = ((meta.moderation as Record<string, unknown>).is_suspicious || (meta.moderation as Record<string, unknown>).is_malware_blocked) ? 'high' : 'medium';
      const body = {
    owner_user_id: session.user_id,
    org_id: session.org_id || undefined,
    scope_type: scopeType,
    skill_name: String(meta.slug || slug),
    description: String(meta.summary || meta.display_name || slug),
    skill_type: inferClawHubSkillType(meta),
    definition_json: definition,
    metadata: {
      source: meta.source_uri,
      installed_from: 'clawhub.ai',
      clawhub_slug: meta.slug,
      clawhub_owner: meta.owner,
      clawhub_version: meta.latest_version,
      clawhub_updated_at: meta.updated_at,
      risk,
      rating: Number(meta.stars || 0),
      downloads: Number(meta.downloads || 0),
      admin_managed: true
    },
    source_uri: meta.source_uri
  };
  const r = await fetchFromService(skillLibraryUrl + '/internal/skills/create', { method: 'POST', body: JSON.stringify(body) });
  if (r.status >= 200 && r.status < 300 && (r.data as Record<string, unknown>)?.skill) {
    const created = ((r.data as Record<string, unknown>).skill || {}) as Record<string, unknown>;
    const pool = await getDbPool();
    if (pool && created.id) {
      const mergedMeta = { ...body.metadata, created_from_clawhub_at: new Date().toISOString() };
      await pool.query(`UPDATE skill SET metadata = $2::jsonb, updated_at = now() WHERE id = $1`, [String(created.id), JSON.stringify(mergedMeta)]).catch(() => undefined);
    }
  }
  return { status: r.status, body: (r.data || {}) as Record<string, unknown> };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';
  const requestLang = getRequestLang(req);

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3003', 'http://127.0.0.1:3003'];
  const origin = req.headers.origin || '';

  if (allowedOrigins.includes('*') && process.env.NODE_ENV === 'production') {
    logger.error('cors.invalid', 'CORS_ORIGINS wildcard (*) is not allowed in production with credentials');
    sendJson(res, 500, { ok: false, error: 'configuration_error' });
    return Promise.resolve();
  }

  const isAllowedOrigin = allowedOrigins.includes('*') || allowedOrigins.includes(origin) || allowedOrigins.some(a => a.endsWith('*') && origin.startsWith(a.slice(0, -1)));
  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigins[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id, Accept-Language');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    if (pathname === '/favicon.ico') {
      res.writeHead(204, { 'content-type': 'image/x-icon' });
      res.end();
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      sendFile(res, join(STATIC_DIR, 'index.html'), 'text/html; charset=utf-8');
      return;
    }

    if (pathname === '/localization.js') {
      sendFile(res, join(STATIC_DIR, 'localization.js'), 'application/javascript; charset=utf-8');
      return;
    }

    if (pathname === '/app.js') {
      sendFile(res, join(STATIC_DIR, 'app.js'), 'application/javascript; charset=utf-8');
      return;
    }

    if (pathname === '/health' || pathname === '/health/live') {
      sendJson(res, 200, { ok: true, status: 'alive', timestamp: new Date().toISOString() });
      return;
    }

    if (pathname === '/health/ready') {
      const db = await getDbPool();
      sendJson(res, db ? 200 : 503, { ok: !!db, status: db ? 'ready' : 'degraded', timestamp: new Date().toISOString() });
      return;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const rateLimitKey = `login:${clientIp}`;
      const rateCheck = checkLoginRateLimit(rateLimitKey, requestLang);
      if (rateCheck.blocked) {
        sendJson(res, 429, { ok: false, error: 'rate_limited', message: rateCheck.message, retry_after_ms: rateCheck.retryAfterMs });
        return;
      }

      const body = await readJson(req);
      const rawUsername = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!rawUsername || !password) {
        sendJson(res, 400, { ok: false, error: 'missing_credentials', message: t(requestLang, 'portal.login.empty_credentials') });
        return;
      }
      let dbPasswordVerified = false;
      try {
        const pool = await getDbPool();
        if (pool) {
          const userResult = await pool.query(
            `SELECT id, username, role, org_id, metadata
             FROM "user"
             WHERE username = $1
             ORDER BY (org_id = $2::uuid) DESC, created_at ASC
             LIMIT 1`,
            [rawUsername, DEFAULT_ORG_ID]
          );
          if (userResult.rows.length > 0) {
            const metadata = userResult.rows[0].metadata || {};
            const storedHash = metadata.password_hash || '';
            if (storedHash) {
              const verified = verifyPassword(password, storedHash);
              if (verified.valid) {
                dbPasswordVerified = true;
                if (verified.needsMigration && verified.newHash) {
                  try {
                    await pool.query(
                      `UPDATE "user" SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{password_hash}', $2::jsonb) WHERE id = $1`,
                      [userResult.rows[0].id, JSON.stringify(verified.newHash)]
                    );
                  } catch { /* migration failure is non-fatal */ }
                }
              }
            }
          }
        }
      } catch { /* ignore */ }
      if (!dbPasswordVerified) {
        const failResult = recordLoginFailure(rateLimitKey, requestLang);
        if (failResult.blocked) {
          sendJson(res, 429, { ok: false, error: 'rate_limited', message: failResult.message, retry_after_ms: failResult.retryAfterMs });
        } else {
          sendJson(res, 401, { ok: false, error: 'invalid_credentials', message: t(requestLang, 'portal.login.wrong_credentials') });
        }
        return;
      }
      clearLoginAttempts(rateLimitKey);
      await evictExpiredSessions();
      if (sessionStore.size >= MAX_SESSIONS) {
        sendJson(res, 429, { ok: false, error: 'too_many_sessions', message: t(requestLang, 'portal.login.max_sessions') });
        return;
      }
      const sessionId = randomUUID();
      let userId = rawUsername;
      let role: SessionRole = 'user';
      let orgId: string | null = null;
      let defaultPasswordActive = false;
      try {
        const pool = await getDbPool();
        if (pool) {
          const userResult = await pool.query(
            `SELECT id, role, org_id, metadata
             FROM "user"
             WHERE username = $1
             ORDER BY (org_id = $2::uuid) DESC, created_at ASC
             LIMIT 1`,
            [rawUsername, DEFAULT_ORG_ID]
          );
          if (userResult.rows.length > 0) {
            userId = String(userResult.rows[0].id);
            role = userResult.rows[0].role === 'admin' ? 'admin' : 'user';
            orgId = userResult.rows[0].org_id || null;
            const metadata = userResult.rows[0].metadata || {};
            defaultPasswordActive = metadata.must_change_password === true;
          }
        }
      } catch { /* ignore */ }
      await setSessionToStore(sessionId, {
        user_id: userId,
        username: rawUsername,
        role,
        org_id: orgId,
        created_at: Date.now(),
        context_workflows: {},
      });
      const mustChangePassword = defaultPasswordActive || password === DEFAULT_ADMIN_PASSWORD || password === 'admin123' || password === rawUsername;
      await auditWriter.write({ action: 'user.login', user_id: userId, resource_type: 'session', resource_ref: sessionId, resource_scope: 'system', result: 'success', detail_json: { username: rawUsername } });
      sendJson(res, 200, { ok: true, session_id: sessionId, role, org_id: orgId, must_change_password: mustChangePassword, username: rawUsername });
      return;
    }

    if (pathname === '/api/auth/change-password' && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const oldPassword = String(body.old_password || '');
      const newPassword = String(body.new_password || '');
      if (!oldPassword || !newPassword) {
        sendJson(res, 400, { ok: false, error: 'missing_fields', message: t(requestLang, 'portal.pwd.empty_fields') });
        return;
      }
      const strength = validatePasswordStrength(newPassword, requestLang);
      if (!strength.valid) {
        sendJson(res, 400, { ok: false, error: 'weak_password', message: strength.message, score: strength.score });
        return;
      }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const userResult = await pool.query(
          `SELECT id, metadata FROM "user" WHERE id = $1 LIMIT 1`,
          [session.user_id]
        );
        if (userResult.rows.length === 0) {
          sendJson(res, 404, { ok: false, error: 'user_not_found' });
          return;
        }
        const metadata = userResult.rows[0].metadata || {};
        const storedHash = metadata.password_hash || '';
        const defaultAdminOldPassword =
          session.username === DEFAULT_ADMIN_USERNAME &&
          metadata.must_change_password === true &&
          oldPassword === ADMIN_PASSWORD;
        if (!verifyPassword(oldPassword, storedHash).valid && !defaultAdminOldPassword) {
          sendJson(res, 401, { ok: false, error: 'invalid_old_password', message: t(requestLang, 'portal.pwd.wrong_old') });
          return;
        }
        const newHash = hashPassword(newPassword);
        await pool.query(
          `UPDATE "user"
           SET metadata = jsonb_set(
             jsonb_set(COALESCE(metadata, '{}'::jsonb) - 'must_change_password', '{source}', '"user_changed"'::jsonb),
             '{password_hash}',
             $2::jsonb
           )
           WHERE id = $1`,
          [session.user_id, JSON.stringify(newHash)]
        );
        await auditWriter.write({ action: 'user.change_password', user_id: session.user_id, resource_type: 'user', resource_ref: session.user_id, resource_scope: 'system', result: 'success', detail_json: {} });
        sendJson(res, 200, { ok: true, message: t(requestLang, 'portal.pwd.changed') });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const sessionId = getSessionId(req);
      if (sessionId) {
        await deleteSessionFromStore(sessionId);
      }
      sendJson(res, 200, { ok: true, message: t(requestLang, 'portal.logout.success') });
      return;
    }

    if (pathname === '/api/auth/session' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      sendJson(res, 200, { ok: true, session: { user_id: session.user_id, username: session.username, role: session.role, org_id: session.org_id } });
      return;
    }

    if (pathname === '/api/setup/status' && method === 'GET') {
      const steps = [
        { key: 'database', label: t(requestLang, 'portal.setup.step.database'), done: false },
        { key: 'organization', label: t(requestLang, 'portal.setup.step.organization'), done: false },
        { key: 'admin', label: t(requestLang, 'portal.setup.step.admin'), done: false },
        { key: 'channel', label: t(requestLang, 'portal.setup.step.channel'), done: false },
        { key: 'llm', label: t(requestLang, 'portal.setup.step.llm'), done: false },
        { key: 'embedding', label: t(requestLang, 'portal.setup.step.embedding'), done: false },
      ];
      const pool = await getDbPool();
      if (pool) {
        steps[0].done = true;
        try {
          const orgResult = await pool.query(`SELECT COUNT(*) as cnt FROM organization WHERE status = 'active'`);
          if (Number(orgResult.rows[0]?.cnt) > 0) steps[1].done = true;
          const adminResult = await pool.query(`SELECT COUNT(*) as cnt FROM "user" WHERE role = 'admin' AND status = 'active'`);
          if (Number(adminResult.rows[0]?.cnt) > 0) steps[2].done = true;
        } catch { /* ignore */ }
      }
      const env = loadEnvFile();
      const mergedEnv = { ...env };
      for (const key of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'WECOM_CORP_ID', 'LITELLM_URL', 'LITELLM_MASTER_KEY', 'EMBEDDING_MODE', 'EMBEDDING_PROVIDER_URL']) {
        if (!mergedEnv[key] && process.env[key]) mergedEnv[key] = process.env[key];
      }
      if (mergedEnv.FEISHU_APP_ID || mergedEnv.WECOM_CORP_ID) steps[3].done = true;
      if (mergedEnv.LITELLM_URL || mergedEnv.LITELLM_MASTER_KEY) steps[4].done = true;
      if (mergedEnv.EMBEDDING_MODE === 'provider' && mergedEnv.EMBEDDING_PROVIDER_URL) steps[5].done = true;
      if (mergedEnv.EMBEDDING_MODE === 'deterministic' || !mergedEnv.EMBEDDING_MODE) steps[5].done = true;
      const initialized = steps.every(s => s.done);
      sendJson(res, 200, { ok: true, initialized, steps });
      return;
    }

    if (pathname === '/api/setup/initialize' && method === 'POST') {
      const forwarded = (req.headers['x-forwarded-for'] as string) || '';
      const clientIp = (forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || '';
      const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
      const body = await readJson(req);
      if (!LOCAL_IPS.has(clientIp)) {
        if (!SETUP_TOKEN || body.setup_token !== SETUP_TOKEN) {
          sendJson(res, 403, { ok: false, error: 'forbidden', message: t(requestLang, 'portal.setup.local_only') });
          return;
        }
      }
      const step = String(body.step || '');
      const pool = await getDbPool();
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'db_unavailable', message: t(requestLang, 'portal.setup.db_unavailable') });
        return;
      }
      const setupCheck = await pool.query(`SELECT COUNT(*) as cnt FROM organization WHERE status = 'active'`);
      if (Number(setupCheck.rows[0]?.cnt) > 0) {
        const adminCheck = await pool.query(`SELECT COUNT(*) as cnt FROM "user" WHERE role = 'admin' AND status = 'active'`);
        if (Number(adminCheck.rows[0]?.cnt) > 0) {
          sendJson(res, 403, { ok: false, error: 'already_initialized', message: t(requestLang, 'portal.setup.already_initialized') });
          return;
        }
      }
      if (step === 'organization') {
        const orgName = String(body.org_name || 'default').trim();
        const displayName = String(body.display_name || orgName).trim();
        await pool.query(
          `INSERT INTO organization (org_name, display_name, status, settings, metadata)
           VALUES ($1, $2, 'active', '{}'::jsonb, '{"source":"setup_wizard"}'::jsonb)
           ON CONFLICT DO NOTHING`,
          [orgName, displayName]
        );
      } else if (step === 'admin') {
        const username = String(body.username || 'admin').trim();
        const password = String(body.password || '').trim();
        if (!password) {
          sendJson(res, 400, { ok: false, error: 'missing_password', message: t(requestLang, 'portal.setup.admin_pass_required') });
          return;
        }
        const passwordHash = hashPassword(password);
        await pool.query(
          `INSERT INTO "user" (username, role, status, metadata)
           VALUES ($1, 'admin', 'active', $2::jsonb)
           ON CONFLICT (username) DO UPDATE SET metadata = $2::jsonb`,
          [username, JSON.stringify({ password_hash: passwordHash, source: 'setup_wizard' })]
        );
      } else if (step === 'channel') {
        const env = loadEnvFile();
        if (body.feishu_app_id) env.FEISHU_APP_ID = String(body.feishu_app_id);
        if (body.feishu_app_secret) env.FEISHU_APP_SECRET = String(body.feishu_app_secret);
        persistConfigEnv(env);
      } else if (step === 'llm') {
        const env = loadEnvFile();
        if (body.litellm_url) env.LITELLM_URL = String(body.litellm_url);
        if (body.litellm_model) env.LITELLM_MODEL = String(body.litellm_model);
        persistConfigEnv(env);
      } else if (step === 'embedding') {
        const env = loadEnvFile();
        if (body.embedding_mode) env.EMBEDDING_MODE = String(body.embedding_mode);
        if (body.embedding_provider_url) env.EMBEDDING_PROVIDER_URL = String(body.embedding_provider_url);
        persistConfigEnv(env);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/system/overview' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const services: Array<{ name: string; status: string; latency_ms: number }> = [];
      const checkService = async (name: string, url: string) => {
        const start = Date.now();
        try {
          const r = await fetchFromService(url + '/health/live');
          services.push({ name, status: r.status === 200 ? 'healthy' : 'unhealthy', latency_ms: Date.now() - start });
        } catch {
          services.push({ name, status: 'unreachable', latency_ms: Date.now() - start });
        }
      };
      await Promise.allSettled([
        checkService('gateway-adapter', gatewayUrl),
        checkService('workflow-service', workflowUrl),
        checkService('executor-gateway', executorUrl),
        checkService('fact-retrieval', factRetrievalUrl),
        checkService('skill-library', skillLibraryUrl),
        checkService('resource-scheduler', resourceSchedulerUrl),
        checkService('mobile-app', mobileAppUrl),
      ]);
      const summary: Record<string, number> = { services_total: services.length, services_healthy: services.filter(s => s.status === 'healthy').length };
      try {
        const pool = await getDbPool();
        if (pool) {
          const wfResult = await pool.query(`SELECT COUNT(*) as cnt FROM workflow_instance WHERE status IN ('running', 'planned')`);
          summary.active_workflows = Number(wfResult.rows[0]?.cnt || 0);
          const userResult = await pool.query(`SELECT COUNT(*) as cnt FROM "user" WHERE status = 'active'`);
          summary.active_users = Number(userResult.rows[0]?.cnt || 0);
          const orgResult = await pool.query(`SELECT COUNT(*) as cnt FROM organization WHERE status = 'active'`);
          summary.active_orgs = Number(orgResult.rows[0]?.cnt || 0);
        }
      } catch { /* ignore */ }
      sendJson(res, 200, { ok: true, overview: { summary, services } });
      return;
    }

    if (pathname === '/api/workflows' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const status = url.searchParams.get('status') || '';
      const params = new URLSearchParams({ limit: '100' });
      if (session.role === 'admin') {
        params.set('acting_role', 'admin');
        if (session.org_id) params.set('org_id', session.org_id);
        else params.set('owner_user_id', toWorkflowUserId(session));
      } else {
        params.set('owner_user_id', toWorkflowUserId(session));
      }
      const targetUrl = `${workflowUrl}/internal/workflows?${params.toString()}`;
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.status >= 200 && r.status < 300 ? normalizeWorkflowList(r.data, status || undefined) : r.data);
      return;
    }

    if (pathname.startsWith('/api/workflows/') && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const ref = pathname.slice('/api/workflows/'.length);
      const params = new URLSearchParams();
      if (session.role === 'admin') params.set('acting_role', 'admin');
      else params.set('owner_user_id', toWorkflowUserId(session));
      if (session.org_id) params.set('org_id', session.org_id);
      const r = await fetchFromService(`${workflowUrl}/internal/workflows/${encodeURIComponent(ref)}?${params.toString()}`);
      sendJson(res, r.status, r.status >= 200 && r.status < 300 ? normalizeWorkflowDetail(r.data) : r.data);
      return;
    }

    if (pathname === '/api/workflows/create-from-markdown' && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const ownerUserId = toWorkflowUserId(session);
      const planBody = {
        user_id: ownerUserId,
        user_role: session.role,
        user_goal: String(body.goal || body.user_goal || ''),
        task_type_hint: body.task_type || body.task_type_hint,
        risk_level: body.risk_level || 'medium',
        org_id: session.org_id || undefined,
        source: 'web_portal',
        policy_snapshot_hash: `sha256:portal_${createHash('sha256').update(`${session.user_id}:${session.org_id || ''}`).digest('hex')}`,
      };
      const plan = await fetchFromService(`${workflowUrl}/internal/workflows/plan`, { method: 'POST', body: JSON.stringify(planBody) });
      if (plan.status < 200 || plan.status >= 300) {
        sendJson(res, plan.status, plan.data);
        return;
      }
      const planData = plan.data as { workflow_instance_ref?: string };
      const workflowRef = planData.workflow_instance_ref || '';
      if (!workflowRef) {
        sendJson(res, 502, { ok: false, error: 'workflow_plan_missing_ref' });
        return;
      }
      const dispatch = await fetchFromService(`${workflowUrl}/internal/workflows/${encodeURIComponent(workflowRef)}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ user_role: session.role, executor_kind: body.target_executor || 'generic-executor' }),
      });
      sendJson(res, dispatch.status, {
        ok: dispatch.status >= 200 && dispatch.status < 300,
        workflow_ref: workflowRef,
        plan: plan.data,
        dispatch: dispatch.data,
      });
      return;
    }

    if (pathname.startsWith('/api/workflows/') && pathname.endsWith('/approval') && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const ref = pathname.slice('/api/workflows/'.length, -'/approval'.length);
      const body = await readJson(req);
      const action = String(body.action || '').toLowerCase();
      const endpoint = action === 'reject' ? 'cancel' : 'resume';
      const r = await fetchFromService(`${workflowUrl}/internal/workflows/${encodeURIComponent(ref)}/${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({ user_role: session.role, reason: action || 'approval' }),
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/users' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT id, username, display_name, role, status, org_id, created_at FROM "user" ORDER BY created_at DESC LIMIT 1000`
        );
        sendJson(res, 200, { ok: true, users: result.rows });
      } catch (error) {
        logger.error('users.query_failed', 'Users query failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/users' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const newPassword = String(body.password || '');
      if (newPassword) {
        const strength = validatePasswordStrength(newPassword, requestLang);
        if (!strength.valid) {
          sendJson(res, 400, { ok: false, error: 'weak_password', message: strength.message });
          return;
        }
      }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const username = String(body.username || '').trim();
        const displayName = String(body.display_name || body.username || '').trim();
        const role = String(body.role || 'user').trim();
        if (!username) { sendJson(res, 400, { ok: false, error: 'missing_username' }); return; }
        const metadata: Record<string, unknown> = {};
        if (newPassword) metadata.password_hash = hashPassword(newPassword);
        const result = await pool.query(
          `INSERT INTO "user" (username, display_name, role, status, metadata) VALUES ($1, $2, $3, 'active', $4::jsonb) ON CONFLICT (username) DO UPDATE SET display_name = $2, role = $3, metadata = $4::jsonb RETURNING *`,
          [username, displayName, role, JSON.stringify(metadata)]
        );
        sendJson(res, 201, { ok: true, user: result.rows[0] });
      } catch (error) {
        logger.error('users.create_failed', 'User create failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/organizations' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT id, org_name, display_name, status, settings, metadata, created_at, updated_at
           FROM organization
           WHERE status <> 'deleted'
           ORDER BY created_at DESC
           LIMIT 1000`
        );
        sendJson(res, 200, { ok: true, organizations: result.rows });
      } catch (error) {
        logger.error('organizations.list_failed', 'Organization list failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/organizations' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const orgName = String(body.org_name || '').trim();
      const displayName = String(body.display_name || orgName).trim();
      if (!orgName) { sendJson(res, 400, { ok: false, error: 'missing_org_name' }); return; }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `INSERT INTO organization (org_name, display_name, status, settings, metadata)
           VALUES ($1, $2, 'active', COALESCE($3::jsonb, '{}'::jsonb), COALESCE($4::jsonb, '{}'::jsonb))
           RETURNING id, org_name, display_name, status, settings, metadata, created_at, updated_at`,
          [orgName, displayName, JSON.stringify(body.settings || {}), JSON.stringify(body.metadata || {})]
        );
        sendJson(res, 201, { ok: true, organization: result.rows[0] });
      } catch (error) {
        logger.error('organizations.create_failed', 'Organization create failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname.startsWith('/api/admin/organizations/') && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = pathname.slice('/api/admin/organizations/'.length);
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT id, org_name, display_name, status, settings, metadata, created_at, updated_at
           FROM organization WHERE id = $1 LIMIT 1`,
          [orgId]
        );
        if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'organization_not_found' }); return; }
        sendJson(res, 200, { ok: true, organization: result.rows[0] });
      } catch (error) {
        logger.error('organizations.get_failed', 'Organization get failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname.startsWith('/api/admin/organizations/') && method === 'PUT') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = pathname.slice('/api/admin/organizations/'.length);
      const body = await readJson(req);
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `UPDATE organization
           SET display_name = COALESCE($2, display_name),
               status = COALESCE($3, status),
               settings = COALESCE($4::jsonb, settings),
               metadata = COALESCE($5::jsonb, metadata),
               updated_at = now()
           WHERE id = $1
           RETURNING id, org_name, display_name, status, settings, metadata, created_at, updated_at`,
          [
            orgId,
            body.display_name !== undefined ? String(body.display_name) : null,
            body.status !== undefined ? String(body.status) : null,
            body.settings !== undefined ? JSON.stringify(body.settings) : null,
            body.metadata !== undefined ? JSON.stringify(body.metadata) : null,
          ]
        );
        if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'organization_not_found' }); return; }
        sendJson(res, 200, { ok: true, organization: result.rows[0] });
      } catch (error) {
        logger.error('organizations.update_failed', 'Organization update failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname.startsWith('/api/admin/organizations/') && method === 'DELETE') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = pathname.slice('/api/admin/organizations/'.length);
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `UPDATE organization SET status = 'deleted', updated_at = now() WHERE id = $1 RETURNING id`,
          [orgId]
        );
        if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'organization_not_found' }); return; }
        sendJson(res, 200, { ok: true });
      } catch (error) {
        logger.error('organizations.delete_failed', 'Organization delete failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/skills' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/skills' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const normalizedBody = {
        owner_user_id: session.user_id,
        org_id: session.org_id || undefined,
        scope_type: body.scope_type || 'private',
        skill_name: String(body.skill_name || body.name || '').trim(),
        description: String(body.description || ''),
        skill_type: String(body.skill_type || body.type || 'prompt'),
        definition_json: body.definition_json || body.definition || {},
        metadata: body.metadata || {},
        source_uri: body.source_uri || body.source || undefined,
      };
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/create', { method: 'POST', body: JSON.stringify(normalizedBody) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/skills/import' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const sourceUrl = String(body.source_url || body.source_uri || '').trim();
      const markdownContent = String(body.markdown_content || body.content || '').trim();
      const scopeType = String(body.scope_type || 'private');
      if (sourceUrl && sourceUrl.includes('clawhub.ai')) {
        const result = await createSkillFromClawHub(session, sourceUrl, scopeType);
        sendJson(res, result.status, result.body);
        return;
      }
      if (markdownContent) {
        const r = await fetchFromService(skillLibraryUrl + '/internal/skills/import', {
          method: 'POST',
          body: JSON.stringify({
            owner_user_id: session.user_id,
            org_id: session.org_id || undefined,
            scope_type: scopeType,
            markdown_content: markdownContent,
            source_uri: sourceUrl || body.file_name || 'admin_upload',
            metadata: { admin_uploaded: true, source_url: sourceUrl || undefined }
          })
        });
        sendJson(res, r.status, r.data);
        return;
      }
      sendJson(res, 400, { ok: false, error: 'missing_import_content' });
      return;
    }

    if (pathname === '/api/admin/skills/check-updates' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const skillId = String(body.skill_id || '').trim();
      const slugOrUrl = String(body.slug || body.source_url || body.source_uri || '').trim();
      const targets: Array<Record<string, unknown>> = [];
      if (skillId) {
        const detail = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId));
        if (detail.status !== 200 || !(detail.data as Record<string, unknown>)?.skill) {
          sendJson(res, detail.status, detail.data);
          return;
        }
        targets.push((detail.data as Record<string, unknown>).skill as Record<string, unknown>);
      } else if (slugOrUrl) {
        targets.push({ id: '', skill_name: normalizeClawHubSlug(slugOrUrl), metadata: { source: slugOrUrl, clawhub_slug: normalizeClawHubSlug(slugOrUrl) }, definition_json: {} });
      } else {
        const listed = await fetchFromService(skillLibraryUrl + '/internal/skills?limit=200');
        if (listed.status !== 200 || !Array.isArray((listed.data as Record<string, unknown>)?.skills)) {
          sendJson(res, listed.status, listed.data);
          return;
        }
        for (const skill of (listed.data as Record<string, unknown>).skills as Array<Record<string, unknown>>) {
          const info = extractInstalledClawHubInfo(skill);
          if (info.slug || info.sourceUri.includes('clawhub.ai')) targets.push(skill);
        }
      }

      const updates: Array<Record<string, unknown>> = [];
      for (const target of targets) {
        const installed = extractInstalledClawHubInfo(target);
        const slug = installed.slug || normalizeClawHubSlug(slugOrUrl);
        if (!slug) continue;
        const versionsResult = await runClawHubInspect(slug, ['--versions', '--limit', '10']);
        if (!versionsResult.ok || !versionsResult.data) {
          updates.push({ skill_id: target.id, skill_name: target.skill_name, slug, ok: false, error: versionsResult.error || 'clawhub_unavailable', detail: versionsResult.text });
          continue;
        }
        const meta = normalizeClawHubInspect(versionsResult.data, slug);
        const latestVersion = String(meta.latest_version || '');
        const currentVersion = installed.currentVersion || latestVersion;
        const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
        const versions = Array.isArray(versionsResult.data.versions) ? versionsResult.data.versions as Array<Record<string, unknown>> : [];
        const relevantChanges = versions
          .filter(version => {
            const versionName = String(version.version || '');
            return !currentVersion || compareVersions(versionName, currentVersion) > 0;
          })
          .map(version => ({
            version: String(version.version || ''),
            changelog: String(version.changelog || ''),
            summary: summarizeClawHubChangelog(String(version.changelog || ''), currentVersion, String(version.version || ''))
          }));
        updates.push({
          skill_id: target.id,
          skill_name: target.skill_name || meta.display_name,
          slug,
          source_uri: installed.sourceUri || meta.source_uri,
          current_version: currentVersion,
          latest_version: latestVersion,
          has_update: hasUpdate,
          changelog: String(meta.latest_changelog || ''),
          change_summary: summarizeClawHubChangelog(String(meta.latest_changelog || ''), currentVersion, latestVersion),
          relevant_changes: relevantChanges,
          moderation: meta.moderation,
          downloads: meta.downloads,
          stars: meta.stars,
          updated_at: meta.updated_at
        });
      }
      sendJson(res, 200, { ok: true, updates, checked_at: new Date().toISOString() });
      return;
    }

    if (pathname.startsWith('/api/admin/skills/') && pathname.endsWith('/upgrade') && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const skillId = pathname.slice('/api/admin/skills/'.length, -'/upgrade'.length);
      if (!skillId) { sendJson(res, 400, { ok: false, error: 'missing_skill_id' }); return; }
      const detail = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId));
      if (detail.status !== 200 || !(detail.data as Record<string, unknown>)?.skill) {
        sendJson(res, detail.status, detail.data);
        return;
      }
      const skill = (detail.data as Record<string, unknown>).skill as Record<string, unknown>;
      const installed = extractInstalledClawHubInfo(skill);
      if (!installed.slug) {
        sendJson(res, 400, { ok: false, error: 'skill_not_from_clawhub' });
        return;
      }
      const inspected = await runClawHubInspect(installed.slug, ['--files']);
      if (!inspected.ok || !inspected.data) {
        sendJson(res, 502, { ok: false, error: inspected.error || 'clawhub_unavailable', detail: inspected.text });
        return;
      }
      const meta = normalizeClawHubInspect(inspected.data, installed.slug);
      const version = (inspected.data.version || {}) as Record<string, unknown>;
      const files = Array.isArray(version.files) ? version.files as Array<Record<string, unknown>> : [];
      const existingDefinition = (skill.definition_json || {}) as Record<string, unknown>;
      const definition = {
        ...existingDefinition,
        ...buildSkillDefinitionFromClawHub(meta, files),
        risk_profile: (existingDefinition.risk_profile || buildSkillDefinitionFromClawHub(meta, files).risk_profile) as Record<string, unknown>
      };
      const updateBody = {
        definition_json: definition,
        description: String(meta.summary || skill.description || ''),
        skill_type: inferClawHubSkillType(meta, String(skill.skill_type || 'workflow')),
        scope_type: skill.scope_type,
        source_uri: meta.source_uri,
        source_type: 'manual',
        source_metadata: {
          registry: 'clawhub.ai',
          clawhub_slug: meta.slug,
          upstream_version: meta.latest_version,
          changelog_summary: summarizeClawHubChangelog(String(meta.latest_changelog || ''), installed.currentVersion, String(meta.latest_version || ''))
        }
      };
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId) + '/update', {
        method: 'POST',
        body: JSON.stringify(updateBody)
      });
      if (r.status >= 200 && r.status < 300) {
        const pool = await getDbPool();
        if (pool) {
          const existingMeta = (skill.metadata || {}) as Record<string, unknown>;
          const mergedMeta = {
            ...existingMeta,
            source: existingMeta.source || meta.source_uri,
            installed_from: 'clawhub.ai',
            clawhub_slug: meta.slug,
            clawhub_owner: meta.owner || existingMeta.clawhub_owner,
            clawhub_version: meta.latest_version,
            clawhub_updated_at: meta.updated_at,
            last_upgrade_checked_at: new Date().toISOString(),
            last_upgrade_summary: summarizeClawHubChangelog(String(meta.latest_changelog || ''), installed.currentVersion, String(meta.latest_version || ''))
          };
          await pool.query(`UPDATE skill SET metadata = $2::jsonb, updated_at = now() WHERE id = $1`, [skillId, JSON.stringify(mergedMeta)]).catch(() => undefined);
        }
      }
      sendJson(res, r.status, {
        ...((r.data || {}) as Record<string, unknown>),
        clawhub: {
          slug: meta.slug,
          previous_version: installed.currentVersion,
          latest_version: meta.latest_version,
          change_summary: summarizeClawHubChangelog(String(meta.latest_changelog || ''), installed.currentVersion, String(meta.latest_version || '')),
          moderation: meta.moderation
        }
      });
      return;
    }

    if (pathname.startsWith('/api/admin/skills/') && !pathname.includes('/mirror-') && pathname !== '/api/admin/skills/recommended' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const skillId = pathname.slice('/api/admin/skills/'.length);
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId));
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/skills/') && method === 'PUT') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const skillId = pathname.slice('/api/admin/skills/'.length);
      const body = await readJson(req);
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId), { method: 'PUT', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/clawhub/status' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const env = loadEnvFile();
      const site = env.CLAWHUB_SITE || process.env.CLAWHUB_SITE || 'https://clawhub.ai';
      const registry = env.CLAWHUB_REGISTRY || process.env.CLAWHUB_REGISTRY || '';
      const hasToken = Boolean(env.CLAWHUB_ADMIN_TOKEN || process.env.CLAWHUB_ADMIN_TOKEN);
      sendJson(res, 200, { ok: true, site, registry, token_configured: hasToken, token_preview: hasToken ? '********' : '' });
      return;
    }

    if (pathname === '/api/admin/config' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const env = loadEnvFile();
      const config: Record<string, string> = {};
      const sections = getConfigSections(getRequestLang(req));
      for (const section of sections) {
        for (const field of section.fields) {
          const val = env[field.key] || process.env[field.key] || '';
          config[field.key] = field.sensitive
            ? String(redactConfigValue(field.key, val, field.type))
            : String(redactConfigValue(field.key, val));
        }
      }
      sendJson(res, 200, { ok: true, config });
      return;
    }

    if (pathname === '/api/admin/config-meta' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      sendJson(res, 200, { ok: true, sections: getConfigSections(getRequestLang(req)) });
      return;
    }

    if (pathname === '/api/admin/config' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const env = loadEnvFile();
      const sections = getConfigSections(getRequestLang(req));
      const changedKeys: string[] = [];
      for (const section of sections) {
        for (const field of section.fields) {
          if (body[field.key] !== undefined) {
            if (field.sensitive && body[field.key] === '****') continue;
            const nextValue = String(body[field.key]);
            if (env[field.key] !== nextValue) changedKeys.push(field.key);
            env[field.key] = nextValue;
          }
        }
      }
      persistConfigEnv(env);
      const hostEnvSync = syncHostEnvFile();
      const restart_targets = getRestartTargetsForConfigKeys(changedKeys);
      sendJson(res, 200, {
        ok: true,
        reloaded: true,
        hot_loaded: true,
        changed_keys: changedKeys,
        restart_targets,
        restart_hint: restart_targets.length > 0 ? 'restart_optional' : undefined,
        host_env_synced: hostEnvSync.synced,
        host_env_sync_error: hostEnvSync.error
      });
      return;
    }

    if (pathname === '/api/admin/config/reload' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const env = loadEnvFile();
      persistConfigEnv(env);
      sendJson(res, 200, { ok: true, reloaded: true });
      return;
    }

    if (pathname === '/api/admin/services/restart' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const service = String(body.service || '').trim();
      const result = restartServiceByName(service);
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }

    if (pathname === '/api/admin/audit' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(gatewayUrl + '/admin/audit?limit=' + MAX_AUDIT_ROWS);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/retrieval-traces' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(factRetrievalUrl + '/admin/retrieval-traces?limit=' + MAX_RETRIEVAL_ROWS);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/channels/identity' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const r = await fetchFromService(gatewayUrl + '/channels/identity');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/channels/identity/') && pathname.endsWith('/rebind') && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const id = pathname.slice('/api/channels/identity/'.length, -'/rebind'.length);
      const r = await fetchFromService(gatewayUrl + '/channels/identity/' + encodeURIComponent(id) + '/rebind', { method: 'POST' });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/db/stats' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const connResult = await pool.query(`SELECT count(*) as cnt FROM pg_stat_activity WHERE datname = current_database()`);
        const sizeResult = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`);
        const tableResult = await pool.query(`SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = 'public'`);
        sendJson(res, 200, { ok: true, stats: { connections: Number(connResult.rows[0]?.cnt || 0), db_size: sizeResult.rows[0]?.size || '-', table_count: Number(tableResult.rows[0]?.cnt || 0) } });
      } catch (error) {
        logger.error('db.stats_error', 'DB stats query failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/db/maintenance' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const body = await readJson(req);
      const action = String(body.action || '');
      try {
        const started = Date.now();
        if (action === 'analyze') await pool.query('ANALYZE');
        else if (action === 'checkpoint') await pool.query('CHECKPOINT');
        else { sendJson(res, 400, { ok: false, error: 'invalid_action' }); return; }
        const [connResult, sizeResult, tableResult] = await Promise.all([
          pool.query(`SELECT count(*) as cnt FROM pg_stat_activity WHERE datname = current_database()`),
          pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`),
          pool.query(`SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = 'public'`)
        ]);
        sendJson(res, 200, {
          ok: true,
          action,
          duration_ms: Date.now() - started,
          stats: {
            connections: Number(connResult.rows[0]?.cnt || 0),
            db_size: sizeResult.rows[0]?.size || '-',
            table_count: Number(tableResult.rows[0]?.cnt || 0)
          }
        });
      } catch (error) {
        logger.error('db.maintenance_error', 'DB maintenance failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/knowledge/import' && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const ownerUserId = toPortalOwnerUserId(session);
      const sourceType = normalizeKnowledgeSourceType(String(body.source_type || body.source_kind || 'manual'));
      const scope = String(body.scope || 'private') === 'public' ? 'public' : 'private';
      let content = String(body.content || body.content_text || body.source_text || '');
      let fileResult: { status: number; data: unknown } | null = null;
      let fileWarning: string | undefined;
      if (typeof body.file_buffer_b64 === 'string' && body.file_buffer_b64) {
        const buffer = Buffer.from(String(body.file_buffer_b64), 'base64');
        content = await parseKnowledgeFileContent(buffer, String(body.file_name || body.title || 'upload'), String(body.mime_type || 'application/octet-stream'));
        if (factRetrievalUrl) {
          fileResult = await fetchFromService(factRetrievalUrl + '/internal/files/upload', {
            method: 'POST',
            body: JSON.stringify({
              owner_user_id: ownerUserId,
              org_id: session.org_id || null,
              file_buffer_b64: body.file_buffer_b64,
              original_name: String(body.file_name || body.title || 'upload'),
              mime_type: String(body.mime_type || 'application/octet-stream'),
              source: 'import',
              scope,
              file_category: 'upload'
            })
          });
          if (fileResult.status >= 400) {
            const data = fileResult.data as Record<string, unknown>;
            fileWarning = String(data.error || 'file_storage_unavailable');
            logger.warn('knowledge.file_storage_failed', 'File storage failed while knowledge import continues', {
              file_name: String(body.file_name || body.title || 'upload'),
              status: fileResult.status,
              error: fileWarning
            });
          }
        } else {
          fileWarning = 'fact_retrieval_url_missing';
        }
      }
      if (!content.trim()) { sendJson(res, 400, { ok: false, error: 'missing_content' }); return; }
      if (!factRetrievalUrl) { sendJson(res, 503, { ok: false, error: 'fact_retrieval_url_missing' }); return; }
      const documentResult = await fetchFromService(factRetrievalUrl + '/internal/documents/index', {
        method: 'POST',
        body: JSON.stringify({
          owner_user_id: ownerUserId,
          org_id: session.org_id || undefined,
          title: String(body.title || body.file_name || 'Knowledge Import'),
          content_text: content,
          source_type: sourceType,
          source_uri: typeof body.source_uri === 'string' && body.source_uri
            ? body.source_uri
            : String(body.file_name || ''),
          scope: [scope],
          scope_type: scope
        })
      });
      if (documentResult.status >= 400) {
        sendJson(res, documentResult.status, documentResult.data);
        return;
      }
      const factResult = await fetchFromService(factRetrievalUrl + '/internal/fact/submit', {
        method: 'POST',
        body: JSON.stringify({
          owner_user_id: ownerUserId,
          org_id: session.org_id || undefined,
          source_text: content.slice(0, 20000),
          source: sourceType === 'upload' ? 'portal_document_import' : 'portal_manual_import'
        })
      });
      const documentData = (documentResult.data || {}) as Record<string, unknown>;
      const factData = (factResult.data || {}) as Record<string, unknown>;
      sendJson(res, 200, {
        ok: true,
        document: {
          document_id: documentData.document_id,
          version_id: documentData.version_id,
          chunks_indexed: documentData.chunks_indexed,
          chunk_ids: documentData.chunk_ids
        },
        review: {
          submitted: factResult.status >= 200 && factResult.status < 300,
          fact_id: factData.fact_id,
          error: factData.error
        },
        file: fileResult && (fileResult.data as Record<string, unknown>).file ? (fileResult.data as Record<string, unknown>).file : undefined,
        warning: fileWarning
      });
      return;
    }

    if (pathname === '/api/knowledge/review' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = url.searchParams.get('org_id') || '';
      const status = url.searchParams.get('status') || 'unconfirmed';
      const limit = url.searchParams.get('limit') || '50';
      const r = await fetchFromService(factRetrievalUrl + '/internal/fact/review?org_id=' + encodeURIComponent(orgId) + '&status=' + encodeURIComponent(status) + '&limit=' + encodeURIComponent(limit));
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/knowledge/review' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(factRetrievalUrl + '/internal/fact/review', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/shared-knowledge' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(factRetrievalUrl + '/admin/shared-knowledge');
      if (r.status === 404 || (typeof r.data === 'object' && r.data && (r.data as Record<string, unknown>).error === 'not_found')) {
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
        try {
          const result = await pool.query(
            `SELECT id, title, source_kind, source_uri, status, created_at
               FROM document
              WHERE scope_type = 'public' AND status = 'active'
              ORDER BY created_at DESC
              LIMIT 200`
          );
          sendJson(res, 200, { ok: true, documents: result.rows });
        } catch (error) {
          logger.error('shared_knowledge.list_failed', 'Failed to list shared knowledge', { error: String(error) });
          sendJson(res, 500, { ok: false, error: 'db_error' });
        }
        return;
      }
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/shared-knowledge' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const payload = {
        owner_user_id: toPortalOwnerUserId(session),
        org_id: session.org_id || undefined,
        title: String(body.title || 'Shared Doc'),
        content_text: String(body.content || body.content_text || ''),
        source_type: normalizeKnowledgeSourceType(String(body.source_kind || body.source_type || 'manual')),
        source_uri: String(body.source_uri || ''),
        scope: ['public'],
        scope_type: 'public'
      };
      const r = await fetchFromService(factRetrievalUrl + '/internal/documents/index', { method: 'POST', body: JSON.stringify(payload) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/shared-knowledge/') && method === 'DELETE') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const docId = pathname.slice('/api/admin/shared-knowledge/'.length);
      const r = await fetchFromService(factRetrievalUrl + '/admin/shared-knowledge/' + encodeURIComponent(docId), { method: 'DELETE' });
      if (r.status === 404 || (typeof r.data === 'object' && r.data && (r.data as Record<string, unknown>).error === 'not_found')) {
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
        try {
          await pool.query(`UPDATE document SET status='deleted', updated_at=now() WHERE id=$1`, [docId]);
          sendJson(res, 200, { ok: true });
        } catch (error) {
          logger.error('shared_knowledge.delete_failed', 'Failed to delete shared knowledge', { docId, error: String(error) });
          sendJson(res, 500, { ok: false, error: 'db_error' });
        }
        return;
      }
      sendJson(res, r.status, r.data);
      return;
    }

    // ============================================================
    // 梦境模式：记忆分析 API 代理 (Dream Mode - Memory)
    // ============================================================

    // 个人梦境分析
    if (pathname === '/api/admin/dream/analyze' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(hermesUrl + '/internal/memory/analyze', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    // 组织级记忆分析
    if (pathname === '/api/admin/dream/analyze-org' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(hermesUrl + '/internal/memory/analyze/org', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    // 组织级记忆汇总查询
    if (pathname === '/api/admin/dream/summary' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = new URL(req.url || '/', 'http://localhost').searchParams.get('org_id') || '';
      const category = new URL(req.url || '/', 'http://localhost').searchParams.get('category') || '';
      let url = hermesUrl + '/internal/memory/summary?org_id=' + encodeURIComponent(orgId);
      if (category) url += '&category=' + encodeURIComponent(category);
      const r = await fetchFromService(url);
      sendJson(res, r.status, r.data);
      return;
    }

    // 记忆分析运行历史
    if (pathname === '/api/admin/dream/runs' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const orgId = reqUrl.searchParams.get('org_id') || '';
      const userId = reqUrl.searchParams.get('user_id') || '';
      let url = hermesUrl + '/internal/memory/analysis-runs?';
      if (orgId) url += 'org_id=' + encodeURIComponent(orgId) + '&';
      if (userId) url += 'user_id=' + encodeURIComponent(userId) + '&';
      const r = await fetchFromService(url);
      sendJson(res, r.status, r.data);
      return;
    }

    // 记忆压缩日志
    if (pathname === '/api/admin/dream/compressions' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const userId = new URL(req.url || '/', 'http://localhost').searchParams.get('user_id') || '';
      const r = await fetchFromService(hermesUrl + '/internal/memory/compression-logs?user_id=' + encodeURIComponent(userId));
      sendJson(res, r.status, r.data);
      return;
    }

    // 记忆访问日志
    if (pathname === '/api/admin/dream/access-log' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const userId = new URL(req.url || '/', 'http://localhost').searchParams.get('user_id') || '';
      const r = await fetchFromService(hermesUrl + '/internal/memory/access-log?user_id=' + encodeURIComponent(userId));
      sendJson(res, r.status, r.data);
      return;
    }

    // 召回与业务结果归因
    if (pathname === '/api/admin/dream/attribution' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const orgId = reqUrl.searchParams.get('org_id') || session.org_id || '';
      const orgFilter = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId) ? orgId : '';
      const days = Math.max(1, Math.min(Number(reqUrl.searchParams.get('days') || 30), 180));
      try {
        const [skills, knowledge, outcomes] = await Promise.all([
          pool.query(
            `SELECT skill_id, skill_name,
                    SUM(recall_count)::int AS recall_count,
                    SUM(injected_count)::int AS injected_count,
                    SUM(succeeded_count)::int AS succeeded_count,
                    ROUND(AVG(avg_business_score)::numeric, 2) AS avg_business_score
             FROM skill_business_outcome_daily
             WHERE usage_date >= current_date - ($1::int * interval '1 day')
               AND ($2::text = '' OR EXISTS (
                 SELECT 1 FROM skill s WHERE s.id = skill_business_outcome_daily.skill_id AND s.org_id = $2::uuid
               ))
             GROUP BY skill_id, skill_name
             ORDER BY succeeded_count DESC, recall_count DESC
             LIMIT 50`,
            [days, orgFilter]
          ),
          pool.query(
            `SELECT recall_source, item_ref,
                    SUM(recall_count)::int AS recall_count,
                    SUM(injected_count)::int AS injected_count,
                    SUM(succeeded_count)::int AS succeeded_count,
                    ROUND(AVG(avg_business_score)::numeric, 2) AS avg_business_score
             FROM knowledge_business_outcome_daily
             WHERE usage_date >= current_date - ($1::int * interval '1 day')
               AND ($2::text = '' OR EXISTS (
                 SELECT 1 FROM knowledge_recall_event kre
                 WHERE kre.recall_source = knowledge_business_outcome_daily.recall_source
                   AND kre.item_ref = knowledge_business_outcome_daily.item_ref
                   AND kre.org_id = $2::uuid
               ))
             GROUP BY recall_source, item_ref
             ORDER BY succeeded_count DESC, recall_count DESC
             LIMIT 50`,
            [days, orgFilter]
          ),
          pool.query(
            `SELECT outcome_status, COUNT(*)::int AS count, ROUND(AVG(business_score)::numeric, 2) AS avg_business_score
             FROM workflow_outcome_eval
             WHERE created_at >= now() - ($1::int * interval '1 day')
               AND ($2::text = '' OR org_id = $2::uuid)
             GROUP BY outcome_status
             ORDER BY outcome_status`,
            [days, orgFilter]
          )
        ]);
        sendJson(res, 200, {
          ok: true,
          days,
          skills: skills.rows,
          knowledge: knowledge.rows,
          outcomes: outcomes.rows
        });
      } catch (err) {
        logger.error('dream.attribution_failed', 'Failed to query dream attribution', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'query_failed' });
      }
      return;
    }

    // ============================================================
    // 梦境模式：技能发现 API 代理 (Dream Mode - Skill Discovery)
    // ============================================================

    // 技能审核
    if (pathname === '/api/admin/dream/skill-audit' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/audit', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    // 批量技能审核
    if (pathname === '/api/admin/dream/skill-audit-batch' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/audit/batch', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    // 技能审核记录查询
    if (pathname === '/api/admin/dream/skill-audit-records' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const skillId = reqUrl.searchParams.get('skill_id') || '';
      const orgId = reqUrl.searchParams.get('org_id') || '';
      let url = skillLibraryUrl + '/internal/skills/audit-records?';
      if (skillId) url += 'skill_id=' + encodeURIComponent(skillId) + '&';
      if (orgId) url += 'org_id=' + encodeURIComponent(orgId) + '&';
      const r = await fetchFromService(url);
      sendJson(res, r.status, r.data);
      return;
    }

    // 组织技能注册表
    if (pathname === '/api/admin/dream/org-skills' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = new URL(req.url || '/', 'http://localhost').searchParams.get('org_id') || '';
      const category = new URL(req.url || '/', 'http://localhost').searchParams.get('category') || '';
      let url = skillLibraryUrl + '/internal/skills/org-registry?org_id=' + encodeURIComponent(orgId);
      if (category) url += '&category=' + encodeURIComponent(category);
      const r = await fetchFromService(url);
      sendJson(res, r.status, r.data);
      return;
    }

    // 技能使用统计
    if (pathname === '/api/admin/dream/skill-usage' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const skillId = reqUrl.searchParams.get('skill_id') || '';
      const days = reqUrl.searchParams.get('days') || '30';
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/usage-stats?skill_id=' + encodeURIComponent(skillId) + '&days=' + encodeURIComponent(days));
      sendJson(res, r.status, r.data);
      return;
    }

    // 场景价值评估
    if (pathname === '/api/admin/dream/scenes' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = new URL(req.url || '/', 'http://localhost').searchParams.get('org_id') || '';
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/scene-assessments?org_id=' + encodeURIComponent(orgId));
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/dream/workflow-definition-reviews/nominate' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(skillLibraryUrl + '/internal/workflow-definition-reviews/nominate', {
        method: 'POST',
        body: JSON.stringify({ ...body, org_id: body.org_id || session.org_id || undefined })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/dream/workflow-definition-reviews' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const status = reqUrl.searchParams.get('status') || 'pending';
      const orgId = reqUrl.searchParams.get('org_id') || session.org_id || '';
      const limit = reqUrl.searchParams.get('limit') || '100';
      const r = await fetchFromService(
        skillLibraryUrl + '/internal/workflow-definition-reviews?status=' + encodeURIComponent(status) +
        '&org_id=' + encodeURIComponent(orgId) +
        '&limit=' + encodeURIComponent(limit)
      );
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/dream/workflow-definition-reviews/') && pathname.endsWith('/decision') && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const reviewId = pathname.split('/')[5];
      const body = await readJson(req);
      const r = await fetchFromService(skillLibraryUrl + '/internal/workflow-definition-reviews/' + encodeURIComponent(reviewId) + '/decision', {
        method: 'POST',
        body: JSON.stringify({
          action: body.action,
          notes: body.notes || '',
          reviewed_by: session.user_id
        })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    // 提升技能为组织级
    if (pathname.startsWith('/api/admin/skills/') && pathname.endsWith('/promote-to-org') && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const skillId = pathname.split('/')[4];
      const body = await readJson(req);
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId) + '/promote-to-org', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    // 梦境模式配置 CRUD
    if (pathname === '/api/admin/dream/config' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const orgId = session.org_id || '00000000-0000-0000-0000-000000000001';
      const result = await pool.query('SELECT * FROM dream_mode_config WHERE org_id = $1 LIMIT 1', [orgId]);
      sendJson(res, 200, { ok: true, config: result.rows[0] || null });
      return;
    }

    if (pathname === '/api/admin/dream/config' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const orgId = session.org_id || '00000000-0000-0000-0000-000000000001';
      try {
        await pool.query(
          `INSERT INTO dream_mode_config (org_id, enabled, dream_user_trigger, dream_scheduled_hour, cooling_window_minutes, compression_threshold_chars, max_compressions_per_run, skill_audit_enabled, skill_audit_scheduled_hour, auto_promote_threshold, min_usage_for_scene_detection)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (org_id) DO UPDATE SET enabled=$2, dream_user_trigger=$3, dream_scheduled_hour=$4, cooling_window_minutes=$5, compression_threshold_chars=$6, max_compressions_per_run=$7, skill_audit_enabled=$8, skill_audit_scheduled_hour=$9, auto_promote_threshold=$10, min_usage_for_scene_detection=$11, updated_at=now()`,
          [orgId, body.enabled !== false, String(body.dream_user_trigger || 'auto'), Number(body.dream_scheduled_hour || 3), Number(body.cooling_window_minutes || 120),
           Number(body.compression_threshold_chars || 4000), Number(body.max_compressions_per_run || 100),
           body.skill_audit_enabled !== false, Number(body.skill_audit_scheduled_hour || 5),
           Number(body.auto_promote_threshold || 80), Number(body.min_usage_for_scene_detection || 3)]
        );
        sendJson(res, 200, { ok: true });
      } catch (err) {
        logger.error('dream.config_save_failed', 'Failed to save dream mode config', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'config_save_failed' });
      }
      return;
    }

    if (pathname === '/api/admin/tasks' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(gatewayUrl + '/admin/tasks');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/tasks' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(gatewayUrl + '/admin/tasks', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/tasks/') && method === 'PUT') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const taskId = pathname.slice('/api/admin/tasks/'.length);
      const body = await readJson(req);
      const r = await fetchFromService(gatewayUrl + '/admin/tasks/' + encodeURIComponent(taskId), { method: 'PUT', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/tasks/') && method === 'DELETE') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const taskId = pathname.slice('/api/admin/tasks/'.length);
      const r = await fetchFromService(gatewayUrl + '/admin/tasks/' + encodeURIComponent(taskId), { method: 'DELETE' });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/tasks' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const r = await fetchFromService(gatewayUrl + '/tasks');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/submit') && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const assignmentId = pathname.slice('/api/tasks/'.length, -'/submit'.length);
      const body = await readJson(req);
      const r = await fetchFromService(gatewayUrl + '/tasks/' + encodeURIComponent(assignmentId) + '/submit', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/internal/tasks/assign' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(gatewayUrl + '/internal/tasks/assign', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/internal/tasks/notify' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(gatewayUrl + '/internal/tasks/notify', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/quotas' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const scope = getQuotaScope(session);
      const r = await fetchFromService(getResourceSchedulerUrl() + '/internal/quotas/' + scope);
      if (r.status === 404 || r.status === 502 || r.status === 504) {
        sendJson(res, 200, normalizeQuotaResponse({ quota: { scope, ...DEFAULT_QUOTAS }, usage: {} }));
        return;
      }
      sendJson(res, r.status, r.status >= 200 && r.status < 300 ? normalizeQuotaResponse(r.data) : r.data);
      return;
    }

    if (pathname === '/api/admin/quotas' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const quotas = (body.quotas || {}) as Record<string, unknown>;
      const payload = {
        scope: getQuotaScope(session),
        created_by: session.user_id,
        ...DEFAULT_QUOTAS,
        ...Object.fromEntries(Object.keys(DEFAULT_QUOTAS).map(key => {
          const raw = quotas[key];
          const fallback = DEFAULT_QUOTAS[key as keyof typeof DEFAULT_QUOTAS];
          const parsed = raw === '' || raw === undefined || raw === null ? fallback : Number(raw);
          return [key, Number.isFinite(parsed) ? parsed : fallback];
        })),
      };
      const r = await fetchFromService(getResourceSchedulerUrl() + '/internal/quotas/create', { method: 'POST', body: JSON.stringify(payload) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/quotas/report' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(getResourceSchedulerUrl() + '/internal/inspections/report');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/quotas/inspect' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(getResourceSchedulerUrl() + '/internal/inspections/start', { method: 'POST' });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/dashboard' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = url.searchParams.get('org_id') || session.org_id || '';
      const targetUrl = getProactiveOrchestratorUrl() + '/internal/dashboard' + (orgId ? '?org_id=' + encodeURIComponent(orgId) : '');
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/rules' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = url.searchParams.get('org_id') || session.org_id || '';
      const targetUrl = getProactiveOrchestratorUrl() + '/internal/rules' + (orgId ? '?org_id=' + encodeURIComponent(orgId) : '');
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/rules' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(getProactiveOrchestratorUrl() + '/internal/rules', {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          org_id: body.org_id || session.org_id || undefined,
          created_by: body.created_by || session.user_id,
        })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/proactive/rules/') && method === 'PUT') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const ruleId = pathname.slice('/api/admin/proactive/rules/'.length);
      const body = await readJson(req);
      const r = await fetchFromService(getProactiveOrchestratorUrl() + '/internal/rules/' + encodeURIComponent(ruleId), {
        method: 'PUT',
        body: JSON.stringify(body)
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/proactive/rules/') && pathname.endsWith('/archive') && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const ruleId = pathname.slice('/api/admin/proactive/rules/'.length, -'/archive'.length);
      const r = await fetchFromService(getProactiveOrchestratorUrl() + '/internal/rules/' + encodeURIComponent(ruleId) + '/archive', { method: 'POST' });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/runs' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = url.searchParams.get('org_id') || session.org_id || '';
      const targetUrl = getProactiveOrchestratorUrl() + '/internal/runs' + (orgId ? '?org_id=' + encodeURIComponent(orgId) : '');
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/runs' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(getProactiveOrchestratorUrl() + '/internal/runs', {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          org_id: body.org_id || session.org_id || undefined,
          triggered_by: session.user_id,
        })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/insights' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = url.searchParams.get('org_id') || session.org_id || '';
      const status = url.searchParams.get('review_status') || '';
      let targetUrl = getProactiveOrchestratorUrl() + '/internal/insights?';
      if (orgId) targetUrl += 'org_id=' + encodeURIComponent(orgId) + '&';
      if (status) targetUrl += 'review_status=' + encodeURIComponent(status);
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/proactive/insights/') && pathname.endsWith('/review') && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const insightId = pathname.slice('/api/admin/proactive/insights/'.length, -'/review'.length);
      const body = await readJson(req);
      const r = await fetchFromService(getProactiveOrchestratorUrl() + '/internal/insights/' + encodeURIComponent(insightId) + '/review', {
        method: 'POST',
        body: JSON.stringify({ ...body, reviewer_id: session.user_id })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/missions' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = url.searchParams.get('org_id') || session.org_id || '';
      const status = url.searchParams.get('status') || '';
      let targetUrl = getProactiveOrchestratorUrl() + '/internal/missions?';
      if (orgId) targetUrl += 'org_id=' + encodeURIComponent(orgId) + '&';
      if (status) targetUrl += 'status=' + encodeURIComponent(status);
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/proactive/missions/') && pathname.endsWith('/dispatch') && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const missionId = pathname.slice('/api/admin/proactive/missions/'.length, -'/dispatch'.length);
      const body = await readJson(req);
      const r = await fetchFromService(getProactiveOrchestratorUrl() + '/internal/missions/' + encodeURIComponent(missionId) + '/dispatch', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/proactive/reports' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = url.searchParams.get('org_id') || session.org_id || '';
      const targetUrl = getProactiveOrchestratorUrl() + '/internal/reports' + (orgId ? '?org_id=' + encodeURIComponent(orgId) : '');
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/proactive/reports/') && pathname.endsWith('/publish') && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const reportId = pathname.slice('/api/admin/proactive/reports/'.length, -'/publish'.length);
      const r = await fetchFromService(getProactiveOrchestratorUrl() + '/internal/reports/' + encodeURIComponent(reportId) + '/publish', { method: 'POST' });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/docker-stats' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const activeWf = await pool.query(`SELECT COUNT(*) as cnt FROM workflow_instance WHERE status IN ('running', 'planned')`);
        const activeUsers = await pool.query(`SELECT COUNT(*) as cnt FROM "user" WHERE status = 'active'`);
        const totalDocs = await pool.query(`SELECT COUNT(*) as cnt FROM document WHERE 1=1`);
        const totalSkills = await pool.query(`SELECT COUNT(*) as cnt FROM skill WHERE status != 'deleted'`);
        const dbSize = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`);
        const connections = await pool.query(`SELECT count(*) as cnt FROM pg_stat_activity WHERE datname = current_database()`);
        sendJson(res, 200, {
          ok: true,
          stats: {
            active_workflows: Number(activeWf.rows[0]?.cnt || 0),
            active_users: Number(activeUsers.rows[0]?.cnt || 0),
            total_documents: Number(totalDocs.rows[0]?.cnt || 0),
            total_skills: Number(totalSkills.rows[0]?.cnt || 0),
            db_size: dbSize.rows[0]?.size || '-',
            db_connections: Number(connections.rows[0]?.cnt || 0),
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        logger.error('db.stats_error', 'Container stats failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'stats_error' });
      }
      return;
    }

    if (pathname === '/api/knowledge/list' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const scope = url.searchParams.get('scope') || 'private';
      const limit = url.searchParams.get('limit') || '50';
      const r = await fetchFromService(factRetrievalUrl + '/knowledge/list?scope=' + encodeURIComponent(scope) + '&limit=' + encodeURIComponent(limit));
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/users-orgs' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT u.id, u.username, u.role, u.status, u.org_id, o.org_name, o.display_name as org_display_name
           FROM "user" u
           LEFT JOIN organization o ON u.org_id = o.id
           WHERE u.status = 'active'
           ORDER BY u.username
           LIMIT 1000`
        );
        sendJson(res, 200, { ok: true, users: result.rows });
      } catch (error) {
        logger.error('db.users_orgs_error', 'Users-orgs query failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/users-orgs' && method === 'PUT') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const userId = String(body.user_id || '');
      const orgId = String(body.org_id || '');
      if (!userId) { sendJson(res, 400, { ok: false, error: 'missing_user_id' }); return; }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        await pool.query(`UPDATE "user" SET org_id = $1 WHERE id = $2`, [orgId || null, userId]);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        logger.error('db.user_org_update_error', 'User-org update failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/llm-models' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const env = loadEnvFile();
      const models = parseLlmModels(env).map((model) => sanitizeLlmModel(model));
      sendJson(res, 200, {
        ok: true,
        models,
        catalog: {
          chat: getModelCatalogByKind('chat'),
          embedding: getModelCatalogByKind('embedding'),
          rerank: getModelCatalogByKind('rerank')
        }
      });
      return;
    }

    if (pathname === '/api/admin/llm-models' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      if (!name) { sendJson(res, 400, { ok: false, error: 'missing_name', message: t(requestLang, 'portal.llm.name_required') }); return; }
      const env = loadEnvFile();
      const models = parseLlmModels(env);
      const newModel = buildModelUpsertPayload(body, env, models.length);
      const normalized = [...models.map((item, idx) => normalizeModelRecord(item, String(item.id || `model-${idx}`))), newModel];
      const persistedModels = persistLlmModels(env, normalized);
      persistConfigEnv(env);
      const persistedModel = persistedModels.find((item) => String(item.id) === String(newModel.id)) || persistedModels[persistedModels.length - 1] || newModel;
      sendJson(res, 200, { ok: true, model: sanitizeLlmModel(persistedModel), models: persistedModels.map((item) => sanitizeLlmModel(item)) });
      return;
    }

    if (pathname === '/api/admin/llm-models/catalog' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const env = loadEnvFile();
      const kind = String(body.kind || 'chat') as 'chat' | 'embedding' | 'rerank';
      const baseUrl = String(body.url || env.LITELLM_URL || process.env.LITELLM_URL || 'http://localhost:4000').trim();
      const rawApiKey = isMaskedSecret(body.api_key) ? '' : String(body.api_key || '').trim();
      const apiKey = String(rawApiKey || env.LITELLM_MASTER_KEY || process.env.LITELLM_MASTER_KEY || '').trim();
      const providerModels = await fetchProviderModelCatalog(baseUrl, apiKey);
      const catalogMap = getLiteLlmCatalogByName();
      const providerMerged = providerModels.map((item, index) => {
        const meta = catalogMap.get(String(item.name || item.id || '').toLowerCase()) || {};
        return normalizeModelRecord({
          ...meta,
          ...item,
          url: baseUrl,
          api_key: apiKey,
          mode: meta.mode,
        }, `catalog-${index}`);
      });
      const providerFiltered = providerMerged.filter((item) => modelLooksLikeKind(item, kind));
      const localCatalog = getModelCatalogByKind(kind).map((item, index) => normalizeModelRecord({
        ...item,
        url: item.api_base || baseUrl,
        api_key: apiKey,
        mode: item.mode || (kind === 'embedding' ? 'embeddings' : kind)
      }, `local-${index}`));
      const byName = new Map<string, Record<string, unknown>>();
      for (const item of [...providerFiltered, ...localCatalog]) {
        const name = String(item.name || item.id || '').trim();
        if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), item);
      }
      sendJson(res, 200, { ok: true, kind, models: Array.from(byName.values()).map((item) => sanitizeLlmModel(item)) });
      return;
    }

    if (pathname === '/api/admin/llm-models/test' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const env = overlayProviderEnv(loadEnvFile(), body);
      const kind = String(body.kind || 'chat') as 'chat' | 'embedding' | 'rerank';
      const modelId = String(body.model_id || body.modelId || '').trim();
      const models = parseLlmModels(env);
      const selected = modelId ? models.find((model) => String(model.id) === modelId || String(model.name) === modelId) : undefined;
      if (kind === 'chat') {
        const result = await testChatModel(selected || body, env);
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }
      if (kind === 'embedding') {
        const result = await testEmbeddingProvider(env);
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }
      const result = await testRerankProvider(env);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }

    if (pathname === '/api/admin/llm-models/reorder' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const order = body.order as string[] | undefined;
      if (!order || !Array.isArray(order)) { sendJson(res, 400, { ok: false, error: 'invalid_order' }); return; }
      const env = loadEnvFile();
      const models = parseLlmModels(env);
      const reordered = order.map((id: string, idx: number) => {
        const found = models.find((m: Record<string, unknown>) => String(m.id) === id);
        if (!found) return null;
        return { ...normalizeModelRecord(found, id), priority: idx + 1, is_fallback: idx > 0 };
      }).filter(Boolean) as Array<Record<string, unknown>>;
      if (reordered.length === 0) { sendJson(res, 400, { ok: false, error: 'no_valid_models' }); return; }
      const persistedModels = persistLlmModels(env, reordered);
      persistConfigEnv(env);
      sendJson(res, 200, { ok: true, models: persistedModels.map((item) => sanitizeLlmModel(item)) });
      return;
    }

    if (pathname.startsWith('/api/admin/llm-models/') && method === 'DELETE') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const modelId = pathname.slice('/api/admin/llm-models/'.length);
      const env = loadEnvFile();
      const models = parseLlmModels(env);
      const filtered = models.filter((m: Record<string, unknown>) => String(m.id) !== modelId);
      if (filtered.length === models.length) { sendJson(res, 404, { ok: false, error: 'model_not_found' }); return; }
      const normalized = filtered.map((m: Record<string, unknown>, i: number) => ({ ...normalizeModelRecord(m, String(m.id || `model-${i}`)), priority: i + 1, is_fallback: i > 0 }));
      const persistedModels = persistLlmModels(env, normalized);
      persistConfigEnv(env);
      sendJson(res, 200, { ok: true, models: persistedModels.map((item) => sanitizeLlmModel(item)) });
      return;
    }

    if (pathname === '/api/admin/container-stats' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const containerStats: Array<Record<string, unknown>> = [];
      let dockerAvailable = false;
      try {
        try { await execDocker(['info'], 5000); dockerAvailable = true; } catch { /* docker not available */ }

        if (dockerAvailable) {
          const psOutput = await execDocker(['ps', '--format', '{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}'], 10000);
          const containers = psOutput.trim().split('\n').filter(Boolean);
          const statsOutput = containers.length > 0
            ? await execDocker(['stats', '--no-stream', '--format', '{{.ID}}|{{.CPUPerc}}|{{.MemPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}'], 15000).catch(() => '')
            : '';
          const statsById = new Map<string, string[]>();
          for (const line of statsOutput.trim().split('\n').filter(Boolean)) {
            const [id, cpuPct = '0', memPct = '0', memUsage = '-', netIo = '-', blockIo = '-'] = line.split('|');
            if (id) statsById.set(id, [cpuPct.trim(), memPct.trim(), memUsage.trim(), netIo.trim(), blockIo.trim()]);
          }
          for (const line of containers) {
            const [id, name, status, image] = line.split('|');
            if (!id || !name) continue;
            const [cpuPct = '0', memPct = '0', memUsage = '-', netIo = '-', blockIo = '-'] = statsById.get(id) || [];
            containerStats.push({ id, name, status, image, cpu_percent: cpuPct, memory_percent: memPct, memory_usage: memUsage, net_io: netIo, block_io: blockIo });
          }
        }
      } catch (error) {
        logger.warn('container_stats.error', 'Failed to collect container stats', { error: String(error) });
      }
      sendJson(res, 200, { ok: true, containers: containerStats, docker_available: dockerAvailable, timestamp: new Date().toISOString() });
      return;
    }

    if (pathname === '/api/admin/skills/mirror-search' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const query = url.searchParams.get('query') || '';
      if (!query) { sendJson(res, 400, { ok: false, error: 'missing_query' }); return; }
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/search?query=' + encodeURIComponent(query) + '&limit=20');
      if (r.status === 200 && r.data) {
        const skills = (r.data as Record<string, unknown>).skills || [];
        sendJson(res, 200, { ok: true, skills, total: (r.data as Record<string, unknown>).total || (skills as unknown[]).length });
      } else {
        sendJson(res, r.status, r.data);
      }
      return;
    }

    if (pathname === '/api/admin/skills/mirror-install' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const skillId = String(body.skill_id || '');
      if (!skillId) { sendJson(res, 400, { ok: false, error: 'missing_skill_id' }); return; }
      const detailR = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId));
      if (detailR.status !== 200 || !(detailR.data as Record<string, unknown>).skill) {
        sendJson(res, 404, { ok: false, error: 'skill_not_found', message: t(requestLang, 'portal.skill.not_found') });
        return;
      }
      const sourceSkill = (detailR.data as Record<string, unknown>).skill as Record<string, unknown>;
      const installBody = {
        owner_user_id: session.user_id,
        org_id: session.org_id || undefined,
        skill_name: sourceSkill.skill_name || body.skill_name || '',
        description: sourceSkill.description || '',
        skill_type: sourceSkill.skill_type || 'workflow',
        definition_json: sourceSkill.definition_json || {},
        metadata: { ...(sourceSkill.metadata || {}), installed_from: skillId, installed_at: new Date().toISOString() },
      };
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/create', { method: 'POST', body: JSON.stringify(installBody) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/skills/recommended' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      let seededSlugs: string[] = [];
      if (pool) {
        try {
          const result = await pool.query(
            `SELECT metadata->>'clawhub_slug' AS slug
               FROM skill
              WHERE status <> 'deleted'
                AND (metadata->>'installed_from' = 'clawhub.ai' OR metadata->>'source' LIKE 'https://clawhub.ai/%')
              LIMIT 500`
          );
          seededSlugs = result.rows.map(row => String(row.slug || '')).filter(Boolean);
        } catch { /* recommended list can still render without DB enrichment */ }
      }
      const seededRecommended = CURATED_CLAWHUB_SKILLS.map(skill => ({
        ...skill,
        installed: seededSlugs.includes(normalizeClawHubSlug(skill.source))
      }));
      sendJson(res, 200, { ok: true, skills: seededRecommended });
      return;
    }

    if (pathname === '/api/admin/skills/recommended' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const name = String(body.name || body.skill_name || '').trim();
      const skill = CURATED_CLAWHUB_SKILLS.find((item) => item.name === name || item.source === body.source);
      if (!skill) {
        sendJson(res, 404, { ok: false, error: 'skill_not_found' });
        return;
      }
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills/create', {
        method: 'POST',
        body: JSON.stringify({
          owner_user_id: session.user_id,
          org_id: session.org_id || undefined,
          scope_type: 'private',
          skill_name: skill.name,
          description: skill.description,
          skill_type: skill.type,
          definition_json: skill.definition,
          source_uri: skill.source,
          metadata: {
            curated: true,
            source: skill.source,
            installed_from: 'clawhub.ai',
            clawhub_slug: normalizeClawHubSlug(skill.source),
            risk: skill.risk,
            install_count: skill.installCount,
            rating: skill.rating,
            category: skill.category,
            admin_managed: true
          }
        })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/service-status-history' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT *, created_at AS occurred_at FROM service_status_event ORDER BY created_at DESC LIMIT 100`
        );
        sendJson(res, 200, { ok: true, events: result.rows });
      } catch {
        sendJson(res, 200, { ok: true, events: [] });
      }
      return;
    }

    // ── 用户文件浏览器 API ──
    if (pathname === '/api/files' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const category = reqUrl.searchParams.get('category') || '';
      const scope = reqUrl.searchParams.get('scope') || '';
      const limit = reqUrl.searchParams.get('limit') || '50';
      const offset = reqUrl.searchParams.get('offset') || '0';
      let url = `${factRetrievalUrl}/internal/files?owner_user_id=${encodeURIComponent(toPortalFileOwnerUserId(session))}&limit=${limit}&offset=${offset}`;
      if (category) url += '&category=' + encodeURIComponent(category);
      if (scope) url += '&scope=' + encodeURIComponent(scope);
      const r = await fetchFromService(url);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/files/upload' && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(`${factRetrievalUrl}/internal/files/upload`, {
        method: 'POST',
        body: JSON.stringify({
          owner_user_id: toPortalFileOwnerUserId(session),
          org_id: session.org_id,
          file_buffer_b64: String(body.file_buffer || ''),
          original_name: String(body.original_name || 'untitled'),
          mime_type: String(body.mime_type || 'application/octet-stream'),
          source: 'user_upload',
          scope: body.scope || 'private',
          file_category: 'upload',
        })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/files/') && pathname.endsWith('/download') && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const fileId = pathname.split('/')[3];
      const r = await fetchFromService(
        `${factRetrievalUrl}/internal/files/${encodeURIComponent(fileId)}/download?user_id=${encodeURIComponent(toPortalFileOwnerUserId(session))}`
      );
      if (r.status === 200 && typeof r.data === 'object' && r.data) {
        const data = r.data as Record<string, unknown>;
        res.setHeader('Content-Type', String(data.mime_type || 'application/octet-stream'));
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(String(data.original_name || 'file.bin'))}"`);
        res.end(Buffer.from(String(data.buffer_b64 || ''), 'base64'));
        return;
      }
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/files/') && pathname.endsWith('/share') && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const fileId = pathname.split('/')[3];
      const body = await readJson(req);
      const r = await fetchFromService(`${factRetrievalUrl}/internal/files/${encodeURIComponent(fileId)}/share`, {
        method: 'POST',
        body: JSON.stringify({ scope: String(body.scope || 'shared'), requested_by: toPortalFileOwnerUserId(session) })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/files/') && method === 'DELETE') {
      const session = await requireSession(req, res);
      if (!session) return;
      const fileId = pathname.split('/')[3];
      const r = await fetchFromService(`${factRetrievalUrl}/internal/files/${encodeURIComponent(fileId)}?user_id=${encodeURIComponent(toPortalFileOwnerUserId(session))}`, { method: 'DELETE' });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/policies' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const orgId = url.searchParams.get('org_id') || session.org_id;
        const result = await pool.query(
          `SELECT * FROM org_policy WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [orgId]
        );
        sendJson(res, 200, { ok: true, policies: result.rows });
      } catch (error) {
        logger.error('policies.query_failed', 'Policy query failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/policies' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const body = await readJson(req);
      try {
        const orgId = body.org_id || session.org_id;
        await pool.query(
          `INSERT INTO org_policy (org_id, role, resource, action, decision) VALUES ($1, $2, $3, $4, $5)`,
          [orgId, body.role || 'user', body.resource || '*', body.action || 'read', body.decision || 'allow']
        );
        await auditWriter.write({ action: 'policy.create', user_id: session.user_id, resource_type: 'org_policy', resource_ref: 'new', resource_scope: `org:${orgId}`, result: 'success', detail_json: {} });
        sendJson(res, 200, { ok: true });
      } catch (error) {
        logger.error('policies.create_failed', 'Policy create failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    if (pathname === '/api/admin/organization-invitations' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT * FROM org_invitation WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [session.org_id]
        );
        sendJson(res, 200, { ok: true, invitations: result.rows });
      } catch {
        sendJson(res, 200, { ok: true, invitations: [] });
      }
      return;
    }

    if (pathname === '/api/admin/organization-members' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT u.id, u.username, u.display_name, u.role, u.status, u.org_id, u.created_at
           FROM "user" u WHERE u.org_id = $1 AND u.status = 'active'
           ORDER BY u.username LIMIT 1000`,
          [session.org_id]
        );
        sendJson(res, 200, { ok: true, members: result.rows });
      } catch (error) {
        logger.error('members.query_failed', 'Members query failed', { error: String(error) });
        sendJson(res, 500, { ok: false, error: 'db_error' });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.error', 'Unhandled request error', { error: String(error), pathname });
    sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
}

async function startServer(): Promise<void> {
  await initRedisSessionStore();
  await checkProductionSecurity();
  try {
    await ensureDefaultAdmin();
  } catch (error) {
    logger.warn('default_admin.ensure_failed', 'Failed to ensure default admin account', { error: String(error) });
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      logger.error('server.request_error', 'Unhandled server error', { error: String(error) });
      try {
        sendJson(res, 500, { ok: false, error: 'internal_error' });
      } catch { /* ignore */ }
    });
  });

  server.listen(port, () => {
    logger.info('server.started', `Web portal server listening on port ${port}`);
  });

  startTaskScheduler();
  startDreamScheduler();

  const sessionCleanupInterval = setInterval(() => {
    evictExpiredSessions();
    cleanupLoginAttempts();
  }, 5 * 60 * 1000);

  const shutdown = () => {
    logger.info('server.shutdown', 'Shutting down server...');
    stopTaskScheduler();
    stopDreamScheduler();
    clearInterval(sessionCleanupInterval);
    server.close(() => {
      if (dbPool) dbPool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

let taskSchedulerTimer: ReturnType<typeof setInterval> | null = null;

function parseCronToDailyTime(expression: string): { hour: number; minute: number } | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const minuteField = parts[0];
  const hourField = parts[1];

  function parseField(raw: string): number[] {
    const values: number[] = [];
    if (raw === '*') return [];
    const segments = raw.split(',');
    for (const seg of segments) {
      const trimmed = seg.trim();
      if (trimmed === '*') return [];
      if (trimmed.includes('-')) {
        const [lo, hi] = trimmed.split('-').map(Number);
        if (!isNaN(lo) && !isNaN(hi)) {
          for (let v = lo; v <= hi; v++) values.push(v);
        }
      } else {
        const num = parseInt(trimmed, 10);
        if (!isNaN(num)) values.push(num);
      }
    }
    return values;
  }

  const hourValues = parseField(hourField);
  const minuteValues = parseField(minuteField);

  if (hourField === '*' && minuteField !== '*') {
    return { hour: 0, minute: 0 };
  }

  const h = hourField === '*' ? 0 : (hourValues[0] ?? NaN);
  const m = minuteField === '*' ? 0 : (minuteValues[0] ?? NaN);

  if (isNaN(h) || isNaN(m)) return null;
  return { hour: h, minute: m };
}

async function runTaskScheduler(): Promise<void> {
  const pool = await getDbPool();
  if (!pool) return;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  try {
    const tasks = await pool.query(
      `SELECT * FROM org_task WHERE status = 'active' AND schedule_type IN ('daily', 'weekly', 'cron', 'once')`
    );

    for (const task of tasks.rows) {
      let shouldTrigger = false;

      if (task.schedule_type === 'once') {
        const scheduledAt = task.scheduled_at ? new Date(task.scheduled_at) : null;
        if (scheduledAt && now >= scheduledAt) {
          const todayCheck = await pool.query(
            `SELECT id FROM org_task_assignment WHERE task_id = $1 AND created_at >= date_trunc('day', NOW()) LIMIT 1`,
            [task.id]
          );
          if (todayCheck.rows.length === 0) {
            shouldTrigger = true;
          }
        }
      } else if (task.schedule_type === 'daily') {
        const cronExpr = task.cron_expression || '0 20 * * *';
        const time = parseCronToDailyTime(cronExpr);
        if (time && currentHour === time.hour && currentMinute === time.minute) {
          shouldTrigger = true;
        }
      } else if (task.schedule_type === 'weekly') {
        const cronExpr = task.cron_expression || '0 9 * * 1';
        const time = parseCronToDailyTime(cronExpr);
        const dayOfWeek = now.getDay();
        const targetDay = 1;
        if (time && currentHour === time.hour && currentMinute === time.minute && dayOfWeek === targetDay) {
          shouldTrigger = true;
        }
      } else if (task.schedule_type === 'cron' && task.cron_expression) {
        const time = parseCronToDailyTime(task.cron_expression);
        if (time && currentHour === time.hour && currentMinute === time.minute) {
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        logger.info('task_scheduler.triggering', `Triggering task ${task.title}`, { task_id: task.id });

        await fetchFromService(gatewayUrl + '/internal/tasks/assign', {
          method: 'POST',
          body: JSON.stringify({ task_id: task.id }),
        }).catch((err) => {
          logger.warn('task_scheduler.assign_failed', 'Failed to assign task', { task_id: task.id, error: String(err) });
        });

        await fetchFromService(gatewayUrl + '/internal/tasks/notify', {
          method: 'POST',
          body: JSON.stringify({ task_id: task.id }),
        }).catch((err) => {
          logger.warn('task_scheduler.notify_failed', 'Failed to notify task', { task_id: task.id, error: String(err) });
        });

        if (task.schedule_type === 'once') {
          await pool.query(
            `UPDATE org_task SET status = 'archived', updated_at = NOW() WHERE id = $1`,
            [task.id]
          );
        }
      }
    }
  } catch (error) {
    logger.warn('task_scheduler.error', 'Task scheduler iteration failed', { error: String(error) });
  }
}

function startTaskScheduler(): void {
  if (taskSchedulerTimer) return;
  taskSchedulerTimer = setInterval(runTaskScheduler, 60000);
  logger.info('task_scheduler.started', 'Org task cron scheduler started (every 60s)');
  runTaskScheduler();
}

function stopTaskScheduler(): void {
  if (taskSchedulerTimer) {
    clearInterval(taskSchedulerTimer);
    taskSchedulerTimer = null;
  }
}

// ============================================================
// 梦境模式调度器 (Dream Mode Scheduler)
// ============================================================
let dreamSchedulerTimer: ReturnType<typeof setInterval> | null = null;
const dreamSchedulerRuns = new Set<string>();

async function runDreamScheduler(): Promise<void> {
  const pool = await getDbPool();
  if (!pool) return;

  try {
    const configsResult = await pool.query(
      `SELECT * FROM dream_mode_config WHERE enabled = true`
    );
    const configs = configsResult.rows;

    for (const config of configs) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const dayKey = now.toISOString().slice(0, 10);

      // 梦境个人分析：在配置的小时执行
      const userDreamKey = `${config.org_id}:dream_user:${dayKey}:${currentHour}`;
      if (config.dream_scheduled_hour === currentHour && currentMinute < 5 && !dreamSchedulerRuns.has(userDreamKey)) {
        dreamSchedulerRuns.add(userDreamKey);
        // 获取该组织所有活跃用户
        const usersResult = await pool.query(
          `SELECT id FROM "user" WHERE org_id = $1 AND status = 'active' LIMIT 50`,
          [config.org_id]
        );

        let processed = 0;
        for (const user of usersResult.rows) {
          try {
            await fetchFromService(hermesUrl + '/internal/memory/analyze', {
              method: 'POST',
              body: JSON.stringify({ owner_user_id: user.id, org_id: config.org_id }),
            });
            processed++;
            await new Promise(r => setTimeout(r, 2000));
          } catch { /* skip */ }
        }

        if (processed > 0) {
          logger.info('dream_scheduler.user_dreams_completed', 'User dream analysis completed', { org_id: config.org_id, users_processed: processed });
        }
      }

      const orgDreamHour = (Number(config.dream_scheduled_hour) + 1) % 24;
      const orgDreamKey = `${config.org_id}:dream_org:${dayKey}:${orgDreamHour}`;
      if (orgDreamHour === currentHour && currentMinute < 5 && !dreamSchedulerRuns.has(orgDreamKey)) {
        dreamSchedulerRuns.add(orgDreamKey);
        try {
          await fetchFromService(hermesUrl + '/internal/memory/analyze/org', {
            method: 'POST',
            body: JSON.stringify({ org_id: config.org_id }),
          });
          logger.info('dream_scheduler.org_analysis_completed', 'Org memory analysis completed', { org_id: config.org_id });
        } catch (err) {
          logger.warn('dream_scheduler.org_analysis_failed', 'Org memory analysis failed', { error: String(err) });
        }
      }

      const skillAuditKey = `${config.org_id}:skill_audit:${dayKey}:${currentHour}`;
      if (config.skill_audit_enabled && config.skill_audit_scheduled_hour === currentHour && currentMinute < 5 && !dreamSchedulerRuns.has(skillAuditKey)) {
        dreamSchedulerRuns.add(skillAuditKey);
        try {
          await fetchFromService(skillLibraryUrl + '/internal/skills/audit/batch', {
            method: 'POST',
            body: JSON.stringify({ org_id: config.org_id }),
          });
          logger.info('dream_scheduler.skill_audit_completed', 'Skill audit completed', { org_id: config.org_id });
        } catch (err) {
          logger.warn('dream_scheduler.skill_audit_failed', 'Skill audit failed', { error: String(err) });
        }
      }
    }
  } catch (error) {
    logger.warn('dream_scheduler.error', 'Dream scheduler iteration failed', { error: String(error) });
  }
}

function startDreamScheduler(): void {
  if (dreamSchedulerTimer) return;
  dreamSchedulerTimer = setInterval(runDreamScheduler, 120000); // 每 2 分钟检查一次
  logger.info('dream_scheduler.started', 'Dream mode scheduler started (every 120s)');
  runDreamScheduler();
}

function stopDreamScheduler(): void {
  if (dreamSchedulerTimer) {
    clearInterval(dreamSchedulerTimer);
    dreamSchedulerTimer = null;
  }
}

startServer().catch(error => {
  logger.error('server.start_failed', 'Failed to start server', { error: String(error) });
  process.exit(1);
});
