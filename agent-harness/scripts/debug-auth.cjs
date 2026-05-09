const http = require('http');

function api(method, path, body, sid) {
  return new Promise((resolve) => {
    const url = new URL(path, 'http://localhost:3003');
    const headers = { 'Content-Type': 'application/json' };
    if (sid) headers['x-session-id'] = sid;
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', () => resolve({ ok: false, error: 'network' }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // 1. Login
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'dev-password' });
  console.log('[LOGIN]', JSON.stringify(login));
  const sid = login.session_id;
  if (!sid) { console.log('No session!'); process.exit(1); }

  // 2. Check auth
  const auth = await api('GET', '/api/auth/check', null, sid);
  console.log('[AUTH]', JSON.stringify(auth));

  // 3. List users  
  const users = await api('GET', '/api/users', null, sid);
  console.log('[USERS]', JSON.stringify(users));

  // 4. Try creating a user (must be admin)
  const create = await api('POST', '/api/users', { username: 'test1', password: '<USER_PASSWORD>', role: 'user' }, sid);
  console.log('[CREATE]', JSON.stringify(create));
}
main().catch(e => console.error(e));
