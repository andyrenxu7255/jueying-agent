const fs = require('fs');
const path = require('path');

const WORK_DIR = 'D:/teamclaw/agent-harness';

function loadDotEnv() {
  const envPath = path.join(WORK_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function databaseUrl() {
  loadDotEnv();
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const user = process.env.POSTGRES_USER || 'agent_harness';
  const password = process.env.POSTGRES_PASSWORD || 'dev_password_changeme';
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const db = process.env.POSTGRES_DB || 'agent_harness';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

function redisUrl() {
  loadDotEnv();
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  return process.env.REDIS_PASSWORD
    ? `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD)}@localhost:6379`
    : 'redis://localhost:6379';
}

function testEnv(extra = {}) {
  loadDotEnv();
  return {
    ...process.env,
    NODE_ENV: 'test',
    TEST_RESET_TOKEN: process.env.TEST_RESET_TOKEN || 'm2-smoke-reset',
    DATABASE_URL: databaseUrl(),
    REDIS_URL: redisUrl(),
    ...extra,
  };
}

module.exports = {
  WORK_DIR,
  databaseUrl,
  redisUrl,
  testEnv,
};
