import type { WorkflowPlan, Stage } from '@agent-harness/contracts';
import { PlanValidator } from './plan-validator';

const hash = `sha256:${'b'.repeat(64)}`;

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    stage_id: 'st_demo',
    seq: 0,
    stage_key: 'demo',
    stage_type: 'IntentClarification',
    assigned_executor: 'generic-executor',
    purpose: 'Clarify task',
    inputs: { required_refs: [], optional_refs: [] },
    retrieval_plan: { enabled: false },
    acceptance: { must_have: ['answer'], pass_rules: [], fail_rules: [] },
    timeouts: { soft_timeout_sec: 60, hard_timeout_sec: 120 },
    retry_policy: { max_retries: 1, max_repairs: 0, retryable_errors: [] },
    checkpoint_policy: { on_enter: true, on_progress: false, on_exit: true },
    on_success: 'succeeded',
    on_failure: 'repair_or_fail',
    ...overrides,
  };
}

function makePlan(stages: Stage[]): WorkflowPlan {
  return {
    workflow_type: 'analysis',
    plan_version: 'v1',
    owner_user_id: 'u_demo',
    scope_type: 'private',
    risk_level: 'medium',
    policy_snapshot_hash: hash,
    goal: { user_goal: 'Demo', success_definition: ['done'] },
    budgets: { time_budget_sec: 600, retrieval_budget: 5, execution_budget: 5, repair_budget: 1 },
    retrieval_profile: 'balanced',
    stage_chain: stages,
    report_policy: { on_stage_complete: true, on_waiting_user: true, on_final: true },
    archive_policy: { archive_evidence: true, archive_artifacts: true, retention_days: 30 },
    plan_hash: hash,
  };
}

describe('PlanValidator', () => {
  const validator = new PlanValidator();

  it('accepts a valid plan', () => {
    expect(validator.validate(makePlan([makeStage()]))).toEqual({ ok: true, issues: [] });
  });

  it('rejects an empty stage chain', () => {
    const result = validator.validate(makePlan([]));
    expect(result.ok).toBe(false);
    expect(result.issues[0].field).toBe('stage_chain');
  });

  it('rejects duplicate sequence numbers and stage keys', () => {
    const result = validator.validate(makePlan([
      makeStage({ seq: 1, stage_key: 'dup' }),
      makeStage({ stage_id: 'st_demo_2', seq: 1, stage_key: 'dup' }),
    ]));
    expect(result.issues.map((issue) => issue.field)).toContain('stage_chain[1].seq');
    expect(result.issues.map((issue) => issue.field)).toContain('stage_chain[1].stage_key');
  });

  it('rejects timeout, repair, graph, and executor mismatches', () => {
    const result = validator.validate(makePlan([
      makeStage({
        timeouts: { soft_timeout_sec: 120, hard_timeout_sec: 120 },
        retry_policy: { max_retries: 1, max_repairs: 2 },
        retrieval_plan: { enabled: true, allow_graph: true, max_graph_hops: 3 },
        assigned_executor: 'code-executor',
      }),
    ]));
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toEqual(expect.arrayContaining([
      'stage_chain[0].timeouts',
      'stage_chain[0].retry_policy.max_repairs',
      'stage_chain[0].retrieval_plan.max_graph_hops',
      'stage_chain[0].assigned_executor',
    ]));
  });

  it('allows omitted graph hops when graph retrieval is enabled', () => {
    const result = validator.validate(makePlan([
      makeStage({
        retrieval_plan: { enabled: true, allow_graph: true },
      }),
    ]));

    expect(result.ok).toBe(true);
  });

  it('rejects unknown stage types through the executor compatibility check', () => {
    const result = validator.validate(makePlan([
      makeStage({
        stage_type: 'UnknownStage' as Stage['stage_type'],
        assigned_executor: 'generic-executor',
      }),
    ]));

    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('UnknownStage');
  });

  it('allows valid executor mappings for specialized stage types', () => {
    const result = validator.validate(makePlan([
      makeStage({ stage_type: 'EvidenceRetrieval', assigned_executor: 'retrieval-aware-executor' }),
      makeStage({ stage_id: 'st_impl', seq: 1, stage_key: 'impl', stage_type: 'Implementation', assigned_executor: 'code-executor' }),
      makeStage({ stage_id: 'st_verify', seq: 2, stage_key: 'verify', stage_type: 'Verification', assigned_executor: 'verification-executor' }),
      makeStage({ stage_id: 'st_repair', seq: 3, stage_key: 'repair', stage_type: 'Repair', assigned_executor: 'repair-executor' }),
      makeStage({ stage_id: 'st_approval', seq: 4, stage_key: 'approval', stage_type: 'Approval', assigned_executor: 'human-gateway' }),
    ]));
    expect(result.ok).toBe(true);
  });
});
