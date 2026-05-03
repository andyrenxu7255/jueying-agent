create table if not exists artifact_object (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references "user"(id),
  scope_type text not null check (scope_type = 'private'),
  artifact_type text not null,
  content_hash text not null,
  storage_backend text not null check (storage_backend in ('minio', 's3', 'localfs')),
  storage_ref text not null,
  mime_type text not null,
  byte_size bigint not null,
  inline_threshold_exceeded boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_artifact_owner_scope on artifact_object (owner_user_id, scope_type);
create index if not exists idx_artifact_content_hash on artifact_object (content_hash);
