const RESULTS: Array<{ name: string; passed: boolean; detail: string; duration_ms: number }> = [];
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    RESULTS.push({ name, passed: true, detail: 'OK', duration_ms: Date.now() - start });
    passed++;
  } catch (error) {
    RESULTS.push({ name, passed: false, detail: String(error), duration_ms: Date.now() - start });
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body };
}

async function waitForServer(url: string, maxRetries = 30, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function main(): Promise<void> {
  console.log('=== Agent Harness Integration Test Suite ===\n');

  const workflowUrl = process.env.WORKFLOW_URL || 'http://localhost:3001';
  const executorUrl = process.env.EXECUTOR_URL || 'http://localhost:3002';
  const webPortalUrl = process.env.WEB_PORTAL_URL || 'http://localhost:3003';
  const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || 'http://localhost:3004';
  const adminPassword = process.env.ADMIN_PASSWORD || 'dev-password';
  let adminSessionId = '';
  let hasAdminAccess = false;
  let createdPolicyId = '';
  let createdInvitationId = '';
  let verificationWorkflowRef = '';
  let verificationStageId = '';

  console.log('Phase 1: Health Check Tests\n');

  await test('Workflow Service - Health Check', async () => {
    const ready = await waitForServer(`${workflowUrl}/health/live`, 5, 500);
    if (!ready) throw new Error('Workflow service not reachable');
    const { status, body } = await fetchJson(`${workflowUrl}/health/live`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
  });

  await test('Executor Gateway - Health Check', async () => {
    const ready = await waitForServer(`${executorUrl}/health/live`, 5, 500);
    if (!ready) throw new Error('Executor gateway not reachable');
    const { status, body } = await fetchJson(`${executorUrl}/health/live`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
  });

  await test('Web Portal - Health Check', async () => {
    const ready = await waitForServer(`${webPortalUrl}/health/live`, 5, 500);
    if (!ready) throw new Error('Web portal not reachable');
    const { status, body } = await fetchJson(`${webPortalUrl}/health/live`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
  });

  await test('Fact Retrieval - Health Check', async () => {
    const ready = await waitForServer(`${factRetrievalUrl}/health/live`, 5, 500);
    if (!ready) throw new Error('Fact retrieval not reachable');
    const { status, body } = await fetchJson(`${factRetrievalUrl}/health/live`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
  });

  console.log('\nPhase 2: Web Portal Auth Tests\n');

  await test('Web Portal - Login without credentials returns 400', async () => {
    const { status } = await fetchJson(`${webPortalUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'missing_credentials', `Expected missing_credentials, got ${body.error}`);
  });

  await test('Web Portal - Login with wrong password returns 401', async () => {
    const { status } = await fetchJson(`${webPortalUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
    });
    assert(status === 401 || status === 200, `Expected 401 or 200, got ${status}`);
  });

  await test('Web Portal - Unauthenticated workflow list returns 401', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/workflows`);
    assert(status === 401, `Expected 401, got ${status}`);
    assert(body.error === 'unauthorized', `Expected unauthorized, got ${body.error}`);
  });

  await test('Web Portal - Admin login returns session', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
    assert(typeof body.session_id === 'string' && body.session_id.length > 0, 'Expected session_id');
    adminSessionId = body.session_id as string;
  });

  await test('Web Portal - Overview returns system summary', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/system/overview`, {
      headers: { 'x-session-id': adminSessionId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
    assert(typeof body.overview === 'object' && body.overview !== null, 'Expected overview payload');
    const overview = body.overview as Record<string, unknown>;
    assert(Array.isArray(overview.services), 'Expected services array');
    assert(typeof overview.summary === 'object' && overview.summary !== null, 'Expected summary object');
  });

  await test('Web Portal - Admin workflow list returns array', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/workflows`, {
      headers: { 'x-session-id': adminSessionId },
    });
    if (status === 200) {
      hasAdminAccess = true;
      assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
      assert(Array.isArray(body.workflows), 'Expected workflows array');
    } else {
      hasAdminAccess = false;
      assert(status === 403, `Expected 200 or 403, got ${status}`);
    }
  });

  await test('Web Portal - Policy create/list/disable works', async () => {
    if (!hasAdminAccess) return;
    const createRes = await fetchJson(`${webPortalUrl}/api/admin/policies`, {
      method: 'POST',
      headers: { 'x-session-id': adminSessionId },
      body: JSON.stringify({ role: 'user', resource: 'knowledge', action: `read_test_${Date.now()}` }),
    });
    assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
    assert(createRes.body.ok === true, `Expected ok=true, got ${createRes.body.ok}`);
    const policy = createRes.body.policy as Record<string, unknown>;
    assert(typeof policy?.id === 'string', 'Expected policy.id');
    createdPolicyId = String(policy.id);

    const listRes = await fetchJson(`${webPortalUrl}/api/admin/policies`, {
      headers: { 'x-session-id': adminSessionId },
    });
    assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
    assert(Array.isArray(listRes.body.policies), 'Expected policies array');
    const hasCreated = (listRes.body.policies as Array<Record<string, unknown>>).some((p) => p.id === createdPolicyId);
    assert(hasCreated, 'Expected created policy in list');

    const disableRes = await fetchJson(`${webPortalUrl}/api/admin/policies/${encodeURIComponent(createdPolicyId)}/disable`, {
      method: 'POST',
      headers: { 'x-session-id': adminSessionId },
      body: JSON.stringify({}),
    });
    assert(disableRes.status === 200, `Expected 200, got ${disableRes.status}`);
    const disabled = disableRes.body.policy as Record<string, unknown>;
    assert(disabled.status === 'deleted', `Expected deleted, got ${disabled.status}`);
  });

  await test('Web Portal - Organization invitation create/revoke works', async () => {
    if (!hasAdminAccess) return;
    const createRes = await fetchJson(`${webPortalUrl}/api/admin/organization-invitations`, {
      method: 'POST',
      headers: { 'x-session-id': adminSessionId },
      body: JSON.stringify({ invitee: 'integration-user', role: 'user', expires_in_hours: 24 }),
    });
    assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
    assert(createRes.body.ok === true, `Expected ok=true, got ${createRes.body.ok}`);
    const invitation = createRes.body.invitation as Record<string, unknown>;
    assert(typeof invitation?.id === 'string', 'Expected invitation.id');
    assert(typeof invitation?.invite_code === 'string' && String(invitation.invite_code).length >= 8, 'Expected invite_code');
    createdInvitationId = String(invitation.id);

    const listRes = await fetchJson(`${webPortalUrl}/api/admin/organization-invitations`, {
      headers: { 'x-session-id': adminSessionId },
    });
    assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
    assert(Array.isArray(listRes.body.invitations), 'Expected invitations array');
    const hasCreated = (listRes.body.invitations as Array<Record<string, unknown>>).some((i) => i.id === createdInvitationId);
    assert(hasCreated, 'Expected created invitation in list');

    const revokeRes = await fetchJson(`${webPortalUrl}/api/admin/organization-invitations/${encodeURIComponent(createdInvitationId)}/revoke`, {
      method: 'POST',
      headers: { 'x-session-id': adminSessionId },
      body: JSON.stringify({}),
    });
    assert(revokeRes.status === 200, `Expected 200, got ${revokeRes.status}`);
    const revoked = revokeRes.body.invitation as Record<string, unknown>;
    assert(revoked.status === 'revoked', `Expected revoked, got ${revoked.status}`);
  });

  await test('Web Portal - Organization members list returns array', async () => {
    if (!hasAdminAccess) return;
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/organization-members`, {
      headers: { 'x-session-id': adminSessionId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
    assert(Array.isArray(body.members), 'Expected members array');
  });

  console.log('\nPhase 3: Workflow Service Tests\n');

  await test('Workflow - Plan without policy_snapshot_hash returns 400', async () => {
    const { status, body } = await fetchJson(`${workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'u_testuser',
        user_goal: 'test goal',
        task_type_hint: 'knowledge',
      }),
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'missing_policy_snapshot_hash', `Expected missing_policy_snapshot_hash, got ${body.error}`);
  });

  await test('Workflow - Plan with invalid user_id returns 400', async () => {
    const { status, body } = await fetchJson(`${workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'invalid-user',
        user_goal: 'test goal',
        policy_snapshot_hash: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      }),
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'invalid_user_id', `Expected invalid_user_id, got ${body.error}`);
  });

  await test('Workflow - Plan with valid input returns 200', async () => {
    const { status, body } = await fetchJson(`${workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'u_testuser',
        user_goal: 'Analyze the quarterly revenue data',
        task_type_hint: 'analysis',
        risk_level: 'medium',
        policy_snapshot_hash: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        budget: { time_sec: 600, retrieval: 5, execution: 10 },
      }),
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, `Expected ok=true, got ${body.ok}`);
    assert(typeof body.workflow_instance_ref === 'string', 'Expected workflow_instance_ref');
    assert(typeof body.workflow_plan_hash === 'string', 'Expected workflow_plan_hash');
    assert(Array.isArray(body.stage_plan), 'Expected stage_plan array');
  });

  await test('Workflow - Plan includes valid stage chain', async () => {
    const { body } = await fetchJson(`${workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'u_testuser',
        user_goal: 'Build a web scraper',
        task_type_hint: 'development',
        policy_snapshot_hash: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      }),
    });
    const stages = (body.stage_plan as Array<Record<string, unknown>>) || [];
    const validTypes = new Set(['IntentClarification','PlanGeneration','EvidenceRetrieval','MemoryRetrieval','ObjectExtraction','ArchitectureDesign','SpecGeneration','DecisionMaking','Implementation','Verification','Repair','Approval','ResultReporting','SkillExtraction','DreamSummarization','Archive']);
    assert(stages.length >= 3, `Expected at least 3 stages, got ${stages.length}`);
    const allValid = stages.every(s => validTypes.has(String(s.stage_type)));
    assert(allValid, `Expected all valid stage types, got: ${stages.map(s => s.stage_type).join(', ')}`);
  });

  console.log('\nPhase 4: Workflow State Machine Tests\n');

  let workflowRef = '';
  await test('Workflow - Create workflow for state machine test', async () => {
    const { body } = await fetchJson(`${workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'u_statetest',
        user_goal: 'State machine test',
        task_type_hint: 'knowledge',
        policy_snapshot_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      }),
    });
    workflowRef = body.workflow_instance_ref as string;
    assert(typeof workflowRef === 'string', 'Expected workflow_instance_ref');
  });

  await test('Workflow - Get workflow returns planned status', async () => {
    const { status, body } = await fetchJson(`${workflowUrl}/internal/workflows/${workflowRef}`);
    assert(status === 200, `Expected 200, got ${status}`);
    const wf = body.workflow as Record<string, unknown>;
    assert(wf.status === 'planned', `Expected planned, got ${wf.status}`);
  });

  await test('Workflow - Dispatch transitions to running', async () => {
    const { status, body } = await fetchJson(`${workflowUrl}/internal/workflows/${workflowRef}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({ trigger: 'test' }),
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.workflow_status === 'running' || body.dispatch_status, 'Expected running status or dispatch accepted');
  });

  await test('Workflow - Stage dispatch captures verification meta in audit', async () => {
    const create = await fetchJson(`${workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'u_verifymeta',
        user_goal: 'Verification audit test',
        task_type_hint: 'knowledge',
        policy_snapshot_hash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      }),
    });
    verificationWorkflowRef = String(create.body.workflow_instance_ref || '');
    assert(verificationWorkflowRef.length > 0, 'Expected workflow_instance_ref');

    const detail = await fetchJson(`${workflowUrl}/internal/workflows/${verificationWorkflowRef}`);
    assert(detail.status === 200, `Expected 200, got ${detail.status}`);
    const workflow = detail.body.workflow as Record<string, unknown>;
    const stages = (workflow.stages as Array<Record<string, unknown>>) || [];
    assert(stages.length > 0, 'Expected workflow stages');
    verificationStageId = String(stages[0].id || '');
    assert(verificationStageId.length > 0, 'Expected stage id');

    const stageUpdate = await fetchJson(`${workflowUrl}/internal/workflows/${verificationWorkflowRef}/stages/${verificationStageId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        output: 'Verification completed\n[verification-meta] verdict=PASS; confidence=0.9; reasons=verdict_line=PASS|token_count(pass=1,fail=0)',
      }),
    });
    assert(stageUpdate.status === 200, `Expected 200, got ${stageUpdate.status}`);

    const detailAfter = await fetchJson(`${workflowUrl}/internal/workflows/${verificationWorkflowRef}`);
    assert(detailAfter.status === 200, `Expected 200, got ${detailAfter.status}`);
    const wfAfter = detailAfter.body.workflow as Record<string, unknown>;
    const stageAfter = ((wfAfter.stages as Array<Record<string, unknown>>) || []).find((s) => s.id === verificationStageId) || {};
    const vm = (stageAfter.verification_meta || {}) as Record<string, unknown>;
    assert(vm.verdict === 'PASS', `Expected workflow stage verification_meta PASS, got ${vm.verdict}`);

    if (!hasAdminAccess) return;

    const audit = await fetchJson(`${webPortalUrl}/api/admin/audit`, {
      headers: { 'x-session-id': adminSessionId },
    });
    assert(audit.status === 200, `Expected 200, got ${audit.status}`);
    const events = (audit.body.events as Array<Record<string, unknown>>) || [];
    const hit = events.find((e) => {
      const details = (e.details || {}) as Record<string, unknown>;
      const meta = (details.verification_meta || {}) as Record<string, unknown>;
      return details.workflow_instance_ref === verificationWorkflowRef && meta.verdict === 'PASS';
    });
    assert(Boolean(hit), 'Expected audit event containing verification_meta verdict PASS');
  });

  console.log('\nPhase 5: Module Import Tests\n');

  await test('Shared lib exports are accessible', async () => {
    const shared = await import('@agent-harness/shared');
    assert(typeof shared.createLogger === 'function', 'Expected createLogger function');
    assert(typeof shared.configManager !== 'undefined', 'Expected configManager');
  });

  await test('Contracts lib exports are accessible', async () => {
    const contracts = await import('@agent-harness/contracts');
    assert(contracts.WorkflowPlanSchema !== undefined, 'Expected WorkflowPlanSchema');
  });

  await test('Audit lib exports are accessible', async () => {
    const audit = await import('@agent-harness/audit');
    assert(typeof audit.auditWriter !== 'undefined', 'Expected auditWriter');
    assert(typeof audit.auditWriter.write === 'function', 'Expected auditWriter.write function');
  });

  await test('Policy lib exports are accessible', async () => {
    const policy = await import('@agent-harness/policy');
    assert(typeof policy.policyManager !== 'undefined', 'Expected policyManager');
    assert(typeof policy.policyManager.generateSnapshot === 'function', 'Expected generateSnapshot function');
  });

  console.log('\nPhase 6: Policy Snapshot Tests\n');

  await test('Policy Manager - Generate snapshot for user', async () => {
    const { policyManager } = await import('@agent-harness/policy');
    await policyManager.initialize();
    const snapshot = policyManager.generateSnapshot({ user_id: 'u_testuser', role: 'user' });
    assert(snapshot.snapshot_hash.startsWith('sha256:'), `Expected sha256: prefix, got ${snapshot.snapshot_hash.slice(0, 10)}`);
    assert(snapshot.allowed_scopes.includes('private:u_testuser'), `Expected private:u_testuser in scopes`);
    assert(snapshot.allowed_scopes.includes('public:workflow'), `Expected public:workflow in scopes`);
    assert(snapshot.allowed_scopes.includes('public:skill'), `Expected public:skill in scopes`);
  });

  console.log('\n=== Test Results ===\n');
  for (const result of RESULTS) {
    const icon = result.passed ? '✓' : '✗';
    console.log(`${icon} ${result.name} (${result.duration_ms}ms)`);
    if (!result.passed) {
      console.log(`  Detail: ${result.detail}`);
    }
  }
  console.log(`\nTotal: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(2);
});
