-- ============================================================
-- 026_recall_outcome_attribution.sql
-- Hook-style recall and business outcome attribution ledger
-- ============================================================

CREATE TABLE IF NOT EXISTS hook_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  owner_user_id uuid,
  session_id text,
  workflow_instance_id uuid,
  workflow_stage_id uuid,
  event_name text NOT NULL,
  event_source text NOT NULL,
  event_phase text NOT NULL CHECK (event_phase IN ('pre', 'post', 'final', 'async')),
  resource_type text,
  resource_ref text,
  result text NOT NULL DEFAULT 'observed' CHECK (result IN ('observed', 'allowed', 'blocked', 'success', 'failure', 'degraded')),
  latency_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hook_event_log_workflow ON hook_event_log(workflow_instance_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hook_event_log_org_event ON hook_event_log(org_id, event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_hook_event_log_resource ON hook_event_log(resource_type, resource_ref, created_at);

CREATE TABLE IF NOT EXISTS knowledge_recall_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  owner_user_id uuid,
  session_id text,
  workflow_instance_id uuid,
  workflow_stage_id uuid,
  recall_source text NOT NULL CHECK (recall_source IN ('memory', 'fact', 'document_chunk', 'org_memory', 'hermes_memory')),
  item_ref text NOT NULL,
  query_text text,
  retrieval_trace_id text,
  evidence_pack_hash text,
  score real,
  injected boolean NOT NULL DEFAULT false,
  injection_ref text,
  source_scope text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_recall_workflow ON knowledge_recall_event(workflow_instance_id, workflow_stage_id, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_recall_item ON knowledge_recall_event(recall_source, item_ref, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_recall_trace ON knowledge_recall_event(retrieval_trace_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_recall_org ON knowledge_recall_event(org_id, created_at);

CREATE TABLE IF NOT EXISTS skill_recall_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  owner_user_id uuid,
  session_id text,
  workflow_instance_id uuid,
  workflow_stage_id uuid,
  skill_id uuid,
  version_id uuid,
  query_text text,
  recall_reason text,
  score real,
  injected boolean NOT NULL DEFAULT false,
  injection_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skill_recall_skill ON skill_recall_event(skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_recall_workflow ON skill_recall_event(workflow_instance_id, workflow_stage_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_recall_org ON skill_recall_event(org_id, created_at);

CREATE TABLE IF NOT EXISTS workflow_outcome_eval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id uuid NOT NULL,
  org_id uuid,
  owner_user_id uuid,
  outcome_status text NOT NULL CHECK (outcome_status IN ('succeeded', 'failed', 'cancelled', 'partial')),
  business_score real NOT NULL DEFAULT 0 CHECK (business_score >= 0 AND business_score <= 100),
  user_feedback_score real,
  duration_ms integer,
  success_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  grader_version text NOT NULL DEFAULT 'heuristic.v1',
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_outcome_eval_workflow ON workflow_outcome_eval(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_outcome_eval_org_score ON workflow_outcome_eval(org_id, business_score DESC, created_at);

CREATE TABLE IF NOT EXISTS recall_outcome_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_eval_id uuid NOT NULL,
  workflow_instance_id uuid NOT NULL,
  attribution_type text NOT NULL CHECK (attribution_type IN ('knowledge', 'skill')),
  source_event_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_ref text NOT NULL,
  contribution_score real NOT NULL DEFAULT 0 CHECK (contribution_score >= 0 AND contribution_score <= 100),
  contribution_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recall_outcome_workflow ON recall_outcome_attribution(workflow_instance_id, attribution_type);
CREATE INDEX IF NOT EXISTS idx_recall_outcome_resource ON recall_outcome_attribution(resource_type, resource_ref);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recall_outcome_source_unique ON recall_outcome_attribution(outcome_eval_id, attribution_type, source_event_id);

CREATE OR REPLACE VIEW skill_business_outcome_daily AS
SELECT
  s.id AS skill_id,
  s.skill_name,
  date_trunc('day', sr.created_at)::date AS usage_date,
  COUNT(*) AS recall_count,
  COUNT(*) FILTER (WHERE sr.injected) AS injected_count,
  COUNT(*) FILTER (WHERE woe.outcome_status = 'succeeded') AS succeeded_count,
  AVG(woe.business_score) AS avg_business_score
FROM skill_recall_event sr
JOIN skill s ON s.id = sr.skill_id
LEFT JOIN workflow_outcome_eval woe ON woe.workflow_instance_id = sr.workflow_instance_id
GROUP BY s.id, s.skill_name, date_trunc('day', sr.created_at)::date;

CREATE OR REPLACE VIEW knowledge_business_outcome_daily AS
SELECT
  kr.recall_source,
  kr.item_ref,
  date_trunc('day', kr.created_at)::date AS usage_date,
  COUNT(*) AS recall_count,
  COUNT(*) FILTER (WHERE kr.injected) AS injected_count,
  COUNT(*) FILTER (WHERE woe.outcome_status = 'succeeded') AS succeeded_count,
  AVG(woe.business_score) AS avg_business_score
FROM knowledge_recall_event kr
LEFT JOIN workflow_outcome_eval woe ON woe.workflow_instance_id = kr.workflow_instance_id
GROUP BY kr.recall_source, kr.item_ref, date_trunc('day', kr.created_at)::date;
