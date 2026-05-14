import { RepairExecutor } from './repair-executor';
import type { Stage } from '@agent-harness/contracts';

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    stage_id: 'st_repair_test_1',
    seq: 0,
    stage_key: 'repair_task',
    stage_type: 'Repair',
    assigned_executor: 'repair-executor',
    purpose: 'Test repair',
    inputs: { required_refs: [], optional_refs: [] },
    retrieval_plan: { enabled: false },
    acceptance: {
      must_have: ['fix applied'],
      pass_rules: ['no errors after fix'],
      fail_rules: ['still broken']
    },
    timeouts: { soft_timeout_sec: 300, hard_timeout_sec: 1800 },
    retry_policy: { max_retries: 1, max_repairs: 0 },
    checkpoint_policy: { on_enter: true, on_progress: false, on_exit: true },
    on_success: 'next_stage',
    on_failure: 'repair_or_fail',
    ...overrides
  } as Stage;
}

describe('RepairExecutor', () => {
  const executor = new RepairExecutor();

  it('should exist as an instance', () => {
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe('function');
  });

  it('should return defined status when executing', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_repair_123',
      workflow_stage_id: 'wf_repair_123_stage_1',
      stage: makeStage(),
      user_goal: 'Test repair',
      policy_snapshot_hash: 'test_hash_repair',
      context: {
        verification_output: 'Test failed',
        error: 'Sample error for repair',
        original_context: { broken: true }
      }
    });

    expect(result.status).toBeDefined();
    expect(['completed', 'failed']).toContain(result.status);
  });

  it('should include model_call_ok field in result', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_repair_456',
      workflow_stage_id: 'wf_repair_456_stage_1',
      stage: makeStage({
        acceptance: {
          must_have: ['resolution'],
          pass_rules: ['check passes'],
          fail_rules: []
        }
      }),
      user_goal: 'Repair verification failures',
      policy_snapshot_hash: 'hash_repair_v2',
      context: {
        verification_output: 'FAIL: missing feature',
        error: 'Not implemented'
      }
    });

    expect(result).toHaveProperty('model_call_ok');
    expect(typeof result.model_call_ok).toBe('boolean');
  });

  it('should output next_action in result', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_repair_789',
      workflow_stage_id: 'wf_repair_789_stage_1',
      stage: makeStage({
        acceptance: {
          must_have: ['fix verified'],
          pass_rules: ['retry passes'],
          fail_rules: []
        }
      }),
      user_goal: 'Repair test',
      policy_snapshot_hash: 'hash_repair_v3',
      context: {
        verification_output: 'FAIL: minor issue',
        error: '',
        original_context: {}
      }
    });

    expect(result.next_action).toBeDefined();
    expect(['next_stage', 'repair']).toContain(result.next_action);
  });

  it('should handle missing context gracefully', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_repair_empty',
      workflow_stage_id: 'wf_repair_empty_1',
      stage: makeStage({
        acceptance: { must_have: [], pass_rules: [], fail_rules: [] }
      }),
      user_goal: 'Minimal repair',
      policy_snapshot_hash: 'empty_repair_hash',
      context: {}
    });

    expect(result.status).toBeDefined();
  });
});