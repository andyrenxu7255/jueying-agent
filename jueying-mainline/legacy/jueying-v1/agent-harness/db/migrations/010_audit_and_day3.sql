do $$ begin
  raise notice '010_audit_and_day3: original content had non-conforming table definitions (text PKs, missing scope_type). Tables are now defined in 002-007 and 008 migrations. This script only adds missing indexes and constraints.';
end $$;

create index if not exists idx_audit_event_action_time on audit_event (action, occurred_at);

create index if not exists idx_entity_name_trgm on entity using gin (canonical_name gin_trgm_ops);

create index if not exists idx_document_title_trgm on document using gin (title gin_trgm_ops);

do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'audit_event' and column_name = 'trace_id') then
    raise notice 'trace_id column already exists in audit_event';
  else
    alter table audit_event add column trace_id text;
    raise notice 'Added trace_id column to audit_event';
  end if;
end $$;
