-- Make created_by nullable for LUI task dispatch (admin creates task without explicit user context)
ALTER TABLE org_task ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE org_task DROP CONSTRAINT IF EXISTS org_task_created_by_fkey;
ALTER TABLE org_task ADD CONSTRAINT org_task_created_by_fkey FOREIGN KEY (created_by) REFERENCES "user"(id) ON DELETE SET NULL;
