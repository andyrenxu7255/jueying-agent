create table if not exists memory_item (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type in ('private', 'public')),
  memory_type text not null check (memory_type in ('episodic', 'semantic', 'procedural')),
  content_text text not null,
  summary text,
  embedding vector(1536),
  embedding_model_version text,
  confidence real not null default 0.5,
  status text not null check (status in ('active', 'archived', 'superseded')) default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memory_item_owner_scope on memory_item (owner_user_id, scope_type);
create index if not exists idx_memory_item_type_status on memory_item (memory_type, status);
create index if not exists idx_memory_item_embedding_hnsw on memory_item using hnsw (embedding vector_cosine_ops);

create table if not exists memory_source (
  id uuid primary key default gen_random_uuid(),
  memory_item_id uuid not null references memory_item(id) on delete cascade,
  source_type text not null check (source_type in ('workflow', 'conversation', 'document', 'manual')),
  source_ref text not null,
  relevance_score real not null default 0.5,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_memory_source_item on memory_source (memory_item_id);
create index if not exists idx_memory_source_type_ref on memory_source (source_type, source_ref);

create table if not exists memory_usage_log (
  id uuid primary key default gen_random_uuid(),
  memory_item_id uuid not null references memory_item(id),
  workflow_instance_id uuid references workflow_instance(id),
  usage_type text not null check (usage_type in ('retrieval', 'injection', 'validation')),
  relevance_score real,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_memory_usage_log_item on memory_usage_log (memory_item_id);
create index if not exists idx_memory_usage_log_workflow on memory_usage_log (workflow_instance_id);

create table if not exists skill (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type in ('private', 'public')),
  skill_name text not null,
  description text,
  skill_type text not null check (skill_type in ('prompt', 'tool', 'workflow')),
  status text not null check (status in ('active', 'deprecated', 'deleted')) default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_skill_owner_scope on skill (owner_user_id, scope_type);
create index if not exists idx_skill_name_trgm on skill using gin (skill_name gin_trgm_ops);
create index if not exists idx_skill_type_status on skill (skill_type, status);

create table if not exists skill_version (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references skill(id) on delete cascade,
  version integer not null,
  definition_json jsonb not null default '{}'::jsonb,
  content_hash text not null,
  status text not null check (status in ('active', 'superseded')) default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (skill_id, version)
);

create index if not exists idx_skill_version_skill on skill_version (skill_id);

create table if not exists skill_source (
  id uuid primary key default gen_random_uuid(),
  skill_version_id uuid not null references skill_version(id) on delete cascade,
  source_type text not null check (source_type in ('upload', 'workflow', 'channel', 'manual')),
  source_uri text,
  content_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_skill_source_version on skill_source (skill_version_id);

create table if not exists projection_event (
  id uuid primary key default gen_random_uuid(),
  graph_name text not null,
  vertex_label text,
  edge_label text,
  operation text not null check (operation in ('create', 'update', 'delete')),
  entity_ref text,
  payload jsonb not null default '{}'::jsonb,
  applied boolean not null default false,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_projection_event_graph on projection_event (graph_name, applied);
create index if not exists idx_projection_event_entity on projection_event (entity_ref);
