const http = require('http');
const crypto = require('crypto');

function api(method, path, body = null, sessionId = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:3003');
    const headers = { 'Content-Type': 'application/json' };
    if (sessionId) headers['x-session-id'] = sessionId;

    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

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

async function main() {
  const adminPassword = process.env.ADMIN_PASSWORD || (process.argv.length > 2 ? process.argv[2] : '');
  if (!adminPassword) {
    console.error('Usage: node setup-users.cjs <admin-password>');
    console.error('  or set ADMIN_PASSWORD env variable');
    process.exit(1);
  }

  console.log('=== 用户创建脚本 ===\n');

  console.log('1. 管理员登录...');
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: adminPassword });
  console.log(`   结果: ${JSON.stringify(login.body)}`);
  const sid = login.body.session_id;
  if (!sid) { console.log('   登录失败! 请确认管理员账号密码正确。'); process.exit(1); }
  console.log('   登录成功!\n');

  const users = [
    { username: 'engineer_zhang', password: generatePassword(), role: 'user' },
    { username: 'pm_wang', password: generatePassword(), role: 'user' },
    { username: 'designer_li', password: generatePassword(), role: 'user' },
  ];

  const createdUsers = [];
  for (const u of users) {
    console.log(`2. 创建用户: ${u.username}...`);
    const result = await api('POST', '/api/users', {
      username: u.username,
      password: u.password,
      role: u.role,
    }, sid);
    console.log(`   结果: ${JSON.stringify(result.body)}`);
    if (result.body.ok) {
      createdUsers.push({ username: u.username, password: u.password, role: u.role });
    }
  }

  console.log('\n3. 用户列表...');
  const list = await api('GET', '/api/users', null, sid);
  console.log(`   用户数: ${(list.body.users || []).length}`);
  for (const u of (list.body.users || [])) {
    console.log(`   - ${u.username} (${u.role}) [${u.status}]`);
  }

  if (createdUsers.length > 0) {
    console.log('\n=== 创建的账号信息（请妥善保管） ===');
    for (const u of createdUsers) {
      console.log(`   用户名: ${u.username}`);
      console.log(`   密码:   ${u.password}`);
      console.log(`   角色:   ${u.role}`);
      console.log('');
    }
  }

  console.log('=== 完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
