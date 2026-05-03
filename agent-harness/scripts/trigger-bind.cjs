const http = require('http');

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
        catch { resolve({ status: res.statusCode, raw: data.substring(0, 200) }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, ok: false, error: e.message }));
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // Check auto-bind: resend the user's real identity to trigger auto-upgrade
  console.log('=== Triggering auto-bind upgrade for real user ===');
  const result = await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', {
    type: 'im.message.receive_v1',
    header: { event_id: 'evt_real_bind_' + Date.now() },
    event: {
      sender: { sender_id: { open_id: 'ou_cf6147dcb7c1b28ca629c8532629631e' } },
      message: { chat_id: 'oc_1b6242c6d975ec1dad9849c4cb9f3442', msg_type: 'text', content: JSON.stringify({ text: '你好，我绑定好了吗' }) }
    }
  });
  console.log('  Status:', result.status, '| received:', result.received);

  // Wait for async processing
  await new Promise(r => setTimeout(r, 8000));

  // Check gateway logs for auto-bind event
  const { execSync } = require('child_process');
  const logs = execSync('docker logs ah-gateway --tail 30', { encoding: 'utf8' });
  const relevantLines = logs.split('\n').filter(l => 
    l.includes('feishu.event.received') || l.includes('feishu.reply.attempt') || 
    l.includes('feishu.reply.failed') || l.includes('feishu.event.completed') ||
    l.includes('identity.auto_bound') || l.includes('auto_bound') ||
    l.includes('classif') || l.includes('model.call')
  );
  relevantLines.forEach(l => console.log('  LOG:', l.substring(0, 200)));

  // Check workflow logs
  const wfLogs = execSync('docker logs ah-workflow --tail 10', { encoding: 'utf8' });
  const wfRelevant = wfLogs.split('\n').filter(l => l.includes('plan') || l.includes('dispatch') || l.includes('auto_bound'));
  console.log('');
  console.log('=== Workflow logs ===');
  wfRelevant.forEach(l => console.log('  WF:', l.substring(0, 200)));

  console.log('');
  console.log('=== DONE ===');
  console.log('Send a message from Feishu now to test.');
}

main().catch(e => { console.error(e); process.exit(1); });
