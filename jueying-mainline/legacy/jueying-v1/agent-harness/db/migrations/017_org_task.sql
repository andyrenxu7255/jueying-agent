CREATE TABLE IF NOT EXISTS org_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES "user"(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  task_type text NOT NULL CHECK (task_type IN ('form', 'workflow', 'heartbeat')) DEFAULT 'form',
  schedule_type text NOT NULL CHECK (schedule_type IN ('once', 'daily', 'weekly', 'cron')) DEFAULT 'once',
  cron_expression text,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'archived')) DEFAULT 'active',
  prompt_message text NOT NULL DEFAULT '',
  required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_channels text[] NOT NULL DEFAULT ARRAY['wecom']::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_task_org_status ON org_task(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_task_schedule ON org_task(schedule_type, status);
CREATE INDEX IF NOT EXISTS idx_org_task_created_by ON org_task(created_by);

CREATE TABLE IF NOT EXISTS org_task_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES org_task(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user"(id),
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'notified', 'completed', 'skipped', 'expired')) DEFAULT 'pending',
  workflow_ref text,
  notified_at timestamptz,
  completed_at timestamptz,
  response_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_task_assignment_task ON org_task_assignment(task_id, status);
CREATE INDEX IF NOT EXISTS idx_org_task_assignment_user ON org_task_assignment(user_id, status);
CREATE INDEX IF NOT EXISTS idx_org_task_assignment_org ON org_task_assignment(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_task_assignment_workflow ON org_task_assignment(workflow_ref);
