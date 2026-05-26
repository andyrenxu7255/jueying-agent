const { execFileSync } = require('child_process');
const crypto = require('crypto');

function pg(sql) {
  try {
    return execFileSync('docker', ['exec', 'ah-postgres', 'psql', '-U', 'agent_harness', '-d', 'agent_harness', '-c', sql], { encoding: 'utf8' });
  } catch(e) {
    console.error('SQL ERROR:', e.stderr || e.message);
    return null;
  }
}

async function main() {
  // Get real binding
  const res = pg(
    "SELECT external_identity, binding_status FROM channel_identity WHERE channel_type = 'feishu' AND binding_status = 'pending' AND external_identity LIKE 'ou_cf%'"
  );
  console.log('Current state:', res);
  
  const realOpenId = 'ou_cf6147dcb7c1b28ca629c8532629631e';
  const suffix = crypto.createHash('sha256').update(`feishu:${realOpenId}`).digest('hex').slice(0, 8);
  const username = `u_feishu_${suffix}`;
  const userId = crypto.createHash('sha256').update(`user:${username}`).digest('hex').slice(0, 32);
  const orgId = 'a0a0a0a0-0000-4000-8000-000000000001';

  console.log('Creating user:', username, 'id:', userId);

  // Create user (INSERT)
  const insertUser = pg(
    `INSERT INTO "user" (id, org_id, username, display_name, role, status, metadata) VALUES ('${userId}', '${orgId}', '${username}', '\u98de\u4e66\u7528\u6237 ${suffix}', 'user', 'active', '\{"source":"feishu_auto","channel":"feishu"\}'::jsonb) ON CONFLICT (username) DO UPDATE SET status = 'active'`
  );
  console.log('Insert user result:', insertUser);

  // Upgrade binding
  const upgradeBind = pg(
    `UPDATE channel_identity SET binding_status = 'bound', user_id = '${userId}' WHERE channel_type = 'feishu' AND external_identity = '${realOpenId}'`
  );
  console.log('Upgrade bind result:', upgradeBind);

  // Verify
  const verify = pg(
    `SELECT ci.external_identity, ci.binding_status, u.username FROM channel_identity ci LEFT JOIN "user" u ON u.id = ci.user_id WHERE ci.external_identity = '${realOpenId}'`
  );
  console.log('Verify:', verify);

  console.log('\nDone! User is now bound.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
