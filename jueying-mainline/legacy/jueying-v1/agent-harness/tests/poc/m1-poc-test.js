#!/usr/bin/env node

const WORKFLOW_URL = 'http://localhost:3001';
const EXECUTOR_URL = 'http://localhost:3002';
const GATEWAY_URL = 'http://localhost:3000';
const WEB_PORTAL_URL = 'http://localhost:3003';

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, body: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, body: text };
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, body: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, body: text };
  }
}

console.log('=== P0-1 PoC: OpenClaw与Workflow解耦接入 ===\n');

const results = {
  p0_1: { passed: 0, failed: 0, details: [] },
  p0_2: { passed: 0, failed: 0, details: [] }
};

async function runP0_1() {
  console.log('1. 测试健康检查...');
  
  const healthChecks = [
    { name: 'workflow-service', url: `${WORKFLOW_URL}/health/live` },
    { name: 'executor-gateway', url: `${EXECUTOR_URL}/health/live` },
    { name: 'gateway-adapter', url: `${GATEWAY_URL}/health/live` }
  ];
  
  for (const check of healthChecks) {
    const result = await getJson(check.url);
    if (result.ok && result.body?.ok) {
      console.log(`  ✓ ${check.name} 健康`);
      results.p0_1.passed++;
    } else {
      console.log(`  ✗ ${check.name} 不健康: ${result.status}`);
      results.p0_1.failed++;
      results.p0_1.details.push(`${check.name} health check failed`);
    }
  }

  console.log('\n2. 测试未绑定身份不创建Workflow...');
  
  const unboundRequest = await postJson(`${GATEWAY_URL}/internal/channel-ingress/normalize`, {
    channel_identity: 'unknown',
    session_hint: { channel_type: 'web_portal' },
    request_text: '帮我分析数据'
  });
  
  if (unboundRequest.body?.identity_binding_state === 'pending') {
    console.log('  ✓ 未绑定身份返回 binding_required');
    results.p0_1.passed++;
  } else {
    console.log(`  ✗ 未绑定身份处理错误: ${JSON.stringify(unboundRequest.body)}`);
    results.p0_1.failed++;
    results.p0_1.details.push('Unbound identity handling failed');
  }

  console.log('\n3. 测试10次连续请求创建Workflow...');
  
  let successCount = 0;
  let lastWorkflowRef = '';
  for (let i = 0; i < 10; i++) {
    const planResult = await postJson(`${WORKFLOW_URL}/internal/workflows/plan`, {
      user_id: `u_testuser${i}`,
      user_goal: `测试任务 ${i}`,
      task_type_hint: 'knowledge',
      risk_level: 'medium',
      policy_snapshot_hash: `sha256:test_hash_${i}_00000000000000000000000000000000000000000000000000000000`,
      budget: { time_sec: 300, retrieval: 5, execution: 10 }
    });
    
    if (planResult.ok && planResult.body?.workflow_instance_ref) {
      successCount++;
      lastWorkflowRef = planResult.body.workflow_instance_ref;
      console.log(`  ✓ 第${i + 1}次请求成功: ${planResult.body.workflow_instance_ref}`);
    } else {
      console.log(`  ✗ 第${i + 1}次请求失败: ${planResult.status}`);
      results.p0_1.details.push(`Request ${i + 1} failed`);
    }
  }
  
  if (successCount === 10) {
    results.p0_1.passed += 10;
    console.log(`  ✓ 全部10次请求成功`);
  } else {
    results.p0_1.failed += 10 - successCount;
    console.log(`  ✗ 只有${successCount}/10次成功`);
  }

  console.log('\n4. 测试dispatch触发执行...');
  
  if (!lastWorkflowRef) {
    console.log(`  ✗ dispatch失败: 没有可用的workflow`);
    results.p0_1.failed++;
    results.p0_1.details.push('Dispatch failed: no workflow');
  } else {
    const dispatchResult = await postJson(`${WORKFLOW_URL}/internal/workflows/${lastWorkflowRef}/dispatch`, {
      trigger: 'manual_test'
    });
  
  if (dispatchResult.ok && dispatchResult.body?.executor_run_ref) {
      console.log(`  ✓ dispatch成功: ${dispatchResult.body.executor_run_ref}`);
      results.p0_1.passed++;
    } else {
      console.log(`  ✗ dispatch失败: ${JSON.stringify(dispatchResult.body)}`);
      results.p0_1.failed++;
      results.p0_1.details.push('Dispatch failed');
    }
  }
}

