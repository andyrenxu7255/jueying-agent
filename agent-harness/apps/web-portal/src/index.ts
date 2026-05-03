import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, dirname } from 'node:path';
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
const MAX_WORKFLOW_ROWS = 500;
const MAX_RETRIEVAL_ROWS = 300;
const MAX_USER_ROWS = 1000;
const ENV_FILE_PATH = process.env.PORTAL_ENV_FILE || resolve(process.cwd(), '.env');
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_COST = 16384;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_COST }).toString('hex');
  return `scrypt:${SCRYPT_COST}:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith('scrypt:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return false;
    const cost = Number(parts[1]);
    const salt = parts[2];
    const expected = parts[3];
    const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, { N: cost || SCRYPT_COST }).toString('hex');
    try {
      return timingSafeEqual(Buffer.from(derived), Buffer.from(expected));
    } catch {
      return false;
    }
  }
  if (storedHash.startsWith('sha256:')) {
    const plain = storedHash.slice(7);
    const computed = createHash('sha256').update(password).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(plain), Buffer.from(computed));
    } catch {
      return false;
    }
  }
  const computed = createHash('sha256').update(password).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(storedHash), Buffer.from(computed));
  } catch {
    return false;
  }
}

const sessionStore = new Map<string, Session>();

const REDIS_URL = process.env.REDIS_URL || '';
let redisClient: { get(key: string): Promise<string | null>; set(key: string, value: string, mode?: string, duration?: number): Promise<string | null>; del(key: string): Promise<number> } | null = null;

async function initRedisSessionStore(): Promise<void> {
  if (!REDIS_URL) return;
  try {
    const redis = await import('redis') as any;
    const client = redis.createClient({ url: REDIS_URL });
    client.on('error', (err: Error) => logger.warn('redis.session.error', 'Redis session store error', { error: String(err) }));
    await client.connect();
    redisClient = client as never;
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

async function getDbPool(): Promise<Pool | null> {
  if (dbPool) return dbPool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  try {
    dbPool = new Pool({ connectionString: databaseUrl, max: 5 });
    const client = await dbPool.connect();
    client.release();
    logger.info('db.connected', 'Database pool connected');
    return dbPool;
  } catch (error) {
    logger.warn('db.connect_failed', 'Database connection failed', { error: String(error) });
    dbPool = null;
    return null;
  }
}

async function evictExpiredSessions(): Promise<void> {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.created_at > SESSION_TTL_MS) {
      await deleteSessionFromStore(sessionId);
    }
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
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
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html, 'utf8'),
  });
  res.end(html);
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
    if (now > val.lockedUntil && now - (val.lockedUntil - LOGIN_WINDOW_MS) > LOGIN_WINDOW_MS * 2) {
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
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      body: options?.body,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }
    return { status: response.status, data };
  } catch (error) {
    logger.warn('service.fetch_failed', 'Failed to fetch from service', { url, error: String(error) });
    return { status: 502, data: { ok: false, error: 'service_unavailable', message: String(error) } };
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

const CONFIG_SECTIONS: ConfigSection[] = [
  {
    key: 'feishu',
    label: '飞书渠道配置',
    fields: [
      { key: 'FEISHU_APP_ID', label: 'App ID', type: 'text', sensitive: true },
      { key: 'FEISHU_APP_SECRET', label: 'App Secret', type: 'password', sensitive: true },
      { key: 'FEISHU_VERIFICATION_TOKEN', label: 'Verification Token', type: 'password', sensitive: true },
      { key: 'FEISHU_ENCRYPT_KEY', label: 'Encrypt Key', type: 'password', sensitive: true },
      { key: 'FEISHU_DOMAIN', label: '域名', type: 'select', options: ['feishu', 'lark'], default: 'feishu' },
    ],
  },
  {
    key: 'wecom',
    label: '企业微信渠道配置',
    fields: [
      { key: 'WECOM_CORP_ID', label: 'Corp ID', type: 'text', sensitive: true },
      { key: 'WECOM_AGENT_ID', label: 'Agent ID', type: 'text' },
      { key: 'WECOM_SECRET', label: 'Secret', type: 'password', sensitive: true },
      { key: 'WECOM_TOKEN', label: 'Token', type: 'password', sensitive: true },
      { key: 'WECOM_ENCODING_AES_KEY', label: 'AES Key', type: 'password', sensitive: true },
    ],
  },
  {
    key: 'llm',
    label: 'LLM 模型配置',
    fields: [
      { key: 'LITELLM_URL', label: 'LiteLLM 地址', type: 'text', default: 'http://localhost:4000' },
      { key: 'LITELLM_MASTER_KEY', label: 'Master Key', type: 'password', sensitive: true },
      { key: 'LITELLM_MODEL', label: '默认模型', type: 'text', default: 'minimax-m2.7' },
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
      { key: 'EMBEDDING_DIMENSION', label: '维度', type: 'number', default: '1536' },
    ],
  },
  {
    key: 'rerank',
    label: 'Rerank 配置',
    fields: [
      { key: 'RERANK_MODE', label: '模式', type: 'select', options: ['deterministic', 'ollama', 'remote-provider'], default: 'deterministic' },
      { key: 'RERANK_PROVIDER_URL', label: 'Provider URL', type: 'text' },
      { key: 'RERANK_PROVIDER_MODEL', label: 'Provider Model', type: 'text' },
      { key: 'RERANK_PROVIDER_API_KEY', label: 'API Key', type: 'password', sensitive: true },
      { key: 'RERANK_OLLAMA_URL', label: 'Ollama URL', type: 'text' },
      { key: 'RERANK_OLLAMA_MODEL', label: 'Ollama Model', type: 'text' },
    ],
  },
];

function buildHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JueYing</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--surface:#1e293b;--surface2:#334155;--border:#475569;--text:#e2e8f0;--text2:#94a3b8;--primary:#3b82f6;--primary-hover:#2563eb;--success:#22c55e;--warning:#f59e0b;--danger:#ef4444;--info:#06b6d4;--radius:8px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.login-container{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.login-card{background:var(--surface);border-radius:var(--radius);padding:40px;width:100%;max-width:400px;border:1px solid var(--border)}
.login-card h1{text-align:center;margin-bottom:8px;font-size:24px}
.login-card p{text-align:center;color:var(--text2);margin-bottom:24px;font-size:14px}
.app-container{display:flex;min-height:100vh}
.sidebar{width:240px;background:var(--surface);border-right:1px solid var(--border);padding:16px 0;flex-shrink:0;overflow-y:auto}
.sidebar-brand{padding:12px 20px;font-size:18px;font-weight:700;color:var(--primary);border-bottom:1px solid var(--border);margin-bottom:8px}
.sidebar-nav a{display:block;padding:10px 20px;color:var(--text2);text-decoration:none;font-size:14px;transition:all .15s}
.sidebar-nav a:hover,.sidebar-nav a.active{color:var(--text);background:var(--surface2)}
.sidebar-nav a.active{border-left:3px solid var(--primary)}
.sidebar-nav .nav-section{padding:8px 20px 4px;font-size:11px;text-transform:uppercase;color:var(--border);letter-spacing:1px;margin-top:8px}
.main-content{flex:1;padding:24px;overflow-y:auto}
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.page-header h2{font-size:20px;font-weight:600}
.card{background:var(--surface);border-radius:var(--radius);border:1px solid var(--border);padding:20px;margin-bottom:16px}
.card h3{font-size:16px;margin-bottom:12px}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;color:var(--text2);margin-bottom:4px}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:8px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px}
.form-group textarea{min-height:120px;font-family:monospace}
.btn{padding:8px 16px;border-radius:6px;border:none;cursor:pointer;font-size:14px;font-weight:500;transition:all .15s}
.btn-primary{background:var(--primary);color:#fff}
.btn-primary:hover{background:var(--primary-hover)}
.btn-success{background:var(--success);color:#fff}
.btn-danger{background:var(--danger);color:#fff}
.btn-sm{padding:4px 10px;font-size:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border);font-size:13px}
th{color:var(--text2);font-weight:500;font-size:12px;text-transform:uppercase}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
.badge-success{background:rgba(34,197,94,.15);color:var(--success)}
.badge-warning{background:rgba(245,158,11,.15);color:var(--warning)}
.badge-danger{background:rgba(239,68,68,.15);color:var(--danger)}
.badge-info{background:rgba(6,182,212,.15);color:var(--info)}
.tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--border)}
.tab{padding:10px 20px;cursor:pointer;color:var(--text2);font-size:14px;border-bottom:2px solid transparent;transition:all .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--primary);border-bottom-color:var(--primary)}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:var(--surface);border-radius:var(--radius);border:1px solid var(--border);padding:16px}
.stat-card .stat-value{font-size:28px;font-weight:700}
.stat-card .stat-label{font-size:12px;color:var(--text2);margin-top:4px}
.toast{position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:var(--radius);color:#fff;font-size:14px;z-index:9999;animation:slideIn .3s}
.toast-success{background:var(--success)}
.toast-error{background:var(--danger)}
@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
.hidden{display:none!important}
.setup-wizard{max-width:600px;margin:0 auto}
.setup-step{margin-bottom:24px}
.step-indicator{display:flex;gap:8px;margin-bottom:24px}
.step-dot{width:32px;height:32px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text2)}
.step-dot.active{background:var(--primary);color:#fff}
.step-dot.done{background:var(--success);color:#fff}
</style>
</head>
<body>
<div id="app"></div>
<script>
const API_BASE = '';
let currentSession = null;
let currentView = 'dashboard';

function getSessionId() {
  return localStorage.getItem('ah_session_id') || '';
}

async function api(path, options = {}) {
  const sessionId = getSessionId();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (sessionId) headers['x-session-id'] = sessionId;
  try {
    const res = await fetch(API_BASE + path, { ...options, headers });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'network_error', message: e.message } };
  }
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusBadge(status) {
  const map = { running: 'info', completed: 'success', failed: 'danger', paused: 'warning', planned: 'warning', cancelled: 'danger', pending: 'warning', approved: 'success', rejected: 'danger' };
  return '<span class="badge badge-' + (map[status] || 'info') + '">' + escapeHtml(status) + '</span>';
}

async function checkSetup() {
  const r = await api('/api/setup/status');
  return r.ok ? r.data : null;
}

async function checkAuth() {
  const sid = getSessionId();
  if (!sid) return false;
  const r = await api('/api/system/overview');
  if (r.ok) { currentSession = r.data; return true; }
  if (r.status === 401) { localStorage.removeItem('ah_session_id'); return false; }
  return false;
}

function renderLogin() {
  document.getElementById('app').innerHTML = '<div class="login-container"><div class="login-card"><h1>JueYing</h1><p>Agent Harness 管理门户</p><div class="form-group"><label>用户名</label><input type="text" id="login-user" placeholder="admin"></div><div class="form-group"><label>密码</label><input type="password" id="login-pass" placeholder="密码"></div><button class="btn btn-primary" style="width:100%" onclick="doLogin()">登 录</button></div></div>';
  document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) { showToast('请输入用户名和密码', 'error'); return; }
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  if (r.ok && r.data.session_id) {
    localStorage.setItem('ah_session_id', r.data.session_id);
    showToast('登录成功');
    await initApp();
  } else {
    showToast(r.data.message || r.data.error || '登录失败', 'error');
  }
}

function renderSetupWizard(setupStatus) {
  const steps = setupStatus?.steps || [];
  const allDone = steps.every(s => s.done);
  if (allDone) { initApp(); return; }
  const currentStep = steps.findIndex(s => !s.done);
  document.getElementById('app').innerHTML = '<div class="login-container"><div class="login-card setup-wizard"><h1>初始化向导</h1><p>首次使用，请完成以下配置</p><div class="step-indicator">' +
    steps.map((s, i) => '<div class="step-dot ' + (s.done ? 'done' : (i === currentStep ? 'active' : '')) + '">' + (s.done ? '✓' : (i + 1)) + '</div>').join('') +
    '</div><div id="setup-content"></div></div></div>';
  renderSetupStep(currentStep, steps);
}

function renderSetupStep(stepIndex, steps) {
  const content = document.getElementById('setup-content');
  if (stepIndex < 0 || stepIndex >= steps.length) return;
  const step = steps[stepIndex];
  let html = '<div class="setup-step"><h3>' + escapeHtml(step.label) + '</h3><p style="color:var(--text2);margin-bottom:16px">' + escapeHtml(step.description || '') + '</p>';
  if (step.key === 'organization') {
    html += '<div class="form-group"><label>组织名称</label><input type="text" id="setup-org-name" value="default"></div>';
    html += '<div class="form-group"><label>显示名称</label><input type="text" id="setup-org-display" value="Default Organization"></div>';
  } else if (step.key === 'admin') {
    html += '<div class="form-group"><label>管理员用户名</label><input type="text" id="setup-admin-user" value="admin"></div>';
    html += '<div class="form-group"><label>管理员密码</label><input type="password" id="setup-admin-pass"></div>';
  } else if (step.key === 'channel') {
    html += '<div class="form-group"><label>飞书 App ID</label><input type="text" id="setup-feishu-app-id"></div>';
    html += '<div class="form-group"><label>飞书 App Secret</label><input type="password" id="setup-feishu-app-secret"></div>';
    html += '<p style="color:var(--text2);font-size:12px;margin:8px 0">渠道配置可稍后在系统配置中完成</p>';
  } else if (step.key === 'llm') {
    html += '<div class="form-group"><label>LiteLLM 地址</label><input type="text" id="setup-litellm-url" value="http://localhost:4000"></div>';
    html += '<div class="form-group"><label>默认模型</label><input type="text" id="setup-litellm-model" value="minimax-m2.7"></div>';
  } else if (step.key === 'embedding') {
    html += '<div class="form-group"><label>Embedding 模式</label><select id="setup-emb-mode"><option value="deterministic">deterministic</option><option value="provider">provider</option></select></div>';
    html += '<div class="form-group"><label>Provider URL</label><input type="text" id="setup-emb-url"></div>';
  } else {
    html += '<p>此步骤已自动完成或需要手动配置</p>';
  }
  html += '<button class="btn btn-primary" onclick="doSetupStep(' + stepIndex + ')">完成此步骤</button>';
  html += '</div>';
  content.innerHTML = html;
}

async function doSetupStep(stepIndex) {
  const setupStatus = await checkSetup();
  if (!setupStatus) { showToast('无法获取初始化状态', 'error'); return; }
  const step = setupStatus.steps[stepIndex];
  const payload = { step: step.key };
  if (step.key === 'organization') {
    payload.org_name = document.getElementById('setup-org-name')?.value || 'default';
    payload.display_name = document.getElementById('setup-org-display')?.value || '';
  } else if (step.key === 'admin') {
    payload.username = document.getElementById('setup-admin-user')?.value || 'admin';
    payload.password = document.getElementById('setup-admin-pass')?.value || '';
  } else if (step.key === 'channel') {
    payload.feishu_app_id = document.getElementById('setup-feishu-app-id')?.value || '';
    payload.feishu_app_secret = document.getElementById('setup-feishu-app-secret')?.value || '';
  } else if (step.key === 'llm') {
    payload.litellm_url = document.getElementById('setup-litellm-url')?.value || '';
    payload.litellm_model = document.getElementById('setup-litellm-model')?.value || '';
  } else if (step.key === 'embedding') {
    payload.embedding_mode = document.getElementById('setup-emb-mode')?.value || 'deterministic';
    payload.embedding_provider_url = document.getElementById('setup-emb-url')?.value || '';
  }
  const r = await api('/api/setup/initialize', { method: 'POST', body: JSON.stringify(payload) });
  if (r.ok) {
    showToast('步骤完成');
    const newStatus = await checkSetup();
    if (newStatus && newStatus.steps.every(s => s.done)) {
      showToast('初始化完成！请登录');
      renderLogin();
    } else {
      renderSetupWizard(newStatus);
    }
  } else {
    showToast(r.data.message || r.data.error || '操作失败', 'error');
  }
}

function renderApp() {
  const navItems = [
    { section: '概览', items: [{ key: 'dashboard', label: '仪表盘', icon: '&#x1F4CA;' }] },
    { section: '任务', items: [{ key: 'workflows', label: 'Workflow 控制台', icon: '&#x26A1;' }, { key: 'task-input', label: '任务接入', icon: '&#x1F4DD;' }, { key: 'approvals', label: '审批台', icon: '&#x2705;' }] },
    { section: '管理', items: [{ key: 'config', label: '系统配置', icon: '&#x2699;&#xFE0F;' }, { key: 'users', label: '用户管理', icon: '&#x1F465;' }, { key: 'organizations', label: '组织管理', icon: '&#x1F3E2;' }, { key: 'skills', label: '技能管理', icon: '&#x1F527;' }, { key: 'knowledge', label: '知识导入', icon: '&#x1F4DA;' }] },
    { section: '运维', items: [{ key: 'audit', label: '审计日志', icon: '&#x1F4CB;' }, { key: 'retrieval', label: '检索追踪', icon: '&#x1F50D;' }, { key: 'identities', label: '身份绑定', icon: '&#x1F511;' }, { key: 'db-maint', label: '数据库运维', icon: '&#x1F5C4;&#xFE0F;' }, { key: 'resources', label: '资源监控', icon: '&#x1F4CA;' }, { key: 'knowledge-review', label: '知识审核', icon: '&#x1F4DD;' }] },
  ];
  if (currentSession && currentSession.role === 'admin') {
    navItems.push({ section: '共享', items: [{ key: 'shared-knowledge', label: '共享知识库', icon: '&#x1F4E2;' }] });
    navItems.push({ section: '调度', items: [{ key: 'org-tasks', label: '任务分发', icon: '&#x1F4CB;' }] });
  }
  if (currentSession) {
    navItems.push({ section: '我的', items: [{ key: 'my-tasks', label: '我的任务', icon: '&#x270D;&#xFE0F;' }] });
  }
  document.getElementById('app').innerHTML = '<div class="app-container"><div class="sidebar"><div class="sidebar-brand">JueYing</div><nav class="sidebar-nav">' +
    navItems.map(g => '<div class="nav-section">' + g.section + '</div>' + g.items.map(i => '<a href="#" data-view="' + i.key + '" class="' + (currentView === i.key ? 'active' : '') + '">' + i.icon + ' ' + i.label + '</a>').join('')).join('') +
    '</nav><div style="padding:12px 20px;margin-top:auto"><a href="#" onclick="doLogout()" style="color:var(--danger);font-size:13px;text-decoration:none">退出登录</a></div></div><div class="main-content" id="main-content"></div></div>';
  document.querySelectorAll('.sidebar-nav a[data-view]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); currentView = a.dataset.view; document.querySelectorAll('.sidebar-nav a').forEach(x => x.classList.remove('active')); a.classList.add('active'); renderView(); });
  });
  renderView();
}

function renderView() {
  const el = document.getElementById('main-content');
  const renderers = { dashboard: renderDashboard, workflows: renderWorkflows, 'task-input': renderTaskInput, approvals: renderApprovals, config: renderConfig, users: renderUsers, organizations: renderOrganizations, skills: renderSkills, knowledge: renderKnowledge, audit: renderAudit, retrieval: renderRetrieval, identities: renderIdentities, 'db-maint': renderDbMaint, 'shared-knowledge': renderSharedKnowledge, 'org-tasks': renderOrgTasks, 'my-tasks': renderMyTasks, resources: renderResources, 'knowledge-review': renderKnowledgeReview };
  const renderer = renderers[currentView];
  if (renderer) renderer(el); else el.innerHTML = '<p>视图未实现</p>';
}

async function renderDashboard(el) {
  el.innerHTML = '<div class="page-header"><h2>系统总览</h2></div><div class="stat-grid" id="stats-grid"><div class="stat-card"><div class="stat-value">-</div><div class="stat-label">加载中...</div></div></div><div class="card"><h3>服务状态</h3><div id="services-list">加载中...</div></div>';
  const r = await api('/api/system/overview');
  if (r.ok && r.data.overview) {
    const o = r.data.overview;
    const grid = document.getElementById('stats-grid');
    const stats = o.summary || {};
    grid.innerHTML = Object.entries(stats).map(([k, v]) => '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(v)) + '</div><div class="stat-label">' + escapeHtml(k) + '</div></div>').join('');
    const svcList = document.getElementById('services-list');
    if (o.services && o.services.length > 0) {
      svcList.innerHTML = '<table><tr><th>服务</th><th>状态</th><th>延迟</th></tr>' + o.services.map(s => '<tr><td>' + escapeHtml(s.name) + '</td><td>' + statusBadge(s.status) + '</td><td>' + escapeHtml(String(s.latency_ms || '-')) + 'ms</td></tr>').join('') + '</table>';
    } else {
      svcList.innerHTML = '<p style="color:var(--text2)">暂无服务状态信息</p>';
    }
  } else {
    document.getElementById('stats-grid').innerHTML = '<div class="stat-card"><div class="stat-value">⚠</div><div class="stat-label">无法加载概览数据</div></div>';
  }
}

async function renderWorkflows(el) {
  el.innerHTML = '<div class="page-header"><h2>Workflow 控制台</h2><button class="btn btn-primary" onclick="renderView()">刷新</button></div><div class="card"><div id="wf-list">加载中...</div></div>';
  const r = await api('/api/workflows');
  if (r.ok && r.data.workflows) {
    const wfs = r.data.workflows;
    if (wfs.length === 0) {
      document.getElementById('wf-list').innerHTML = '<p style="color:var(--text2)">暂无工作流</p>';
    } else {
      document.getElementById('wf-list').innerHTML = '<table><tr><th>引用</th><th>目标</th><th>状态</th><th>创建时间</th><th>操作</th></tr>' + wfs.map(w => '<tr><td>' + escapeHtml(w.ref || w.id) + '</td><td>' + escapeHtml(w.goal || '-') + '</td><td>' + statusBadge(w.status) + '</td><td>' + escapeHtml(w.created_at || '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="viewWorkflow(\\'' + escapeHtml(w.ref || w.id) + '\\')">详情</button></td></tr>').join('') + '</table>';
    }
  } else {
    document.getElementById('wf-list').innerHTML = '<p style="color:var(--text2)">无法加载工作流列表</p>';
  }
}

async function viewWorkflow(ref) {
  const r = await api('/api/workflows/' + encodeURIComponent(ref));
  const el = document.getElementById('main-content');
  if (r.ok && r.data.workflow) {
    const w = r.data.workflow;
    el.innerHTML = '<div class="page-header"><h2>Workflow: ' + escapeHtml(ref) + '</h2><button class="btn btn-primary" onclick="renderView()">返回</button></div><div class="card"><h3>基本信息</h3><p>目标: ' + escapeHtml(w.goal || '-') + '</p><p>状态: ' + statusBadge(w.status) + '</p><p>创建: ' + escapeHtml(w.created_at || '-') + '</p></div><div class="card"><h3>阶段</h3><div id="wf-stages">加载中...</div></div>';
    if (w.stages && w.stages.length > 0) {
      document.getElementById('wf-stages').innerHTML = '<table><tr><th>序号</th><th>名称</th><th>类型</th><th>状态</th></tr>' + w.stages.map((s, i) => '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(s.name || '-') + '</td><td>' + escapeHtml(s.stage_type || '-') + '</td><td>' + statusBadge(s.status) + '</td></tr>').join('') + '</table>';
    } else {
      document.getElementById('wf-stages').innerHTML = '<p style="color:var(--text2)">暂无阶段信息</p>';
    }
  } else {
    el.innerHTML = '<p>无法加载工作流详情</p>';
  }
}

function renderTaskInput(el) {
  el.innerHTML = '<div class="page-header"><h2>任务接入</h2></div><div class="card"><div class="form-group"><label>任务目标</label><textarea id="task-goal" placeholder="描述您要完成的任务目标..."></textarea></div><div class="form-group"><label>任务类型</label><select id="task-type"><option value="analysis">分析任务</option><option value="research">调研任务</option><option value="execution">执行任务</option><option value="creative">创意任务</option></select></div><div class="form-group"><label>风险等级</label><select id="task-risk"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div><button class="btn btn-primary" onclick="submitTask()">提交任务</button></div>';
}

async function submitTask() {
  const goal = document.getElementById('task-goal')?.value?.trim();
  if (!goal) { showToast('请输入任务目标', 'error'); return; }
  const taskType = document.getElementById('task-type')?.value || 'analysis';
  const riskLevel = document.getElementById('task-risk')?.value || 'low';
  const r = await api('/api/workflows/create-from-markdown', { method: 'POST', body: JSON.stringify({ goal, task_type: taskType, risk_level: riskLevel }) });
  if (r.ok) { showToast('任务已创建'); currentView = 'workflows'; renderView(); }
  else { showToast(r.data.message || r.data.error || '创建失败', 'error'); }
}

async function renderApprovals(el) {
  el.innerHTML = '<div class="page-header"><h2>审批台</h2><button class="btn btn-primary" onclick="renderView()">刷新</button></div><div class="card"><div id="approval-list">加载中...</div></div>';
  const r = await api('/api/workflows?status=pending_approval');
  if (r.ok && r.data.workflows) {
    const wfs = r.data.workflows;
    if (wfs.length === 0) {
      document.getElementById('approval-list').innerHTML = '<p style="color:var(--text2)">暂无待审批项</p>';
    } else {
      document.getElementById('approval-list').innerHTML = '<table><tr><th>引用</th><th>目标</th><th>操作</th></tr>' + wfs.map(w => '<tr><td>' + escapeHtml(w.ref || w.id) + '</td><td>' + escapeHtml(w.goal || '-') + '</td><td><button class="btn btn-sm btn-success" onclick="handleApproval(\\'' + escapeHtml(w.ref) + '\\',\\'approve\\')">批准</button> <button class="btn btn-sm btn-danger" onclick="handleApproval(\\'' + escapeHtml(w.ref) + '\\',\\'reject\\')">驳回</button></td></tr>').join('') + '</table>';
    }
  } else {
    document.getElementById('approval-list').innerHTML = '<p style="color:var(--text2)">无法加载审批列表</p>';
  }
}

async function handleApproval(ref, action) {
  const r = await api('/api/workflows/' + encodeURIComponent(ref) + '/approval', { method: 'POST', body: JSON.stringify({ action }) });
  if (r.ok) showToast('操作成功'); else showToast(r.data.error || '操作失败', 'error');
  renderView();
}

async function renderConfig(el) {
  el.innerHTML = '<div class="page-header"><h2>系统配置</h2></div><div class="tabs" id="config-tabs"></div><div id="config-content"></div>';
  const r = await api('/api/admin/config');
  const config = r.ok ? (r.data.config || {}) : {};
  const tabs = document.getElementById('config-tabs');
  tabs.innerHTML = CONFIG_SECTIONS.map((s, i) => '<div class="tab ' + (i === 0 ? 'active' : '') + '" data-section="' + s.key + '">' + s.label + '</div>').join('');
  tabs.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    renderConfigSection(t.dataset.section, config);
  }));
  renderConfigSection(CONFIG_SECTIONS[0].key, config);
}

const CONFIG_SECTIONS = ${JSON.stringify(CONFIG_SECTIONS)};

function renderConfigSection(sectionKey, config) {
  const section = CONFIG_SECTIONS.find(s => s.key === sectionKey);
  if (!section) return;
  const content = document.getElementById('config-content');
  let html = '<div class="card"><h3>' + escapeHtml(section.label) + '</h3>';
  section.fields.forEach(f => {
    const val = config[f.key] || f.default || '';
    const displayVal = f.sensitive ? '****' : escapeHtml(val);
    if (f.type === 'select') {
      html += '<div class="form-group"><label>' + escapeHtml(f.label) + '</label><select id="cfg-' + f.key + '">' + (f.options || []).map(o => '<option value="' + o + '" ' + (val === o ? 'selected' : '') + '>' + o + '</option>').join('') + '</select></div>';
    } else {
      html += '<div class="form-group"><label>' + escapeHtml(f.label) + '</label><input type="' + f.type + '" id="cfg-' + f.key + '" value="' + displayVal + '" ' + (f.sensitive ? 'placeholder="留空则不修改"' : '') + '></div>';
    }
  });
  html += '<button class="btn btn-primary" onclick="saveConfigSection(\\'' + sectionKey + '\\')">保存配置</button></div>';
  content.innerHTML = html;
}

async function saveConfigSection(sectionKey) {
  const section = CONFIG_SECTIONS.find(s => s.key === sectionKey);
  if (!section) return;
  const updates = {};
  section.fields.forEach(f => {
    const el = document.getElementById('cfg-' + f.key);
    if (el) {
      let val = el.value.trim();
      if (f.sensitive && val === '****') return;
      if (val) updates[f.key] = val;
    }
  });
  const r = await api('/api/admin/config', { method: 'POST', body: JSON.stringify(updates) });
  if (r.ok) showToast('配置已保存，部分配置需重启生效'); else showToast(r.data.error || '保存失败', 'error');
}

async function renderUsers(el) {
  el.innerHTML = '<div class="page-header"><h2>用户管理</h2><button class="btn btn-primary" onclick="showAddUser()">新增用户</button></div><div class="card"><div id="user-list">加载中...</div></div>';
  const r = await api('/api/users');
  if (r.ok && r.data.users) {
    document.getElementById('user-list').innerHTML = '<table><tr><th>用户名</th><th>角色</th><th>状态</th><th>组织</th></tr>' + r.data.users.map(u => '<tr><td>' + escapeHtml(u.username) + '</td><td>' + escapeHtml(u.role) + '</td><td>' + statusBadge(u.status) + '</td><td>' + escapeHtml(u.org_id || '-') + '</td></tr>').join('') + '</table>';
  } else {
    document.getElementById('user-list').innerHTML = '<p style="color:var(--text2)">无法加载用户列表</p>';
  }
}

function showAddUser() {
  const el = document.getElementById('main-content');
  el.innerHTML = '<div class="page-header"><h2>新增用户</h2><button class="btn btn-primary" onclick="renderView()">返回</button></div><div class="card"><div class="form-group"><label>用户名</label><input type="text" id="new-user-name"></div><div class="form-group"><label>密码</label><input type="password" id="new-user-pass"></div><div class="form-group"><label>角色</label><select id="new-user-role"><option value="user">user</option><option value="admin">admin</option></select></div><button class="btn btn-primary" onclick="doAddUser()">创建</button></div>';
}

async function doAddUser() {
  const username = document.getElementById('new-user-name')?.value?.trim();
  const password = document.getElementById('new-user-pass')?.value;
  const role = document.getElementById('new-user-role')?.value || 'user';
  if (!username || !password) { showToast('请填写完整信息', 'error'); return; }
  const r = await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
  if (r.ok) { showToast('用户已创建'); renderView(); } else showToast(r.data.error || '创建失败', 'error');
}

async function renderOrganizations(el) {
  el.innerHTML = '<div class="page-header"><h2>组织管理</h2><button class="btn btn-primary" onclick="showAddOrg()">创建组织</button></div><div class="card"><div id="org-list">加载中...</div></div><div id="org-editor" class="hidden"></div>';
  const r = await api('/api/admin/organizations');
  if (r.ok && r.data.organizations) {
    document.getElementById('org-list').innerHTML = '<table><tr><th>名称</th><th>显示名称</th><th>状态</th><th>配额</th><th>创建时间</th><th>操作</th></tr>' + r.data.organizations.map(o => {
      const settings = o.settings || {};
      const quotaInfo = '用户上限: ' + (settings.max_users || '-') + ' / Workflow/天: ' + (settings.max_workflows_per_day || '-');
      const statusClass = o.status === 'active' ? 'badge-success' : o.status === 'suspended' ? 'badge-warning' : 'badge-danger';
      return '<tr><td>' + escapeHtml(o.org_name) + '</td><td>' + escapeHtml(o.display_name || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(o.status) + '</span></td><td style="font-size:12px;color:var(--text2)">' + escapeHtml(quotaInfo) + '</td><td>' + escapeHtml(o.created_at || '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="showEditOrg(' + JSON.stringify(o.id) + ')">编辑</button> <button class="btn btn-sm btn-danger" onclick="deleteOrg(' + JSON.stringify(o.id) + ',' + JSON.stringify(o.org_name) + ')">删除</button></td></tr>';
    }).join('') + '</table>';
  } else {
    document.getElementById('org-list').innerHTML = '<p style="color:var(--text2)">无法加载组织列表</p>';
  }
}

function showAddOrg() {
  const el = document.getElementById('main-content');
  el.innerHTML = '<div class="page-header"><h2>创建组织</h2><button class="btn btn-primary" onclick="renderView()">返回</button></div><div class="card"><div class="form-group"><label>组织名称</label><input type="text" id="new-org-name"></div><div class="form-group"><label>显示名称</label><input type="text" id="new-org-display"></div><button class="btn btn-primary" onclick="doAddOrg()">创建</button></div>';
}

async function doAddOrg() {
  const org_name = document.getElementById('new-org-name')?.value?.trim();
  const display_name = document.getElementById('new-org-display')?.value?.trim();
  if (!org_name) { showToast('请输入组织名称', 'error'); return; }
  const r = await api('/api/admin/organizations', { method: 'POST', body: JSON.stringify({ org_name, display_name }) });
  if (r.ok) { showToast('组织已创建'); renderView(); } else showToast(r.data.error || '创建失败', 'error');
}

async function showEditOrg(orgId) {
  const r = await api('/api/admin/organizations/' + orgId);
  if (!r.ok) { showToast('无法加载组织信息', 'error'); return; }
  const org = r.data.organization;
  const el = document.getElementById('org-editor');
  const settings = org.settings || {};
  el.innerHTML = '<div class="card"><h3>编辑组织: ' + escapeHtml(org.org_name) + '</h3>' +
    '<div class="form-group"><label>显示名称</label><input type="text" id="edit-org-display" value="' + escapeHtml(org.display_name || '') + '"></div>' +
    '<div class="form-group"><label>状态</label><select id="edit-org-status"><option value="active"' + (org.status === 'active' ? ' selected' : '') + '>active</option><option value="suspended"' + (org.status === 'suspended' ? ' selected' : '') + '>suspended</option><option value="deleted"' + (org.status === 'deleted' ? ' selected' : '') + '>deleted</option></select></div>' +
    '<h4 style="margin-top:16px;margin-bottom:8px;color:var(--text2);font-size:13px">资源配额</h4>' +
    '<div class="form-group"><label>用户上限</label><input type="number" id="edit-org-max-users" value="' + (settings.max_users || 100) + '" min="1"></div>' +
    '<div class="form-group"><label>每日 Workflow 上限</label><input type="number" id="edit-org-max-wf" value="' + (settings.max_workflows_per_day || 500) + '" min="0"></div>' +
    '<button class="btn btn-primary" onclick="doEditOrg(' + JSON.stringify(orgId) + ')">保存修改</button>' +
    ' <button class="btn btn-danger" onclick="document.getElementById(' + JSON.stringify('org-editor') + ').classList.add(' + JSON.stringify('hidden') + ')">取消</button></div>';
  el.classList.remove('hidden');
  window.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
}

async function doEditOrg(orgId) {
  const displayName = document.getElementById('edit-org-display')?.value?.trim();
  const status = document.getElementById('edit-org-status')?.value;
  const maxUsers = parseInt(document.getElementById('edit-org-max-users')?.value || '0', 10);
  const maxWf = parseInt(document.getElementById('edit-org-max-wf')?.value || '0', 10);
  const settings = { max_users: maxUsers, max_workflows_per_day: maxWf };
  const body = {};
  if (displayName !== undefined) body.display_name = displayName;
  if (status) body.status = status;
  body.settings = settings;
  const r = await api('/api/admin/organizations/' + orgId, { method: 'PUT', body: JSON.stringify(body) });
  if (r.ok) { showToast('组织已更新'); document.getElementById('org-editor').classList.add('hidden'); renderView(); }
  else showToast(r.data.error || '更新失败', 'error');
}

async function deleteOrg(orgId, orgName) {
  if (!confirm('确定要删除组织 "' + orgName + '" 吗？此操作将软删除该组织，所有关联用户将无法登录。')) return;
  const r = await api('/api/admin/organizations/' + orgId, { method: 'DELETE' });
  if (r.ok) { showToast('组织已删除'); renderView(); }
  else showToast(r.data.error || '删除失败', 'error');
}

async function renderSharedKnowledge(el) {
  el.innerHTML = '<div class="page-header"><h2>共享知识库</h2><span style="color:var(--text2);font-size:13px">此文件夹中的内容默认对所有租户开放</span></div>' +
    '<div class="card"><h3>上传共享文档</h3>' +
    '<div class="form-group"><label>标题</label><input type="text" id="shared-title" placeholder="文档标题"></div>' +
    '<div class="form-group"><label>内容</label><textarea id="shared-content" style="min-height:160px" placeholder="文档内容..."></textarea></div>' +
    '<div class="form-group"><label>来源类型</label><select id="shared-source"><option value="manual">手动输入</option><option value="template">配置模板</option><option value="guide">操作指南</option><option value="reference">参考文档</option></select></div>' +
    '<button class="btn btn-primary" onclick="doUploadShared()">上传到共享库</button></div>' +
    '<div class="card"><h3>已共享文档列表</h3><div id="shared-list">加载中...</div></div>';
  await loadSharedDocs();
}

async function loadSharedDocs() {
  const el = document.getElementById('shared-list');
  if (!el) return;
  const r = await api('/api/admin/shared-knowledge');
  if (r.ok && r.data.documents) {
    if (r.data.documents.length === 0) {
      el.innerHTML = '<p style="color:var(--text2)">暂无共享文档</p>';
    } else {
      el.innerHTML = '<table><tr><th>标题</th><th>类型</th><th>创建时间</th><th>操作</th></tr>' +
        r.data.documents.map(d => '<tr><td>' + escapeHtml(d.title) + '</td><td>' + escapeHtml(d.source_kind || '-') + '</td><td>' + escapeHtml(d.created_at || '-') + '</td><td><button class="btn btn-sm btn-danger" onclick="deleteSharedDoc(' + JSON.stringify(d.id) + ')">移除</button></td></tr>').join('') + '</table>';
    }
  } else {
    el.innerHTML = '<p style="color:var(--text2)">无法加载共享文档</p>';
  }
}

async function doUploadShared() {
  const title = document.getElementById('shared-title')?.value?.trim();
  const content = document.getElementById('shared-content')?.value?.trim();
  const sourceKind = document.getElementById('shared-source')?.value || 'manual';
  if (!content) { showToast('请输入内容', 'error'); return; }
  const r = await api('/api/admin/shared-knowledge', { method: 'POST', body: JSON.stringify({ title: title || 'Shared Doc', content, source_kind: sourceKind }) });
  if (r.ok) {
    showToast('共享文档已上传');
    document.getElementById('shared-title').value = '';
    document.getElementById('shared-content').value = '';
    await loadSharedDocs();
  } else {
    showToast(r.data.error || '上传失败', 'error');
  }
}

async function deleteSharedDoc(docId) {
  if (!confirm('确定要移除该共享文档吗？')) return;
  const r = await api('/api/admin/shared-knowledge/' + docId, { method: 'DELETE' });
  if (r.ok) { showToast('已移除'); await loadSharedDocs(); }
  else showToast(r.data.error || '移除失败', 'error');
}

async function renderOrgTasks(el) {
  el.innerHTML = '<div class="page-header"><h2>任务分发</h2><button class="btn btn-primary" onclick="showAddOrgTask()">创建新任务</button></div>' +
    '<div class="card" id="org-task-create" style="display:none"><h3>创建组织任务</h3>' +
    '<div class="form-group"><label>任务标题 *</label><input type="text" id="ot-title" placeholder="例如: 每日拜访总结"></div>' +
    '<div class="form-group"><label>描述</label><textarea id="ot-desc" placeholder="任务说明..."></textarea></div>' +
    '<div class="form-group"><label>任务类型</label><select id="ot-type"><option value="form">表单收集</option><option value="workflow">工作流</option><option value="heartbeat">心跳检测</option></select></div>' +
    '<div class="form-group"><label>调度方式</label><select id="ot-schedule" onchange="document.getElementById(' + JSON.stringify('ot-cron-row') + ').style.display=this.value===' + JSON.stringify('cron') + '?' + JSON.stringify('block') + ':' + JSON.stringify('none') + '"><option value="daily">每日</option><option value="weekly">每周</option><option value="once">单次</option><option value="cron">Cron表达式</option></select></div>' +
    '<div class="form-group" id="ot-cron-row" style="display:none"><label>Cron表达式</label><input type="text" id="ot-cron" value="0 20 * * *" placeholder="0 20 * * * (=每天20:00)"><span style="color:var(--text2);font-size:11px">例: 0 20 * * * = 每天8PM</span></div>' +
    '<div class="form-group"><label>提醒消息</label><textarea id="ot-prompt" placeholder="发送给用户的提示文字...">请提交您的每日拜访工作总结:</textarea></div>' +
    '<div class="form-group"><label>目标范围</label><select id="ot-org"><option value="">全部组织</option></select></div>' +
    '<div class="form-group"><label>通知渠道</label><div style="display:flex;gap:8px"><label><input type="checkbox" id="ot-ch-wecom" checked> 企业微信</label></div></div>' +
    '<button class="btn btn-primary" onclick="doCreateOrgTask()">创建并分发</button> <button class="btn btn-danger" onclick="document.getElementById(' + JSON.stringify('org-task-create') + ').style.display=' + JSON.stringify('none') + '">取消</button></div>' +
    '<div class="card"><h3>已有任务</h3><div id="org-task-list">加载中...</div></div>';
  await loadOrgListForTask();
  await loadOrgTasks();
}

async function loadOrgListForTask() {
  const r = await api('/api/admin/organizations');
  const sel = document.getElementById('ot-org');
  if (!sel || !r.ok) return;
  const orgs = r.data.organizations || [];
  sel.innerHTML = '<option value="">全部组织</option>' + orgs.map(o => '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(o.display_name || o.org_name) + '</option>').join('');
}

async function loadOrgTasks() {
  const el = document.getElementById('org-task-list');
  if (!el) return;
  const r = await api('/api/admin/tasks');
  if (r.ok && r.data.tasks) {
    const tasks = r.data.tasks;
    if (tasks.length === 0) {
      el.innerHTML = '<p style="color:var(--text2)">暂无任务</p>';
    } else {
      el.innerHTML = '<table><tr><th>标题</th><th>类型</th><th>调度</th><th>状态</th><th>创建时间</th><th>操作</th></tr>' +
        tasks.map(t => {
          const stats = t.assignment_stats || [];
          const completed = stats.filter((s) => s.status === 'completed').length;
          const total = stats.length;
          return '<tr><td><strong>' + escapeHtml(t.title) + '</strong></td><td>' + escapeHtml(t.task_type) + '</td><td>' + escapeHtml(t.schedule_type) + (t.cron_expression ? ' (' + escapeHtml(t.cron_expression) + ')' : '') + '</td><td>' + escapeHtml(t.status) + (total > 0 ? ' <span style="font-size:11px;color:var(--text2)">(' + completed + '/' + total + ' 完成)</span>' : '') + '</td><td>' + escapeHtml(t.created_at?.slice(0, 10) || '-') + '</td><td>' +
            '<button class="btn btn-sm btn-primary" onclick="triggerOrgTask(' + JSON.stringify(t.id) + ')">立即分发</button> ' +
            (t.status === 'active' ? '<button class="btn btn-sm btn-warning" onclick="pauseOrgTask(' + JSON.stringify(t.id) + ')">暂停</button>' : '') +
            ' <button class="btn btn-sm btn-danger" onclick="archiveOrgTask(' + JSON.stringify(t.id) + ')">归档</button></td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = '<p style="color:var(--text2)">无法加载任务</p>';
  }
}

function showAddOrgTask() { document.getElementById('org-task-create').style.display = 'block'; }

async function doCreateOrgTask() {
  const title = document.getElementById('ot-title')?.value?.trim();
  if (!title) { showToast('请输入标题', 'error'); return; }
  const body: any = {
    title,
    description: document.getElementById('ot-desc')?.value || '',
    task_type: document.getElementById('ot-type')?.value || 'form',
    schedule_type: document.getElementById('ot-schedule')?.value || 'daily',
    prompt_message: document.getElementById('ot-prompt')?.value || '',
    required_fields: ['summary'],
    target_channels: ['wecom'],
    org_id: document.getElementById('ot-org')?.value || null,
    cron_expression: document.getElementById('ot-cron')?.value || '0 20 * * *',
  };
  const r = await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) {
    showToast('任务已创建');
    document.getElementById('org-task-create').style.display = 'none';
    document.getElementById('ot-title').value = '';
    await loadOrgTasks();
  } else showToast(r.data.error || '创建失败', 'error');
}

async function triggerOrgTask(taskId) {
  if (!confirm('确定立即分发此任务到所有用户吗？')) return;
  // Assign
  const r1 = await api('/internal/tasks/assign', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
  // Notify
  const r2 = await api('/internal/tasks/notify', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
  showToast('已分发 ' + ((r1.data)?.assigned || 0) + ' 人, 已通知 ' + ((r2.data)?.notified || 0) + ' 人');
  await loadOrgTasks();
}

async function pauseOrgTask(taskId) {
  await api('/api/admin/tasks/' + taskId, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) });
  showToast('已暂停');
  await loadOrgTasks();
}

async function archiveOrgTask(taskId) {
  if (!confirm('确定归档此任务吗？')) return;
  await api('/api/admin/tasks/' + taskId, { method: 'DELETE' });
  showToast('已归档');
  await loadOrgTasks();
}

async function renderMyTasks(el) {
  el.innerHTML = '<div class="page-header"><h2>我的任务</h2></div><div class="card"><div id="my-task-list">加载中...</div></div>';
  await loadMyTasks();
}

async function loadMyTasks() {
  const el = document.getElementById('my-task-list');
  if (!el) return;
  const r = await api('/api/tasks');
  if (r.ok && r.data.assignments) {
    const items = r.data.assignments;
    if (items.length === 0) {
      el.innerHTML = '<p style="color:var(--text2)">暂无任务</p>';
    } else {
      el.innerHTML = items.map(a => {
        const completed = a.status === 'completed';
        const statusLabel = completed ? '✅ 已完成' : a.status === 'notified' ? '🔔 待反馈' : '⏳ 待通知';
        return '<div class="card" style="margin-bottom:12px"><h4>' + escapeHtml(a.title) + ' <span style="font-size:12px;color:var(--text2)">' + statusLabel + '</span></h4>' +
          '<p style="color:var(--text2);margin:4px 0">' + escapeHtml(a.prompt_message || '') + '</p>' +
          (completed
            ? '<p style="color:var(--success);font-size:12px">已于 ' + escapeHtml(a.completed_at?.slice(0, 16) || '') + ' 提交</p>'
            : '<div class="form-group"><textarea id="task-resp-' + a.id + '" style="min-height:80px" placeholder="请输入您的总结..."></textarea></div>' +
              '<button class="btn btn-primary btn-sm" onclick="submitTaskResponse(' + JSON.stringify(a.id) + ')">提交反馈</button>') +
          '</div>';
      }).join('');
    }
  } else {
    el.innerHTML = '<p style="color:var(--text2)">无法加载任务</p>';
  }
}

async function submitTaskResponse(assignmentId) {
  const textarea = document.getElementById('task-resp-' + assignmentId);
  const summary = textarea?.value?.trim();
  if (!summary) { showToast('请输入内容', 'error'); return; }
  const r = await api('/api/tasks/' + assignmentId + '/submit', { method: 'POST', body: JSON.stringify({ summary }) });
  if (r.ok) { showToast('反馈已提交'); await renderView(); }
  else showToast(r.data.error || '提交失败', 'error');
}

async function renderSkills(el) {
  el.innerHTML = '<div class="page-header"><h2>技能管理</h2><button class="btn btn-primary" onclick="showAddSkill()">创建技能</button></div><div class="card"><div id="skill-list">加载中...</div></div>';
  const r = await api('/api/admin/skills');
  if (r.ok && r.data.skills) {
    document.getElementById('skill-list').innerHTML = '<table><tr><th>名称</th><th>类型</th><th>版本</th><th>状态</th></tr>' + r.data.skills.map(s => '<tr><td>' + escapeHtml(s.skill_name) + '</td><td>' + escapeHtml(s.skill_type || '-') + '</td><td>' + escapeHtml(String(s.version || 1)) + '</td><td>' + statusBadge(s.status || 'active') + '</td></tr>').join('') + '</table>';
  } else {
    document.getElementById('skill-list').innerHTML = '<p style="color:var(--text2)">无法加载技能列表</p>';
  }
}

function showAddSkill() {
  const el = document.getElementById('main-content');
  el.innerHTML = '<div class="page-header"><h2>创建技能</h2><button class="btn btn-primary" onclick="renderView()">返回</button></div><div class="card"><div class="form-group"><label>技能名称</label><input type="text" id="new-skill-name"></div><div class="form-group"><label>类型</label><input type="text" id="new-skill-type"></div><div class="form-group"><label>描述</label><textarea id="new-skill-desc"></textarea></div><div class="form-group"><label>定义 (JSON)</label><textarea id="new-skill-def">{}</textarea></div><button class="btn btn-primary" onclick="doAddSkill()">创建</button></div>';
}

async function doAddSkill() {
  const name = document.getElementById('new-skill-name')?.value?.trim();
  const type = document.getElementById('new-skill-type')?.value?.trim();
  const description = document.getElementById('new-skill-desc')?.value?.trim();
  const definition = document.getElementById('new-skill-def')?.value?.trim();
  if (!name) { showToast('请输入技能名称', 'error'); return; }
  let parsedDef = {};
  try { parsedDef = JSON.parse(definition || '{}'); } catch { showToast('定义JSON格式错误', 'error'); return; }
  const r = await api('/api/admin/skills', { method: 'POST', body: JSON.stringify({ name, type, description, definition: parsedDef }) });
  if (r.ok) { showToast('技能已创建'); renderView(); } else showToast(r.data.error || '创建失败', 'error');
}

function renderKnowledge(el) {
  el.innerHTML = '<div class="page-header"><h2>知识导入</h2></div><div class="card"><div class="form-group"><label>标题</label><input type="text" id="kb-title"></div><div class="form-group"><label>内容</label><textarea id="kb-content" style="min-height:200px"></textarea></div><div class="form-group"><label>来源类型</label><select id="kb-source-type"><option value="manual">手动输入</option><option value="document">文档</option><option value="conversation">对话</option></select></div><div class="form-group"><label>可见范围</label><select id="kb-scope"><option value="private">私有</option><option value="public">公开</option></select></div><div class="form-group"><label><input type="checkbox" id="kb-extract" checked> 自动抽取实体和关系</label></div><button class="btn btn-primary" onclick="doImportKnowledge()">导入</button></div>';
}

async function doImportKnowledge() {
  const title = document.getElementById('kb-title')?.value?.trim();
  const content = document.getElementById('kb-content')?.value?.trim();
  if (!content) { showToast('请输入内容', 'error'); return; }
  const r = await api('/api/knowledge/import', { method: 'POST', body: JSON.stringify({ title, content, source_type: document.getElementById('kb-source-type')?.value || 'manual', scope: document.getElementById('kb-scope')?.value || 'private', auto_extract: document.getElementById('kb-extract')?.checked ?? true }) });
  if (r.ok) { showToast('知识已导入'); document.getElementById('kb-title').value = ''; document.getElementById('kb-content').value = ''; } else showToast(r.data.error || '导入失败', 'error');
}

async function renderAudit(el) {
  el.innerHTML = '<div class="page-header"><h2>审计日志</h2><button class="btn btn-primary" onclick="renderView()">刷新</button></div><div class="card"><div id="audit-list">加载中...</div></div>';
  const r = await api('/api/admin/audit');
  if (r.ok && r.data.events) {
    document.getElementById('audit-list').innerHTML = '<table><tr><th>时间</th><th>操作</th><th>用户</th><th>详情</th></tr>' + r.data.events.map(e => '<tr><td>' + escapeHtml(e.occurred_at || '-') + '</td><td>' + escapeHtml(e.action) + '</td><td>' + escapeHtml(e.user_id || '-') + '</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(JSON.stringify(e.detail_json || {}).substring(0, 100)) + '</td></tr>').join('') + '</table>';
  } else {
    document.getElementById('audit-list').innerHTML = '<p style="color:var(--text2)">无法加载审计日志</p>';
  }
}

async function renderRetrieval(el) {
  el.innerHTML = '<div class="page-header"><h2>检索追踪</h2><button class="btn btn-primary" onclick="renderView()">刷新</button></div><div class="card"><div id="retrieval-list">加载中...</div></div>';
  const r = await api('/api/admin/retrieval-traces');
  if (r.ok && r.data.traces) {
    document.getElementById('retrieval-list').innerHTML = '<table><tr><th>时间</th><th>查询</th><th>结果数</th><th>降级</th></tr>' + r.data.traces.map(t => '<tr><td>' + escapeHtml(t.created_at || '-') + '</td><td>' + escapeHtml((t.query_text || '').substring(0, 50)) + '</td><td>' + escapeHtml(String(t.items_count || 0)) + '</td><td>' + (t.degraded ? '<span class="badge badge-warning">是</span>' : '<span class="badge badge-success">否</span>') + '</td></tr>').join('') + '</table>';
  } else {
    document.getElementById('retrieval-list').innerHTML = '<p style="color:var(--text2)">无法加载检索追踪</p>';
  }
}

async function renderIdentities(el) {
  el.innerHTML = '<div class="page-header"><h2>身份绑定管理</h2><button class="btn btn-primary" onclick="renderView()">刷新</button></div><div class="card"><div id="identity-list">加载中...</div></div>';
  const r = await api('/api/channels/identity');
  if (r.ok && r.data.identities) {
    document.getElementById('identity-list').innerHTML = '<table><tr><th>渠道</th><th>外部ID</th><th>状态</th><th>操作</th></tr>' + r.data.identities.map(i => '<tr><td>' + escapeHtml(i.channel_type) + '</td><td>' + escapeHtml(i.external_identity || '-') + '</td><td>' + statusBadge(i.binding_status) + '</td><td>' + (i.binding_status === 'pending' || i.binding_status === 'conflicted' ? '<button class="btn btn-sm btn-primary" onclick="rebindIdentity(\\'' + escapeHtml(i.id) + '\\')">绑定</button>' : '-') + '</td></tr>').join('') + '</table>';
  } else {
    document.getElementById('identity-list').innerHTML = '<p style="color:var(--text2)">无法加载身份列表</p>';
  }
}

async function rebindIdentity(id) {
  const r = await api('/api/channels/identity/' + id + '/rebind', { method: 'POST' });
  if (r.ok) showToast('绑定成功'); else showToast(r.data.error || '绑定失败', 'error');
  renderView();
}

async function renderDbMaint(el) {
  el.innerHTML = '<div class="page-header"><h2>数据库运维</h2></div><div class="card"><h3>数据库统计</h3><div id="db-stats">加载中...</div></div><div class="card"><h3>维护操作</h3><button class="btn btn-primary" onclick="dbMaintain(\\'analyze\\')" style="margin-right:8px">ANALYZE</button><button class="btn btn-primary" onclick="dbMaintain(\\'checkpoint\\')">CHECKPOINT</button></div>';
  const r = await api('/api/admin/db/stats');
  if (r.ok && r.data.stats) {
    const s = r.data.stats;
    document.getElementById('db-stats').innerHTML = '<p>连接数: ' + escapeHtml(String(s.connections || '-')) + '</p><p>数据库大小: ' + escapeHtml(s.db_size || '-') + '</p><p>表数量: ' + escapeHtml(String(s.table_count || '-')) + '</p>';
  } else {
    document.getElementById('db-stats').innerHTML = '<p style="color:var(--text2)">无法获取数据库统计</p>';
  }
}

async function dbMaintain(action) {
  const r = await api('/api/admin/db/maintenance', { method: 'POST', body: JSON.stringify({ action }) });
  if (r.ok) showToast('操作完成'); else showToast(r.data.error || '操作失败', 'error');
}

function doLogout() {
  localStorage.removeItem('ah_session_id');
  currentSession = null;
  renderLogin();
}

// ─── 知识审核台渲染器 ───
// 展示待审核的知识条目（unconfirmed状态），支持批准/拒绝/退回/共享
async function renderKnowledgeReview(el) {
  const statusFilter = currentStatusFilter || 'unconfirmed';
  el.innerHTML = '<div class="page-header"><h2>知识审核台</h2>' +
    '<div style="display:flex;gap:8px;">' +
    '<select id="status-filter" onchange="currentStatusFilter=this.value;renderView()"><option value="unconfirmed"' + (statusFilter === 'unconfirmed' ? ' selected' : '') + '>待审核</option><option value="active"' + (statusFilter === 'active' ? ' selected' : '') + '>已批准</option><option value="rejected"' + (statusFilter === 'rejected' ? ' selected' : '') + '>已拒绝</option></select>' +
    '<button class="btn btn-primary" onclick="renderView()">刷新</button></div></div>' +
    '<div class="card"><div id="review-item-list">加载中...</div></div>' +
    '<div class="card" id="review-detail-card" style="display:none"><h3>知识详情</h3><div id="review-detail"></div></div>';

  await loadReviewItems(statusFilter);
}

// 当前过滤状态（在renderView间保持）
let currentStatusFilter = 'unconfirmed';

async function loadReviewItems(status) {
  const list = document.getElementById('review-item-list');
  if (!list) return;

  try {
    const orgId = currentSession ? (currentSession.org_id || '') : '';
    const r = await api('/api/knowledge/review?org_id=' + encodeURIComponent(orgId) + '&status=' + encodeURIComponent(status) + '&limit=50');
    if (!r.ok || !r.data || !r.data.items) {
      list.innerHTML = '<p style="color:var(--text2)">暂无待审核知识条目</p>';
      return;
    }

    const items = r.data.items;
    if (items.length === 0) {
      list.innerHTML = '<p style="color:var(--text2)">暂无' + (status === 'unconfirmed' ? '待审核' : status === 'active' ? '已批准' : '已拒绝') + '的知识条目</p>';
      return;
    }

    list.innerHTML = '<table><tr><th>编号</th><th>内容摘要</th><th>来源</th><th>提交时间</th><th>操作</th></tr>' +
      items.map(item => {
        const preview = (item.object_value || '').substring(0, 80) + ((item.object_value || '').length > 80 ? '...' : '');
        const sourceLabel = item.source === 'user_submitted' ? '用户提交' : (item.source || '系统');
        return '<tr><td>' + escapeHtml(String(item.fact_id || '').substring(0, 12)) + '</td>' +
          '<td>' + escapeHtml(preview) + '</td>' +
          '<td><span class="badge badge-info">' + escapeHtml(sourceLabel) + '</span></td>' +
          '<td style="font-size:12px">' + escapeHtml(String(item.created_at || '')) + '</td>' +
          '<td>' + (status === 'unconfirmed'
            ? '<button class="btn btn-sm btn-success" onclick="reviewAction(\'' + escapeHtml(String(item.fact_id)) + '\',\'approve\')">批准</button> ' +
              '<button class="btn btn-sm btn-primary" onclick="reviewAction(\'' + escapeHtml(String(item.fact_id)) + '\',\'approve_shared\')">共享</button> ' +
              '<button class="btn btn-sm btn-warning" onclick="reviewAction(\'' + escapeHtml(String(item.fact_id)) + '\',\'return\')">退回</button> ' +
              '<button class="btn btn-sm btn-danger" onclick="reviewAction(\'' + escapeHtml(String(item.fact_id)) + '\',\'reject\')">拒绝</button>'
            : '<span class="badge ' + (status === 'active' ? 'badge-success' : 'badge-danger') + '">' + status + '</span>') +
          '</td></tr>';
      }).join('') + '</table>';

    if (r.data.total > 50) {
      list.innerHTML += '<p style="color:var(--text2);margin-top:8px">共 ' + r.data.total + ' 条，显示前 50 条</p>';
    }
  } catch {
    list.innerHTML = '<p style="color:var(--text2)">加载失败，请检查知识检索服务状态</p>';
  }
}

// 知识审核操作: 批准/共享/退回/拒绝
async function reviewAction(factId, action) {
  const actions = {
    approve: '确认批准该知识条目为私有知识？',
    approve_shared: '确认批准并共享给全组织的用户？',
    return: '确认退回该条目，用户可重新编辑提交？',
    reject: '确认拒绝该知识条目？'
  };
  if (!confirm(actions[action] || '确认执行此操作？')) return;

  const r = await api('/api/knowledge/review', {
    method: 'POST',
    body: JSON.stringify({ fact_id: factId, action })
  });
  if (r.ok) {
    showToast('操作成功');
    renderView();
  } else {
    showToast(r.data.error || '操作失败', 'error');
  }
}

// ─── 资源监控视图渲染器 ───
// 展示组织资源配额、使用情况和巡检报告
async function renderResources(el) {
  el.innerHTML = '<div class="page-header"><h2>资源监控</h2><button class="btn btn-primary" onclick="renderView()">刷新</button> <button class="btn btn-primary" onclick="triggerInspection()" style="margin-left:8px">触发巡检</button></div>' +
    '<div class="stat-grid" id="quota-stats-grid"></div>' +
    '<div class="card"><h3>服务巡检报告</h3><div id="inspection-report">加载中...</div></div>' +
    '<div class="card"><h3>配额配置</h3><div id="quota-config">加载中...</div></div>';

  await loadQuotaStats();
  await loadInspectionReport();
  await loadQuotaConfig();
}

// 加载配额统计数据并渲染为统计卡片
async function loadQuotaStats() {
  const grid = document.getElementById('quota-stats-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="stat-card"><div class="stat-value">-</div><div class="stat-label">加载中...</div></div>';

  const r = await api('/api/admin/quotas');
  if (!r.ok || !r.data) {
    grid.innerHTML = '<div class="stat-card"><div class="stat-value">⚠</div><div class="stat-label">无法加载配额数据</div></div>';
    return;
  }
  const quotas = r.data.quotas || r.data || {};
  // 配额维度中文映射
  const labelMap = {
    concurrent_workflows: '并发工作流',
    daily_api_calls: '每日API调用',
    retrieval_queries: '检索查询数',
    execution_seconds: '执行秒数',
    storage_bytes: '存储量(MB)',
    llm_tokens: 'LLM Tokens'
  };
  grid.innerHTML = Object.entries(quotas).map(([k, v]) => {
    const q = v as Record<string, unknown> || {};
    const limit = q.limit || q.max || '-';
    const used = q.used || q.current || 0;
    const label = labelMap[k] || k;
    return '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(used)) + ' / ' + escapeHtml(String(limit)) + '</div><div class="stat-label">' + escapeHtml(label) + '</div></div>';
  }).join('');
}

// 加载服务巡检报告
async function loadInspectionReport() {
  const report = document.getElementById('inspection-report');
  if (!report) return;

  const r = await api('/api/admin/quotas/report');
  if (!r.ok || !r.data || !r.data.report) {
    report.innerHTML = '<p style="color:var(--text2)">暂无巡检报告，点击"触发巡检"生成</p>';
    return;
  }
  const data = r.data.report;
  const results = data.results || data.services || [];
  const inspectedAt = data.inspected_at || data.timestamp || '';
  if (results.length === 0) {
    report.innerHTML = '<p style="color:var(--text2)">暂无巡检数据</p>';
    return;
  }
  report.innerHTML = '<p style="color:var(--text2);font-size:12px;margin-bottom:8px">巡检时间: ' + escapeHtml(String(inspectedAt)) + '</p>' +
    '<table><tr><th>服务</th><th>健康状态</th><th>延迟(ms)</th><th>详情</th></tr>' +
    results.map(s => {
      const statusClass = s.healthy || s.status === 'healthy' ? 'badge-success' : 'badge-danger';
      const statusText = s.healthy || s.status === 'healthy' ? 'healthy' : (s.status || 'unhealthy');
      return '<tr><td>' + escapeHtml(s.service || s.name || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(statusText) + '</span></td><td>' + escapeHtml(String(s.latency_ms || s.latency || '-')) + '</td><td style="font-size:12px">' + escapeHtml(String(s.error || s.detail || '-')) + '</td></tr>';
    }).join('') + '</table>';
}

// 加载配额配置表单
async function loadQuotaConfig() {
  const config = document.getElementById('quota-config');
  if (!config) return;

  const r = await api('/api/admin/quotas');
  if (!r.ok) {
    config.innerHTML = '<p style="color:var(--text2)">无法加载配额配置</p>';
    return;
  }
  const quotas = r.data.quotas || r.data || {};
  const dimensions = [
    { key: 'concurrent_workflows', label: '并发工作流上限' },
    { key: 'daily_api_calls', label: '每日API调用上限' },
    { key: 'retrieval_queries', label: '检索查询上限' },
    { key: 'execution_seconds', label: '执行时长上限(秒)' },
    { key: 'storage_bytes', label: '存储上限(字节)' },
    { key: 'llm_tokens', label: 'LLM Token上限' }
  ];
  config.innerHTML = dimensions.map(d => {
    const q = quotas[d.key] as Record<string, unknown> || {};
    const val = q.limit || q.max || '';
    return '<div class="form-group"><label>' + d.label + '</label><input type="number" id="quota-' + d.key + '" value="' + escapeHtml(String(val)) + '" placeholder="留空则不限制"></div>';
  }).join('') + '<button class="btn btn-primary" onclick="saveQuotaConfig()">保存配额配置</button>';
}

// 保存配额配置到 resource-scheduler
async function saveQuotaConfig() {
  const dimensions = ['concurrent_workflows', 'daily_api_calls', 'retrieval_queries', 'execution_seconds', 'storage_bytes', 'llm_tokens'];
  const quotas: Record<string, number> = {};
  dimensions.forEach(key => {
    const el = document.getElementById('quota-' + key);
    if (el && el.value) {
      quotas[key] = parseInt(el.value, 10);
    }
  });
  const r = await api('/api/admin/quotas', { method: 'POST', body: JSON.stringify({ quotas }) });
  if (r.ok) showToast('配额配置已保存'); else showToast(r.data.error || '保存失败', 'error');
}

// 触发资源巡检
async function triggerInspection() {
  const r = await api('/api/admin/quotas/inspect', { method: 'POST' });
  if (r.ok) {
    showToast('巡检已触发，正在收集数据...');
    setTimeout(() => renderView(), 3000);
  } else {
    showToast(r.data.error || '触发失败', 'error');
  }
}

async function initApp() {
  const isAuth = await checkAuth();
  if (!isAuth) {
    const setup = await checkSetup();
    if (setup && !setup.initialized) {
      renderSetupWizard(setup);
    } else {
      renderLogin();
    }
  } else {
    renderApp();
  }
}

initApp();
</script>
</body>
</html>`;
}

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
      sendHtml(res, buildHtmlPage());
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
              if (storedHash && verifyPassword(password, storedHash)) {
                dbPasswordVerified = true;
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
      await auditWriter.write({ action: 'user.login', user_id: userId, resource_type: 'session', resource_ref: sessionId, resource_scope: 'system', result: 'success', detail_json: { username: rawUsername } });
      sendJson(res, 200, { ok: true, session_id: sessionId, role, org_id: orgId });
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
      const clientIp = req.socket.remoteAddress || '';
      if (!clientIp.includes('127.0.0.1') && !clientIp.includes('::1') && clientIp !== '::ffff:127.0.0.1') {
        if (SETUP_TOKEN) {
          const body = await readJson(req);
          if (body.setup_token !== SETUP_TOKEN) {
            sendJson(res, 403, { ok: false, error: 'forbidden', message: '仅限本地访问或提供有效 SETUP_TOKEN' });
            return;
          }
        }
      }
      const body = await readJson(req);
      const step = String(body.step || '');
      const pool = await getDbPool();
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'db_unavailable', message: '数据库不可用' });
        return;
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
          sendJson(res, 400, { ok: false, error: 'missing_password' });
          return;
        }
        const orgResult = await pool.query(`SELECT id FROM organization WHERE status = 'active' LIMIT 1`);
        const orgId = orgResult.rows[0]?.id || '00000000-0000-0000-0000-000000000001';
        const passwordHash = hashPassword(password);
        await pool.query(
          `INSERT INTO "user" (org_id, username, display_name, role, status, metadata)
           VALUES ($1, $2, $3, 'admin', 'active', $4)
           ON CONFLICT (org_id, username) DO UPDATE SET role = 'admin', status = 'active', metadata = $4`,
          [orgId, username, username, JSON.stringify({ password_hash: passwordHash, source: 'setup_wizard' })]
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
      sendJson(res, 200, { ok: true, step });
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
        }
      } catch { /* ignore */ }
      // 从 resource-scheduler 获取资源使用数据
      let resourceData: Record<string, unknown> | null = null;
      if (resourceSchedulerUrl) {
        try {
          const inspResult = await fetchFromService(resourceSchedulerUrl + '/internal/inspections/report');
          if (inspResult.status === 200 && inspResult.data) {
            resourceData = inspResult.data as Record<string, unknown>;
          }
        } catch { /* ignore */ }
      }
      sendJson(res, 200, { ok: true, overview: { services, summary, resource_data: resourceData } });
      return;
    }

    if (pathname === '/api/workflows' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      try {
        const params = new URLSearchParams();
        if (session.role === 'admin') {
          params.set('limit', String(MAX_WORKFLOW_ROWS));
        } else {
          params.set('owner_user_id', session.user_id);
          params.set('org_id', session.org_id || '');
          params.set('limit', String(MAX_WORKFLOW_ROWS));
        }
        const r = await fetchFromService(workflowUrl + '/internal/workflows?' + params.toString());
        sendJson(res, r.status, r.data);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (pathname === '/api/admin/workflows' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      try {
        const r = await fetchFromService(workflowUrl + '/internal/workflows?limit=' + MAX_WORKFLOW_ROWS);
        sendJson(res, r.status, r.data);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (pathname === '/api/workflows/create-from-markdown' && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const goal = String(body.goal || '').trim();
      if (!goal) {
        sendJson(res, 400, { ok: false, error: 'missing_goal' });
        return;
      }
      try {
        const r = await fetchFromService(workflowUrl + '/internal/workflows/plan', {
          method: 'POST',
          body: JSON.stringify({
            goal,
            task_type_hint: body.task_type || 'analysis',
            risk_level: body.risk_level || 'low',
            owner_user_id: session.user_id,
            org_id: session.org_id,
          }),
        });
        sendJson(res, r.status, r.data);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (pathname.startsWith('/api/workflows/') && pathname.endsWith('/approval') && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const ref = pathname.split('/')[3];
      const body = await readJson(req);
      const action = String(body.action || '');
      if (!['approve', 'reject', 'hold'].includes(action)) {
        sendJson(res, 400, { ok: false, error: 'invalid_action' });
        return;
      }
      try {
        const r = await fetchFromService(workflowUrl + '/internal/workflows/' + encodeURIComponent(ref) + '/approval', {
          method: 'POST',
          body: JSON.stringify({ action, user_id: session.user_id, org_id: session.org_id, role: session.role }),
        });
        sendJson(res, r.status, r.data);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (pathname.startsWith('/api/workflows/') && (pathname.endsWith('/pause') || pathname.endsWith('/resume') || pathname.endsWith('/cancel'))) {
      const session = await requireSession(req, res);
      if (!session) return;
      const parts = pathname.split('/');
      const ref = parts[3];
      const action = parts[4];
      try {
        const r = await fetchFromService(workflowUrl + '/internal/workflows/' + encodeURIComponent(ref) + '/' + action, {
          method: 'POST',
          body: JSON.stringify({ user_id: session.user_id, org_id: session.org_id, role: session.role }),
        });
        sendJson(res, r.status, r.data);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (pathname.startsWith('/api/workflows/') && !pathname.includes('/approval') && !pathname.includes('/pause') && !pathname.includes('/resume') && !pathname.includes('/cancel') && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const ref = pathname.split('/')[3];
      try {
        const params = new URLSearchParams();
        if (session.role !== 'admin') {
          params.set('owner_user_id', session.user_id);
          params.set('org_id', session.org_id || '');
        }
        const queryStr = params.toString();
        const r = await fetchFromService(workflowUrl + '/internal/workflows/' + encodeURIComponent(ref) + (queryStr ? '?' + queryStr : ''));
        sendJson(res, r.status, r.data);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
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

    if (pathname === '/api/admin/config' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const env = loadEnvFile();
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string' && value.trim()) {
          env[key] = String(value);
        }
      }
      saveEnvFile(env);
      await auditWriter.write({ action: 'config.update', user_id: session.user_id, resource_type: 'config', resource_ref: 'system', resource_scope: 'system', result: 'success', detail_json: { keys: Object.keys(body) } });
      sendJson(res, 200, { ok: true, message: '配置已保存，部分配置需重启服务生效' });
      return;
    }

    // ─── 资源监控面板 API ───
    // 获取组织资源配额和使用情况
    if (pathname === '/api/admin/quotas' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      if (!resourceSchedulerUrl) {
        sendJson(res, 200, { ok: true, quotas: [] });
        return;
      }
      try {
        const r = await fetchFromService(resourceSchedulerUrl + '/internal/quotas/' + encodeURIComponent(session.org_id || 'system'));
        sendJson(res, r.status, r.data as Record<string, unknown>);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    // 创建/更新资源配额
    if (pathname === '/api/admin/quotas' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      if (!resourceSchedulerUrl) {
        sendJson(res, 503, { ok: false, error: 'resource_scheduler_unavailable' });
        return;
      }
      const body = await readJson(req);
      try {
        const r = await fetchFromService(resourceSchedulerUrl + '/internal/quotas/create', {
          method: 'POST',
          body: JSON.stringify({
            scope: session.org_id || 'system',
            quotas: body.quotas || body,
            updated_by: session.user_id,
          }),
        });
        sendJson(res, r.status, r.data as Record<string, unknown>);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    // 触发资源巡检
    if (pathname === '/api/admin/quotas/inspect' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      if (!resourceSchedulerUrl) {
        sendJson(res, 503, { ok: false, error: 'resource_scheduler_unavailable' });
        return;
      }
      try {
        const r = await fetchFromService(resourceSchedulerUrl + '/internal/inspections/start', { method: 'POST' });
        sendJson(res, r.status, r.data as Record<string, unknown>);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    // 获取巡检报告
    if (pathname === '/api/admin/quotas/report' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      if (!resourceSchedulerUrl) {
        sendJson(res, 200, { ok: true, report: null });
        return;
      }
      try {
        const r = await fetchFromService(resourceSchedulerUrl + '/internal/inspections/report');
        sendJson(res, r.status, r.data as Record<string, unknown>);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (pathname === '/api/admin/organizations' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT id, org_name, display_name, status, settings, created_at FROM organization ORDER BY created_at DESC`);
      sendJson(res, 200, { ok: true, organizations: result.rows });
      return;
    }

    if (pathname === '/api/admin/organizations' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const orgName = String(body.org_name || '').trim();
      if (!orgName) { sendJson(res, 400, { ok: false, error: 'missing_org_name' }); return; }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `INSERT INTO organization (org_name, display_name, status, settings, metadata) VALUES ($1, $2, 'active', $3, '{}'::jsonb) RETURNING id, org_name, display_name, status`,
        [orgName, String(body.display_name || orgName), JSON.stringify(body.settings || {})]
      );
      await auditWriter.write({ action: 'organization.create', user_id: session.user_id, resource_type: 'organization', resource_ref: orgName, resource_scope: 'system', result: 'success', detail_json: { org_name: orgName } });
      sendJson(res, 201, { ok: true, organization: result.rows[0] });
      return;
    }

    if (method === 'GET') {
      const orgDetailMatch = pathname.match(/^\/api\/admin\/organizations\/([^/]+)$/);
      if (orgDetailMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const orgId = orgDetailMatch[1];
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
        const result = await pool.query(
          `SELECT id, org_name, display_name, status, settings, metadata, created_at, updated_at FROM organization WHERE id = $1 LIMIT 1`,
          [orgId]
        );
        if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }
        sendJson(res, 200, { ok: true, organization: result.rows[0] });
        return;
      }
    }

    if (method === 'PUT') {
      const orgUpdateMatch = pathname.match(/^\/api\/admin\/organizations\/([^/]+)$/);
      if (orgUpdateMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const orgId = orgUpdateMatch[1];
        const body = await readJson(req);
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }

        const existing = await pool.query(`SELECT id FROM organization WHERE id = $1 LIMIT 1`, [orgId]);
        if (existing.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }

        const updates: string[] = [];
        const values: (string | Record<string, unknown>)[] = [];
        let paramIdx = 1;

        const displayName = body.display_name !== undefined ? String(body.display_name).trim() : undefined;
        if (displayName !== undefined) {
          updates.push(`display_name = $${paramIdx++}`);
          values.push(displayName);
        }

        const status = body.status !== undefined ? String(body.status) : undefined;
        if (status && ['active', 'suspended', 'deleted'].includes(status)) {
          updates.push(`status = $${paramIdx++}`);
          values.push(status);
        }

        if (body.settings !== undefined) {
          updates.push(`settings = $${paramIdx++}`);
          values.push(typeof body.settings === 'string' ? JSON.parse(body.settings) : (body.settings as Record<string, unknown>));
        }

        const metadata = body.metadata !== undefined ? body.metadata : undefined;
        if (metadata !== undefined) {
          updates.push(`metadata = $${paramIdx++}`);
          values.push(typeof metadata === 'string' ? JSON.parse(metadata) : (metadata as Record<string, unknown>));
        }

        if (updates.length === 0) { sendJson(res, 400, { ok: false, error: 'no_fields_to_update' }); return; }

        updates.push(`updated_at = NOW()`);
        values.push(orgId);

        const result = await pool.query(
          `UPDATE organization SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, org_name, display_name, status, settings, metadata, updated_at`,
          [...values, orgId]
        );

        await auditWriter.write({ action: 'organization.update', user_id: session.user_id, resource_type: 'organization', resource_ref: orgId, resource_scope: 'system', result: 'success', detail_json: { org_id: orgId, fields: Object.keys(body) } });
        sendJson(res, 200, { ok: true, organization: result.rows[0] });
        return;
      }
    }

    if (method === 'DELETE') {
      const orgDeleteMatch = pathname.match(/^\/api\/admin\/organizations\/([^/]+)$/);
      if (orgDeleteMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const orgId = orgDeleteMatch[1];
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }

        const existing = await pool.query(`SELECT id, org_name FROM organization WHERE id = $1 LIMIT 1`, [orgId]);
        if (existing.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }

        await pool.query(`UPDATE organization SET status = 'deleted', updated_at = NOW() WHERE id = $1`, [orgId]);
        await auditWriter.write({ action: 'organization.delete', user_id: session.user_id, resource_type: 'organization', resource_ref: orgId, resource_scope: 'system', result: 'success', detail_json: { org_id: orgId, org_name: existing.rows[0].org_name } });
        sendJson(res, 200, { ok: true, message: '组织已删除（软删除）' });
        return;
      }
    }

    // ─── Org Task Management ───
    if (pathname === '/api/admin/tasks' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `SELECT t.*, COALESCE(
          (SELECT json_agg(json_build_object('status', a.status)) FROM org_task_assignment a WHERE a.task_id = t.id),
          '[]'::json
        ) AS assignment_stats
         FROM org_task t ORDER BY t.created_at DESC LIMIT 200`
      );
      sendJson(res, 200, { ok: true, tasks: result.rows });
      return;
    }

    if (pathname === '/api/admin/tasks' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const title = String(body.title || '').trim();
      if (!title) { sendJson(res, 400, { ok: false, error: 'missing_title' }); return; }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }

      const taskType = String(body.task_type || 'form');
      if (!['form', 'workflow', 'heartbeat'].includes(taskType)) { sendJson(res, 400, { ok: false, error: 'invalid_task_type' }); return; }
      const scheduleType = String(body.schedule_type || 'daily');
      if (!['once', 'daily', 'weekly', 'cron'].includes(scheduleType)) { sendJson(res, 400, { ok: false, error: 'invalid_schedule_type' }); return; }

      const targetOrgId = body.org_id || null;
      const cronExpression = scheduleType === 'cron' ? String(body.cron_expression || '0 20 * * *') : null;
      const promptMessage = String(body.prompt_message || `请提交您的${title}反馈`);
      const requiredFields = Array.isArray(body.required_fields) ? JSON.stringify(body.required_fields) : '[]';
      const targetChannels = Array.isArray(body.target_channels) ? body.target_channels.map((c: unknown) => String(c)) : ['wecom'];

      const result = await pool.query(
        `INSERT INTO org_task (org_id, created_by, title, description, task_type, schedule_type, cron_expression, status, prompt_message, required_fields, target_channels, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11)
         RETURNING *`,
        [targetOrgId, session.user_id, title, String(body.description || ''), taskType, scheduleType, cronExpression, promptMessage, requiredFields, targetChannels, JSON.stringify(body.metadata || {})]
      );

      await auditWriter.write({ action: 'org_task.create', user_id: session.user_id, resource_type: 'org_task', resource_ref: result.rows[0].id, resource_scope: 'system', result: 'success', detail_json: { title, task_type: taskType, schedule_type: scheduleType } });
      sendJson(res, 201, { ok: true, task: result.rows[0] });
      return;
    }

    if (method === 'PUT') {
      const taskMatch = pathname.match(/^\/api\/admin\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const taskId = taskMatch[1];
        const body = await readJson(req);
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }

        const existing = await pool.query(`SELECT id FROM org_task WHERE id = $1 LIMIT 1`, [taskId]);
        if (existing.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }

        const updates: string[] = [];
        const values: (string | number | null | string[])[] = [];
        let p = 1;

        const setField = <T>(field: string, val: T) => { updates.push(`${field} = $${p++}`); values.push(val as string); };

        if (body.title !== undefined) setField('title', String(body.title).trim());
        if (body.description !== undefined) setField('description', String(body.description));
        if (body.status !== undefined && ['active', 'paused', 'archived'].includes(String(body.status))) setField('status', String(body.status));
        if (body.prompt_message !== undefined) setField('prompt_message', String(body.prompt_message));
        if (body.schedule_type !== undefined) setField('schedule_type', String(body.schedule_type));
        if (body.cron_expression !== undefined) setField('cron_expression', String(body.cron_expression));
        if (body.required_fields !== undefined) setField('required_fields', JSON.stringify(body.required_fields));
        if (body.target_channels !== undefined) setField('target_channels', JSON.stringify(body.target_channels));

        if (updates.length === 0) { sendJson(res, 400, { ok: false, error: 'no_fields' }); return; }
        updates.push(`updated_at = NOW()`);

        const result = await pool.query(
          `UPDATE org_task SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`,
          [...values, taskId]
        );
        sendJson(res, 200, { ok: true, task: result.rows[0] });
        return;
      }
    }

    if (method === 'DELETE') {
      const taskMatch = pathname.match(/^\/api\/admin\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const taskId = taskMatch[1];
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
        await pool.query(`UPDATE org_task SET status = 'archived', updated_at = NOW() WHERE id = $1`, [taskId]);
        await auditWriter.write({ action: 'org_task.archive', user_id: session.user_id, resource_type: 'org_task', resource_ref: taskId, resource_scope: 'system', result: 'success', detail_json: {} });
        sendJson(res, 200, { ok: true, message: '已归档' });
        return;
      }
    }

    // Tenant endpoints
    if (pathname === '/api/tasks' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `SELECT a.id, a.status, a.notified_at, a.completed_at, a.response_data, a.workflow_ref,
                t.id AS task_id, t.title, t.description, t.task_type, t.prompt_message, t.required_fields, t.schedule_type
         FROM org_task_assignment a
         JOIN org_task t ON a.task_id = t.id
         WHERE a.user_id = $1 AND t.status = 'active'
         ORDER BY a.created_at DESC LIMIT 100`,
        [session.user_id]
      );
      sendJson(res, 200, { ok: true, assignments: result.rows });
      return;
    }

    if (method === 'POST') {
      const submitMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/submit$/);
      if (submitMatch) {
        const session = await requireSession(req, res);
        if (!session) return;
        const assignmentId = submitMatch[1];
        const body = await readJson(req);
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }

        const existing = await pool.query(
          `SELECT a.id, a.user_id, a.status FROM org_task_assignment a WHERE a.id = $1 LIMIT 1`,
          [assignmentId]
        );
        if (existing.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }
        if (existing.rows[0].user_id !== session.user_id) { sendJson(res, 403, { ok: false, error: 'forbidden' }); return; }
        if (existing.rows[0].status === 'completed') { sendJson(res, 400, { ok: false, error: 'already_completed' }); return; }

        await pool.query(
          `UPDATE org_task_assignment SET status = 'completed', completed_at = NOW(), response_data = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(body.response_data || { summary: body.summary || body.content || '' }), assignmentId]
        );
        sendJson(res, 200, { ok: true, message: '反馈已提交' });
        return;
      }
    }

    // Internal: assign task to all users (called by cron or admin trigger)
    if (pathname === '/internal/tasks/assign' && method === 'POST') {
      const body = await readJson(req);
      const taskId = String(body.task_id || '');
      if (!taskId) { sendJson(res, 400, { ok: false, error: 'missing_task_id' }); return; }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }

      const taskResult = await pool.query(`SELECT * FROM org_task WHERE id = $1 AND status = 'active' LIMIT 1`, [taskId]);
      if (taskResult.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'task_not_found_or_inactive' }); return; }
      const task = taskResult.rows[0];

      let userQuery: string;
      const userParams: string[] = [];
      if (task.org_id) {
        userQuery = `SELECT u.id, u.org_id, u.username FROM "user" u WHERE u.org_id = $1 AND u.status = 'active'`;
        userParams.push(task.org_id);
      } else {
        userQuery = `SELECT u.id, u.org_id, u.username FROM "user" u WHERE u.status = 'active'`;
      }
      const usersResult = await pool.query(userQuery, userParams as any);
      let assigned = 0;

      for (const user of usersResult.rows) {
        const conflict = await pool.query(
          `SELECT id FROM org_task_assignment WHERE task_id = $1 AND user_id = $2 AND status IN ('pending', 'notified') LIMIT 1`,
          [taskId, user.id]
        );
        if (conflict.rows.length > 0) continue;

        await pool.query(
          `INSERT INTO org_task_assignment (task_id, user_id, org_id, status) VALUES ($1, $2, $3, 'pending')`,
          [taskId, user.id, user.org_id]
        );
        assigned++;
      }

      sendJson(res, 200, { ok: true, assigned, task_title: task.title });
      return;
    }

    // Internal: trigger notification for a specific assignment (called by cron)
    if (pathname === '/internal/tasks/notify' && method === 'POST') {
      const body = await readJson(req);
      const taskId = String(body.task_id || '');
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }

      const taskResult = await pool.query(`SELECT * FROM org_task WHERE id = $1 AND status = 'active' LIMIT 1`, [taskId]);
      if (taskResult.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'task_not_found' }); return; }
      const task = taskResult.rows[0];

      const assignments = await pool.query(
        `SELECT a.id, a.user_id, a.org_id, u.username, u.display_name
         FROM org_task_assignment a
         JOIN "user" u ON a.user_id = u.id
         WHERE a.task_id = $1 AND a.status = 'pending' LIMIT 500`,
        [taskId]
      );

      let notified = 0;
      for (const a of assignments.rows) {
        try {
          // Send notification via gateway for wecom channel
          if (task.target_channels && task.target_channels.includes('wecom')) {
            await fetch(gatewayUrl + '/internal/notify/wecom', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: a.user_id,
                org_id: a.org_id,
                message_type: 'task_reminder',
                content: `📋 **${task.title}**\n${task.prompt_message}\n\n请及时提交您的反馈。`,
                metadata: { task_id: taskId, assignment_id: a.id }
              }),
            }).catch(() => {});
          }

          await pool.query(
            `UPDATE org_task_assignment SET status = 'notified', notified_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [a.id]
          );
          notified++;
        } catch {
          // skip failed notification
        }
      }

      sendJson(res, 200, { ok: true, notified, total: assignments.rows.length });
      return;
    }

    // Shared Knowledge Base - Admin upload/view/delete
    if (pathname === '/api/admin/shared-knowledge' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `SELECT d.id, d.title, d.source_kind, d.status, d.content_hash, d.created_at, d.metadata
         FROM document d
         WHERE d.scope_type = 'shared' AND d.status = 'active'
         ORDER BY d.created_at DESC LIMIT 200`
      );
      sendJson(res, 200, { ok: true, documents: result.rows });
      return;
    }

    if (pathname === '/api/admin/shared-knowledge' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const title = String(body.title || 'Untitled').trim();
      const content = String(body.content || '');
      if (!content) { sendJson(res, 400, { ok: false, error: 'missing_content' }); return; }

      try {
        const indexResult = await fetchFromService(factRetrievalUrl + '/internal/documents/index', {
          method: 'POST',
          body: JSON.stringify({
            title,
            content_text: content,
            source_kind: body.source_kind || 'manual',
            scope_type: 'shared',
            scope: ['shared'],
            owner_user_id: session.user_id,
            org_id: session.org_id,
          }),
        });
        await auditWriter.write({ action: 'shared_knowledge.create', user_id: session.user_id, resource_type: 'document', resource_ref: String((indexResult.data as any)?.document_id || (indexResult.data as any)?.id || ''), resource_scope: 'system', result: 'success', detail_json: { title } });
        sendJson(res, 201, indexResult.data as Record<string, unknown>);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (method === 'DELETE') {
      const sharedDocMatch = pathname.match(/^\/api\/admin\/shared-knowledge\/([^/]+)$/);
      if (sharedDocMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const docId = sharedDocMatch[1];
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
        await pool.query(`UPDATE document SET status = 'deleted', updated_at = NOW() WHERE id = $1 AND scope_type = 'shared'`, [docId]);
        await auditWriter.write({ action: 'shared_knowledge.delete', user_id: session.user_id, resource_type: 'document', resource_ref: docId, resource_scope: 'system', result: 'success', detail_json: {} });
        sendJson(res, 200, { ok: true, message: '已删除' });
        return;
      }
    }

    // Cross-tenant shared knowledge query (for all tenants)
    if (pathname === '/api/knowledge/shared' && method === 'GET') {
      const session = await requireSession(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `SELECT d.id, d.title, d.source_kind, d.status, d.content_hash, d.created_at
         FROM document d
         WHERE d.scope_type = 'shared' AND d.status = 'active'
         ORDER BY d.created_at DESC LIMIT 200`
      );
      sendJson(res, 200, { ok: true, documents: result.rows });
      return;
    }

    // Policies
    if (pathname === '/api/admin/policies' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT id, role, resource, action, status, created_at FROM org_policy ORDER BY created_at DESC`);
      sendJson(res, 200, { ok: true, policies: result.rows });
      return;
    }

    if (pathname === '/api/admin/policies' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const role = String(body.role || 'user');
      const resource = String(body.resource || '');
      const action = String(body.action || '');
      if (!resource || !action) { sendJson(res, 400, { ok: false, error: 'missing_params' }); return; }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `INSERT INTO org_policy (org_id, role, resource, action, status) VALUES ($1, $2, $3, $4, 'active') ON CONFLICT (org_id, role, resource, action) DO UPDATE SET status = 'active', updated_at = NOW() RETURNING id, role, resource, action, status`,
        [session.org_id, role, resource, action]
      );
      await auditWriter.write({ action: 'policy.create', user_id: session.user_id, resource_type: 'policy', resource_ref: String(result.rows[0].id), resource_scope: 'system', result: 'success', detail_json: { role, resource, action } });
      sendJson(res, 201, { ok: true, policy: result.rows[0] });
      return;
    }

    // 知识审核台: 查询待审核/已审核知识列表（代理到 fact-retrieval）
    if (pathname === '/api/knowledge/review' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      if (!factRetrievalUrl) {
        sendJson(res, 503, { ok: false, error: 'fact_retrieval_unavailable' });
        return;
      }
      const url = new URL(req.url || '/', 'http://localhost');
      try {
        const r = await fetchFromService(
          factRetrievalUrl + '/internal/fact/review?org_id=' + encodeURIComponent(session.org_id || '') +
          '&status=' + encodeURIComponent(url.searchParams.get('status') || 'unconfirmed') +
          '&limit=' + encodeURIComponent(url.searchParams.get('limit') || '50') +
          '&offset=' + encodeURIComponent(url.searchParams.get('offset') || '0')
        );
        sendJson(res, r.status, r.data as Record<string, unknown>);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    // 知识审核台: 批准/拒绝/退回知识条目
    if (pathname === '/api/knowledge/review' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      if (!factRetrievalUrl) {
        sendJson(res, 503, { ok: false, error: 'fact_retrieval_unavailable' });
        return;
      }
      const body = await readJson(req);
      try {
        const r = await fetchFromService(factRetrievalUrl + '/internal/fact/review', {
          method: 'POST',
          body: JSON.stringify({
            fact_id: body.fact_id,
            action: body.action,
            reviewer_id: session.user_id,
            review_note: body.review_note || ''
          })
        });
        sendJson(res, r.status, r.data as Record<string, unknown>);
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (method === 'POST') {
      const policyDisableMatch = pathname.match(/^\/api\/admin\/policies\/([^/]+)\/disable$/);
      if (policyDisableMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const policyId = policyDisableMatch[1];
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
        const result = await pool.query(
          `UPDATE org_policy SET status = 'deleted', updated_at = NOW() WHERE id = $1 AND org_id = $2 RETURNING id, role, resource, action, status`,
          [policyId, session.org_id]
        );
        if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }
        await auditWriter.write({ action: 'policy.disable', user_id: session.user_id, resource_type: 'policy', resource_ref: policyId, resource_scope: 'system', result: 'success', detail_json: {} });
        sendJson(res, 200, { ok: true, policy: result.rows[0] });
        return;
      }
    }

    // Organization Invitations
    if (pathname === '/api/admin/organization-invitations' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT id, invitee, role, invite_code, status, expires_at, created_at FROM org_invitation WHERE org_id = $1 ORDER BY created_at DESC`, [session.org_id]);
      sendJson(res, 200, { ok: true, invitations: result.rows });
      return;
    }

    if (pathname === '/api/admin/organization-invitations' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const invitee = String(body.invitee || '').trim();
      const role = String(body.role || 'user');
      const expiresInHours = Number(body.expires_in_hours || 24);
      if (!invitee) { sendJson(res, 400, { ok: false, error: 'missing_invitee' }); return; }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const inviteCode = randomUUID().replace(/-/g, '').substring(0, 12);
      const expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
      const result = await pool.query(
        `INSERT INTO org_invitation (org_id, invitee, role, invite_code, status, expires_at) VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id, invitee, role, invite_code, status, expires_at`,
        [session.org_id, invitee, role, inviteCode, expiresAt]
      );
      await auditWriter.write({ action: 'invitation.create', user_id: session.user_id, resource_type: 'invitation', resource_ref: inviteCode, resource_scope: 'system', result: 'success', detail_json: { invitee, role } });
      sendJson(res, 201, { ok: true, invitation: result.rows[0] });
      return;
    }

    if (method === 'POST') {
      const inviteRevokeMatch = pathname.match(/^\/api\/admin\/organization-invitations\/([^/]+)\/revoke$/);
      if (inviteRevokeMatch) {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const inviteId = inviteRevokeMatch[1];
        const pool = await getDbPool();
        if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
        const result = await pool.query(
          `UPDATE org_invitation SET status = 'revoked', updated_at = NOW() WHERE id = $1 AND org_id = $2 RETURNING id, invitee, role, invite_code, status, expires_at`,
          [inviteId, session.org_id]
        );
        if (result.rows.length === 0) { sendJson(res, 404, { ok: false, error: 'not_found' }); return; }
        await auditWriter.write({ action: 'invitation.revoke', user_id: session.user_id, resource_type: 'invitation', resource_ref: inviteId, resource_scope: 'system', result: 'success', detail_json: {} });
        sendJson(res, 200, { ok: true, invitation: result.rows[0] });
        return;
      }
    }

    // Organization Members
    if (pathname === '/api/admin/organization-members' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT id, username, display_name, role, status FROM "user" WHERE org_id = $1 ORDER BY username`, [session.org_id]);
      sendJson(res, 200, { ok: true, members: result.rows });
      return;
    }

    if (pathname === '/api/admin/skills' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      // 优先使用 skill-library 服务
      if (skillLibraryUrl) {
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/search?q=');
          if (r.status === 200) {
            sendJson(res, 200, { ok: true, skills: (r.data as Record<string, unknown>).skills || (r.data as Record<string, unknown>).items || [] });
            return;
          }
        } catch { /* fallback to DB */ }
      }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT s.id, s.skill_name, s.skill_type, s.scope_type, s.status, s.description, sv.version, sv.definition_json FROM skill s LEFT JOIN LATERAL (SELECT version, definition_json FROM skill_version WHERE skill_id = s.id ORDER BY version DESC LIMIT 1) sv ON true ORDER BY s.skill_name`);
      sendJson(res, 200, { ok: true, skills: result.rows });
      return;
    }

    if (pathname === '/api/admin/skills' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      if (!name) { sendJson(res, 400, { ok: false, error: 'missing_name' }); return; }
      // 优先使用 skill-library 服务
      if (skillLibraryUrl) {
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/create', {
            method: 'POST',
            body: JSON.stringify({
              name,
              skill_type: String(body.type || 'generic'),
              description: String(body.description || ''),
              definition: body.definition || {},
              owner_user_id: session.user_id,
              org_id: session.org_id,
            }),
          });
          if (r.status === 201 || r.status === 200) {
            sendJson(res, 201, r.data as Record<string, unknown>);
            return;
          }
        } catch { /* fallback to DB */ }
      }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `INSERT INTO skill (scope_type, owner_user_id, org_id, skill_name, skill_type, status, description, metadata) VALUES ('org', $1, $2, $3, $4, 'active', $5, '{}'::jsonb) RETURNING id`,
        [session.user_id, session.org_id, name, String(body.type || 'generic'), String(body.description || '')]
      );
      const skillId = result.rows[0].id;
      const defJson = JSON.stringify(body.definition || {});
      const contentHash = createHash('sha256').update(defJson).digest('hex');
      await pool.query(
        `INSERT INTO skill_version (skill_id, version, definition_json, content_hash, status, metadata) VALUES ($1, 1, $2, $3, 'active', '{}'::jsonb)`,
        [skillId, defJson, contentHash]
      );
      await auditWriter.write({ action: 'skill.create', user_id: session.user_id, resource_type: 'skill', resource_ref: name, resource_scope: 'system', result: 'success', detail_json: { name } });
      sendJson(res, 201, { ok: true, skill_id: skillId });
      return;
    }

    // 技能详情、发布、归档等操作代理到 skill-library
    if (skillLibraryUrl) {
      // GET /api/admin/skills/:id - 获取技能详情
      const skillDetailMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)$/);
      if (skillDetailMatch && method === 'GET') {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const skillId = skillDetailMatch[1];
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId));
          sendJson(res, r.status, r.data as Record<string, unknown>);
        } catch {
          sendJson(res, 502, { ok: false, error: 'service_unavailable' });
        }
        return;
      }

      // POST /api/admin/skills/:id/publish - 发布技能
      const skillPublishMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)\/publish$/);
      if (skillPublishMatch && method === 'POST') {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const skillId = skillPublishMatch[1];
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId) + '/publish', { method: 'POST' });
          sendJson(res, r.status, r.data as Record<string, unknown>);
        } catch {
          sendJson(res, 502, { ok: false, error: 'service_unavailable' });
        }
        return;
      }

      // POST /api/admin/skills/:id/archive - 归档技能
      const skillArchiveMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)\/archive$/);
      if (skillArchiveMatch && method === 'POST') {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const skillId = skillArchiveMatch[1];
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId) + '/archive', { method: 'POST' });
          sendJson(res, r.status, r.data as Record<string, unknown>);
        } catch {
          sendJson(res, 502, { ok: false, error: 'service_unavailable' });
        }
        return;
      }

      // POST /api/admin/skills/:id/update - 更新技能
      const skillUpdateMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)\/update$/);
      if (skillUpdateMatch && method === 'POST') {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const skillId = skillUpdateMatch[1];
        const body = await readJson(req);
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId) + '/update', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          sendJson(res, r.status, r.data as Record<string, unknown>);
        } catch {
          sendJson(res, 502, { ok: false, error: 'service_unavailable' });
        }
        return;
      }

      // POST /api/admin/skills/import - 导入技能（Markdown格式）
      const skillImportMatch = pathname === '/api/admin/skills/import';
      if (skillImportMatch && method === 'POST') {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const body = await readJson(req);
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/import', {
            method: 'POST',
            body: JSON.stringify({ markdown: body.markdown || body.content || '', owner_user_id: session.user_id, org_id: session.org_id }),
          });
          sendJson(res, r.status, r.data as Record<string, unknown>);
        } catch {
          sendJson(res, 502, { ok: false, error: 'service_unavailable' });
        }
        return;
      }

      // GET /api/admin/skills/:id/export - 导出技能
      const skillExportMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)\/export$/);
      if (skillExportMatch && method === 'GET') {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const skillId = skillExportMatch[1];
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId) + '/export');
          sendJson(res, r.status, r.data as Record<string, unknown>);
        } catch {
          sendJson(res, 502, { ok: false, error: 'service_unavailable' });
        }
        return;
      }

      // GET /api/admin/skills/:id/versions - 技能版本列表
      const skillVersionsMatch = pathname.match(/^\/api\/admin\/skills\/([^/]+)\/versions$/);
      if (skillVersionsMatch && method === 'GET') {
        const session = await requireAdmin(req, res);
        if (!session) return;
        const skillId = skillVersionsMatch[1];
        try {
          const r = await fetchFromService(skillLibraryUrl + '/internal/skills/' + encodeURIComponent(skillId) + '/versions');
          sendJson(res, r.status, r.data as Record<string, unknown>);
        } catch {
          sendJson(res, 502, { ok: false, error: 'service_unavailable' });
        }
        return;
      }
    }

    if (pathname === '/api/knowledge/import' && method === 'POST') {
      const session = await requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const content = String(body.content || '').trim();
      if (!content) { sendJson(res, 400, { ok: false, error: 'missing_content' }); return; }
      try {
        const indexResult = await fetchFromService(factRetrievalUrl + '/internal/documents/index', {
          method: 'POST',
          body: JSON.stringify({
            title: body.title || 'Untitled',
            content,
            source_type: body.source_type || 'manual',
            scope: [body.scope || 'private'],
            owner_user_id: session.user_id,
            org_id: session.org_id,
          }),
        });
        if (body.auto_extract !== false) {
          await fetchFromService(factRetrievalUrl + '/internal/entities/write', {
            method: 'POST',
            body: JSON.stringify({
              owner_user_id: session.user_id,
              org_id: session.org_id,
              entities: [{ name: String(body.title || 'document'), type: 'document', attributes: { content_preview: content.substring(0, 200) } }],
              scope: [body.scope || 'private'],
              source_ref: (indexResult.data as any)?.document_id || (indexResult.data as any)?.id,
            }),
          });
        }
        sendJson(res, 200, { ok: true, index_result: indexResult.data });
      } catch {
        sendJson(res, 502, { ok: false, error: 'service_unavailable' });
      }
      return;
    }

    if (pathname === '/api/users' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT id, username, role, status, org_id FROM "user" ORDER BY username LIMIT $1`, [MAX_USER_ROWS]);
      sendJson(res, 200, { ok: true, users: result.rows });
      return;
    }

    if (pathname === '/api/users' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const role = String(body.role || 'user');
      if (!username || !password) { sendJson(res, 400, { ok: false, error: 'missing_fields' }); return; }
      if (password.length < 8) { sendJson(res, 400, { ok: false, error: 'password_too_short', message: '密码至少8位' }); return; }
      if (password.length > 128) { sendJson(res, 400, { ok: false, error: 'password_too_long', message: '密码不超过128位' }); return; }
      if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        sendJson(res, 400, { ok: false, error: 'password_weak', message: '密码必须同时包含字母和数字' });
        return;
      }
      const COMMON_PASSWORDS = new Set(['password', '12345678', '123456789', 'admin123', 'qwerty123', 'abc12345', 'password1', 'admin1234', 'test1234']);
      if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        sendJson(res, 400, { ok: false, error: 'password_common', message: '密码过于常见，请更换' });
        return;
      }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const passwordHash = hashPassword(password);
      try {
        const result = await pool.query(
          `INSERT INTO "user" (org_id, username, display_name, role, status, metadata) VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id, username, role, status`,
          [session.org_id, username, username, role, JSON.stringify({ password_hash: passwordHash, source: 'admin_create' })]
        );
        await auditWriter.write({ action: 'user.create', user_id: session.user_id, resource_type: 'user', resource_ref: username, resource_scope: 'system', result: 'success', detail_json: { username, role } });
        sendJson(res, 201, { ok: true, user: result.rows[0] });
      } catch (error) {
        sendJson(res, 409, { ok: false, error: 'user_exists', message: String(error) });
      }
      return;
    }

    if (pathname === '/api/channels/identity' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT id, channel_type, external_identity, binding_status, user_id FROM channel_identity ORDER BY created_at DESC LIMIT 100`);
      sendJson(res, 200, { ok: true, identities: result.rows });
      return;
    }

    if (pathname.match(/^\/api\/channels\/identity\/[^/]+\/rebind$/) && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const id = pathname.split('/')[4];
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      await pool.query(`UPDATE channel_identity SET binding_status = 'bound' WHERE id = $1`, [id]);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/admin/audit' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(`SELECT id, action, user_id, detail_json, occurred_at FROM audit_event ORDER BY occurred_at DESC LIMIT $1`, [MAX_AUDIT_ROWS]);
      sendJson(res, 200, { ok: true, events: result.rows });
      return;
    }

    if (pathname === '/api/admin/retrieval-traces' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const result = await pool.query(
        `SELECT id, query_text, COALESCE((result_summary->>'item_count')::int, 0) AS items_count, degraded, created_at
         FROM retrieval_trace
         ORDER BY created_at DESC
         LIMIT $1`,
        [MAX_RETRIEVAL_ROWS]
      );
      sendJson(res, 200, { ok: true, traces: result.rows });
      return;
    }

    if (pathname === '/api/admin/db/stats' && method === 'GET') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      const [connResult, sizeResult, tableResult] = await Promise.all([
        pool.query(`SELECT count(*) as cnt FROM pg_stat_activity WHERE datname = current_database()`),
        pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as db_size`),
        pool.query(`SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = 'public'`),
      ]);
      sendJson(res, 200, {
        ok: true,
        stats: {
          connections: Number(connResult.rows[0]?.cnt || 0),
          db_size: sizeResult.rows[0]?.db_size || '-',
          table_count: Number(tableResult.rows[0]?.cnt || 0),
        },
      });
      return;
    }

    if (pathname === '/api/admin/db/maintenance' && method === 'POST') {
      const session = await requireAdmin(req, res);
      if (!session) return;
      const body = await readJson(req);
      const action = String(body.action || '');
      const allowedActions = ['analyze', 'checkpoint'];
      if (!allowedActions.includes(action)) {
        sendJson(res, 400, { ok: false, error: 'invalid_action', message: '仅允许 ANALYZE 和 CHECKPOINT 操作' });
        return;
      }
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 503, { ok: false, error: 'db_unavailable' }); return; }
      await pool.query(action.toUpperCase());
      await auditWriter.write({ action: 'db.maintenance', user_id: session.user_id, resource_type: 'database', resource_ref: 'system', resource_scope: 'system', result: 'success', detail_json: { operation: action } });
      sendJson(res, 200, { ok: true, message: action.toUpperCase() + ' 已执行' });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found', path: pathname });
  } catch (error) {
    logger.error('request.handler_error', 'Unhandled error in request handler', { error: String(error), path: pathname });
    sendJson(res, 500, { ok: false, error: 'internal_error', message: 'Internal server error' });
  }
}

