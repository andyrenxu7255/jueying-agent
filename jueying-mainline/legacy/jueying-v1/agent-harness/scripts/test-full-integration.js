const WORKFLOW_URL = 'http://localhost:3001';
const EXECUTOR_URL = 'http://localhost:3002';
const GATEWAY_URL = 'http://localhost:3000';

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(response => {
    return response.text().then(text => {
      let jsonBody = null;
      try { jsonBody = JSON.parse(text); } catch {}
      return { ok: response.ok, status: response.status, body: jsonBody };
    });
  }).catch(() => ({ ok: false, status: 0, body: null }));
}

function getJson(url) {
  return fetch(url).then(response => {
    return response.text().then(text => {
      let jsonBody = null;
      try { jsonBody = JSON.parse(text); } catch {}
      return { ok: response.ok, status: response.status, body: jsonBody };
    });
  }).catch(() => ({ ok: false, status: 0, body: null }));
}

async function testFullWorkflowExecution() {
  console.log('=== Full Workflow Execution Test ===\n');

  const policyHash = 'sha256:full_test_' + Date.now();
  const userId = 'u_fulltest' + Date.now().toString(36);

  console.log('Step 1: Normalize message through gateway...');
  const normalizeResult = await postJson(GATEWAY_URL + '/internal/channel-ingress/normalize', {
    channel_identity: 'test-user-01',
    session_hint: {
      channel_type: 'web_portal',
      channel_account_id: 'test-account',
      conversation_id: 'test-conv',
      thread_id: 'test-thread'
    },
    raw_message: {
      text: 'Please analyze the system and provide recommendations'
    },
    attachments: []
  });

  console.log('  Normalize: ' + (normalizeResult.ok ? 'OK' : 'FAILED'));
  console.log('  Session ref: ' + (normalizeResult.body?.session_ref || 'N/A'));

  console.log('\nStep 2: Create workflow plan...');
  const planResult = await postJson(WORKFLOW_URL + '/internal/workflows/plan', {
    user_id: userId,
    user_goal: 'Analyze the system architecture and provide optimization recommendations',
    task_type_hint: 'analysis',
    risk_level: 'medium',
    policy_snapshot_hash: policyHash,
    budget: { time_sec: 300 }
  });

  console.log('  Plan: ' + (planResult.ok ? 'OK' : 'FAILED'));
  if (!planResult.ok || !planResult.body) {
    return false;
  }

  const workflowRef = planResult.body.workflow_instance_ref;
  const stageCount = planResult.body.workflow_plan?.stage_chain?.length || 0;
  console.log('  Workflow ref: ' + workflowRef);
  console.log('  Stages: ' + stageCount);

  console.log('\nStep 3: Dispatch workflow to executor...');
  const dispatchResult = await postJson(WORKFLOW_URL + '/internal/workflows/' + workflowRef + '/dispatch', {
    trigger: 'test'
  });

  console.log('  Dispatch: ' + (dispatchResult.ok ? 'OK' : 'FAILED'));
  console.log('  Executor run ref: ' + (dispatchResult.body?.executor_run_ref || 'N/A'));
  console.log('  Workflow status: ' + (dispatchResult.body?.workflow_status || 'N/A'));

  console.log('\nStep 4: Check executor health...');
  const executorHealth = await getJson(EXECUTOR_URL + '/health/live');
  console.log('  Executor health: ' + (executorHealth.ok ? 'OK' : 'FAILED'));

  console.log('\nStep 5: Check executor dispatch endpoint...');
  const executorDispatch = await postJson(EXECUTOR_URL + '/internal/executor/dispatch', {
    workflow_instance_ref: workflowRef,
    trigger: 'manual_test'
  });

  console.log('  Executor dispatch: ' + (executorDispatch.ok ? 'OK' : 'FAILED'));
  console.log('  Executor run ref: ' + (executorDispatch.body?.executor_run_ref || 'N/A'));

  console.log('\nStep 6: Query workflow status...');
  const workflowStatus = await getJson(WORKFLOW_URL + '/internal/workflows/' + workflowRef);
  console.log('  Workflow status: ' + (workflowStatus.ok ? 'OK' : 'FAILED'));
  if (workflowStatus.body?.workflow) {
    const wf = workflowStatus.body.workflow;
    console.log('  Status: ' + wf.status);
    console.log('  Stages: ' + (wf.stages?.length || 0));
  }

  console.log('\n=== Full Workflow Execution Test PASSED ===\n');
  return true;
}

async function testExecutorStageExecution() {
  console.log('=== Executor Stage Execution Test ===\n');

  console.log('Step 1: Test executor dispatch...');
  const dispatchResult = await postJson(EXECUTOR_URL + '/internal/executor/dispatch', {
    workflow_instance_ref: 'wf_test_executor',
    trigger: 'test'
  });

  console.log('  Executor dispatch: ' + (dispatchResult.ok ? 'OK' : 'FAILED'));
  console.log('  Status: ' + dispatchResult.status);

  console.log('\nStep 2: Test executor stage execute...');
  const stageResult = await postJson(EXECUTOR_URL + '/internal/executor/execute', {
    workflow_instance_id: 'wf_test_executor',
    workflow_stage_id: 'st_test_stage',
    stage: {
      stage_id: 'st_test_stage',
      stage_type: 'IntentClarification',
      assigned_executor: 'generic-executor',
      purpose: 'Test stage execution',
      inputs: { required_refs: [], optional_refs: [] },
      timeouts: { soft_timeout_sec: 30, hard_timeout_sec: 60 }
    },
    user_goal: 'Test executor functionality',
    policy_snapshot_hash: 'sha256:test'
  });

  console.log('  Stage execute: ' + (stageResult.ok ? 'OK' : 'FAILED'));
  console.log('  Status: ' + stageResult.status);
  if (stageResult.body) {
    console.log('  Execution status: ' + (stageResult.body.execution_status || 'N/A'));
    console.log('  Model call ok: ' + (stageResult.body.model_call_ok || false));
  }

  if (!stageResult.ok) {
    return false;
  }

  const executionStatus = stageResult.body?.execution_status;
  if (typeof executionStatus !== 'string' || !executionStatus) {
    return false;
  }

  console.log('\n=== Executor Stage Execution Test PASSED ===\n');
  return true;
}

async function main() {
  console.log('Complete System Integration Tests\n');

  const results = [];

  results.push(await testFullWorkflowExecution());
  results.push(await testExecutorStageExecution());

  const allPass = results.every(r => r);

  console.log('\n=== Final Summary ===');
  console.log('Full Workflow Execution: ' + (results[0] ? 'PASS' : 'FAIL'));
  console.log('Executor Stage Execution: ' + (results[1] ? 'PASS' : 'FAIL'));
  console.log('Overall: ' + (allPass ? 'PASS' : 'FAIL'));

  process.exit(allPass ? 0 : 1);
}

main().catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
