create table if not exists workflow_definition (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('private', 'public')),
  owner_user_id uuid not null references "user"(id),
  name text not null,
  workflow_type text not null,
  risk_level text not null,
  status text not null check (status in ('draft', 'active', 'deprecated', 'deleted')),
  version integer not null default 1,
  definition_json jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, name, version)
);

create index if not exists idx_workflow_definition_scope_owner on workflow_definition (scope_type, owner_user_id);
create index if not exists idx_workflow_definition_type_status on workflow_definition (workflow_type, status);

create table if not exists workflow_instance (
  id uuid primary key default gen_random_uuid(),
  workflow_definition_id uuid references workflow_definition(id),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type = 'private'),
  status text not null check (status in ('draft', 'planned', 'running', 'waiting_user', 'blocked', 'verifying', 'repairing', 'reporting', 'paused', 'failed', 'succeeded', 'cancelled', 'archived')),
  workflow_plan_hash text not null,
  policy_snapshot_id uuid not null references policy_snapshot(id),
  budget_json jsonb not null default '{}'::jsonb,
  input_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workflow_instance_owner_status on workflow_instance (owner_user_id, status);
create index if not exists idx_workflow_instance_scope_status on workflow_instance (scope_type, status);
create index if not exists idx_workflow_instance_started_at on workflow_instance (started_at);
create index if not exists idx_workflow_instance_policy_snapshot on workflow_instance (policy_snapshot_id);

create table if not exists workflow_stage (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references workflow_instance(id),
  stage_key text not null,
  stage_type text not null check (stage_type in ('IntentClarification', 'EvidenceRetrieval', 'Analysis', 'DecisionMaking', 'Approval', 'Execution', 'Verification', 'Repair', 'ReVerification', 'Reporting', 'Archiving', 'Generic', 'WaitUser', 'Block', 'Pause', 'Custom')),
  seq integer not null,
  assigned_executor text not null check (assigned_executor in ('generic-executor', 'retrieval-aware-executor', 'approval-executor', 'human-gateway', 'system')),
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'waiting_user', 'blocked', 'verifying', 'repairing', 're_verifying', 'paused', 'skipped')),
  input_refs jsonb not null default '[]'::jsonb,
  output_refs jsonb not null default '[]'::jsonb,
  stage_input_hash text,
  stage_output_hash text,
  tool_call_refs jsonb not null default '[]'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  fact_write_refs jsonb not null default '[]'::jsonb,
  verification_refs jsonb not null default '[]'::jsonb,
  acceptance_result jsonb not null default '{}'::jsonb,
  checkpoint_id uuid,
  next_action text,
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_instance_id, seq),
  unique (workflow_instance_id, stage_key)
);

create index if not exists idx_workflow_stage_instance_status on workflow_stage (workflow_instance_id, status);
create index if not exists idx_workflow_stage_executor_status on workflow_stage (assigned_executor, status);

create table if not exists checkpoint (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references workflow_instance(id),
  workflow_stage_id uuid not null references workflow_stage(id),
  checkpoint_type text not null check (checkpoint_type in ('stage-enter', 'stage-exit', 'waiting-user', 'blocked', 'paused', 'repair')),
  resume_token text not null,
  state_hash text not null,
  policy_snapshot_hash text not null,
  status_snapshot jsonb not null default '{}'::jsonb,
  artifact_refs jsonb not null default '[]'::jsonb,
  fact_write_refs jsonb not null default '[]'::jsonb,
  verification_refs jsonb not null default '[]'::jsonb,
  evidence_pack_hash text,
  tool_call_refs jsonb not null default '[]'::jsonb,
  notes text,
  next_action text,
  created_at timestamptz not null default now(),
  unique (resume_token)
);

create index if not exists idx_checkpoint_workflow_stage on checkpoint (workflow_instance_id, workflow_stage_id);
create index if not exists idx_checkpoint_created_at on checkpoint (created_at);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fk_workflow_stage_checkpoint') then
    alter table workflow_stage
      add constraint fk_workflow_stage_checkpoint
      foreign key (checkpoint_id) references checkpoint(id);
  end if;
end $$;

create table if not exists workflow_event (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references workflow_instance(id),
  workflow_stage_id uuid references workflow_stage(id),
  event_type text not null,
  from_status text,
  to_status text,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_workflow_event_instance_time on workflow_event (workflow_instance_id, occurred_at);
create index if not exists idx_workflow_event_stage_time on workflow_event (workflow_stage_id, occurred_at);
create index if not exists idx_workflow_event_type on workflow_event (event_type);

create table if not exists execution_session (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references workflow_instance(id),
  workflow_stage_id uuid not null references workflow_stage(id),
  owner_user_id uuid not null references "user"(id),
  status text not null check (status in ('created', 'preparing', 'ready', 'running', 'verifying', 'repairing', 'waiting_workflow', 'completed', 'failed', 'terminated')),
  repo_ref text,
  branch_ref text,
  worktree_ref text,
  base_commit_hash text,
  stage_goal text,
  budget_json jsonb not null default '{}'::jsonb,
  acceptance_rules jsonb not null default '[]'::jsonb,
  backend_type text not null,
  policy_snapshot_hash text not null,
  checkpoint_id uuid references checkpoint(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_execution_session_stage on execution_session (workflow_stage_id);
create index if not exists idx_execution_session_status on execution_session (status);
create index if not exists idx_execution_session_repo on execution_session (repo_ref);
