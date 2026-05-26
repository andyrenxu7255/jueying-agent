-- Migration 015: Add org_id to relation table for multi-tenant isolation

ALTER TABLE relation ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);

CREATE INDEX IF NOT EXISTS idx_relation_org ON relation(org_id);

UPDATE relation r
SET org_id = (
  SELECT u.org_id FROM "user" u WHERE u.id = r.owner_user_id
)
WHERE r.org_id IS NULL AND EXISTS (
  SELECT 1 FROM "user" u WHERE u.id = r.owner_user_id
);
