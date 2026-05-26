import type { WorkflowStage } from './workflow-types';

export function createDefaultStage(workflowStageId: string, userGoal: string): WorkflowStage {
  return {
    stage_id: workflowStageId,
    seq: 0,
    stage_key: 'generic_task',
    stage_type: 'IntentClarification',
    assigned_executor: 'generic-executor',
    purpose: userGoal.slice(0, 100),
    inputs: { required_refs: [], optional_refs: [] },
    retrieval_plan: { enabled: false },
    acceptance: { must_have: ['non-empty output'], pass_rules: [], fail_rules: [] },
    timeouts: { soft_timeout_sec: 300, hard_timeout_sec: 1800 },
    retry_policy: { max_retries: 1, max_repairs: 0 },
    checkpoint_policy: { on_enter: true, on_progress: false, on_exit: true },
    on_success: 'next_stage',
    on_failure: 'repair_or_fail'
  };
}
