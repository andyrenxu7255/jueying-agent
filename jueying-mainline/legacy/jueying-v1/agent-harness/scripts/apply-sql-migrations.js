const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const MIGRATION_TABLE = '_manual_sql_migrations';
const DEFAULT_DATABASE_URL = 'postgresql://agent_harness:dev_password_changeme@localhost:5432/agent_harness';

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fsSync.existsSync(envPath)) return;

  const content = fsSync.readFileSync(envPath, 'utf8');
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

function getDatabaseUrl() {
  loadDotEnv();
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const user = process.env.POSTGRES_USER || 'agent_harness';
  const password = process.env.POSTGRES_PASSWORD || 'dev_password_changeme';
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const db = process.env.POSTGRES_DB || 'agent_harness';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists ${MIGRATION_TABLE} (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function listSqlFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function appliedMigrations(client) {
  const result = await client.query(`select filename from ${MIGRATION_TABLE}`);
  return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(client, filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = await fs.readFile(fullPath, 'utf8');

  await client.query('begin');
  try {
    await client.query(sql);
    await client.query(`insert into ${MIGRATION_TABLE} (filename) values ($1)`, [filename]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw new Error(`Failed applying ${filename}: ${error.message}`);
  }
}

async function main() {
  const client = new Client({
    connectionString: getDatabaseUrl() || DEFAULT_DATABASE_URL,
  });

  await client.connect();
  try {
    await ensureMigrationTable(client);

    const files = await listSqlFiles();
    const applied = await appliedMigrations(client);
    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
      console.log('No pending SQL migrations');
      return;
    }

    for (const file of pending) {
      console.log(`Applying ${file}`);
      await applyMigration(client, file);
    }

    console.log(`Applied ${pending.length} SQL migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
