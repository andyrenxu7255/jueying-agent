const http = require('http');
const crypto = require('crypto');

function api(host, port, method, path, body) {
  return new Promise((resolve) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;
    const headers = bodyStr != null
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
      : {};
    const req = http.request({ hostname: host, port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, ...JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, ok: false, error: e.message }));
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const PH = 'sha256:' + crypto.createHash('sha256').update('test-policy-v1').digest('hex');
  
  console.log('=== Feishu message simulation ===');
  const feishu = await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', {
    type: 'im.message.receive_v1',
    header: { event_id: 'evt_' + Date.now() },
    event: {
      sender: { sender_id: { open_id: 'ou_test_eng' } },
      message: { chat_id: 'oc_test_' + Date.now(), msg_type: 'text', content: '{"text":"analyze DB connection pooling"}' }
    }
  });
  console.log('Feishu:', feishu.status, feishu.ok);

  console.log('\n=== Plan generation ===');
  const plan = await api('localhost', 3001, 'POST', '/internal/workflows/plan', {
    user_id: 'u_engineer_zhang',
    user_goal: '分析数据库连接池配置最佳实践',
    task_type_hint: 'development',
    risk_level: 'medium',
    policy_snapshot_hash: PH
  });
  console.log('Plan:', plan.ok ? 'OK' : 'FAILED', '| hash:', plan.workflow_plan?.workflow_type);
  
  if (!plan.ok) {
    console.log('Error:', plan.error, plan.detail);
    process.exit(1);
  }
  
  const wfRef = plan.workflow_instance_ref;
  console.log('WF ref:', wfRef);
  console.log('Stages:', plan.workflow_plan?.stage_chain?.length);
  if (plan.workflow_plan?.stage_chain) {
    plan.workflow_plan.stage_chain.forEach((s, i) => {
      console.log(`  [${i}] ${s.stage_type} -> ${s.assigned_executor}`);
    });
  }

  console.log('\n=== Dispatch ===');
  const dispatch = await api('localhost', 3001, 'POST', '/internal/workflows/' + wfRef + '/dispatch', {
    trigger: 'manual', user_role: 'admin'
  });
  console.log('Dispatch:', dispatch.status, dispatch.dispatch_status, 'run:', dispatch.executor_run_ref);

  console.log('\n=== Waiting for completion ===');
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const check = await api('localhost', 3001, 'GET', '/internal/workflows/' + wfRef);
    const s = check.workflow?.status;
    process.stdout.write(`  [${(i+1)*5}s] ${s} | stages: `);
    if (check.workflow?.stages) {
      check.workflow.stages.forEach(st => process.stdout.write(`${st.status} `));
    }
    process.stdout.write('\n');
    if (s === 'succeeded' || s === 'completed' || s === 'failed') {
      console.log('\n=== Final result ===');
      console.log('Status:', s);
      if (check.workflow?.stages) {
        check.workflow.stages.forEach(st => {
          console.log(`  Stage ${st.seq}: ${st.status} | ${(st.last_output_preview||'').substring(0,80)}`);
        });
      }
      break;
    }
  }

  console.log('\n=== Gateway logs (Feishu reply attempt) ===');
  const { execSync } = require('child_process');
  try {
    const logs = execSync('docker logs ah-gateway --tail 15', { encoding: 'utf8' });
    const lines = logs.split('\n').filter(l => l.includes('feishu.reply') || l.includes('feishu.event'));
    lines.forEach(l => console.log('  ', l.substring(0, 120)));
  } catch { /* intentional: best-effort check */ }

  console.log('\n=== DONE ===');
}
main().catch(e => { console.error(e); process.exit(1); });
