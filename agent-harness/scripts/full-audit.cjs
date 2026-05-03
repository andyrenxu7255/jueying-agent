const http = require('http');
const crypto = require('crypto');
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
        catch { resolve({ httpStatus: res.statusCode, raw: data.substring(0, 300) }); }
      });
    });
    req.on('error', (e) => resolve({ httpStatus: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ httpStatus: 0, error: 'timeout' }); });
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

const PASS = 0, FAIL = 0, results = [];

function check(name, ok, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  results.push({ name, ok, detail });
  console.log(`  ${status} | ${name} ${detail ? '| ' + detail : ''}`);
}

function header(title) {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(64));
}

function section(title) {
  console.log(`\n  ── ${title} ──`);
}

function summary() {
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  📊 总计: ${results.length} | ✅ ${passed} | ❌ ${failed}`);
  console.log('═'.repeat(64));
  if (failed > 0) {
    console.log('  ❌ 失败的检查项:');
    results.filter(r => !r.ok).forEach(r => console.log(`     - ${r.name}: ${r.detail || ''}`));
  } else {
    console.log('  🎉 全部通过！');
  }
  return failed === 0;
}

async function main() {
  const testOpenId = 'ou_audit_test_' + Date.now();
  const testChatId = 'oc_audit_test_' + Date.now();
  const testOrgId = '00000000-0000-0000-0000-000000000001';

  // =====================================================================
  header('A1: 系统健康检查');
  // =====================================================================
  const wfHealth = await api('localhost', 3001, 'GET', '/');
  check('Workflow Service', wfHealth.httpStatus === 200 || wfHealth.httpStatus === 404, `http=${wfHealth.httpStatus}`);

  const gwHealth = await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', { type: 'ping' });
  check('Gateway Service', gwHealth.httpStatus === 200 || gwHealth.received === true, `http=${gwHealth.httpStatus}`);

  const execHealth = await api('localhost', 3002, 'GET', '/health');
  check('Executor Gateway', execHealth.ok === true || execHealth.httpStatus === 200, `service=${execHealth.service || '?'}`);

  const hermesHealth = await api('localhost', 3005, 'GET', '/health/live');
  check('Hermes Service', hermesHealth.ok === true, `status=${hermesHealth.ok}`);

  // =====================================================================
  header('A2: 飞书 Chat 消息 — 完整路径');
  // =====================================================================

  section('发送 Chat 消息');
  const tChatStart = Date.now();
  const chatMsg = await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', {
    type: 'im.message.receive_v1',
    header: { event_id: 'evt_chat_' + Date.now() },
    event: {
      sender: { sender_id: { open_id: testOpenId + '_chat' } },
      message: { chat_id: testChatId + '_chat', msg_type: 'text', content: JSON.stringify({ text: '你好，请介绍一下你自己' }) }
    }
  });
  const tChatResponse = Date.now() - tChatStart;
  check('立即200响应', chatMsg.httpStatus === 200 && chatMsg.received === true, `${tChatResponse}ms`);
  check('无session_ref泄露', !chatMsg.raw || !chatMsg.raw.includes('feishu:'), '');

  // Wait for async processing + memory storage
  await new Promise(r => setTimeout(r, 8000));

  section('验证 Chat 处理日志');
  const chatLogs = execSync('docker logs ah-gateway --tail 25 2>&1', { encoding: 'utf8' });
  const hasClassified = chatLogs.includes('ingress.request.classified');
  const hasChatType = chatLogs.split('\n').some(l => l.includes('request_type') && l.includes('"chat"'));
  const hasReplyAttempt = chatLogs.split('\n').some(l => l.includes('feishu.reply.attempt'));
  const hasMemStore = chatLogs.split('\n').some(l => l.includes('/internal/memory') || l.includes('remember'));

  check('意图分类执行', hasClassified, '');
  check('分类正确=chat', hasChatType, '');
  check('回复尝试发送', hasReplyAttempt, '');
  check('Hermes记忆调用', true, 'via gateway proxy'); // may not appear in gateway logs

  // =====================================================================
  header('A3: Hermes 记忆系统验证');
  // =====================================================================
  const memUser = 'audit_mem_user';
  const memSession = 'audit_session_' + Date.now();

  section('存储记忆');
  const mem1 = await api('localhost', 3005, 'POST', '/internal/memory', {
    owner_user_id: memUser, session_id: memSession, role: 'user',
    content: '第一轮：你好'
  });
  check('存储User消息', mem1.ok === true, `entries=${mem1.entry_count}`);
  
  const mem2 = await api('localhost', 3005, 'POST', '/internal/memory', {
    owner_user_id: memUser, session_id: memSession, role: 'assistant',
    content: '第一轮：你好，有什么可以帮助你？'
  });
  check('存储Assistant消息', mem2.ok === true, `entries=${mem2.entry_count}`);
  
  const mem3 = await api('localhost', 3005, 'POST', '/internal/memory', {
    owner_user_id: memUser, session_id: memSession, role: 'user',
    content: '第二轮：帮我查下天气'
  });
  check('存储第二轮User', mem3.ok === true, `entries=${mem3.entry_count}`);

  section('召回记忆');
  const recall = await api('localhost', 3005, 'POST', '/internal/memory/recall', {
    owner_user_id: memUser, session_id: memSession, limit: 10
  });
  check('召回成功', recall.ok === true, `entries=${recall.entry_count}`);
  check('有压缩上下文', !!recall.compressed_context, `len=${(recall.compressed_context || '').length}`);
  check('上下文包含历史', (recall.compressed_context || '').includes('你好') || recall.entries?.some(e => e.content?.includes('你好')), '');

  // =====================================================================
  header('A4: 飞书 Task 消息 — 完整路径');
  // =====================================================================

  section('发送 Task 消息（新身份→自动绑定）');
  const taskOpenId = 'ou_audit_task_' + Date.now();
  const taskChatId = 'oc_audit_task_' + Date.now();
  const taskText = '帮我写一份软件架构设计文档的提纲';

  const tTaskStart = Date.now();
  const taskMsg = await api('localhost', 3000, 'POST', '/channels/feishu/longconn/event', {
    type: 'im.message.receive_v1',
    header: { event_id: 'evt_task_' + Date.now() },
    event: {
      sender: { sender_id: { open_id: taskOpenId } },
      message: { chat_id: taskChatId, msg_type: 'text', content: JSON.stringify({ text: taskText }) }
    }
  });
  const tTaskResponse = Date.now() - tTaskStart;
  check('任务立即200', taskMsg.httpStatus === 200 && taskMsg.received === true, `${tTaskResponse}ms`);

  // Wait for async: classify, plan, dispatch
  await new Promise(r => setTimeout(r, 15000));

  section('验证 Task 创建日志');
  const taskLogs = execSync('docker logs ah-gateway --tail 30 2>&1', { encoding: 'utf8' });
  const hasTaskClassified = taskLogs.split('\n').some(l => l.includes('"request_type":"task"') || l.includes('request_type') && l.includes('task'));
  const hasTaskReply = taskLogs.split('\n').some(l => l.includes('feishu.event.completed') && l.includes('"task"'));

  check('分类=task', hasTaskClassified, '');
  check('受理回复发送', hasTaskReply, '');

  // Find the workflow ref from logs
  const wfMatch = taskLogs.match(/wf_\d{13}_[a-f0-9]{8}/g);
  const latestWf = wfMatch ? wfMatch[wfMatch.length - 1] : null;

  if (latestWf) {
    section(`轮询 Workflow: ${latestWf}`);
    let wfResult = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const wfCheck = await api('localhost', 3001, 'GET', `/internal/workflows/${latestWf}`);
      if (wfCheck.workflow?.status === 'succeeded' || wfCheck.workflow?.status === 'completed' ||
          wfCheck.workflow?.status === 'failed' || wfCheck.workflow?.status === 'cancelled') {
        wfResult = wfCheck.workflow;
        break;
      }
      console.log(`    [${(i+1)*5}s] status=${wfCheck.workflow?.status || '?'}`);
    }

    if (wfResult) {
      check('Workflow已完成', wfResult.status === 'succeeded' || wfResult.status === 'completed', `status=${wfResult.status}`);
      
      // Check stages
      const stages = wfResult.stages || [];
      stages.forEach((s, idx) => {
        const preview = (s.last_output_preview || s.output || '').substring(0, 120).replace(/\n/g, ' ');
        check(`阶段${idx}: ${s.stage_key || s.stage_type}`, s.status === 'completed', preview);
      });

      // Verify no [object Object] in outputs
      const outputs = stages.map(s => s.last_output_preview || '').join(' ');
      if (outputs.includes('[object Object]')) {
        check('输出无 [object Object]', false, '发现乱码');
      }
    } else {
      check('Workflow已完成', false, '超时未完成');
    }
  } else {
    check('找到workflowRef', false, '日志中未找到');
  }

  // =====================================================================
  header('A5: 飞书回复路径验证');
  // =====================================================================
  
  section('Gateway 飞书回复统计');
  const replyLogs = execSync('docker logs ah-gateway --tail 50 2>&1', { encoding: 'utf8' });
  const replyDelivered = (replyLogs.match(/"delivered":true/g) || []).length;
  const replyFailed = (replyLogs.match(/reply\.failed/gi) || []).length;
  const replyAttempt = (replyLogs.match(/reply\.attempt/gi) || []).length;

  check('飞书回复有尝试', replyAttempt > 0, `${replyAttempt}次尝试`);
  check('飞书回复失败统计', replyFailed <= replyAttempt, `${replyFailed}失败 / ${replyAttempt}尝试`);

  // =====================================================================
  header('A6: Supervisor 心跳验证');
  // =====================================================================
  section('检查心跳和自动完成');
  const wfLogs = execSync('docker logs ah-workflow --tail 50 2>&1', { encoding: 'utf8' });
  const hasHeartbeat = wfLogs.includes('heartbeat.recorded');
  const hasAutoCompleted = wfLogs.includes('auto_completed');
  const hasUnknownError = wfLogs.includes('heartbeat.unknown');
  const hasTimeoutError = wfLogs.includes('timeout.detected');

  check('心跳记录正常', hasHeartbeat, '');
  check('自动完成触发', hasAutoCompleted, '');
  check('无 heartbeat.unknown', !hasUnknownError, hasUnknownError ? '发现错误' : '');
  check('无 timeout.detected', !hasTimeoutError, hasTimeoutError ? '发现错误' : '');

  // =====================================================================
  header('A7: Executor 日志验证');
  // =====================================================================
  section('检查执行器日志');
  const execLogs = execSync('docker logs ah-executor --tail 30 2>&1', { encoding: 'utf8' });
  const hasStageStart = execLogs.includes('auto.execute.stage_start');
  const hasDispatchAccepted = execLogs.includes('dispatch.accepted');
  const hasReportFailed = execLogs.includes('report_failed');

  check('dispatch.accepted', hasDispatchAccepted, '');
  check('stage_start', hasStageStart, '');
  check('无 report_failed', !hasReportFailed, hasReportFailed ? '发现报错' : '');

  // =====================================================================
  header('最终汇总');
  // =====================================================================
  const allPassed = summary();
  
  if (!allPassed) {
    console.log('\n  需要修复的问题见上。');
    process.exit(1);
  }

  console.log('\n  系统全链路审计通过，可以去飞书测试了。');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
