const http = require('http');
const { execSync } = require('child_process');

function api(host, port, method, path, body, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;
    const headers = bodyStr != null
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
      : {};
    const req = http.request({ hostname: host, port, path, method, headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ httpStatus: res.statusCode, ...JSON.parse(data) }); }
        catch { resolve({ httpStatus: res.statusCode, raw: data.substring(0, 100) }); }
      });
    });
    req.on('error', (e) => resolve({ httpStatus: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ httpStatus: 0, error: 'timeout' }); });
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`);
}
function header(t) { console.log(`\n${'─'.repeat(60)}\n  ${t}\n${'─'.repeat(60)}`); }

async function main() {
  const evtSuffix = Date.now();
  const openId = 'ou_final_' + evtSuffix;
  const chatId = 'oc_final_' + evtSuffix;

  // ── 1: Health ──
  header('1. 系统健康检查');
  check('Workflow', (await api('localhost', 3001, 'GET', '/internal/workflows?limit=1')).ok !== false, '');
  check('Executor', (await api('localhost', 3002, 'GET', '/health')).ok === true, '');
  check('Hermes', (await api('localhost', 3005, 'GET', '/health/live')).ok === true, '');
  check('Gateway', (await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', { type: 'ping' })).httpStatus === 200, '');

  // ── 2: Chat ──
  header('2. Chat 消息路径');
  const t0 = Date.now();
  await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', {
    type: 'im.message.receive_v1',
    header: { event_id: 'evt_chat_' + evtSuffix },
    event: {
      sender: { sender_id: { open_id: openId + '_chat' } },
      message: { chat_id: chatId + '_chat', msg_type: 'text', content: '{"text":"你好"}' }
    }
  });
  check('响应速度', Date.now() - t0 < 500, (Date.now() - t0) + 'ms');

  console.log('  等待异步处理...');
  await new Promise(r => setTimeout(r, 12000));

  const gw = execSync('docker logs ah-gateway --tail 40 2>&1', { encoding: 'utf8' });
  check('LLM分类执行', gw.includes('ingress.request.classified'), '');
  check('模型调用成功', gw.includes('model.call.success') || gw.includes('model_call_success'), '');
  check('飞书回复尝试', gw.includes('feishu.reply.attempt'), '');

  // ── 3: Task ──
  header('3. Task 消息路径');
  await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', {
    type: 'im.message.receive_v1',
    header: { event_id: 'evt_task_' + evtSuffix },
    event: {
      sender: { sender_id: { open_id: openId + '_task' } },
      message: { chat_id: chatId + '_task', msg_type: 'text', content: '{"text":"帮我写一篇技术博客大纲"} ' }
    }
  });

  console.log('  等待Plan+Dispatch...');
  await new Promise(r => setTimeout(r, 20000));

  // Check WORKFLOW logs (plan/dispatch happens there, not in gateway)
  const wfLog = execSync('docker logs ah-workflow --tail 30 2>&1', { encoding: 'utf8' });
  const wfRefs = wfLog.match(/wf_\d{13}_[a-f0-9]{8}/g) || [];
  const wfRef = wfRefs[wfRefs.length - 1];
  check('生成Workflow', !!wfRef, wfRef || '未找到');

  if (!wfRef) { console.log('\n  FATAL: 无法继续\n'); process.exit(1); }

  // ── 4: Poll completion ──
  header(`4. 轮询 Workflow: ${wfRef}`);
  let done = false;
  for (let i = 0; i < 24 && !done; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const w = await api('localhost', 3001, 'GET', `/internal/workflows/${wfRef}`);
    const s = w.workflow?.status || w.status || '?';
    console.log(`    [${(i+1)*5}s] ${s}`);
    if (['succeeded','completed','failed','cancelled'].includes(s)) {
      done = true;
      check('最终状态', s === 'succeeded', s);

      const stages = w.workflow?.stages || w.stages || [];
      stages.forEach((st, idx) => {
        const out = (st.last_output_preview || '').substring(0, 150);
        check(`S${idx}.${st.stage_type || st.stage_key}`, st.status === 'completed',
          out.replace(/\n/g,' '));
      });

      // Anti-pattern check
      const allOut = JSON.stringify(stages);
      check('无 [object Object]', !allOut.includes('[object Object]'), '');
    }
  }
  if (!done) check('轮询完成', false, '超时');

  // ── 5: Supervisor ──
  header('5. Supervisor 心跳审计');
  const wfL = execSync('docker logs ah-workflow --tail 40 2>&1', { encoding: 'utf8' });
  check('heartbeat.recorded', wfL.includes('heartbeat.recorded'), '');
  check('auto_completed', wfL.includes('auto_completed'), '');
  check('无 heartbeat.unknown', !wfL.includes('heartbeat.unknown'), '');
  check('无 timeout.detected', !wfL.includes('timeout.detected'), '');

  // ── 6: Executor ──
  header('6. Executor 审计');
  const exL = execSync('docker logs ah-executor --tail 30 2>&1', { encoding: 'utf8' });
  check('dispatch.accepted', exL.includes('dispatch.accepted'), '');
  check('stage_start', exL.includes('stage_start'), '');
  check('stage_completed', exL.includes('auto.execute.completed'), '');

  // ── Summary ──
  const p = results.filter(r => r.ok).length;
  const f = results.filter(r => !r.ok).length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 总计: ${results.length} | ✅ ${p} | ❌ ${f}`);
  console.log('═'.repeat(60));
  if (f > 0) {
    console.log('  失败项:');
    results.filter(r => !r.ok).forEach(r => console.log(`    - ${r.name}: ${r.detail}`));
  } else {
    console.log('  🎉 全链路审计通过！系统各路径功能正常。');
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
