import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { Pool } from 'pg';
import { createLogger, configManager, checkProductionSecurity } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';

const logger = createLogger('web-portal');
const port = Number(process.env.PORT || configManager.getPath<number>('server.port') || 3000);
const gatewayUrl = process.env.GATEWAY_URL || '';
const workflowUrl = process.env.WORKFLOW_URL || '';
const executorUrl = process.env.EXECUTOR_URL || '';
const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || '';
const skillLibraryUrl = process.env.SKILL_LIBRARY_URL || '';
const resourceSchedulerUrl = process.env.RESOURCE_SCHEDULER_URL || '';
const mobileAppUrl = process.env.MOBILE_APP_URL || '';
const hermesUrl = process.env.HERMES_URL || '';

const STATIC_DIR = resolve(__dirname, '../static');

type SessionRole = 'admin' | 'user' | 'guest';

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
    type: 'text' | 'password' | 'number' | 'select';
    options?: string[];
    default?: string;
    sensitive?: boolean;
  }>;
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 10000;
const MAX_AUDIT_ROWS = 500;
const MAX_RETRIEVAL_ROWS = 300;
const ENV_FILE_PATH = process.env.PORTAL_ENV_FILE || resolve(process.cwd(), '.env');
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_COST = 16384;

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

const MAX_BODY_SIZE = 1 * 1024 * 1024;

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'");
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
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'");
    const isHtml = contentType.includes('text/html');
    const cacheControl = isHtml ? 'no-cache' : 'public, max-age=3600';
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
    sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Admin access required' });
    return null;
  }
  return session;
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

function checkLoginRateLimit(identifier: string): { blocked: boolean; retryAfterMs?: number; message?: string } {
  const now = Date.now();
  if (loginAttempts.size > 50000) cleanupLoginAttempts(now);

  const entry = loginAttempts.get(identifier);
  if (!entry) return { blocked: false };

  if (now < entry.lockedUntil) {
    const remaining = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      blocked: true,
      retryAfterMs: entry.lockedUntil - now,
      message: `登录尝试次数过多，请等待 ${remaining} 秒后重试`
    };
  }

  return { blocked: false };
}

function recordLoginFailure(identifier: string): { blocked: boolean; retryAfterMs?: number; message?: string } {
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
      message: `登录尝试次数过多，请等待 ${seconds} 秒后重试`
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
  if (lowerKey.includes('_url') || lowerKey.includes('database')) {
    return maskUrlPassword(value);
  }
  if (fieldType === 'password') return maskSensitive(value, 'password');
  return value;
}

async function fetchFromService(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; data: unknown }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
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
      env[key] = value;
    }
  }
  return env;
}

