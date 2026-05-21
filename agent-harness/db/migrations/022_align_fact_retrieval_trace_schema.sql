-- Follow-up alignment for fact and retrieval trace schema fields used by fact-retrieval.

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

CREATE INDEX IF NOT EXISTS idx_retrieval_trace_stage
  ON retrieval_trace (workflow_stage_id);
