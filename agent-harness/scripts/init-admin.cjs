const crypto = require('crypto');
const { randomBytes, scryptSync } = crypto;
const http = require('http');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.argv.length > 2 ? process.argv[2] : '');
const FORCE_OFFLINE = process.argv.includes('--offline');

function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let pwd = '';
  for (let i = 0; i < 12; i++) {
    pwd += chars[bytes[i] % chars.length];
  }
  pwd = pwd.slice(0, 4) + '1' + pwd.slice(4, 8) + 'A' + pwd.slice(8);
  return pwd;
}

if (!ADMIN_PASSWORD && !FORCE_OFFLINE) {
  console.error('Usage: node init-admin.cjs <password> [--offline]');
  console.error('  or set ADMIN_PASSWORD env variable');
  console.error('  --offline: create admin directly in database (requires DATABASE_URL)');
  process.exit(1);
}

function api(method, path, body, sid) {
  return new Promise((resolve) => {
    const url = new URL(path, 'http://localhost:3003');
    const headers = { 'Content-Type': 'application/json' };
    if (sid) headers['x-session-id'] = sid;
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', () => resolve({ ok: false, error: 'network' }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createAdminOnline() {
  console.log('=== Initializing admin via web portal API ===');
  const r = await api('POST', '/api/setup/initialize', { step: 'admin', username: 'admin', password: ADMIN_PASSWORD });
  console.log('Initialize result:', JSON.stringify(r));

  if (!r.ok) {
    console.error('Setup initialize failed:', r.error || r.raw || 'unknown');
    process.exit(1);
  }

  console.log('\n=== Testing login ===');
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
  console.log('Login:', JSON.stringify(login));

  const sid = login.session_id;
  if (!sid) { console.error('FAILED: Could not obtain session after login'); process.exit(1); }

  return sid;
}

async function createAdminOffline() {
  console.log('=== Creating admin directly in database (offline mode) ===');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('FAILED: DATABASE_URL not set, cannot use offline mode');
    process.exit(1);
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(ADMIN_PASSWORD, salt, 32, { N: 16384 }).toString('hex');
    const passwordHash = `scrypt:16384:${salt}:${derived}`;

    const existing = await pool.query(`SELECT id FROM "user" WHERE username = 'admin'`);
    if (existing.rows.length > 0) {
      console.log('Admin user already exists, updating password...');
      await pool.query(
        `UPDATE "user" SET metadata = jsonb_set(metadata, '{password_hash}', $1::jsonb) WHERE username = 'admin'`,
        [JSON.stringify(passwordHash)]
      );
      console.log('Admin password updated successfully.');
    } else {
      const userId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO "user" (id, org_id, username, display_name, role, status, metadata) VALUES ($1, $2, 'admin', 'admin', 'admin', 'active', $3)`,
        [userId, crypto.randomUUID(), JSON.stringify({ password_hash: passwordHash, source: 'init_script' })]
      );
      console.log(`Admin user created successfully. ID: ${userId}`);
    }
    console.log('IMPORTANT: After web portal starts, complete setup wizard at http://localhost:3003/setup');
  } finally {
    await pool.end();
  }

  process.exit(0);
}

async function main() {
  if (FORCE_OFFLINE) {
    await createAdminOffline();
    return;
  }

  let sid;
  try {
    sid = await createAdminOnline();
  } catch (error) {
    console.error('Online admin creation failed:', error.message);
    console.log('Falling back to offline mode...');
    await createAdminOffline();
    return;
  }

  const users = [
    { username: 'engineer_zhang', password: generatePassword(), role: 'user' },
    { username: 'pm_wang', password: generatePassword(), role: 'user' },
    { username: 'designer_li', password: generatePassword(), role: 'user' },
  ];

  for (const u of users) {
    console.log(`\n=== Creating ${u.username} ===`);
    const create = await api('POST', '/api/users', u, sid);
    console.log('Result:', JSON.stringify(create));
  }

  console.log('\n=== User List ===');
  const list = await api('GET', '/api/users', null, sid);
  console.log('Count:', (list.users || []).length);
  for (const u of (list.users || [])) {
    console.log(`  - ${u.username} (${u.role}) [${u.status}]`);
  }

  console.log('\n=== DONE ===');
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
