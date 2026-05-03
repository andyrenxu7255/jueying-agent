do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'workflow_stage_stage_type_check'
      and conrelid = 'workflow_stage'::regclass
  ) then
    alter table workflow_stage drop constraint workflow_stage_stage_type_check;
  end if;
end $$;

alter table workflow_stage
  add constraint workflow_stage_stage_type_check
  check (
    stage_type in (
      'IntentClarification',
      'PlanGeneration',
      'EvidenceRetrieval',
      'MemoryRetrieval',
      'ObjectExtraction',
      'ArchitectureDesign',
      'SpecGeneration',
      'Analysis',
      'DecisionMaking',
      'Implementation',
      'Execution',
      'Verification',
      'Repair',
      'ReVerification',
      'Approval',
      'ResultReporting',
      'Reporting',
      'SkillExtraction',
      'DreamSummarization',
      'Archive',
      'Archiving',
      'Generic',
      'WaitUser',
      'Block',
      'Pause',
      'Custom'
    )
  );

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'workflow_stage_assigned_executor_check'
      and conrelid = 'workflow_stage'::regclass
  ) then
    alter table workflow_stage drop constraint workflow_stage_assigned_executor_check;
  end if;
end $$;

alter table workflow_stage
  add constraint workflow_stage_assigned_executor_check
  check (
    assigned_executor in (
      'generic-executor',
      'retrieval-aware-executor',
      'code-executor',
      'verification-executor',
      'repair-executor',
      'approval-executor',
      'human-gateway',
      'system'
    )
  );
