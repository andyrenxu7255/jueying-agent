-- Align manual SQL migrations with the shared Drizzle schema used by fact-retrieval.

ALTER TABLE document
  ADD COLUMN IF NOT EXISTS current_version_id uuid;

ALTER TABLE document_version
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS source_ref text;

ALTER TABLE artifact_object
  ADD COLUMN IF NOT EXISTS workflow_instance_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_stage_id uuid,
  ADD COLUMN IF NOT EXISTS execution_session_id uuid,
  ADD COLUMN IF NOT EXISTS skill_id uuid,
  ADD COLUMN IF NOT EXISTS skill_version_id uuid;

ALTER TABLE fact
  ADD COLUMN IF NOT EXISTS fact_type text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE fact_evidence
  ADD COLUMN IF NOT EXISTS support_type text,
  ADD COLUMN IF NOT EXISTS excerpt text;

ALTER TABLE fact_conflict
  ADD COLUMN IF NOT EXISTS decision_note text,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

ALTER TABLE retrieval_trace
  ADD COLUMN IF NOT EXISTS workflow_stage_id uuid,
  ADD COLUMN IF NOT EXISTS step_trace_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_pack_hash text;

CREATE INDEX IF NOT EXISTS idx_artifact_workflow_instance
  ON artifact_object (workflow_instance_id);

CREATE INDEX IF NOT EXISTS idx_artifact_workflow_stage
  ON artifact_object (workflow_stage_id);

CREATE INDEX IF NOT EXISTS idx_retrieval_trace_stage
  ON retrieval_trace (workflow_stage_id);
