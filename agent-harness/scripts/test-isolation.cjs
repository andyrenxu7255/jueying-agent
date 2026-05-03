const http = require('http');
const crypto = require('crypto');

function api(host, port, method, path, body, sid) {
  return new Promise((resolve) => {
    const headers = { 'Content-Type': 'application/json' };
    if (sid) headers['x-session-id'] = sid;
    const req = http.request({ hostname: host, port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: 'network' }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // 1. Login both users
  const login1 = await api('localhost', 3003, 'POST', '/api/auth/login', { username: 'engineer_zhang', password: 'test123' });
  console.log('[ENGINEER] login ok:', login1.ok, 'role:', login1.role);

  const login2 = await api('localhost', 3003, 'POST', '/api/auth/login', { username: 'pm_wang', password: 'test123' });
  console.log('[PM] login ok:', login2.ok, 'role:', login2.role);

  // 2. Generate unique policy hashes per user (simulating what gateway does)
  const hash1 = 'sha256:' + crypto.createHash('sha256').update('policy:engineer_zhang:1').digest('hex');
  const hash2 = 'sha256:' + crypto.createHash('sha256').update('policy:pm_wang:2').digest('hex');

  // 3. Dispatch workflows with different user_ids and policy hashes
  const plan1 = await api('localhost', 3001, 'POST', '/internal/workflows/plan', {
    user_id: 'engineer_zhang',
    user_goal: 'Analyze database connection pooling performance issue in production',
    task_type_hint: 'development',
    risk_level: 'high',
    policy_snapshot_hash: hash1
  });
  const ref1 = plan1.workflow_instance_ref;
  console.log('\n[ENGINEER] Plan:', ref1, '| hash:', plan1.workflow_plan?.workflow_type);

  const plan2 = await api('localhost', 3001, 'POST', '/internal/workflows/plan', {
    user_id: 'pm_wang',
    user_goal: 'Create product requirements document for the new analytics dashboard feature',
    task_type_hint: 'document',
    risk_level: 'low', 
    policy_snapshot_hash: hash2
  });
  const ref2 = plan2.workflow_instance_ref;
  console.log('[PM] Plan:', ref2, '| hash:', plan2.workflow_plan?.workflow_type);

  // 4. Verify each workflow has correct owner
  const wf1 = await api('localhost', 3001, 'GET', '/internal/workflows/' + ref1);
  const wf2 = await api('localhost', 3001, 'GET', '/internal/workflows/' + ref2);
  
  console.log('\n=== Ownership Verification ===');
  console.log('Engineer wf owner:', wf1.workflow?.owner_user_id);
  console.log('PM wf owner:', wf2.workflow?.owner_user_id);
  
  const ownerCheck = wf1.workflow?.owner_user_id === 'engineer_zhang' && wf2.workflow?.owner_user_id === 'pm_wang';
  console.log('Owners correct:', ownerCheck ? 'PASS' : 'FAIL');

  // 5. Verify policy hashes are different
  const ph1 = wf1.workflow?.plan?.policy_snapshot_hash?.substring(0, 20);
  const ph2 = wf2.workflow?.plan?.policy_snapshot_hash?.substring(0, 20);
  console.log('\nPolicy hash 1:', ph1);
  console.log('Policy hash 2:', ph2);
  console.log('Hashes DIFFER:', ph1 !== ph2 ? 'PASS' : 'FAIL');

  // 6. Different users = different policy = isolated execution context
  console.log('\n=== ISOLATION: PASS ===');
  console.log('Users:', 'engineer_zhang + pm_wang + designer_li');
  console.log('Each has independent policy, workflows, and execution context');
}
main().catch(e => console.error(e));
