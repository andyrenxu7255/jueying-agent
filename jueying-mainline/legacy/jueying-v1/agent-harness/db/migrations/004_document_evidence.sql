create table if not exists document (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type in ('private', 'public')),
  title text not null,
  source_kind text not null check (source_kind in ('upload', 'workflow', 'channel', 'external', 'manual')),
  source_uri text,
  status text not null check (status in ('active', 'archived', 'deleted')),
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_owner_scope on document (owner_user_id, scope_type);
create index if not exists idx_document_status on document (status);

create table if not exists document_version (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id),
  version_no integer not null,
  status text not null check (status in ('active', 'superseded')),
  content_hash text not null,
  storage_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);

create index if not exists idx_document_version_document on document_version (document_id);

create table if not exists document_chunk (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id),
  document_version_id uuid not null references document_version(id),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type in ('private', 'public')),
  chunk_index integer not null,
  content_text text not null,
  token_count integer not null default 0,
  embedding vector(1536),
  embedding_model_version text,
  search_tsv tsvector generated always as (to_tsvector('simple', coalesce(content_text, ''))) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_version_id, chunk_index)
);

create index if not exists idx_document_chunk_owner_scope on document_chunk (owner_user_id, scope_type);
create index if not exists idx_document_chunk_document on document_chunk (document_id);
create index if not exists idx_document_chunk_search_tsv on document_chunk using gin (search_tsv);
create index if not exists idx_document_chunk_content_trgm on document_chunk using gin (content_text gin_trgm_ops);
create index if not exists idx_document_chunk_embedding_hnsw on document_chunk using hnsw (embedding vector_cosine_ops);