async function startServer(): Promise<void> {
  checkProductionSecurity();
  await initRedisSessionStore();
  await getDbPool();

  const server = createServer(handleRequest);

  server.listen(port, () => {
    logger.info('server.started', 'Web Portal server started', { port });
    startTaskScheduler();
  });

  const shutdown = () => {
    logger.info('server.shutting_down', 'Shutting down server...');
    stopTaskScheduler();
    server.close(() => {
      if (dbPool) dbPool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ─── Cron Scheduler for Org Tasks ───
let taskSchedulerTimer: ReturnType<typeof setInterval> | null = null;

function parseCronToDailyTime(expression: string): { hour: number; minute: number } | null {
  // 支持标准5段cron表达式: minute hour day_of_month month day_of_week
  // 当前简化实现: 仅解析分钟和小时字段，支持具体数值、逗号列表和星号通配
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const minuteField = parts[0];
  const hourField = parts[1];

  // 解析字段值: 支持单值、逗号分隔列表、星号通配
  function parseField(raw: string): number[] {
    const values: number[] = [];
    if (raw === '*') return []; // 标记为通配，需进一步处理
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

  // 支持小时通配 + 分钟具体值 (如 "30 * * * *" 表示每小时的第30分钟)
  if (hourField === '*' && minuteField !== '*') {
    return { hour: 0, minute: 0 }; // 标记为每个小时触发，由调用方以hour=-1识别
  }

  // 取第一个有效的时间组合
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
      // 同时查询 daily、weekly 和 cron 类型，以及 once 类型（到期触发一次后自动归档）
      `SELECT * FROM org_task WHERE status = 'active' AND schedule_type IN ('daily', 'weekly', 'cron', 'once')`
    );

    for (const task of tasks.rows) {
      let shouldTrigger = false;

      if (task.schedule_type === 'once') {
        // 一次性任务: 检查是否到达预定时间
        const scheduledAt = task.scheduled_at ? new Date(task.scheduled_at) : null;
        if (scheduledAt && now >= scheduledAt) {
          // 检查今天是否已经触发过
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
        const dayOfWeek = now.getDay(); // 0=Sunday
        const targetDay = 1; // Monday default
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
        const schedulerPort = port;

        // Step 1: Assign to users (使用内部端口，避免走外部路由)
        await fetch(`http://127.0.0.1:${schedulerPort}/internal/tasks/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.id }),
        }).catch((err) => {
          logger.warn('task_scheduler.assign_failed', 'Failed to assign task', { task_id: task.id, error: String(err) });
        });

        // Step 2: Send notifications
        await fetch(`http://127.0.0.1:${schedulerPort}/internal/tasks/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.id }),
        }).catch((err) => {
          logger.warn('task_scheduler.notify_failed', 'Failed to notify task', { task_id: task.id, error: String(err) });
        });

        // 一次性任务触发后自动归档
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
  // Check every minute for tasks that should trigger
  taskSchedulerTimer = setInterval(runTaskScheduler, 60000);
  logger.info('task_scheduler.started', 'Org task cron scheduler started (every 60s)');
  // Also run once on startup
  runTaskScheduler();
}

function stopTaskScheduler(): void {
  if (taskSchedulerTimer) {
    clearInterval(taskSchedulerTimer);
    taskSchedulerTimer = null;
  }
}

startServer().catch(error => {
  logger.error('server.start_failed', 'Failed to start server', { error: String(error) });
  process.exit(1);
});
