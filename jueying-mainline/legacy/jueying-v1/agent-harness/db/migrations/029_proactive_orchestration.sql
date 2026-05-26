CREATE TABLE IF NOT EXISTS proactive_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES "user"(id),
  rule_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('active', 'paused', 'archived')) DEFAULT 'active',
  schedule_expression text NOT NULL,
  trigger_source text NOT NULL CHECK (trigger_source IN ('fact', 'memory', 'skill', 'manual', 'hybrid')) DEFAULT 'fact',
  target_scope text NOT NULL CHECK (target_scope IN ('user', 'org', 'mixed')) DEFAULT 'org',
  approval_mode text NOT NULL CHECK (approval_mode IN ('review_first', 'auto_when_safe', 'manual_only')) DEFAULT 'review_first',
  scan_window_hours integer NOT NULL DEFAULT 72,
  priority integer NOT NULL DEFAULT 50,
  evidence_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  routing_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_rule_org_status ON proactive_rule(org_id, status);
CREATE INDEX IF NOT EXISTS idx_proactive_rule_created_by ON proactive_rule(created_by);

CREATE TABLE IF NOT EXISTS proactive_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES proactive_rule(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'reviewing', 'dispatched', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  scanned_facts integer NOT NULL DEFAULT 0,
  scanned_summaries integer NOT NULL DEFAULT 0,
  generated_insights integer NOT NULL DEFAULT 0,
  generated_missions integer NOT NULL DEFAULT 0,
  dispatched_assignments integer NOT NULL DEFAULT 0,
  report_ref text,
  error_message text,
  run_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_run_rule_status ON proactive_run(rule_id, status);
CREATE INDEX IF NOT EXISTS idx_proactive_run_org_status ON proactive_run(org_id, status);

CREATE TABLE IF NOT EXISTS proactive_insight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES proactive_run(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES proactive_rule(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  insight_title text NOT NULL,
  insight_summary text NOT NULL,
  insight_type text NOT NULL CHECK (insight_type IN ('fact_gap', 'customer_followup', 'sales_signal', 'process_issue', 'skill_upgrade', 'other')) DEFAULT 'other',
  confidence real NOT NULL DEFAULT 0.5,
  evidence_pack_hash text,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL CHECK (review_status IN ('pending', 'approved', 'rejected', 'auto_approved')) DEFAULT 'pending',
  review_note text,
  reviewer_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_insight_run_status ON proactive_insight(run_id, review_status);
CREATE INDEX IF NOT EXISTS idx_proactive_insight_org_status ON proactive_insight(org_id, review_status);

CREATE TABLE IF NOT EXISTS proactive_mission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES proactive_run(id) ON DELETE CASCADE,
  insight_id uuid NOT NULL REFERENCES proactive_insight(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  mission_title text NOT NULL,
  mission_summary text NOT NULL,
  mission_type text NOT NULL CHECK (mission_type IN ('user_task', 'admin_review', 'fact_collection', 'skill_upgrade', 'report_followup', 'other')) DEFAULT 'user_task',
  status text NOT NULL CHECK (status IN ('draft', 'queued', 'assigned', 'submitted', 'verified', 'blocked', 'done', 'cancelled')) DEFAULT 'draft',
  priority integer NOT NULL DEFAULT 50,
  target_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  workflow_ref text,
  assignment_ref uuid REFERENCES org_task_assignment(id) ON DELETE SET NULL,
  due_at timestamptz,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_mission_run_status ON proactive_mission(run_id, status);
CREATE INDEX IF NOT EXISTS idx_proactive_mission_org_status ON proactive_mission(org_id, status);
CREATE INDEX IF NOT EXISTS idx_proactive_mission_target_user ON proactive_mission(target_user_id, status);

CREATE TABLE IF NOT EXISTS proactive_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES proactive_run(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  report_title text NOT NULL,
  report_summary text NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('daily', 'weekly', 'incident', 'review', 'other')) DEFAULT 'review',
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')) DEFAULT 'draft',
  report_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  publisher_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proactive_report_org_status ON proactive_report(org_id, status);
CREATE INDEX IF NOT EXISTS idx_proactive_report_run ON proactive_report(run_id, status);

ALTER TABLE org_task
  ADD COLUMN IF NOT EXISTS proactive_rule_id uuid REFERENCES proactive_rule(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proactive_run_id uuid REFERENCES proactive_run(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proactive_insight_id uuid REFERENCES proactive_insight(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proactive_mission_id uuid REFERENCES proactive_mission(id) ON DELETE SET NULL;

ALTER TABLE org_task
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual';

ALTER TABLE org_task
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';

ALTER TABLE org_task
  ADD COLUMN IF NOT EXISTS source_summary text NOT NULL DEFAULT '';

ALTER TABLE org_task
  ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE org_task
  ADD COLUMN IF NOT EXISTS rule_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE org_task_assignment
  ADD COLUMN IF NOT EXISTS proactive_mission_id uuid REFERENCES proactive_mission(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proactive_run_id uuid REFERENCES proactive_run(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS feedback_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_org_task_proactive_rule ON org_task(proactive_rule_id, proactive_run_id);
CREATE INDEX IF NOT EXISTS idx_org_task_assignment_proactive ON org_task_assignment(proactive_mission_id, proactive_run_id, status);

INSERT INTO proactive_rule (
  id,
  org_id,
  created_by,
  rule_name,
  description,
  status,
  schedule_expression,
  trigger_source,
  target_scope,
  approval_mode,
  scan_window_hours,
  priority,
  evidence_policy,
  routing_policy,
  metadata
)
SELECT
  'd0000029-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'MEDDIC 销售复盘与客户跟进',
  '基于 MEDDIC demo 资料与 ClawHub 销售技能，扫描事实层、记忆层和组织笔记，生成待审核洞察与派单任务。',
  'active',
  '0 8 * * *',
  'hybrid',
  'org',
  'review_first',
  168,
  90,
  '{"require_evidence":true,"min_confidence":0.72,"dedupe_key":"title+source","allowed_sources":["fact","memory","skill"]}'::jsonb,
  '{"preferred_channels":["org_task"],"default_mission_type":"user_task","escalation_role":"admin"}'::jsonb,
  '{"source":"demo_seed","scenario":"meddic_sales_ops"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM proactive_rule WHERE id = 'd0000029-0000-0000-0000-000000000001'::uuid
);

