-- ============================================================
-- 022_user_file_storage.sql
-- 用户文件存储机制：为每个用户分配独立存储空间
-- 支持：用户上传文件保存、LLM生成文件保存、文件权限控制
-- ============================================================

-- 用户文件主表
CREATE TABLE IF NOT EXISTS user_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  org_id uuid,
  storage_backend text NOT NULL CHECK (storage_backend IN ('localfs', 'minio')),
  storage_path text NOT NULL,
  original_name text NOT NULL,
  mime_type text,
  byte_size bigint NOT NULL DEFAULT 0,
  content_hash text,
  file_category text NOT NULL DEFAULT 'upload'
    CHECK (file_category IN ('upload', 'artifact', 'generated', 'attachment', 'archive')),
  scope text NOT NULL DEFAULT 'private'
    CHECK (scope IN ('private', 'shared', 'public')),
  source text NOT NULL DEFAULT 'user_upload'
    CHECK (source IN ('user_upload', 'llm_generated', 'stage_output', 'import', 'system')),
  source_ref text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deleted')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_file_user ON user_file (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_file_org ON user_file (org_id, status);
CREATE INDEX IF NOT EXISTS idx_user_file_category ON user_file (user_id, file_category);
CREATE INDEX IF NOT EXISTS idx_user_file_scope ON user_file (user_id, scope);
CREATE INDEX IF NOT EXISTS idx_user_file_hash ON user_file (content_hash);

-- 为 document_version 表添加 raw_file_ref 字段，关联用户原始上传文件
ALTER TABLE document_version
  ADD COLUMN IF NOT EXISTS raw_file_ref text;

COMMENT ON COLUMN document_version.raw_file_ref IS '指向 user_file.id 的原始文件引用';
