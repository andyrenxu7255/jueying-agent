-- V3-05 + V3-07: Add org_id to audit tables and core business tables for multi-tenant isolation
-- V3-06: Add org_policy table for organization-level policy persistence

-- 0. org_policy table for org-level policy persistence
CREATE TABLE IF NOT EXISTS org_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id),
  role text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'deleted')) DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, role, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_org_policy_org_status ON org_policy (org_id, status);

-- 1. audit_event: add org_id
ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_audit_event_org ON audit_event (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_user_id ON audit_event (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_event_occurred_at ON audit_event (occurred_at);

-- Backfill org_id from user table
UPDATE audit_event ae SET org_id = u.org_id
FROM "user" u
WHERE ae.user_id = u.username AND ae.org_id IS NULL;

-- 2. retrieval_trace: add org_id
ALTER TABLE retrieval_trace ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_retrieval_trace_org ON retrieval_trace (org_id);

-- Backfill org_id from user table
UPDATE retrieval_trace rt SET org_id = u.org_id
FROM "user" u
WHERE rt.owner_user_id = u.id AND rt.org_id IS NULL;

-- 3. channel_identity: add org_id
ALTER TABLE channel_identity ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_channel_identity_org ON channel_identity (org_id);

-- Backfill org_id from user table
UPDATE channel_identity ci SET org_id = u.org_id
FROM "user" u
WHERE ci.user_id = u.id AND ci.org_id IS NULL;

-- 4. policy_snapshot: add org_id
ALTER TABLE policy_snapshot ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_policy_snapshot_org ON policy_snapshot (org_id);

-- Backfill org_id from user table
UPDATE policy_snapshot ps SET org_id = u.org_id
FROM "user" u
WHERE ps.user_id = u.id AND ps.org_id IS NULL;

-- 5. workflow_instance: add org_id
ALTER TABLE workflow_instance ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_workflow_instance_org ON workflow_instance (org_id);

-- Backfill org_id from user table
UPDATE workflow_instance wi SET org_id = u.org_id
FROM "user" u
WHERE wi.owner_user_id = u.id AND wi.org_id IS NULL;

-- 6. workflow_definition: add org_id
ALTER TABLE workflow_definition ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_workflow_definition_org ON workflow_definition (org_id);

-- 7. document: add org_id
ALTER TABLE document ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_document_org ON document (org_id);

-- Backfill org_id from user table
UPDATE document d SET org_id = u.org_id
FROM "user" u
WHERE d.owner_user_id = u.id AND d.org_id IS NULL;

-- 8. document_chunk: add org_id
ALTER TABLE document_chunk ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_document_chunk_org ON document_chunk (org_id);

-- Backfill org_id from document
UPDATE document_chunk dc SET org_id = d.org_id
FROM document d
WHERE dc.document_id = d.id AND dc.org_id IS NULL;

-- 9. entity: add org_id
ALTER TABLE entity ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_entity_org ON entity (org_id);

-- Backfill org_id from user table
UPDATE entity e SET org_id = u.org_id
FROM "user" u
WHERE e.owner_user_id = u.id AND e.org_id IS NULL;

-- 10. fact: add org_id
ALTER TABLE fact ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_fact_org ON fact (org_id);

-- Backfill org_id from user table
UPDATE fact f SET org_id = u.org_id
FROM "user" u
WHERE f.owner_user_id = u.id AND f.org_id IS NULL;

-- 11. memory_item: add org_id
ALTER TABLE memory_item ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_memory_item_org ON memory_item (org_id);

-- 12. skill: add org_id
ALTER TABLE skill ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_skill_org ON skill (org_id);

-- 13. checkpoint: add org_id
ALTER TABLE checkpoint ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_org ON checkpoint (org_id);

-- Backfill org_id from workflow_instance
UPDATE checkpoint cp SET org_id = wi.org_id
FROM workflow_instance wi
WHERE cp.workflow_instance_id = wi.id AND cp.org_id IS NULL;

-- 14. artifact_object: add org_id
ALTER TABLE artifact_object ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_artifact_object_org ON artifact_object (org_id);

-- Backfill org_id from user table
UPDATE artifact_object ao SET org_id = u.org_id
FROM "user" u
WHERE ao.owner_user_id = u.id AND ao.org_id IS NULL;

-- 15. supervision_state table for supervisor persistence
CREATE TABLE IF NOT EXISTS supervision_state (
  workflow_instance_ref text PRIMARY KEY,
  owner_user_id text NOT NULL,
  state_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supervision_state_updated ON supervision_state (updated_at);
