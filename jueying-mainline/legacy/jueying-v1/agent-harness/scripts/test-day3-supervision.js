const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://agent_harness:dev_password@localhost:5432/agent_harness';
const WORKFLOW_URL = process.env.WORKFLOW_URL || 'http://localhost:3001';

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

async function testCheckpointResume() {
  const details = [];
  console.log('=== Test: Checkpoint Resume Verification ===\n');

  const policyHash = 'sha256:test_policy_' + Date.now();
  const userId = 'u_test' + Date.now().toString(36);

  console.log('Step 1: Create workflow plan...');
  const planResult = await postJson(WORKFLOW_URL + '/internal/workflows/plan', {
    user_id: userId,
    user_goal: 'Test checkpoint resume functionality',
    task_type_hint: 'knowledge',
    policy_snapshot_hash: policyHash,
    budget: { time_sec: 300 }
  });

  details.push({ step: 'plan', ok: planResult.ok, status: planResult.status });
  console.log('  Plan result: ' + (planResult.ok ? 'OK' : 'FAILED') + ' (status ' + planResult.status + ')');

  if (!planResult.ok || !planResult.body) {
    return { pass: false, details };
  }

  const workflowRef = planResult.body.workflow_instance_ref;
  console.log('  Workflow ref: ' + workflowRef);

  console.log('\nStep 2: Create checkpoint...');
  const checkpointResult = await postJson(WORKFLOW_URL + '/internal/checkpoints/create', {
    workflow_instance_id: workflowRef,
    workflow_stage_id: 'st_test_checkpoint',
    checkpoint_type: 'paused',
    policy_snapshot_hash: policyHash,
    status_snapshot: { test_state: 'paused_for_verification', step: 1 },
    artifact_refs: ['artifact_test_1'],
    fact_write_refs: ['fact_test_1'],
    notes: 'Test checkpoint before interruption',
    next_action: 'resume_to_step_2'
  });

  details.push({ step: 'checkpoint_create', ok: checkpointResult.ok, status: checkpointResult.status });
  console.log('  Create checkpoint: ' + (checkpointResult.ok ? 'OK' : 'FAILED'));

  if (!checkpointResult.ok || !checkpointResult.body) {
    return { pass: false, details };
  }

  const resumeToken = checkpointResult.body.resume_token;
  console.log('  Resume token: ' + resumeToken);

  console.log('\nStep 3: Resume from checkpoint (same policy)...');
  const resumeResult = await postJson(WORKFLOW_URL + '/internal/checkpoints/resume', {
    resume_token: resumeToken,
    policy_snapshot_hash: policyHash
  });

  details.push({ step: 'resume_same_policy', ok: resumeResult.ok, status: resumeResult.status });
  console.log('  Resume (same policy): ' + (resumeResult.ok ? 'OK' : 'FAILED'));

  if (!resumeResult.ok || !resumeResult.body) {
    return { pass: false, details };
  }

  const policyHashValid = resumeResult.body.policy_hash_valid;
  console.log('  Policy hash valid: ' + policyHashValid);

  if (!policyHashValid) {
    details.push({ step: 'policy_validation', error: 'Policy hash should be valid' });
    return { pass: false, details };
  }

  console.log('\nStep 4: Resume from checkpoint (wrong policy - should fail)...');
  const wrongResumeResult = await postJson(WORKFLOW_URL + '/internal/checkpoints/resume', {
    resume_token: resumeToken,
    policy_snapshot_hash: 'sha256:wrong_policy_hash'
  });

  details.push({ step: 'resume_wrong_policy', ok: wrongResumeResult.ok, status: wrongResumeResult.status });
  console.log('  Resume (wrong policy): ' + (wrongResumeResult.ok ? 'OK (unexpected)' : 'FAILED (expected)'));

  if (wrongResumeResult.ok) {
    details.push({ step: 'wrong_policy_validation', error: 'Resume should fail with wrong policy' });
    return { pass: false, details };
  }

  console.log('\n=== Checkpoint Resume Test PASSED ===\n');
  return { pass: true, details };
}

