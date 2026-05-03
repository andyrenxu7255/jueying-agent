-- ============================================================
-- 019_skill_constraint_expand.sql
-- Expand skill scope_type and skill_type constraints to support
-- JueYing (绝影) enterprise skill categories
-- ============================================================

-- Allow 'org' scope type for organization-wide skills
ALTER TABLE skill DROP CONSTRAINT IF EXISTS skill_scope_type_check;
ALTER TABLE skill ADD CONSTRAINT skill_scope_type_check CHECK (scope_type IN ('private', 'org', 'public'));

-- Allow extended skill types for office productivity skills
ALTER TABLE skill DROP CONSTRAINT IF EXISTS skill_skill_type_check;
ALTER TABLE skill ADD CONSTRAINT skill_skill_type_check CHECK (skill_type IN (
  'prompt', 'tool', 'workflow',
  'document', 'search', 'content', 'communication',
  'utility', 'automation', 'knowledge', 'security',
  'learning', 'assistant', 'integration', 'productivity'
));

-- Allow 'org' scope type for memory items
ALTER TABLE memory_item DROP CONSTRAINT IF EXISTS memory_item_scope_type_check;
ALTER TABLE memory_item ADD CONSTRAINT memory_item_scope_type_check CHECK (scope_type IN ('private', 'org', 'public'));
