-- ============================================================
-- 027_workflow_definition_review.sql
-- Workflow definition review bridge for high-value workflow skills
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_definition_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid REFERENCES workflow_definition(id) ON DELETE SET NULL,
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source_skill_id uuid NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  source_skill_version_id uuid NOT NULL REFERENCES skill_version(id) ON DELETE CASCADE,
  source_audit_id uuid REFERENCES skill_audit_record(id) ON DELETE SET NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('private', 'public')),
  name text NOT NULL,
  workflow_type text NOT NULL,
  risk_level text NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('pending', 'approved', 'rejected', 'withdrawn')) DEFAULT 'pending',
  skill_recall_count integer NOT NULL DEFAULT 0,
  skill_injected_count integer NOT NULL DEFAULT 0,
  skill_succeeded_count integer NOT NULL DEFAULT 0,
  avg_business_score real NOT NULL DEFAULT 0,
  audit_overall_score real NOT NULL DEFAULT 0,
  definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_notes text,
  reviewed_by uuid REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_definition_review_scope_status
  ON workflow_definition_review(scope_type, review_status);

CREATE INDEX IF NOT EXISTS idx_workflow_definition_review_org
  ON workflow_definition_review(org_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_definition_review_skill
  ON workflow_definition_review(source_skill_id, review_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definition_review_skill_version
  ON workflow_definition_review(source_skill_version_id);
