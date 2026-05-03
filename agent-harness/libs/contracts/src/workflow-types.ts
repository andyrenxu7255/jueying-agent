export interface WorkflowStage {
  stage_id: string;
  seq: number;
  stage_key: string;
  stage_type: string;
  assigned_executor: string;
  purpose: string;
  inputs: {
    required_refs: string[];
    optional_refs: string[];
  };
  retrieval_plan: {
    enabled: boolean;
  };
  acceptance: {
    must_have: string[];
    pass_rules: string[];
    fail_rules: string[];
  };
  timeouts: {
    soft_timeout_sec: number;
    hard_timeout_sec: number;
  };
  retry_policy: {
    max_retries: number;
    max_repairs: number;
  };
  checkpoint_policy: {
    on_enter: boolean;
    on_progress: boolean;
    on_exit: boolean;
  };
  on_success: string;
  on_failure: string;
}

export interface WorkflowInstance {
  workflow_instance_id: string;
  workflow_stage_id: string;
  user_goal: string;
  policy_snapshot_hash: string;
  context?: Record<string, unknown>;
}

export interface ExecutionResult {
  status: 'completed' | 'succeeded' | 'failed' | 'degraded';
  output?: unknown;
  artifacts?: unknown[];
  fact_refs?: string[];
  retrieval_trace_id?: string;
  evidence_pack_hash?: string;
  degraded?: boolean;
  degradation_reasons?: string[];
  next_action?: string;
  error?: string;
  model_call_ok?: boolean;
}

export interface Executor {
  execute(input: WorkflowInstance & { stage: WorkflowStage }): Promise<ExecutionResult>;
}
