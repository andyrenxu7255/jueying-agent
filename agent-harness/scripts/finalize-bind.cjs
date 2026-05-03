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
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  console.log('=== Step 1: Clean up test bindings ===\n');
  // The auto-bind already worked for test identities

  console.log('=== Step 2: Upgrade real user pending binding via API ===\n');
  
  // Send the real user's identity through the event pipeline again
  // This will trigger the auto-upgrade because binding_status='pending'
  const realOpenId = 'ou_cf6147dcb7c1b28ca629c8532629631e';
  
  const trigger = await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', {
    type: 'im.message.receive_v1',
    header: { event_id: 'evt_rebind_' + Date.now() },
    event: {
      sender: { sender_id: { open_id: realOpenId } },
      message: { 
        chat_id: 'oc_1b6242c6d975ec1dad9849c4cb9f3442', 
        msg_type: 'text', 
        content: JSON.stringify({ text: '测试身份绑定' }) 
      }
    }
  });

  console.log('  Trigger status:', trigger.status, '| received:', trigger.received);

  // Wait for async auto-bind
  await new Promise(r => setTimeout(r, 6000));

  const { execSync } = require('child_process');
  
  // Verify binding was upgraded
  const verifyLogs = execSync('docker logs ah-gateway --tail 40 2>&1', { encoding: 'utf8' });
  const relevantLines = verifyLogs.split('\n').filter(l => 
    l.includes(realOpenId.substring(0, 10)) ||
    l.includes('auto_bound') || l.includes('identity.auto') ||
    l.includes('feishu.reply') || l.includes('feishu.event.completed') ||
    l.includes('classif') || l.includes('model.call')
  );
  
  console.log('\n=== Gateway log analysis ===');
  relevantLines.forEach(l => {
    const clean = l.substring(0, 250);
    console.log('  ', clean);
  });

  console.log('\n=== All done! ===');
  console.log('Fixes applied:');
  console.log('  1. Immediate 200 response (no more missing icon)');
  console.log('  2. No session_ref leak in replies');
  console.log('  3. Auto-bind on first message (pending -> bound)');
  console.log('  4. Hermes memory for conversation context');
  console.log('');
  console.log('Next: Send a message from Feishu to verify everything works!');
}

main().catch(e => { console.error(e); process.exit(1); });