async function testHeartbeatAndProgress() {
  const details = [];
  console.log('=== Test: Heartbeat and Progress Monitoring ===\n');

  const policyHash = 'sha256:test_heartbeat_' + Date.now();
  const userId = 'u_hb' + Date.now().toString(36);

  console.log('Step 1: Create workflow...');
  const planResult = await postJson(WORKFLOW_URL + '/internal/workflows/plan', {
    user_id: userId,
    user_goal: 'Test heartbeat and progress monitoring',
    task_type_hint: 'development',
    policy_snapshot_hash: policyHash,
    budget: { time_sec: 600 }
  });

  details.push({ step: 'plan', ok: planResult.ok, status: planResult.status });
  console.log('  Plan result: ' + (planResult.ok ? 'OK' : 'FAILED'));

  if (!planResult.ok || !planResult.body) {
    return { pass: false, details };
  }

  const workflowRef = planResult.body.workflow_instance_ref;
  console.log('  Workflow ref: ' + workflowRef);

  console.log('\nStep 2: Send heartbeat...');
  const heartbeatResult = await postJson(WORKFLOW_URL + '/internal/workflows/' + workflowRef + '/heartbeat', {
    stage_id: 'st_test_heartbeat',
    stage_seq: 1
  });

  details.push({ step: 'heartbeat', ok: heartbeatResult.ok, status: heartbeatResult.status });
  console.log('  Heartbeat result: ' + (heartbeatResult.ok ? 'OK' : 'FAILED'));

  if (!heartbeatResult.ok || !heartbeatResult.body) {
    return { pass: false, details };
  }

  const heartbeatStatus = heartbeatResult.body.heartbeat_status;
  console.log('  Heartbeat alive: ' + heartbeatStatus?.alive);
  console.log('  Grace periods: ' + heartbeatStatus?.grace_periods_remaining);

  console.log('\nStep 3: Get progress...');
  const progressResult = await getJson(WORKFLOW_URL + '/internal/workflows/' + workflowRef + '/progress');

  details.push({ step: 'progress_get', ok: progressResult.ok, status: progressResult.status });
  console.log('  Progress result: ' + (progressResult.ok ? 'OK' : 'FAILED'));

  if (!progressResult.ok || !progressResult.body) {
    return { pass: false, details };
  }

  const progress = progressResult.body.progress;
  console.log('  Progress status: ' + progress?.status);
  console.log('  Progress percentage: ' + progress?.progress_percentage + '%');
  console.log('  Elapsed seconds: ' + progress?.elapsed_seconds);

  console.log('\nStep 4: Update progress...');
  const updateResult = await postJson(WORKFLOW_URL + '/internal/workflows/' + workflowRef + '/progress', {
    stage_id: 'st_stage_2',
    stage_seq: 2,
    status: 'running',
    output_preview: 'Progress update test'
  });

  details.push({ step: 'progress_update', ok: updateResult.ok, status: updateResult.status });
  console.log('  Update result: ' + (updateResult.ok ? 'OK' : 'FAILED'));

  console.log('\n=== Heartbeat and Progress Test PASSED ===\n');
  return { pass: true, details };
}

async function main() {
  console.log('Day 3 Supervision and Persistence Tests\n');
  console.log('Workflow URL: ' + WORKFLOW_URL);

  const checkpointResult = await testCheckpointResume();
  const heartbeatResult = await testHeartbeatAndProgress();

  const allPass = checkpointResult.pass && heartbeatResult.pass;

  console.log('\n=== Final Summary ===');
  console.log('Checkpoint Resume: ' + (checkpointResult.pass ? 'PASS' : 'FAIL'));
  console.log('Heartbeat & Progress: ' + (heartbeatResult.pass ? 'PASS' : 'FAIL'));
  console.log('Overall: ' + (allPass ? 'PASS' : 'FAIL'));

  process.exit(allPass ? 0 : 1);
}

main().catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});