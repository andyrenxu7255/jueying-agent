const http = require('http');

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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Login
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'dev-password' });
  console.log('[LOGIN]', JSON.stringify(login));
  
  // Test: create user directly via workflow service internal API (bypass web-portal)
  // First, let's use a different approach - call workflow directly to create a user scope
  const sid = login.session_id;

  // Try the setup status again
  const status = await api('GET', '/api/setup/status', null, sid);
  console.log('[STATUS]', JSON.stringify(status));

  // Check db directly via workflow health
  const wfHealth = await api('GET', '/health', null, null);
  console.log('[WF-HEALTH]', JSON.stringify(wfHealth));
}
main().catch(e => console.error(e));
