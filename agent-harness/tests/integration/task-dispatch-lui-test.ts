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

interface TaskDispatchState {
  gatewayUrl: string;
  webPortalUrl: string;
  createdTaskId: string;
  createdOrgId: string;
  testUserId: string;
  testAssignmentId: string;
}

async function main(): Promise<void> {
  console.log('=== Task Dispatch LUI Integration Test Suite ===\n');
  console.log('Target: Story #3 - 任务下发功能 (Web UI + 企业微信LUI)\n');

  const state: TaskDispatchState = {
    gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3000',
    webPortalUrl: process.env.WEB_PORTAL_URL || 'http://localhost:3003',
    createdTaskId: '',
    createdOrgId: '',
    testUserId: '',
    testAssignmentId: '',
  };

  // =========================================================
  // Phase 1: Service Health Checks
  // =========================================================
  console.log('Phase 1: Service Health Checks\n');

  await test('Gateway Adapter - Health Check', async () => {
    const ready = await waitForServer(`${state.gatewayUrl}/health`, 5, 500);
    assert(ready, 'Gateway adapter not reachable');
    const { status, body } = await fetchJson(`${state.gatewayUrl}/health`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true`);
    assert(body.service === 'gateway-adapter', 'Expected gateway-adapter service');
  });

  await test('Web Portal - Health Check', async () => {
    const { status, body } = await fetchJson(`${state.webPortalUrl}/health`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true`);
  });

  // =========================================================
  // Phase 2: Admin Task CRUD API Tests
  // =========================================================
  console.log('\nPhase 2: Admin Task CRUD API Tests\n');

  await test('POST /admin/tasks - Create task without required fields returns 400', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.ok === false, 'Expected ok=false');
    assert(body.error === 'missing_required_fields', `Expected missing_required_fields, got ${body.error}`);
  });

  await test('POST /admin/tasks - Create daily form task', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'LUI测试-每日拜访总结',
        description: '请按照模板提交每日客户拜访总结',
        task_type: 'form',
        schedule_type: 'daily',
        prompt_message: '请提交今日拜访总结：\n1. 拜访客户\n2. 洽谈内容\n3. 下一步计划',
        target_channels: ['wecom', 'feishu'],
        created_by: null,
      }),
    });
    assert(status === 201, `Expected 201, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(body.task != null, 'Expected task object');
    const task = body.task as Record<string, unknown>;
    assert(task.title === 'LUI测试-每日拜访总结', `Unexpected title: ${task.title}`);
    assert(task.task_type === 'form', `Unexpected task_type: ${task.task_type}`);
    assert(task.schedule_type === 'daily', `Unexpected schedule_type: ${task.schedule_type}`);
    assert(task.status === 'active', `Expected active status, got ${task.status}`);
    state.createdTaskId = String(task.id);
  });

  await test('POST /admin/tasks - Create workflow task', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'LUI测试-Q3业绩分析',
        description: '对Q3销售数据进行多维度分析并生成报告',
        task_type: 'workflow',
        schedule_type: 'once',
        prompt_message: '请执行Q3业绩分析工作流',
        target_channels: ['wecom'],
      }),
    });
    assert(status === 201, `Expected 201, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(body.task != null, 'Expected task object');
    const task = body.task as Record<string, unknown>;
    assert(task.task_type === 'workflow', `Unexpected task_type: ${task.task_type}`);
  });

  await test('POST /admin/tasks - Create heartbeat task with cron', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'LUI测试-系统心跳检测',
        description: '每天20:00检测agent在线状态',
        task_type: 'heartbeat',
        schedule_type: 'cron',
        cron_expression: '0 20 * * *',
        prompt_message: '心跳检测，请回复确认在线',
        target_channels: ['wecom'],
      }),
    });
    assert(status === 201, `Expected 201, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    const task = body.task as Record<string, unknown>;
    assert(task.cron_expression === '0 20 * * *', `Unexpected cron: ${task.cron_expression}`);
  });

  await test('GET /admin/tasks - List all tasks', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(Array.isArray(body.tasks), 'Expected tasks array');
    const tasks = body.tasks as Array<Record<string, unknown>>;
    assert(tasks.length >= 3, `Expected at least 3 tasks, got ${tasks.length}`);
  });

  await test(`PUT /admin/tasks/:id - Update task title and status`, async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks/${state.createdTaskId}`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'LUI测试-每日拜访总结(已更新)', status: 'paused' }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    const task = body.task as Record<string, unknown>;
    assert(String(task.title).includes('已更新'), `Unexpected title: ${task.title}`);
    assert(task.status === 'paused', `Expected paused, got ${task.status}`);
  });

  await test(`PUT /admin/tasks/:id - Resume task to active`, async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks/${state.createdTaskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'active' }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    const task = body.task as Record<string, unknown>;
    assert(task.status === 'active', `Expected active, got ${task.status}`);
  });

  // =========================================================
  // Phase 3: Task Assignment & Notification Tests
  // =========================================================
  console.log('\nPhase 3: Task Assignment & Notification Tests\n');

  await test('POST /internal/tasks/assign - Missing task_id returns 400', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/internal/tasks/assign`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'missing_task_id', `Expected missing_task_id, got ${body.error}`);
  });

  await test('POST /internal/tasks/assign - Assign task to all org users', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/internal/tasks/assign`, {
      method: 'POST',
      body: JSON.stringify({ task_id: state.createdTaskId }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    const assigned = Number(body.assigned);
    assert(!isNaN(assigned) && assigned > 0, `Expected assigned > 0, got ${body.assigned}`);
    const total = Number(body.total_users);
    assert(!isNaN(total) && total > 0, `Expected total_users > 0, got ${body.total_users}`);
  });

  await test('POST /internal/tasks/assign - Re-assign does not duplicate', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/internal/tasks/assign`, {
      method: 'POST',
      body: JSON.stringify({ task_id: state.createdTaskId }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    const assigned = Number(body.assigned);
    assert(assigned === 0, `Expected 0 assigned on re-assign, got ${body.assigned}`);
  });

  await test('POST /internal/tasks/notify - Notify assigned users', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/internal/tasks/notify`, {
      method: 'POST',
      body: JSON.stringify({ task_id: state.createdTaskId }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    const notified = Number(body.notified);
    assert(!isNaN(notified) && notified > 0, `Expected notified > 0, got ${body.notified}`);
  });

  await test('GET /admin/tasks - Verify completion stats after notification', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`);
    assert(status === 200, `Expected 200, got ${status}`);
    const tasks = body.tasks as Array<Record<string, unknown>>;
    const target = tasks.find((t: Record<string, unknown>) => String(t.id) === state.createdTaskId);
    assert(target != null, 'Created task not found in list');
    const totalCount = Number(target.total_count);
    assert(totalCount > 0, `Expected total_count > 0, got ${totalCount}`);
    const completedCount = Number(target.completed_count);
    assert(completedCount === 0, `Expected 0 completed, got ${completedCount}`);
  });

  // =========================================================
  // Phase 4: User Task List & Submit Tests
  // =========================================================
  console.log('\nPhase 4: User Task List & Submit Tests\n');

  await test('GET /tasks - Missing user_id returns 400', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/tasks`);
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'missing_user_id', `Expected missing_user_id, got ${body.error}`);
  });

  await test('GET /tasks?user_id - List tasks for specific user', async () => {
    const { status: userStatus, body: userBody } = await fetchJson(`${state.gatewayUrl}/tasks?user_id=3e1b0f95-7387-6035-4f3f-2855f28e1f12`);
    assert(userStatus === 200, `Expected 200, got ${userStatus}`);
    assert(userBody.ok === true, 'Expected ok=true');
    const assignments = userBody.assignments as Array<Record<string, unknown>>;
    assert(Array.isArray(assignments), 'Expected assignments array');
    const target = assignments.find((a: Record<string, unknown>) => String(a.task_id) === state.createdTaskId);
    assert(target != null, `User u_alice should have an assignment for task ${state.createdTaskId}`);
    assert(target.status === 'notified', `Expected status notified, got ${target.status}`);
    assert(target.title === 'LUI测试-每日拜访总结(已更新)', `Wrong title: ${target.title}`);
    state.testUserId = String(target.user_id);
    state.testAssignmentId = String(target.id);
  });

  await test('POST /tasks/:id/submit - Submit task response', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/tasks/${state.testAssignmentId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        response_data: {
          summary: '今日拜访客户ABC，洽谈了新产品方案，下一步安排产品演示',
          client: 'ABC公司',
          date: '2026-05-04',
        },
      }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${JSON.stringify(body)}`);
  });

  await test('GET /tasks?user_id - Verify submitted task shows completed', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/tasks?user_id=${state.testUserId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    const assignments = body.assignments as Array<Record<string, unknown>>;
    const target = assignments.find((a: Record<string, unknown>) => String(a.id) === state.testAssignmentId);
    assert(target != null, 'Assignment not found after submission');
    assert(target.status === 'completed', `Expected completed, got ${target.status}`);
    assert(target.completed_at != null, 'Expected completed_at to be set');
  });

  // =========================================================
  // Phase 5: Intent Classification Tests
  // =========================================================
  console.log('\nPhase 5: Intent Classification (task_dispatch) Tests\n');

  const dispatchPhrases = [
    { text: '通知所有人提交周报', expected: 'task_dispatch' },
    { text: '给团队下发任务：完成Q3总结', expected: 'task_dispatch' },
    { text: '下发工作要求：每天20点提交当日总结', expected: 'task_dispatch' },
    { text: '通知全员每周五提交本周工作总结', expected: 'task_dispatch' },
    { text: '下发任务 请大家完成客户满意度调查', expected: 'task_dispatch' },
    { text: '通知销售团队提交本月业绩表', expected: 'task_dispatch' },
  ];

  for (const phrase of dispatchPhrases) {
    await test(`Static Rule: "${phrase.text.substring(0, 30)}..." → task_dispatch`, async () => {
      const isDispatch = isTaskDispatchIntent(phrase.text);
      assert(isDispatch === true, `Expected true for task_dispatch pattern, got ${isDispatch}`);
    });
  }

  const nonDispatchPhrases = [
    { text: '帮我查一下最近的订单数据', expected: 'not dispatch' },
    { text: '你好，今天天气怎么样', expected: 'not dispatch' },
    { text: '分析一下Q3的销售趋势', expected: 'not dispatch' },
    { text: '创建一篇关于产品介绍的知识文档', expected: 'not dispatch' },
    { text: '帮我计算一下本月营收', expected: 'not dispatch' },
    { text: '什么是客户拜访流程', expected: 'not dispatch' },
  ];

  for (const phrase of nonDispatchPhrases) {
    await test(`Static Rule: "${phrase.text.substring(0, 30)}..." → NOT task_dispatch`, async () => {
      const isDispatch = isTaskDispatchIntent(phrase.text);
      assert(isDispatch === false, `Expected false for non-dispatch text, got ${isDispatch}`);
    });
  }

  // =========================================================
  // Phase 6: Error Handling & Edge Cases
  // =========================================================
  console.log('\nPhase 6: Error Handling & Edge Case Tests\n');

  await test('POST /admin/tasks - Non-existent org_id (FK constraint)', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: '无效组织任务',
        task_type: 'form',
        schedule_type: 'once',
        org_id: '00000000-0000-0000-000o-000000000000',
      }),
    });
    assert(status === 500, `Expected 500 for FK violation, got ${status}`);
    assert(body.ok === false, 'Expected ok=false');
  });

  await test('POST /internal/tasks/assign - Non-existent task returns 404', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/internal/tasks/assign`, {
      method: 'POST',
      body: JSON.stringify({ task_id: '00000000-0000-0000-0000-000000000000' }),
    });
    assert(status === 404, `Expected 404, got ${status}`);
    assert(body.error === 'task_not_found', `Expected task_not_found, got ${body.error}`);
  });

  await test('POST /internal/tasks/notify - Non-existent task returns 404', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/internal/tasks/notify`, {
      method: 'POST',
      body: JSON.stringify({ task_id: '00000000-0000-0000-0000-000000000000' }),
    });
    assert(status === 404, `Expected 404, got ${status}`);
    assert(body.error === 'task_not_found', `Expected task_not_found, got ${body.error}`);
  });

  await test('PUT /admin/tasks/:id - Non-existent task returns 404', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks/00000000-0000-0000-0000-000000000000`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'nope' }),
    });
    assert(status === 404, `Expected 404, got ${status}`);
    assert(body.error === 'task_not_found', `Expected task_not_found, got ${body.error}`);
  });

  await test('DELETE /admin/tasks/:id - Non-existent task returns 404', async () => {
    const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks/00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
    });
    assert(status === 404, `Expected 404, got ${status}`);
    assert(body.error === 'task_not_found', `Expected task_not_found, got ${body.error}`);
  });

  // =========================================================
  // Phase 7: Cleanup - Delete test tasks
  // =========================================================
  console.log('\nPhase 7: Cleanup\n');

  await test('DELETE /admin/tasks/:id - Delete all test tasks', async () => {
    const { body: listBody } = await fetchJson(`${state.gatewayUrl}/admin/tasks`);
    const tasks = (listBody.tasks as Array<Record<string, unknown>>).filter(
      (t: Record<string, unknown>) => String(t.title).startsWith('LUI测试-')
    );
    for (const task of tasks) {
      const taskId = String(task.id);
      const { status, body } = await fetchJson(`${state.gatewayUrl}/admin/tasks/${taskId}`, { method: 'DELETE' });
      assert(status === 200, `Expected 200 on delete ${taskId}, got ${status}`);
      assert(body.ok === true, `Expected ok=true on delete ${taskId}`);
    }
  });

  await test('GET /admin/tasks - Verify all test tasks deleted', async () => {
    const { body } = await fetchJson(`${state.gatewayUrl}/admin/tasks`);
    const tasks = (body.tasks as Array<Record<string, unknown>>).filter(
      (t: Record<string, unknown>) => String(t.title).startsWith('LUI测试-')
    );
    assert(tasks.length === 0, `Expected 0 LUI test tasks remaining, got ${tasks.length}`);
  });

  // =========================================================
  // Summary
  // =========================================================
  console.log('\n' + '='.repeat(60));
  console.log('Task Dispatch LUI Test Results');
  console.log('='.repeat(60));
  console.log(`Total: ${RESULTS.length}  |  Passed: ${passed}  |  Failed: ${failed}`);
  console.log('-'.repeat(60));

  for (const r of RESULTS) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`  ${icon} ${r.name} (${r.duration_ms}ms)`);
    if (!r.passed) {
      console.log(`    Error: ${r.detail}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  if (failed > 0) {
    console.log(`❌ ${failed} test(s) failed!`);
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

/**
 * Static rule matching for task_dispatch intent.
 * Mirrors the logic in gateway-adapter/src/index.ts isTaskDispatchIntent().
 */
function isTaskDispatchIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const patterns: RegExp[] = [
    /(通知.*提交|下发.*任务|下发.*工作|分配.*任务|派发.*任务)/,
    /(全员.*提交|团队.*完成|要求.*提交|要求.*完成|安排.*工作)/,
    /(通知所有人|通知全员|通知团队|给.*下发|给.*分配)/,
    /(dispatch.*task|assign.*task|notify.*team|team.*submit)/,
    /(周报|日报|月报|总结|汇报).*(提交|完成|上交)/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

main().catch((err) => {
  console.error('Test suite failed to start:', err);
  process.exit(1);
});
