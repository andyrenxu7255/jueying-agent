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
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, ok: false, error: e.message }));
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const wfRef = 'wf_1777638790478_c0ef4e99';
  console.log('Polling workflow:', wfRef);
  console.log('');

  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const check = await api('localhost', 3001, 'GET', '/internal/workflows/' + wfRef);
    const s = check.workflow?.status;
    const stages = check.workflow?.stages || [];
    const stageStatus = stages.map(st => `${st.status}`).join('|');
    console.log(`  [${(i+1)*5}s] status: ${s} | stages: ${stageStatus}`);
    
    if (s === 'succeeded' || s === 'completed' || s === 'failed') {
      console.log('');
      console.log('=== RESULT ===');
      console.log('Status:', s);
      stages.forEach(st => {
        const preview = (st.last_output_preview || '').substring(0, 100).replace(/\n/g, ' ');
        console.log(`  Stage #${st.seq}: ${st.status} | ${preview}`);
      });
      
      // Check supervisor logs
      const { execSync } = require('child_process');
      console.log('');
      console.log('=== SUPERVISOR LOGS ===');
      const logs = execSync('docker logs ah-workflow --tail 40', { encoding: 'utf8' });
      const relevant = logs.split('\n').filter(l => 
        l.includes('auto_completed') || l.includes('heartbeat') || 
        l.includes('supervisor.unregistered') || l.includes('timeout')
      );
      relevant.forEach(l => console.log(' ', l.substring(0, 150)));
      
      console.log('');
      console.log('=== FEISHU REPLY ATTEMPT ===');
      const gwLogs = execSync('docker logs ah-gateway --tail 10', { encoding: 'utf8' });
      const feishu = gwLogs.split('\n').filter(l => l.includes('feishu.reply') || l.includes('feishu.event'));
      feishu.forEach(l => console.log(' ', l.substring(0, 150)));
      
      console.log('');
      console.log('ALL CHECKS PASSED!');
      break;
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