async function runP0_2() {
  console.log('\n=== P0-2 PoC: Workflow+Checkpoint+Resume ===\n');
  
  console.log('1. 测试checkpoint创建...');
  
  const checkpointResult = await postJson(`${WORKFLOW_URL}/internal/checkpoints/create`, {
    workflow_instance_id: 'wf_test_checkpoint',
    workflow_stage_id: 'st_test_0',
    checkpoint_type: 'waiting-user',
    policy_snapshot_hash: 'sha256:test_policy_hash_00000000000000000000000000000000000000000000000',
    status_snapshot: { stage: 0, status: 'waiting_user' },
    notes: '等待用户输入',
    next_action: 'resume_with_input'
  });
  
  if (checkpointResult.ok && checkpointResult.body?.resume_token) {
    console.log(`  ✓ checkpoint创建成功: ${checkpointResult.body.checkpoint_id}`);
    console.log(`    resume_token: ${checkpointResult.body.resume_token}`);
    results.p0_2.passed++;
    
    console.log('\n2. 测试正确policy_snapshot_hash恢复...');
    
    const resumeResult = await postJson(`${WORKFLOW_URL}/internal/checkpoints/resume`, {
      resume_token: checkpointResult.body.resume_token,
      policy_snapshot_hash: 'sha256:test_policy_hash_00000000000000000000000000000000000000000000000'
    });
    
    if (resumeResult.ok && resumeResult.body?.ok) {
      console.log(`  ✓ 恢复成功，policy_hash一致`);
      results.p0_2.passed++;
    } else {
      console.log(`  ✗ 恢复失败: ${JSON.stringify(resumeResult.body)}`);
      results.p0_2.failed++;
      results.p0_2.details.push('Resume with correct hash failed');
    }
    
    console.log('\n3. 测试错误policy_snapshot_hash拒绝恢复...');
    
    const wrongHashResult = await postJson(`${WORKFLOW_URL}/internal/checkpoints/resume`, {
      resume_token: checkpointResult.body.resume_token,
      policy_snapshot_hash: 'sha256:wrong_hash_00000000000000000000000000000000000000000000000000000'
    });
    
    if (!wrongHashResult.ok && wrongHashResult.body?.error === 'policy_snapshot_hash_mismatch') {
      console.log(`  ✓ 恢复被正确拒绝: policy_snapshot_hash不一致`);
      results.p0_2.passed++;
    } else {
      console.log(`  ✗ 恢复未被拒绝: ${JSON.stringify(wrongHashResult.body)}`);
      results.p0_2.failed++;
      results.p0_2.details.push('Resume with wrong hash not rejected');
    }
  } else {
    console.log(`  ✗ checkpoint创建失败: ${JSON.stringify(checkpointResult.body)}`);
    results.p0_2.failed++;
    results.p0_2.details.push('Checkpoint creation failed');
  }

  console.log('\n4. 测试状态区分...');
  
  const testStates = ['waiting_user', 'blocked', 'paused'];
  
  for (const state of testStates) {
    const cpResult = await postJson(`${WORKFLOW_URL}/internal/checkpoints/create`, {
      workflow_instance_id: `wf_test_${state}`,
      workflow_stage_id: `st_test_${state}`,
      checkpoint_type: state === 'waiting_user' ? 'waiting-user' : state,
      policy_snapshot_hash: `sha256:test_${state}_hash_000000000000000000000000000000000000000000`,
      status_snapshot: { status: state },
      next_action: 'resume'
    });
    
    if (cpResult.ok) {
      console.log(`  ✓ ${state} checkpoint创建成功`);
      results.p0_2.passed++;
    } else {
      console.log(`  ✗ ${state} checkpoint创建失败`);
      results.p0_2.failed++;
      results.p0_2.details.push(`${state} checkpoint failed`);
    }
  }
}

async function main() {
  try {
    await runP0_1();
    await runP0_2();
    
    console.log('\n=== 测试结果汇总 ===\n');
    console.log(`P0-1: ${results.p0_1.passed} passed, ${results.p0_1.failed} failed`);
    if (results.p0_1.details.length > 0) {
      console.log('  失败详情:', results.p0_1.details);
    }
    
    console.log(`P0-2: ${results.p0_2.passed} passed, ${results.p0_2.failed} failed`);
    if (results.p0_2.details.length > 0) {
      console.log('  失败详情:', results.p0_2.details);
    }
    
    const allPassed = results.p0_1.failed === 0 && results.p0_2.failed === 0;
    console.log(`\n总结果: ${allPassed ? '✓ 全部通过' : '✗ 存在失败'}`);
    
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error('测试执行错误:', error);
    process.exit(1);
  }
}

main();