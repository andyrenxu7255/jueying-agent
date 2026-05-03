create table if not exists retrieval_trace (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid references workflow_instance(id),
  owner_user_id uuid not null references "user"(id),
  query_text text not null,
  intent_type text not null,
  scope_summary jsonb not null default '{}'::jsonb,
  retrieval_plan jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  duration_ms integer not null default 0,
  degraded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_retrieval_trace_owner_intent on retrieval_trace (owner_user_id, intent_type);
create index if not exists idx_retrieval_trace_workflow on retrieval_trace (workflow_instance_id);

create table if not exists audit_event (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  workflow_instance_id uuid references workflow_instance(id),
  action text not null,
  resource_type text not null,
  resource_ref text not null,
  resource_scope text not null,
  result text not null check (result in ('success', 'failure')),
  detail_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_audit_event_action on audit_event (action);
create index if not exists idx_audit_event_workflow on audit_event (workflow_instance_id);
