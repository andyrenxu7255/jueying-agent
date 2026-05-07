-- Migration 023: Expand workflow_stage CHECK constraints to match Planner output
-- Context: Planner generates stage types and executor assignments not in original constraint

-- Drop old constraint and recreate with all 16 stage types used by the Planner
alter table workflow_stage drop constraint if exists workflow_stage_stage_type_check;
alter table workflow_stage add constraint workflow_stage_stage_type_check check (
  stage_type in (
    'IntentClarification', 'PlanGeneration', 'EvidenceRetrieval', 'MemoryRetrieval',
    'ObjectExtraction', 'ArchitectureDesign', 'SpecGeneration', 'DecisionMaking',
    'Implementation', 'Verification', 'Repair', 'Approval',
    'ResultReporting', 'SkillExtraction', 'DreamSummarization', 'Archive'
  )
);

-- Drop old constraint and recreate with all 6 executor types used by the Planner
alter table workflow_stage drop constraint if exists workflow_stage_assigned_executor_check;
alter table workflow_stage add constraint workflow_stage_assigned_executor_check check (
  assigned_executor in (
    'generic-executor', 'retrieval-aware-executor', 'approval-executor',
    'code-executor', 'verification-executor', 'repair-executor'
  )
);
