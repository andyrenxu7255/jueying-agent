create table if not exists "user" (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  username text not null,
  display_name text,
  role text not null check (role in ('user', 'admin')),
  status text not null check (status in ('active', 'inactive', 'disabled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, username)
);

create index if not exists idx_user_role on "user" (role);
create index if not exists idx_user_status on "user" (status);

create table if not exists channel_identity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  channel_type text not null check (channel_type in ('wecom', 'feishu', 'web_portal', 'system')),
  external_identity text not null,
  binding_status text not null check (binding_status in ('pending', 'bound', 'disabled', 'conflicted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_type, external_identity)
);

create index if not exists idx_channel_identity_user on channel_identity (user_id);
create index if not exists idx_channel_identity_binding_status on channel_identity (binding_status);

create table if not exists policy_snapshot (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  role text not null,
  acting_subject text,
  allowed_scopes jsonb not null default '[]'::jsonb,
  resource_rules jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  snapshot_hash text not null,
  created_at timestamptz not null default now(),
  unique (snapshot_hash)
);

create index if not exists idx_policy_snapshot_hash on policy_snapshot (snapshot_hash);
create index if not exists idx_policy_snapshot_user on policy_snapshot (user_id);
