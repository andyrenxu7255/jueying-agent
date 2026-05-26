create table if not exists entity (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type in ('private', 'public')),
  entity_type text not null,
  canonical_name text not null,
  status text not null check (status in ('active', 'merged', 'deleted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_entity_owner_scope on entity (owner_user_id, scope_type);
create index if not exists idx_entity_canonical_name on entity (canonical_name);

create table if not exists entity_attribute (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entity(id),
  attr_key text not null,
  attr_value text,
  value_json jsonb not null default '{}'::jsonb,
  confidence real not null default 0.5,
  source_ref text,
  created_at timestamptz not null default now()
);

create index if not exists idx_entity_attribute_entity on entity_attribute (entity_id, attr_key);

create table if not exists relation (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type in ('private', 'public')),
  from_entity_id uuid not null references entity(id),
  relation_type text not null,
  to_entity_id uuid not null references entity(id),
  status text not null check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_relation_owner_scope on relation (owner_user_id, scope_type);
create index if not exists idx_relation_pair on relation (from_entity_id, to_entity_id, relation_type);

create table if not exists fact (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type in ('private', 'public')),
  subject_ref text not null,
  predicate text not null,
  object_value text,
  object_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('candidate', 'active', 'superseded', 'conflicted', 'rejected')),
  confidence real not null default 0.5,
  supersedes_fact_id uuid references fact(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fact_owner_scope on fact (owner_user_id, scope_type);
create index if not exists idx_fact_predicate_status on fact (predicate, status);
create index if not exists idx_fact_subject on fact (subject_ref);

create table if not exists fact_evidence (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references fact(id),
  evidence_ref text not null,
  evidence_type text not null check (evidence_type in ('document_chunk', 'artifact', 'relation', 'manual')),
  excerpt text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fact_evidence_fact on fact_evidence (fact_id);

create table if not exists fact_conflict (
  id uuid primary key default gen_random_uuid(),
  existing_fact_id uuid not null references fact(id),
  incoming_fact_id uuid not null references fact(id),
  conflict_reason text not null,
  resolution_status text not null check (resolution_status in ('open', 'resolved', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_fact_conflict_existing on fact_conflict (existing_fact_id, resolution_status);