function saveEnvFile(env: Record<string, string>): void {
  const dir = dirname(ENV_FILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = Object.entries(env).map(([k, v]) => {
    if (v.includes(' ') || v.includes('"') || v.includes("'")) {
      return `${k}="${v.replace(/"/g, '\\"')}"`;
    }
    return `${k}=${v}`;
  });
  writeFileSync(ENV_FILE_PATH, lines.join('\n') + '\n', 'utf8');
}

function validatePasswordStrength(password: string): { valid: boolean; score: number; message: string } {
  if (!password || password.length < 8) {
    return { valid: false, score: 0, message: '密码长度至少8位' };
  }
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  if (score < 3) return { valid: false, score, message: '密码强度不足：需包含大小写字母、数字或特殊字符' };
  if (score < 5) return { valid: true, score, message: '密码强度中等' };
  return { valid: true, score, message: '密码强度良好' };
}

const CONFIG_SECTIONS: ConfigSection[] = [
  {
    key: 'feishu',
    label: '飞书渠道配置',
    fields: [
      { key: 'FEISHU_APP_ID', label: 'App ID', type: 'text' },
      { key: 'FEISHU_APP_SECRET', label: 'App Secret', type: 'password', sensitive: true },
      { key: 'FEISHU_SIGNING_SECRET', label: '签名密钥 (Signing Secret)', type: 'password', sensitive: true },
      { key: 'FEISHU_DOMAIN', label: '域名', type: 'select', options: ['feishu', 'lark'], default: 'feishu' },
    ],
  },
  {
    key: 'wecom',
    label: '企业微信渠道配置',
    fields: [
      { key: 'WECOM_CORP_ID', label: '企业ID (Corp ID)', type: 'text' },
      { key: 'WECOM_TOKEN', label: '回调验证 Token', type: 'password', sensitive: true },
      { key: 'WECOM_ENCODING_AES_KEY', label: '消息加密 AES Key', type: 'password', sensitive: true },
      { key: 'WECOM_AGENT_ID', label: '应用ID (Agent ID)', type: 'text' },
      { key: 'WECOM_SECRET', label: '应用Secret', type: 'password', sensitive: true },
    ],
  },
  {
    key: 'llm',
    label: 'LLM 模型配置',
    fields: [
      { key: 'LITELLM_URL', label: 'LiteLLM 地址', type: 'text', default: 'http://localhost:4000' },
      { key: 'LITELLM_MASTER_KEY', label: 'Master Key', type: 'password', sensitive: true },
      { key: 'LITELLM_MODEL', label: '默认模型', type: 'text', default: 'minimax-m2.7' },
      { key: 'LITELLM_FALLBACK_MODELS', label: '备用模型 (逗号分隔)', type: 'text', default: '' },
    ],
  },
  {
    key: 'embedding',
    label: 'Embedding 模型配置',
    fields: [
      { key: 'EMBEDDING_MODE', label: '模式', type: 'select', options: ['deterministic', 'provider'], default: 'deterministic' },
      { key: 'EMBEDDING_PROVIDER_URL', label: 'Provider URL', type: 'text' },
      { key: 'EMBEDDING_PROVIDER_MODEL', label: 'Provider Model', type: 'text' },
      { key: 'EMBEDDING_PROVIDER_API_KEY', label: 'API Key', type: 'password', sensitive: true },
    ],
  },
  {
    key: 'rerank',
    label: 'Rerank 配置',
    fields: [
      { key: 'RERANK_MODE', label: '模式', type: 'select', options: ['deterministic', 'provider'], default: 'deterministic' },
      { key: 'RERANK_PROVIDER_URL', label: 'Provider URL', type: 'text' },
      { key: 'RERANK_PROVIDER_MODEL', label: 'Provider Model', type: 'text' },
      { key: 'RERANK_PROVIDER_API_KEY', label: 'API Key', type: 'password', sensitive: true },
    ],
  },
];

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
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
      const rateCheck = checkLoginRateLimit(rateLimitKey);
      if (rateCheck.blocked) {
        sendJson(res, 429, { ok: false, error: 'rate_limited', message: rateCheck.message, retry_after_ms: rateCheck.retryAfterMs });
        return;
      }

      const body = await readJson(req);
      const rawUsername = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!rawUsername || !password) {
        sendJson(res, 400, { ok: false, error: 'missing_credentials', message: '用户名和密码不能为空' });
        return;
      }
      const adminOverride = ADMIN_PASSWORD && password === ADMIN_PASSWORD;
      if (!adminOverride) {
        const rateCheck = checkLoginRateLimit(rateLimitKey);
        if (rateCheck.blocked) {
          sendJson(res, 429, { ok: false, error: 'rate_limited', message: rateCheck.message, retry_after_ms: rateCheck.retryAfterMs });
          return;
        }
      }
      if (!adminOverride) {
        let dbPasswordVerified = false;
        try {
          const pool = await getDbPool();
          if (pool) {
            const userResult = await pool.query(
              `SELECT id, username, role, org_id, metadata FROM "user" WHERE username = $1 LIMIT 1`,
              [rawUsername]
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
          const failResult = recordLoginFailure(rateLimitKey);
          if (failResult.blocked) {
            sendJson(res, 429, { ok: false, error: 'rate_limited', message: failResult.message, retry_after_ms: failResult.retryAfterMs });
          } else {
            sendJson(res, 401, { ok: false, error: 'invalid_credentials', message: '用户名或密码错误' });
          }
          return;
        }
      }
      clearLoginAttempts(rateLimitKey);
      await evictExpiredSessions();
      if (sessionStore.size >= MAX_SESSIONS) {
        sendJson(res, 429, { ok: false, error: 'too_many_sessions', message: '会话数已达上限' });
        return;
      }
      const sessionId = randomUUID();
      let userId = rawUsername;
      let role: SessionRole = 'user';
      let orgId: string | null = null;
      try {
        const pool = await getDbPool();
        if (pool) {
          const userResult = await pool.query(
            `SELECT id, role, org_id FROM "user" WHERE username = $1 LIMIT 1`,
            [rawUsername]
          );
          if (userResult.rows.length > 0) {
            userId = String(userResult.rows[0].id);
            role = userResult.rows[0].role === 'admin' ? 'admin' : 'user';
            orgId = userResult.rows[0].org_id || null;
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
      const mustChangePassword = password === 'admin' || password === 'admin123' || password === rawUsername;
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
        sendJson(res, 400, { ok: false, error: 'missing_fields', message: '请输入旧密码和新密码' });
        return;
      }
      const strength = validatePasswordStrength(newPassword);
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
        if (!verifyPassword(oldPassword, storedHash).valid && oldPassword !== ADMIN_PASSWORD) {
          sendJson(res, 401, { ok: false, error: 'invalid_old_password', message: '旧密码不正确' });
          return;
        }
        const newHash = hashPassword(newPassword);
        await pool.query(
          `UPDATE "user" SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{password_hash}', $2::jsonb) WHERE id = $1`,
          [session.user_id, JSON.stringify(newHash)]
        );
        await auditWriter.write({ action: 'user.change_password', user_id: session.user_id, resource_type: 'user', resource_ref: session.user_id, resource_scope: 'system', result: 'success', detail_json: {} });
        sendJson(res, 200, { ok: true, message: '密码修改成功' });
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
      sendJson(res, 200, { ok: true, message: '已退出登录' });
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
        { key: 'database', label: '数据库连接', done: false },
        { key: 'organization', label: '组织创建', done: false },
        { key: 'admin', label: '管理员创建', done: false },
        { key: 'channel', label: '消息渠道', done: false },
        { key: 'llm', label: 'LLM模型', done: false },
        { key: 'embedding', label: '向量模型', done: false },
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
          sendJson(res, 403, { ok: false, error: 'forbidden', message: '仅限本地访问或提供有效 SETUP_TOKEN' });
          return;
        }
      }
      const step = String(body.step || '');
      const pool = await getDbPool();
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'db_unavailable', message: '数据库不可用' });
        return;
      }
      const setupCheck = await pool.query(`SELECT COUNT(*) as cnt FROM organization WHERE status = 'active'`);
      if (Number(setupCheck.rows[0]?.cnt) > 0) {
        const adminCheck = await pool.query(`SELECT COUNT(*) as cnt FROM "user" WHERE role = 'admin' AND status = 'active'`);
        if (Number(adminCheck.rows[0]?.cnt) > 0) {
          sendJson(res, 403, { ok: false, error: 'already_initialized', message: '系统已完成初始化' });
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
          sendJson(res, 400, { ok: false, error: 'missing_password', message: '管理员密码不能为空' });
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
        saveEnvFile(env);
      } else if (step === 'llm') {
        const env = loadEnvFile();
        if (body.litellm_url) env.LITELLM_URL = String(body.litellm_url);
        if (body.litellm_model) env.LITELLM_MODEL = String(body.litellm_model);
        saveEnvFile(env);
      } else if (step === 'embedding') {
        const env = loadEnvFile();
        if (body.embedding_mode) env.EMBEDDING_MODE = String(body.embedding_mode);
        if (body.embedding_provider_url) env.EMBEDDING_PROVIDER_URL = String(body.embedding_provider_url);
        saveEnvFile(env);
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
      const targetUrl = workflowUrl + '/workflows' + (status ? `?status=${encodeURIComponent(status)}` : '');
      const r = await fetchFromService(targetUrl);
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/workflows/') && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const ref = pathname.slice('/api/workflows/'.length);
      const r = await fetchFromService(workflowUrl + '/workflows/' + encodeURIComponent(ref));
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/workflows/create-from-markdown' && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(workflowUrl + '/workflows/create-from-markdown', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/workflows/') && pathname.endsWith('/approval') && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const ref = pathname.slice('/api/workflows/'.length, -'/approval'.length);
      const body = await readJson(req);
      const r = await fetchFromService(workflowUrl + '/workflows/' + encodeURIComponent(ref) + '/approval', { method: 'POST', body: JSON.stringify(body) });
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
        const strength = validatePasswordStrength(newPassword);
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
      const r = await fetchFromService(gatewayUrl + '/admin/organizations');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/organizations' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(gatewayUrl + '/admin/organizations', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/organizations/') && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = pathname.slice('/api/admin/organizations/'.length);
      const r = await fetchFromService(gatewayUrl + '/admin/organizations/' + encodeURIComponent(orgId));
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/organizations/') && method === 'PUT') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = pathname.slice('/api/admin/organizations/'.length);
      const body = await readJson(req);
      const r = await fetchFromService(gatewayUrl + '/admin/organizations/' + encodeURIComponent(orgId), { method: 'PUT', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/organizations/') && method === 'DELETE') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const orgId = pathname.slice('/api/admin/organizations/'.length);
      const r = await fetchFromService(gatewayUrl + '/admin/organizations/' + encodeURIComponent(orgId), { method: 'DELETE' });
      sendJson(res, r.status, r.data);
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
      const r = await fetchFromService(skillLibraryUrl + '/internal/skills', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/skills/') && !pathname.includes('/mirror-') && method === 'GET') {
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

    if (pathname === '/api/admin/config' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const env = loadEnvFile();
      const config: Record<string, string> = {};
      for (const section of CONFIG_SECTIONS) {
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
      sendJson(res, 200, { ok: true, sections: CONFIG_SECTIONS });
      return;
    }

    if (pathname === '/api/admin/config' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const env = loadEnvFile();
      for (const section of CONFIG_SECTIONS) {
        for (const field of section.fields) {
          if (body[field.key] !== undefined) {
            if (field.sensitive && body[field.key] === '****') continue;
            env[field.key] = String(body[field.key]);
          }
        }
      }
      saveEnvFile(env);
      sendJson(res, 200, { ok: true });
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
        if (action === 'analyze') await pool.query('ANALYZE');
        else if (action === 'checkpoint') await pool.query('CHECKPOINT');
        sendJson(res, 200, { ok: true });
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
      const r = await fetchFromService(factRetrievalUrl + '/knowledge/import', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
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
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/shared-knowledge' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(factRetrievalUrl + '/admin/shared-knowledge', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/admin/shared-knowledge/') && method === 'DELETE') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const docId = pathname.slice('/api/admin/shared-knowledge/'.length);
      const r = await fetchFromService(factRetrievalUrl + '/admin/shared-knowledge/' + encodeURIComponent(docId), { method: 'DELETE' });
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
      // TODO: gateway-adapter does not expose '/internal/query' - should query DB directly
      const r = await fetchFromService(gatewayUrl + '/internal/query', {
        method: 'POST',
        body: JSON.stringify({ sql: 'SELECT * FROM dream_mode_config WHERE org_id = $1', params: [session.org_id || '00000000-0000-0000-0000-000000000001'] })
      }).catch(() => null);
      if (r && r.status === 200) {
        const result = r.data as { rows?: Array<Record<string, unknown>> };
        sendJson(res, 200, { ok: true, config: result.rows?.[0] || null });
      } else {
        sendJson(res, 200, { ok: true, config: null });
      }
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
      const r = await fetchFromService(resourceSchedulerUrl + '/admin/quotas');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/quotas' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const r = await fetchFromService(resourceSchedulerUrl + '/admin/quotas', { method: 'POST', body: JSON.stringify(body) });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/quotas/report' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(resourceSchedulerUrl + '/admin/quotas/report');
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname === '/api/admin/quotas/inspect' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const r = await fetchFromService(resourceSchedulerUrl + '/admin/quotas/inspect', { method: 'POST' });
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
      const modelsJson = env.LLM_MODELS || process.env.LLM_MODELS || '[]';
      try {
        const models = JSON.parse(modelsJson);
        const sanitizedModels = (models as Array<Record<string, unknown>>).map((m: Record<string, unknown>) => ({
          ...m,
          url: maskUrlPassword(String(m.url || '')),
          api_key: String(m.api_key || '') ? '********' : ''
        }));
        sendJson(res, 200, { ok: true, models: sanitizedModels });
      } catch {
        const litellmUrl = maskUrlPassword(env.LITELLM_URL || process.env.LITELLM_URL || 'http://localhost:4000');
        const litellmKey = env.LITELLM_MASTER_KEY || process.env.LITELLM_MASTER_KEY || '';
        const defaultModel = env.LITELLM_MODEL || process.env.LITELLM_MODEL || 'minimax-m2.7';
        const fallbackStr = env.LITELLM_FALLBACK_MODELS || process.env.LITELLM_FALLBACK_MODELS || '';
        const fallbacks = fallbackStr ? fallbackStr.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        const models = [
          { id: 'model-0', name: defaultModel, url: litellmUrl, api_key: litellmKey ? '********' : '', priority: 1, is_fallback: false },
          ...fallbacks.map((m: string, i: number) => ({
            id: 'model-' + (i + 1), name: m, url: litellmUrl, api_key: litellmKey ? '********' : '', priority: i + 2, is_fallback: true,
          })),
        ];
        sendJson(res, 200, { ok: true, models });
      }
      return;
    }

    if (pathname === '/api/admin/llm-models' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      if (!name) { sendJson(res, 400, { ok: false, error: 'missing_name', message: '模型名称不能为空' }); return; }
      const env = loadEnvFile();
      let models: Array<Record<string, unknown>> = [];
      try { models = JSON.parse(env.LLM_MODELS || process.env.LLM_MODELS || '[]'); } catch { /* ignore */ }
      const newId = 'model-' + Date.now();
      const newModel = {
        id: newId,
        name,
        url: String(body.url || env.LITELLM_URL || process.env.LITELLM_URL || 'http://localhost:4000'),
        api_key: String(body.api_key || ''),
        priority: models.length + 1,
        is_fallback: models.length > 0,
        max_tokens: body.max_tokens || undefined,
        temperature: body.temperature || undefined,
      };
      models.push(newModel);
      env.LLM_MODELS = JSON.stringify(models);
      if (models.length > 0 && !env.LITELLM_MODEL) env.LITELLM_MODEL = models[0].name as string;
      const fallbackNames = models.slice(1).map((m: Record<string, unknown>) => m.name).join(',');
      if (fallbackNames) env.LITELLM_FALLBACK_MODELS = fallbackNames;
      saveEnvFile(env);
      sendJson(res, 200, { ok: true, model: newModel });
      return;
    }

    if (pathname === '/api/admin/llm-models/reorder' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const order = body.order as string[] | undefined;
      if (!order || !Array.isArray(order)) { sendJson(res, 400, { ok: false, error: 'invalid_order' }); return; }
      const env = loadEnvFile();
      let models: Array<Record<string, unknown>> = [];
      try { models = JSON.parse(env.LLM_MODELS || process.env.LLM_MODELS || '[]'); } catch { /* ignore */ }
      const reordered = order.map((id: string, idx: number) => {
        const found = models.find((m: Record<string, unknown>) => m.id === id);
        if (!found) return null;
        return { ...found, priority: idx + 1, is_fallback: idx > 0 };
      }).filter(Boolean) as Array<Record<string, unknown>>;
      if (reordered.length === 0) { sendJson(res, 400, { ok: false, error: 'no_valid_models' }); return; }
      env.LLM_MODELS = JSON.stringify(reordered);
      env.LITELLM_MODEL = reordered[0].name as string;
      const fallbackNames = reordered.slice(1).map((m: Record<string, unknown>) => m.name).join(',');
      env.LITELLM_FALLBACK_MODELS = fallbackNames || '';
      saveEnvFile(env);
      sendJson(res, 200, { ok: true, models: reordered });
      return;
    }

    if (pathname.startsWith('/api/admin/llm-models/') && method === 'DELETE') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const modelId = pathname.slice('/api/admin/llm-models/'.length);
      const env = loadEnvFile();
      let models: Array<Record<string, unknown>> = [];
      try { models = JSON.parse(env.LLM_MODELS || process.env.LLM_MODELS || '[]'); } catch { /* ignore */ }
      const filtered = models.filter((m: Record<string, unknown>) => m.id !== modelId);
      if (filtered.length === models.length) { sendJson(res, 404, { ok: false, error: 'model_not_found' }); return; }
      filtered.forEach((m: Record<string, unknown>, i: number) => { m.priority = i + 1; m.is_fallback = i > 0; });
      env.LLM_MODELS = JSON.stringify(filtered);
      if (filtered.length > 0) env.LITELLM_MODEL = filtered[0].name as string;
      const fallbackNames = filtered.slice(1).map((m: Record<string, unknown>) => m.name).join(',');
      env.LITELLM_FALLBACK_MODELS = fallbackNames || '';
      saveEnvFile(env);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/admin/container-stats' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const containerStats: Array<Record<string, unknown>> = [];
      try {
        const { execFileSync } = await import('node:child_process');
        let dockerAvailable = false;
        try { execFileSync('docker', ['info'], { timeout: 5000, stdio: 'pipe' }); dockerAvailable = true; } catch { /* docker not available */ }

        if (dockerAvailable) {
          const psOutput = execFileSync('docker', ['ps', '--format', '{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}'], { timeout: 10000, encoding: 'utf8' });
          const containers = psOutput.trim().split('\n').filter(Boolean);
          for (const line of containers) {
            const [id, name, status, image] = line.split('|');
            if (!id || !name) continue;
            let cpuPct = '0', memPct = '0', memUsage = '-', netIo = '-', blockIo = '-';
            try {
              const statsOutput = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}', id], { timeout: 10000, encoding: 'utf8' });
              const parts = statsOutput.trim().split('|');
              if (parts.length >= 5) { cpuPct = parts[0].trim(); memPct = parts[1].trim(); memUsage = parts[2].trim(); netIo = parts[3].trim(); blockIo = parts[4].trim(); }
            } catch { /* stats unavailable for this container */ }
            containerStats.push({ id, name, status, image, cpu_percent: cpuPct, memory_percent: memPct, memory_usage: memUsage, net_io: netIo, block_io: blockIo });
          }
        }
      } catch (error) {
        logger.warn('container_stats.error', 'Failed to collect container stats', { error: String(error) });
      }
      sendJson(res, 200, { ok: true, containers: containerStats, docker_available: containerStats.length > 0, timestamp: new Date().toISOString() });
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
        sendJson(res, 404, { ok: false, error: 'skill_not_found', message: '技能不存在或服务不可用' });
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

    if (pathname === '/api/admin/service-status-history' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      try {
        const result = await pool.query(
          `SELECT * FROM service_status_event ORDER BY occurred_at DESC LIMIT 100`
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
      let url = `${factRetrievalUrl}/internal/files?owner_user_id=${encodeURIComponent(session.user_id)}&limit=${limit}&offset=${offset}`;
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
          owner_user_id: session.user_id,
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
        `${factRetrievalUrl}/internal/files/${encodeURIComponent(fileId)}/download?user_id=${encodeURIComponent(session.user_id)}`
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
        body: JSON.stringify({ scope: String(body.scope || 'shared'), requested_by: session.user_id })
      });
      sendJson(res, r.status, r.data);
      return;
    }

    if (pathname.startsWith('/api/files/') && method === 'DELETE') {
      const session = await requireSession(req, res);
      if (!session) return;
      const fileId = pathname.split('/')[3];
      const r = await fetchFromService(`${factRetrievalUrl}/internal/files/${encodeURIComponent(fileId)}?user_id=${encodeURIComponent(session.user_id)}`, { method: 'DELETE' });
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

      // 梦境个人分析：在配置的小时执行
      if (config.dream_scheduled_hour === currentHour && currentMinute < 5) {
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
              body: JSON.stringify({ user_id: user.id, org_id: config.org_id }),
            });
            processed++;
            await new Promise(r => setTimeout(r, 2000));
          } catch { /* skip */ }
        }

        if (processed > 0) {
          logger.info('dream_scheduler.user_dreams_completed', 'User dream analysis completed', { org_id: config.org_id, users_processed: processed });
        }

        if (currentMinute >= 55) {
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
      }

      if (config.skill_audit_enabled && config.skill_audit_scheduled_hour === currentHour && currentMinute < 5) {
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
