import { z } from 'zod';

/**
 * Workflow Plan Schema
 * Reference: AH1-17 §17.3
 */

export const WorkflowPlanSchema = z.object({
  workflow_type: z.enum(['development', 'analysis', 'knowledge', 'sales', 'implementation']),
  plan_version: z.literal('v1'),
  owner_user_id: z.string().regex(/^u_[a-z0-9][a-z0-9_-]{0,62}$/),
  scope_type: z.enum(['private', 'public']),
  risk_level: z.enum(['low', 'medium', 'high']),
  policy_snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  goal: z.object({
    user_goal: z.string().min(1).max(4000),
    success_definition: z.array(z.string())
  }),
  budgets: z.object({
    time_budget_sec: z.number().int().min(60).max(86400),
    retrieval_budget: z.number().int().min(0).max(100),
    execution_budget: z.number().int().min(0).max(500),
    repair_budget: z.number().int().min(0).max(10)
  }),
  retrieval_profile: z.enum(['precision-first', 'balanced', 'comprehensive']),
  stage_chain: z.array(z.lazy(() => StageSchema)),
  report_policy: z.object({
    on_stage_complete: z.boolean(),
    on_waiting_user: z.boolean(),
    on_blocked: z.boolean().optional(),
    on_final: z.boolean(),
    progress_interval_sec: z.number().int().optional()
  }),
  archive_policy: z.object({
    archive_evidence: z.boolean(),
    archive_artifacts: z.boolean(),
    archive_checkpoints: z.boolean().optional(),
    retention_days: z.number().int().min(1).max(3650)
  }),
  plan_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
});

export const StageSchema = z.object({
  stage_id: z.string().regex(/^st_[a-z0-9_]+$/),
  seq: z.number().int().min(0),
  stage_key: z.string().min(1).max(100),
  stage_type: z.enum([
    'IntentClarification',
    'PlanGeneration',
    'EvidenceRetrieval',
    'MemoryRetrieval',
    'ObjectExtraction',
    'ArchitectureDesign',
    'SpecGeneration',
    'DecisionMaking',
    'Implementation',
    'Verification',
    'Repair',
    'Approval',
    'ResultReporting',
    'SkillExtraction',
    'DreamSummarization',
    'Archive'
  ]),
  assigned_executor: z.enum([
    'generic-executor',
    'retrieval-aware-executor',
    'code-executor',
    'verification-executor',
    'repair-executor',
    'approval-executor',
    'human-gateway',
    'system'
  ]),
  purpose: z.string().min(1).max(500),
  inputs: z.object({
    required_refs: z.array(z.string()),
    optional_refs: z.array(z.string()).optional()
  }),
  retrieval_plan: z.object({
    enabled: z.boolean(),
    intent_type: z.enum([
      'object-status',
      'evidence',
      'relation',
      'similar-case',
      'dev-context',
      'memory-hint'
    ]).optional(),
    profiles: z.array(z.enum(['structured', 'fulltext', 'vector', 'graph'])).optional(),
    max_candidates: z.number().int().min(1).max(100).optional(),
    allow_graph: z.boolean().optional(),
    max_graph_hops: z.number().int().min(0).max(2).optional()
  }),
  acceptance: z.object({
    must_have: z.array(z.string()),
    pass_rules: z.array(z.string()).optional(),
    fail_rules: z.array(z.string()).optional()
  }),
  timeouts: z.object({
    soft_timeout_sec: z.number().int().min(30).max(7200),
    hard_timeout_sec: z.number().int().min(60).max(14400)
  }),
  retry_policy: z.object({
    max_retries: z.number().int().min(0).max(10),
    max_repairs: z.number().int().min(0).max(10),
    retryable_errors: z.array(z.string()).optional()
  }),
  checkpoint_policy: z.object({
    on_enter: z.boolean(),
    on_progress: z.boolean(),
    on_exit: z.boolean()
  }),
  on_success: z.enum(['next_stage', 'repair_or_fail', 'blocked', 'waiting_user', 'succeeded']),
  on_failure: z.enum(['next_stage', 'repair_or_fail', 'blocked', 'waiting_user', 'failed']),
  on_blocked: z.enum(['blocked', 'waiting_user']).optional(),
  on_waiting_user: z.enum(['waiting_user']).optional()
});

export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;
export type Stage = z.infer<typeof StageSchema>;
