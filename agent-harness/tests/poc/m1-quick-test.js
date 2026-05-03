#!/usr/bin/env node

const WORKFLOW_URL = 'http://localhost:3001';
const EXECUTOR_URL = 'http://localhost:3002';
const GATEWAY_URL = 'http://localhost:3000';

async function fetchWithTimeout(url, options, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    const text = await response.text();
    try {
      return { ok: response.ok, status: response.status, body: JSON.parse(text) };
    } catch {
      return { ok: response.ok, status: response.status, body: text };
    }
  } catch (err) {
    clearTimeout(id);
    return { ok: false, status: 0, error: err.message };
  }
}

async function getJson(url, timeout = 5000) {
  return fetchWithTimeout(url, {}, timeout);
}

async function postJson(url, payload, timeout = 10000) {
  return fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }, timeout);
}

const results = { passed: 0, failed: 0, details: [] };

console.log('=== M1 快速PoC测试 ===\n');

async function testHealth() {
  console.log('1. 健康检查...');
  const checks = [
    { name: 'workflow', url: `${WORKFLOW_URL}/health/live` },
    { name: 'executor', url: `${EXECUTOR_URL}/health/live` },
    { name: 'gateway', url: `${GATEWAY_URL}/health/live` }
  ];
  for (const c of checks) {
    const r = await getJson(c.url, 3000);
    if (r.ok && r.body?.ok) {
      console.log(`  ✓ ${c.name} 健康`);
      results.passed++;
    } else {
      console.log(`  ✗ ${c.name} 失败`);
      results.failed++;
    }
  }
}

async function testUnboundIdentity() {
  console.log('\n2. 未绑定身份测试...');
  const r = await postJson(`${GATEWAY_URL}/internal/channel-ingress/normalize`, {
    channel_identity: 'unknown',
    session_hint: { channel_type: 'web_portal' },
    request_text: '测试'
  }, 3000);
  if (r.body?.identity_binding_state === 'pending') {
    console.log('  ✓ 返回binding_required');
    results.passed++;
  } else {
    console.log('  ✗ 失败');
    results.failed++;
  }
}

async function testWorkflowCreate() {
  console.log('\n3. Workflow创建测试 (5次快速)...');
  for (let i = 0; i < 5; i++) {
    const r = await postJson(`${WORKFLOW_URL}/internal/workflows/plan`, {
      user_id: `u_test${i}`,
      user_goal: `快速测试${i}`,
      task_type_hint: 'knowledge',
      risk_level: 'low',
      policy_snapshot_hash: `sha256:quick${i}_0000000000000000000000000000000000000000000000000`,
      budget: { time_sec: 60, retrieval: 1, execution: 1 }
    }, 8000);
    if (r.ok && r.body?.workflow_instance_ref) {
      console.log(`  ✓ 第${i+1}次成功`);
      results.passed++;
    } else {
      console.log(`  ✗ 第${i+1}次失败: ${r.error || r.status}`);
      results.failed++;
    }
  }
}

async function testCheckpoint() {
  console.log('\n4. Checkpoint测试...');
  const r = await postJson(`${WORKFLOW_URL}/internal/checkpoints/create`, {
    workflow_instance_id: 'wf_test_cp',
    workflow_stage_id: 'st_test',
    checkpoint_type: 'stage-enter',
    policy_snapshot_hash: 'sha256:cp_test_000000000000000000000000000000000000000000000000',
    status_snapshot: { test: true },
    next_action: 'continue'
  }, 5000);
  if (r.ok && r.body?.resume_token) {
    console.log('  ✓ Checkpoint创建成功');
    results.passed++;
    
    const resumeR = await postJson(`${WORKFLOW_URL}/internal/checkpoints/resume`, {
      resume_token: r.body.resume_token,
      policy_snapshot_hash: 'sha256:cp_test_000000000000000000000000000000000000000000000000'
    }, 3000);
    if (resumeR.ok) {
      console.log('  ✓ Resume成功');
      results.passed++;
    } else {
      console.log('  ✗ Resume失败');
      results.failed++;
    }
    
    const wrongR = await postJson(`${WORKFLOW_URL}/internal/checkpoints/resume`, {
      resume_token: r.body.resume_token,
      policy_snapshot_hash: 'sha256:wrong_00000000000000000000000000000000000000000000000000'
    }, 3000);
    if (!wrongR.ok && wrongR.body?.error === 'policy_snapshot_hash_mismatch') {
      console.log('  ✓ 错误hash被拒绝');
      results.passed++;
    } else {
      console.log('  ✗ 错误hash未被拒绝');
      results.failed++;
    }
  } else {
    console.log(`  ✗ Checkpoint创建失败: ${r.error || JSON.stringify(r.body)}`);
    results.failed++;
  }
}

async function main() {
  try {
    await testHealth();
    await testUnboundIdentity();
    await testWorkflowCreate();
    await testCheckpoint();
    
    console.log('\n=== 结果 ===');
    console.log(`通过: ${results.passed}, 失败: ${results.failed}`);
    console.log(results.failed === 0 ? '✓ 全部通过' : '✗ 存在失败');
    process.exit(results.failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('错误:', err);
    process.exit(1);
  }
}

main();