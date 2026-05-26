-- ============================================================
-- 021_dream_mode.sql - 梦境模式：记忆分层管理 + 技能发现生态
-- ============================================================

-- ============================================================
-- 分支一：记忆分层管理系统
-- ============================================================

-- 1-1 记忆分析运行记录表（Admin Agent 分析任务追踪）
CREATE TABLE IF NOT EXISTS memory_analysis_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  run_type text NOT NULL CHECK (run_type IN ('dream_user', 'dream_org', 'admin_extraction', 'manual')),
  scope_user_id uuid REFERENCES "user"(id),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  items_scanned integer NOT NULL DEFAULT 0,
  items_compressed integer NOT NULL DEFAULT 0,
  items_extracted integer NOT NULL DEFAULT 0,
  facts_generated integer NOT NULL DEFAULT 0,
  skills_candidate integer NOT NULL DEFAULT 0,
  error_message text,
  result_summary jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_analysis_run_org ON memory_analysis_run(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_analysis_run_user ON memory_analysis_run(scope_user_id, created_at);

-- 1-2 组织级整合记忆表（Admin 中央知识库）
CREATE TABLE IF NOT EXISTS org_memory_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  title text NOT NULL,
  content_text text NOT NULL,
  summary text,
  category text NOT NULL CHECK (category IN ('business_rule', 'customer_insight', 'project_decision', 'process_knowledge', 'technical_discovery', 'team_collaboration', 'other')),
  source_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  source_memory_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  source_fact_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  extraction_run_id uuid REFERENCES memory_analysis_run(id),
  confidence real NOT NULL DEFAULT 0.5,
  relevance_score real NOT NULL DEFAULT 0.5,
  dedup_group_id uuid,
  status text NOT NULL CHECK (status IN ('candidate', 'active', 'merged', 'archived')) DEFAULT 'candidate',
  embedding vector(1536),
  embedding_model_version text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_memory_summary_org ON org_memory_summary(org_id, category, status);
CREATE INDEX IF NOT EXISTS idx_org_memory_summary_embedding_hnsw ON org_memory_summary USING hnsw (embedding vector_cosine_ops);

-- 1-3 记忆访问日志表（权限控制审计）
CREATE TABLE IF NOT EXISTS memory_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accessor_user_id uuid NOT NULL REFERENCES "user"(id),
  target_memory_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('memory_item', 'org_memory_summary', 'hermes_memory', 'fact')),
  access_type text NOT NULL CHECK (access_type IN ('read', 'write', 'delete', 'query')),
  access_result text NOT NULL CHECK (access_result IN ('granted', 'denied')),
  deny_reason text,
  ip_address text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_user ON memory_access_log(accessor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_target ON memory_access_log(target_type, target_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_result ON memory_access_log(access_result, created_at);

-- 1-4 记忆压缩归档记录表
CREATE TABLE IF NOT EXISTS memory_compression_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES "user"(id),
  org_id uuid REFERENCES organization(id) ON DELETE SET NULL,
  run_id uuid REFERENCES memory_analysis_run(id),
  compression_method text NOT NULL CHECK (compression_method IN ('llm_summary', 'truncation', 'dedup_merge')),
  original_char_count integer NOT NULL,
  compressed_char_count integer NOT NULL,
  archived_file_ref text,
  archived_storage_backend text CHECK (archived_storage_backend IN ('minio', 's3', 'localfs')),
  summary_text text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_compression_log_item ON memory_compression_log(memory_item_id);
CREATE INDEX IF NOT EXISTS idx_memory_compression_log_user ON memory_compression_log(owner_user_id, created_at);

-- ============================================================
-- 分支二：技能发现与管理生态
-- ============================================================

-- 2-1 场景价值评估表
CREATE TABLE IF NOT EXISTS scene_value_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES "user"(id),
  org_id uuid REFERENCES organization(id),
  scene_name text NOT NULL,
  scene_description text NOT NULL,
  trigger_pattern text,
  task_type text NOT NULL,
  usage_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  avg_duration_ms integer,
  interaction_pattern jsonb NOT NULL DEFAULT '{}',
  user_feedback_score real,
  reuse_frequency real NOT NULL DEFAULT 0,
  value_score real NOT NULL DEFAULT 0,
  skill_candidate_id uuid,
  last_used_at timestamptz,
  status text NOT NULL CHECK (status IN ('identified', 'evaluating', 'promoted', 'dismissed')) DEFAULT 'identified',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scene_value_user ON scene_value_assessment(owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_scene_value_score ON scene_value_assessment(value_score DESC);
CREATE INDEX IF NOT EXISTS idx_scene_value_task_type ON scene_value_assessment(task_type, status);

-- 2-2 技能审核记录表
CREATE TABLE IF NOT EXISTS skill_audit_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  auditor_user_id uuid REFERENCES "user"(id),
  org_id uuid REFERENCES organization(id),
  audit_type text NOT NULL CHECK (audit_type IN ('new_submission', 'daily_review', 'manual_review', 'promotion_review')),
  functionality_score real NOT NULL DEFAULT 0 CHECK (functionality_score >= 0 AND functionality_score <= 100),
  security_score real NOT NULL DEFAULT 0 CHECK (security_score >= 0 AND security_score <= 100),
  performance_score real NOT NULL DEFAULT 0 CHECK (performance_score >= 0 AND performance_score <= 100),
  org_fit_score real NOT NULL DEFAULT 0 CHECK (org_fit_score >= 0 AND org_fit_score <= 100),
  overall_score real NOT NULL DEFAULT 0,
  audit_result text NOT NULL CHECK (audit_result IN ('approved', 'rejected', 'needs_revision', 'promoted_to_org')),
  revision_notes text,
  security_issues jsonb NOT NULL DEFAULT '[]',
  performance_issues jsonb NOT NULL DEFAULT '[]',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skill_audit_skill ON skill_audit_record(skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_audit_result ON skill_audit_record(audit_result, created_at);

-- 2-3 技能使用统计表
CREATE TABLE IF NOT EXISTS skill_usage_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  version_id uuid REFERENCES skill_version(id),
  usage_date date NOT NULL,
  invocation_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  avg_duration_ms integer,
  distinct_users integer NOT NULL DEFAULT 0,
  unique_org_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  workflow_instance_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skill_usage_stats_skill ON skill_usage_stats(skill_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_skill_usage_stats_date ON skill_usage_stats(usage_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_usage_stats_unique ON skill_usage_stats(skill_id, usage_date);

-- 2-4 组织技能库表（从用户技能提升为组织技能）
CREATE TABLE IF NOT EXISTS org_skill_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  promoted_by uuid REFERENCES "user"(id),
  promoted_from_skill_id uuid REFERENCES skill(id),
  promotion_audit_id uuid REFERENCES skill_audit_record(id),
  origination_type text NOT NULL CHECK (origination_type IN ('user_upgrade', 'direct_create', 'mirror_import')),
  origination_user_id uuid REFERENCES "user"(id),
  category text NOT NULL CHECK (category IN ('productivity', 'analysis', 'communication', 'automation', 'knowledge', 'development', 'sales', 'other')),
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  install_count integer NOT NULL DEFAULT 0,
  rating_avg real,
  rating_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('active', 'deprecated', 'archived')) DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_skill_registry_org ON org_skill_registry(org_id, category, status);
CREATE INDEX IF NOT EXISTS idx_org_skill_registry_rating ON org_skill_registry(rating_avg DESC);
CREATE INDEX IF NOT EXISTS idx_org_skill_registry_tags ON org_skill_registry USING gin(tags);

-- ============================================================
-- 梦境模式配置表（组织级配置）
-- ============================================================
CREATE TABLE IF NOT EXISTS dream_mode_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES organization(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  dream_user_trigger text NOT NULL DEFAULT 'auto' CHECK (dream_user_trigger IN ('auto', 'scheduled', 'manual')),
  dream_scheduled_hour integer NOT NULL DEFAULT 3 CHECK (dream_scheduled_hour >= 0 AND dream_scheduled_hour <= 23),
  cooling_window_minutes integer NOT NULL DEFAULT 120 CHECK (cooling_window_minutes >= 30),
  compression_threshold_chars integer NOT NULL DEFAULT 4000 CHECK (compression_threshold_chars >= 500),
  max_compressions_per_run integer NOT NULL DEFAULT 100,
  skill_audit_enabled boolean NOT NULL DEFAULT true,
  skill_audit_scheduled_hour integer NOT NULL DEFAULT 5 CHECK (skill_audit_scheduled_hour >= 0 AND skill_audit_scheduled_hour <= 23),
  auto_promote_threshold real NOT NULL DEFAULT 80 CHECK (auto_promote_threshold >= 0 AND auto_promote_threshold <= 100),
  min_usage_for_scene_detection integer NOT NULL DEFAULT 3,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
