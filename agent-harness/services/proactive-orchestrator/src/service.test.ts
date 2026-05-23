import { ProactiveOrchestratorService } from './service';
import type { RuleSnapshot } from './domain';

type QueryCall = { sql: string; params: unknown[] };

class FakePool {
  calls: QueryCall[] = [];
  taskRows: Array<Record<string, unknown>> = [];
  assignmentRows: Array<Record<string, unknown>> = [];

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.calls.push({ sql, params });

    if (sql.includes('FROM proactive_insight WHERE run_id = $1') && sql.includes('count(*)')) {
      if (sql.includes("review_status IN ('approved', 'auto_approved')")) return { rows: [{ count: 1 }] };
      if (sql.includes("review_status = 'rejected'")) return { rows: [{ count: 0 }] };
      if (sql.includes("review_status = 'pending'")) return { rows: [{ count: 0 }] };
      return { rows: [{ count: 1 }] };
    }
    if (sql.includes('FROM proactive_mission WHERE run_id = $1') && sql.includes('count(*)')) {
      if (sql.includes("status IN ('done', 'verified')")) return { rows: [{ count: 1 }] };
      if (sql.includes("status IN ('assigned', 'submitted', 'verified', 'done')")) return { rows: [{ count: 1 }] };
      return { rows: [{ count: 1 }] };
    }
    if (sql.includes('SELECT * FROM proactive_run WHERE id = $1')) {
      return { rows: [{ id: params[0], rule_id: 'rule-1', org_id: null, status: 'reviewing' }] };
    }
    if (sql.includes('SELECT * FROM proactive_report WHERE run_id = $1')) return { rows: [] };
    if (sql.includes('SELECT * FROM proactive_insight WHERE run_id = $1 ORDER BY')) return { rows: [] };
    if (sql.includes('SELECT * FROM proactive_mission WHERE run_id = $1 ORDER BY')) return { rows: [] };
    if (sql.includes('INSERT INTO proactive_report')) return { rows: [{ id: 'report-1' }] };
    if (sql.includes('INSERT INTO org_task_assignment')) {
      const row = { id: 'assignment-1', task_id: params[0] };
      this.assignmentRows.push(row);
      return { rows: [row] };
    }
    if (sql.includes('INSERT INTO org_task')) {
      const row = { id: 'task-1', task_type: params[4], metadata: JSON.parse(String(params[8] || '{}')) };
      this.taskRows.push(row);
      return { rows: [row] };
    }

    return { rows: [] };
  }
}

function createService(pool: FakePool): ProactiveOrchestratorService {
  return new ProactiveOrchestratorService(pool as never, {
    factRetrievalUrl: 'http://127.0.0.1:9',
    hermesUrl: 'http://127.0.0.1:9',
    gatewayUrl: 'http://127.0.0.1:9',
    internalToken: 'test-token',
    ownerUserId: '550e8400-e29b-41d4-a716-446655440000',
    timeoutMs: 1,
  });
}

function createRule(): RuleSnapshot {
  return {
    id: 'rule-1',
    org_id: '00000000-0000-0000-0000-000000000001',
    created_by: '550e8400-e29b-41d4-a716-446655440000',
    rule_name: 'MEDDIC 主动跟进',
    description: '扫描近期事实、技能和任务',
    status: 'active',
    schedule_expression: '0 8 * * *',
    trigger_source: 'hybrid',
    target_scope: 'org',
    approval_mode: 'review_first',
    scan_window_hours: 168,
    priority: 90,
    evidence_policy: {},
    routing_policy: {},
    metadata: {},
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T00:00:00Z',
  };
}

describe('proactive orchestrator service guards', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('{"ok":true}', { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses typed run-summary parameters so status updates cannot silently no-op', async () => {
    const pool = new FakePool();
    const service = createService(pool);

    await (service as unknown as { refreshRunSummary(runId: string): Promise<void> }).refreshRunSummary('run-1');

    const update = pool.calls.find((call) => call.sql.includes('UPDATE proactive_run'));
    expect(update).toBeDefined();
    expect(update?.sql).toContain('$6::boolean');
    expect(update?.sql).toContain('$7::int');
    expect(update?.params).toHaveLength(7);
    expect(typeof update?.params[5]).toBe('boolean');
    expect(typeof update?.params[6]).toBe('number');
  });

  it('applies the rule scan window to skills, tasks, and assignments', async () => {
    const pool = new FakePool();
    const service = createService(pool);

    await service.collectSignals(createRule());

    const skillQuery = pool.calls.find((call) => call.sql.includes('FROM skill'));
    const taskQuery = pool.calls.find((call) => call.sql.includes('FROM org_task') && !call.sql.includes('JOIN org_task'));
    const assignmentQuery = pool.calls.find((call) => call.sql.includes('FROM org_task_assignment a'));
    expect(skillQuery?.sql).toContain("created_at >= now() - ($1::int || ' hours')::interval");
    expect(taskQuery?.sql).toContain("created_at >= now() - ($1::int || ' hours')::interval");
    expect(assignmentQuery?.sql).toContain("a.created_at >= now() - ($1::int || ' hours')::interval");
    expect(skillQuery?.params).toEqual([168, '00000000-0000-0000-0000-000000000001']);
  });

  it('dispatches through the existing org_task contract and preserves mission type in metadata', async () => {
    const pool = new FakePool();
    const service = createService(pool);

    await (service as unknown as {
      createOrgTaskForMission(
        mission: Record<string, unknown>,
        insight: Record<string, unknown>,
        rule: RuleSnapshot,
        targetUserId: string
      ): Promise<{ task_id: string; assignment_id: string }>;
    }).createOrgTaskForMission(
      {
        id: 'mission-1',
        run_id: 'run-1',
        insight_id: 'insight-1',
        mission_title: '用户协同 - MEDDIC',
        mission_summary: '跟进客户',
        mission_type: 'user_task',
        evidence_refs: [],
      },
      {
        id: 'insight-1',
        review_status: 'approved',
        confidence: 0.86,
        insight_summary: 'MEDDIC follow-up',
      },
      createRule(),
      '550e8400-e29b-41d4-a716-446655440001'
    );

    expect(pool.taskRows[0]?.task_type).toBe('form');
    expect(pool.taskRows[0]?.metadata).toMatchObject({
      source: 'proactive_orchestrator',
      proactive_mission_type: 'user_task',
    });
    expect(pool.assignmentRows[0]?.task_id).toBe('task-1');
  });
});
