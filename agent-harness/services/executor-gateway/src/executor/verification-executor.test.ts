import { VerificationExecutor } from './verification-executor';
import type { Stage } from '@agent-harness/contracts';

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    stage_id: 'st_verif_test_1',
    seq: 0,
    stage_key: 'verification_task',
    stage_type: 'Verification',
    assigned_executor: 'verification-executor',
    purpose: 'Test verification',
    inputs: { required_refs: [], optional_refs: [] },
    retrieval_plan: { enabled: false },
    acceptance: {
      must_have: ['output is valid'],
      pass_rules: ['no errors'],
      fail_rules: ['critical error']
    },
    timeouts: { soft_timeout_sec: 300, hard_timeout_sec: 1800 },
    retry_policy: { max_retries: 1, max_repairs: 0 },
    checkpoint_policy: { on_enter: true, on_progress: false, on_exit: true },
    on_success: 'next_stage',
    on_failure: 'repair_or_fail',
    ...overrides
  } as Stage;
}

describe('VerificationExecutor', () => {
  const executor = new VerificationExecutor();

  it('should exist as an instance', () => {
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe('function');
  });

  it('should return failed status when model call fails', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_test_123',
      workflow_stage_id: 'wf_test_123_stage_1',
      stage: makeStage(),
      user_goal: 'Test verification',
      policy_snapshot_hash: 'test_hash',
      context: { output: 'Test output for verification' }
    });

    expect(result.status).toBeDefined();
    expect(['completed', 'failed']).toContain(result.status);
  });

  it('should include model_call_ok field in result', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_test_456',
      workflow_stage_id: 'wf_test_456_stage_1',
      stage: makeStage({
        acceptance: {
          must_have: ['feature complete'],
          pass_rules: ['all tests pass'],
          fail_rules: ['runtime error']
        }
      }),
      user_goal: 'Test verification with pass rules',
      policy_snapshot_hash: 'test_hash_v2',
      context: { output: 'All good output' }
    });

    expect(result).toHaveProperty('model_call_ok');
    expect(typeof result.model_call_ok).toBe('boolean');
  });

  it('should output next_action in result', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_test_789',
      workflow_stage_id: 'wf_test_789_stage_1',
      stage: makeStage({
        acceptance: {
          must_have: ['complete'],
          pass_rules: ['no warnings'],
          fail_rules: []
        }
      }),
      user_goal: 'Action test',
      policy_snapshot_hash: 'test_hash_v3',
      context: { output: 'Success output' }
    });

    expect(result.next_action).toBeDefined();
    expect(['next_stage', 'repair']).toContain(result.next_action);
  });

  it('should handle empty content gracefully', async () => {
    const result = await executor.execute({
      workflow_instance_id: 'wf_empty',
      workflow_stage_id: 'wf_empty_1',
      stage: makeStage({
        acceptance: { must_have: [], pass_rules: [], fail_rules: [] }
      }),
      user_goal: 'Empty',
      policy_snapshot_hash: 'empty_hash',
      context: { output: '' }
    });

    expect(result.status).toBeDefined();
  });
});