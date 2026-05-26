create table if not exists organization (
  id uuid primary key default gen_random_uuid(),
  org_name text not null,
  display_name text,
  status text not null check (status in ('active', 'suspended', 'deleted')) default 'active',
  settings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_name on organization (org_name);
create index if not exists idx_organization_status on organization (status);

alter table "user" drop constraint if exists idx_user_org_username_shared;

insert into organization (id, org_name, display_name, status, settings, metadata)
values (
  '00000000-0000-0000-0000-000000000001',
  'default',
  'Default Organization',
  'active',
  '{"max_users": 100, "max_workflows_per_day": 500}'::jsonb,
  '{"source": "migration", "auto_created": true}'::jsonb
) on conflict do nothing;

insert into "user" (id, org_id, username, display_name, role, status, metadata)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'system_seed',
  'System Seed User',
  'admin',
  'active',
  '{"source": "migration", "auto_created": true}'::jsonb
)
on conflict (id) do nothing;

insert into organization (id, org_name, display_name, status, settings, metadata)
select
  u.org_id,
  'org-' || left(replace(u.org_id::text, '-', ''), 8),
  'Migrated Organization ' || left(replace(u.org_id::text, '-', ''), 8),
  'active',
  '{}'::jsonb,
  '{"source": "migration", "auto_created": true, "reason": "backfill_existing_user_org"}'::jsonb
from "user" u
where u.org_id is not null
on conflict (id) do nothing;

alter table "user" add constraint fk_user_organization
  foreign key (org_id) references organization(id) on delete restrict;

alter table "user" add constraint idx_user_org_username_shared
  unique (org_id, username);
