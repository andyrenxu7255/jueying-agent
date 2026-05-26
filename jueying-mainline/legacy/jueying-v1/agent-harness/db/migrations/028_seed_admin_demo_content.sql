-- ============================================================
-- 028_seed_admin_demo_content.sql
-- Admin-ready demo content for knowledge, graph, and ClawHub skill maintenance.
-- Sensitive tokens are intentionally not seeded here; only public metadata and
-- low-risk demonstration knowledge are preloaded.
-- ============================================================

ALTER TABLE relation
  ADD COLUMN IF NOT EXISTS strength real,
  ADD COLUMN IF NOT EXISTS evidence_ref text;

ALTER TABLE document
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id),
  ADD COLUMN IF NOT EXISTS current_version_id uuid;

ALTER TABLE document_version
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS source_ref text;

ALTER TABLE document_chunk
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);

ALTER TABLE entity
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id),
  ADD COLUMN IF NOT EXISTS source_confidence real;

ALTER TABLE entity_attribute
  ADD COLUMN IF NOT EXISTS value_type text;

ALTER TABLE relation
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);

ALTER TABLE skill
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organization(id);

ALTER TABLE skill DROP CONSTRAINT IF EXISTS skill_scope_type_check;
ALTER TABLE skill ADD CONSTRAINT skill_scope_type_check CHECK (scope_type IN ('private', 'org', 'public'));

ALTER TABLE skill DROP CONSTRAINT IF EXISTS skill_skill_type_check;
ALTER TABLE skill ADD CONSTRAINT skill_skill_type_check CHECK (skill_type IN (
  'prompt', 'tool', 'workflow',
  'document', 'search', 'content', 'communication',
  'utility', 'automation', 'knowledge', 'security',
  'learning', 'assistant', 'integration', 'productivity'
));

WITH ensure_default_org AS (
  INSERT INTO organization (id, org_name, display_name, status, settings, metadata)
  VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'default',
    'Default Organization',
    'active',
    '{}'::jsonb,
    '{"source":"demo_seed","auto_created":true}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id
), ensure_seed_owner AS (
  INSERT INTO "user" (id, org_id, username, display_name, role, status, metadata)
  VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'system_seed',
    'System Seed User',
    'admin',
    'active',
    '{"source":"demo_seed","auto_created":true}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id
), seed_owner AS (
  SELECT id AS owner_user_id, '00000000-0000-0000-0000-000000000001'::uuid AS org_id
  FROM ensure_seed_owner
  UNION ALL
  SELECT id AS owner_user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000001'::uuid) AS org_id
  FROM "user"
  WHERE username = 'system_seed'
  ORDER BY owner_user_id
  LIMIT 1
), demo_docs AS (
  SELECT *
  FROM (VALUES
    (
      'd0000028-0000-0000-0000-000000000001'::uuid,
      'e0000028-0000-0000-0000-000000000001'::uuid,
      'f0000028-0000-0000-0000-000000000001'::uuid,
      'MEDDIC销售六步法总览',
      'local-demo://MEDDIC销售助手/销售六步法总览',
      'MEDDIC不要只作为静态清单使用。高手把它落实为从Discovery到Negotiate & Close的动态销售流程，每个阶段都有明确动作、退出标准和管理判断。

六步法包括Discovery、Scope、Go/No-Go、Validate Solution、Business Case、Negotiate & Close。Discovery负责绘制客户权力与痛苦地图，Scope把模糊需求转成项目范围，Go/No-Go要求经济决策者亲口确认痛点、优先级、预算和决策标准。

方案验证阶段要和Champion共同制定验证计划，收集截图、报告、客户反馈和竞品差异证据。Business Case阶段把技术验证转译成ROI和业务价值，面向EB完成汇报并推动采购、法务流程。

这套流程的价值在于节奏感、可预测性和资源效率。任何阶段gate没有真实通过，都不应简单沿用该阶段赢率。'
    ),
    (
      'd0000028-0000-0000-0000-000000000002'::uuid,
      'e0000028-0000-0000-0000-000000000002'::uuid,
      'f0000028-0000-0000-0000-000000000002'::uuid,
      '销售六步法Gates检查清单',
      'local-demo://MEDDIC销售助手/销售六步法gates',
      'Discovery阶段要确认Champion或目标Champion、客户关注点、部门和组织分工、EB判断、痛点现状、竞争对手以及下一步行动计划。

Scope阶段要由Champion亲口确认组织收益、时间计划、可能预算，并形成书面确认。关键推进信号是Champion愿意帮助约见EB。

Go/No-Go阶段必须见EB，由EB确认痛点、优先级、业务收益、流程、时间、预算、供应商评估方式和关键标准。无法取得EB确认时，应重新评估投入。

Validation Solution阶段要与Champion当面制定验证计划和标准，并明确双方在POC、案例考察或Demo中的责任。Business Case阶段要回顾验证报告，向EB汇报方案，建立采购联系并完成谈判计划。

Negotiate Close阶段要完成报价、订单检查、SOW和交付确认，并更新CRM状态。'
    ),
    (
      'd0000028-0000-0000-0000-000000000003'::uuid,
      'e0000028-0000-0000-0000-000000000003'::uuid,
      'f0000028-0000-0000-0000-000000000003'::uuid,
      'Champion识别标准',
      'local-demo://MEDDIC销售助手/关于champion',
      '复杂B2B销售中，Champion不是普通教练。他要在你不在场时替你销售、帮助扫清障碍，并把项目成功视作自己的个人成功。

合格Champion至少满足四项标准：在组织内具备权力或影响力，能提供接触经济决策者的渠道，把你的方案看作个人成功，并能在内部会议中用自己的语言销售方案价值。

寻找Champion可以从公司重点任务、优秀影响者、新晋管理者、善于提问的人和外部合作伙伴线索入手。测试Champion时要重点观察他是否提供内部情报、组织技术深潜、推动流程审核、筹备高层汇报、协助方案验证和商业论证。

如果候选人无法影响决策、无法引荐EB或只提供八卦信息，就更像Coach而不是Champion。'
    ),
    (
      'd0000028-0000-0000-0000-000000000004'::uuid,
      'e0000028-0000-0000-0000-000000000004'::uuid,
      'f0000028-0000-0000-0000-000000000004'::uuid,
      'Discovery探索阶段五道门',
      'local-demo://MEDDIC销售助手/discover探索阶段',
      '高质量Pipeline始于高质量Discovery。机会进入管道前，应完成机会资格认证，而不是只凭客户咨询或CRM建档。

Discovery五道门包括：角色地图、可解决的痛苦、痛苦影响、现状流程、下一步行动。角色地图要包含Champion、EB、技术评估者和最终用户；痛苦要能被量化，并与客户战略目标或业务损失关联。

探索阶段要理解客户现状流程、工具和约束，明确为什么当前做法无法满足目标。每次沟通都要以双方认可的下一步结尾，而不是停留在保持联系。

销售经理在Pipeline Review中要追问Champion是谁、痛苦是否量化、客户最大损失是什么、下一步是否共同确认。'
    ),
    (
      'd0000028-0000-0000-0000-000000000005'::uuid,
      'e0000028-0000-0000-0000-000000000005'::uuid,
      'f0000028-0000-0000-0000-000000000005'::uuid,
      'Business Case商业论证框架',
      'local-demo://MEDDIC销售助手/businessCase阶段',
      'Business Case的目标是让经济决策者清楚看到投资回报。它不应堆砌功能，而应回答之前是什么样、之后会是什么样、价值有多大。

之前状态要重述探索阶段客户已确认的业务痛苦；之后状态要描绘解决方案带来的新工作方式；价值部分必须用验证阶段共同确认的证据量化ROI。

呈报前要与Champion面对面终审商业论证，确认数据、措辞和共同目标。向EB汇报后应争取书面认可，并打通采购、法务等后续流程。

进入谈判前要完成谈判计划，明确底线、可交换价值、对方谈判风格、盟友和阻力，并再次验证项目优先级、合同流程和签约时间表。'
    )
  ) AS v(document_id, version_id, chunk_id, title, source_uri, content_text)
)
INSERT INTO document (id, owner_user_id, org_id, scope_type, title, source_kind, source_uri, status, content_hash, current_version_id, metadata)
SELECT
  dd.document_id,
  so.owner_user_id,
  so.org_id,
  'public',
  dd.title,
  'manual',
  dd.source_uri,
  'active',
  'sha256:demo-meddic-' || replace(dd.document_id::text, '-', ''),
  dd.version_id,
  jsonb_build_object('source', 'demo_seed', 'domain', 'sales', 'collection', 'MEDDIC销售助手', 'demo', true)
FROM demo_docs dd
CROSS JOIN seed_owner so
ON CONFLICT (id) DO NOTHING;

WITH seed_owner AS (
  SELECT id AS owner_user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000001'::uuid) AS org_id
  FROM "user"
  WHERE username = 'system_seed'
  ORDER BY id
  LIMIT 1
), demo_docs AS (
  SELECT *
  FROM (VALUES
    ('d0000028-0000-0000-0000-000000000001'::uuid, 'e0000028-0000-0000-0000-000000000001'::uuid, 'f0000028-0000-0000-0000-000000000001'::uuid, 'MEDDIC销售六步法总览', 'local-demo://MEDDIC销售助手/销售六步法总览', 'MEDDIC不要只作为静态清单使用。高手把它落实为从Discovery到Negotiate & Close的动态销售流程，每个阶段都有明确动作、退出标准和管理判断。

六步法包括Discovery、Scope、Go/No-Go、Validate Solution、Business Case、Negotiate & Close。Discovery负责绘制客户权力与痛苦地图，Scope把模糊需求转成项目范围，Go/No-Go要求经济决策者亲口确认痛点、优先级、预算和决策标准。

方案验证阶段要和Champion共同制定验证计划，收集截图、报告、客户反馈和竞品差异证据。Business Case阶段把技术验证转译成ROI和业务价值，面向EB完成汇报并推动采购、法务流程。

这套流程的价值在于节奏感、可预测性和资源效率。任何阶段gate没有真实通过，都不应简单沿用该阶段赢率。'),
    ('d0000028-0000-0000-0000-000000000002'::uuid, 'e0000028-0000-0000-0000-000000000002'::uuid, 'f0000028-0000-0000-0000-000000000002'::uuid, '销售六步法Gates检查清单', 'local-demo://MEDDIC销售助手/销售六步法gates', 'Discovery阶段要确认Champion或目标Champion、客户关注点、部门和组织分工、EB判断、痛点现状、竞争对手以及下一步行动计划。

Scope阶段要由Champion亲口确认组织收益、时间计划、可能预算，并形成书面确认。关键推进信号是Champion愿意帮助约见EB。

Go/No-Go阶段必须见EB，由EB确认痛点、优先级、业务收益、流程、时间、预算、供应商评估方式和关键标准。无法取得EB确认时，应重新评估投入。

Validation Solution阶段要与Champion当面制定验证计划和标准，并明确双方在POC、案例考察或Demo中的责任。Business Case阶段要回顾验证报告，向EB汇报方案，建立采购联系并完成谈判计划。

Negotiate Close阶段要完成报价、订单检查、SOW和交付确认，并更新CRM状态。'),
    ('d0000028-0000-0000-0000-000000000003'::uuid, 'e0000028-0000-0000-0000-000000000003'::uuid, 'f0000028-0000-0000-0000-000000000003'::uuid, 'Champion识别标准', 'local-demo://MEDDIC销售助手/关于champion', '复杂B2B销售中，Champion不是普通教练。他要在你不在场时替你销售、帮助扫清障碍，并把项目成功视作自己的个人成功。

合格Champion至少满足四项标准：在组织内具备权力或影响力，能提供接触经济决策者的渠道，把你的方案看作个人成功，并能在内部会议中用自己的语言销售方案价值。

寻找Champion可以从公司重点任务、优秀影响者、新晋管理者、善于提问的人和外部合作伙伴线索入手。测试Champion时要重点观察他是否提供内部情报、组织技术深潜、推动流程审核、筹备高层汇报、协助方案验证和商业论证。

如果候选人无法影响决策、无法引荐EB或只提供八卦信息，就更像Coach而不是Champion。'),
    ('d0000028-0000-0000-0000-000000000004'::uuid, 'e0000028-0000-0000-0000-000000000004'::uuid, 'f0000028-0000-0000-0000-000000000004'::uuid, 'Discovery探索阶段五道门', 'local-demo://MEDDIC销售助手/discover探索阶段', '高质量Pipeline始于高质量Discovery。机会进入管道前，应完成机会资格认证，而不是只凭客户咨询或CRM建档。

Discovery五道门包括：角色地图、可解决的痛苦、痛苦影响、现状流程、下一步行动。角色地图要包含Champion、EB、技术评估者和最终用户；痛苦要能被量化，并与客户战略目标或业务损失关联。

探索阶段要理解客户现状流程、工具和约束，明确为什么当前做法无法满足目标。每次沟通都要以双方认可的下一步结尾，而不是停留在保持联系。

销售经理在Pipeline Review中要追问Champion是谁、痛苦是否量化、客户最大损失是什么、下一步是否共同确认。'),
    ('d0000028-0000-0000-0000-000000000005'::uuid, 'e0000028-0000-0000-0000-000000000005'::uuid, 'f0000028-0000-0000-0000-000000000005'::uuid, 'Business Case商业论证框架', 'local-demo://MEDDIC销售助手/businessCase阶段', 'Business Case的目标是让经济决策者清楚看到投资回报。它不应堆砌功能，而应回答之前是什么样、之后会是什么样、价值有多大。

之前状态要重述探索阶段客户已确认的业务痛苦；之后状态要描绘解决方案带来的新工作方式；价值部分必须用验证阶段共同确认的证据量化ROI。

呈报前要与Champion面对面终审商业论证，确认数据、措辞和共同目标。向EB汇报后应争取书面认可，并打通采购、法务等后续流程。

进入谈判前要完成谈判计划，明确底线、可交换价值、对方谈判风格、盟友和阻力，并再次验证项目优先级、合同流程和签约时间表。')
  ) AS v(document_id, version_id, chunk_id, title, source_uri, content_text)
)
INSERT INTO document_version (id, document_id, version_no, status, content_hash, mime_type, source_ref, metadata)
SELECT
  dd.version_id,
  dd.document_id,
  1,
  'active',
  'sha256:demo-meddic-' || replace(dd.document_id::text, '-', ''),
  'text/markdown',
  dd.source_uri,
  jsonb_build_object('source', 'demo_seed', 'title', dd.title)
FROM demo_docs dd
ON CONFLICT (document_id, version_no) DO NOTHING;

WITH seed_owner AS (
  SELECT id AS owner_user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000001'::uuid) AS org_id
  FROM "user"
  WHERE username = 'system_seed'
  ORDER BY id
  LIMIT 1
), demo_docs AS (
  SELECT *
  FROM (VALUES
    ('d0000028-0000-0000-0000-000000000001'::uuid, 'e0000028-0000-0000-0000-000000000001'::uuid, 'f0000028-0000-0000-0000-000000000001'::uuid, 'MEDDIC销售六步法总览', 'MEDDIC不要只作为静态清单使用。高手把它落实为从Discovery到Negotiate & Close的动态销售流程，每个阶段都有明确动作、退出标准和管理判断。六步法包括Discovery、Scope、Go/No-Go、Validate Solution、Business Case、Negotiate & Close。任何阶段gate没有真实通过，都不应简单沿用该阶段赢率。'),
    ('d0000028-0000-0000-0000-000000000002'::uuid, 'e0000028-0000-0000-0000-000000000002'::uuid, 'f0000028-0000-0000-0000-000000000002'::uuid, '销售六步法Gates检查清单', 'Discovery要确认Champion、客户关注点、组织分工、EB判断、痛点现状、竞争对手和下一步。Scope要由Champion确认收益、时间和预算。Go/No-Go必须由EB确认痛点、优先级、预算、评估方式和关键标准。'),
    ('d0000028-0000-0000-0000-000000000003'::uuid, 'e0000028-0000-0000-0000-000000000003'::uuid, 'f0000028-0000-0000-0000-000000000003'::uuid, 'Champion识别标准', 'Champion要在你不在场时替你销售，具备权力或影响力，能提供接触EB的渠道，把方案看作个人成功，并能在内部会议中销售方案价值。无法影响决策或引荐EB的人，更像Coach而不是Champion。'),
    ('d0000028-0000-0000-0000-000000000004'::uuid, 'e0000028-0000-0000-0000-000000000004'::uuid, 'f0000028-0000-0000-0000-000000000004'::uuid, 'Discovery探索阶段五道门', 'Discovery五道门包括角色地图、可解决的痛苦、痛苦影响、现状流程、下一步行动。每次沟通都要以双方认可的下一步结尾，销售经理在Pipeline Review中要追问Champion、量化痛苦和客户最大损失。'),
    ('d0000028-0000-0000-0000-000000000005'::uuid, 'e0000028-0000-0000-0000-000000000005'::uuid, 'f0000028-0000-0000-0000-000000000005'::uuid, 'Business Case商业论证框架', 'Business Case要回答之前是什么样、之后会是什么样、价值有多大。价值必须用验证阶段共同确认的证据量化ROI。呈报前与Champion终审，向EB汇报后争取书面认可并打通采购和法务。')
  ) AS v(document_id, version_id, chunk_id, title, content_text)
)
INSERT INTO document_chunk (id, document_id, document_version_id, owner_user_id, org_id, scope_type, chunk_index, content_text, token_count, metadata)
SELECT
  dd.chunk_id,
  dd.document_id,
  dd.version_id,
  so.owner_user_id,
  so.org_id,
  'public',
  0,
  dd.content_text,
  GREATEST(1, length(dd.content_text) / 2),
  jsonb_build_object('source', 'demo_seed', 'title', dd.title, 'domain', 'sales')
FROM demo_docs dd
CROSS JOIN seed_owner so
ON CONFLICT (document_version_id, chunk_index) DO NOTHING;

WITH seed_owner AS (
  SELECT id AS owner_user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000001'::uuid) AS org_id
  FROM "user"
  WHERE username = 'system_seed'
  ORDER BY id
  LIMIT 1
), entity_rows AS (
  SELECT *
  FROM (VALUES
    ('90000028-0000-0000-0000-000000000001'::uuid, 'SalesMethod', 'MEDDIC销售六步法', 'MEDDIC落地为Discovery到Close的动态销售作战流程。'),
    ('90000028-0000-0000-0000-000000000002'::uuid, 'SalesStage', 'Discovery', '探索客户角色地图、痛苦、影响、现状流程和下一步。'),
    ('90000028-0000-0000-0000-000000000003'::uuid, 'SalesStage', 'Scope', '将模糊需求转为项目范围、收益、时间、预算和决策标准。'),
    ('90000028-0000-0000-0000-000000000004'::uuid, 'SalesStage', 'Go/No-Go', '投入验证资源前由EB确认痛点、优先级、预算和评估标准。'),
    ('90000028-0000-0000-0000-000000000005'::uuid, 'SalesStage', 'Validate Solution', '用Demo、POC、案例或报告证明方案能解决客户痛点。'),
    ('90000028-0000-0000-0000-000000000006'::uuid, 'SalesStage', 'Business Case', '把验证证据转译为ROI和EB能接受的业务论证。'),
    ('90000028-0000-0000-0000-000000000007'::uuid, 'SalesRole', 'Champion', '能替供应商在客户内部销售方案并推动决策的人。'),
    ('90000028-0000-0000-0000-000000000008'::uuid, 'SalesRole', 'Economic Buyer', '拥有预算和最终拍板权的经济决策者。')
  ) AS v(id, entity_type, canonical_name, summary)
)
INSERT INTO entity (id, owner_user_id, org_id, scope_type, entity_type, canonical_name, status, source_confidence, metadata)
SELECT
  er.id,
  so.owner_user_id,
  so.org_id,
  'public',
  er.entity_type,
  er.canonical_name,
  'active',
  0.92,
  jsonb_build_object('source', 'demo_seed', 'summary', er.summary, 'domain', 'sales')
FROM entity_rows er
CROSS JOIN seed_owner so
WHERE NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = er.id);

INSERT INTO entity_attribute (id, entity_id, attr_key, value_type, attr_value, value_json, confidence, source_ref)
SELECT *
FROM (VALUES
  ('91000028-0000-0000-0000-000000000001'::uuid, '90000028-0000-0000-0000-000000000001'::uuid, 'purpose', 'text', '用阶段gate和MEDDIC校准机会健康度与下一步动作。', '{}'::jsonb, 0.9, 'demo_seed:meddic'),
  ('91000028-0000-0000-0000-000000000002'::uuid, '90000028-0000-0000-0000-000000000007'::uuid, 'qualification', 'text', '有权力或影响力、可接触EB、把项目视为个人成功、能在内部替你销售。', '{}'::jsonb, 0.9, 'demo_seed:champion'),
  ('91000028-0000-0000-0000-000000000003'::uuid, '90000028-0000-0000-0000-000000000008'::uuid, 'qualification', 'text', '亲口确认痛点、业务收益、预算、流程、时间和供应商评估标准。', '{}'::jsonb, 0.9, 'demo_seed:eb')
) AS v(id, entity_id, attr_key, value_type, attr_value, value_json, confidence, source_ref)
WHERE NOT EXISTS (SELECT 1 FROM entity_attribute ea WHERE ea.id = v.id);

WITH seed_owner AS (
  SELECT id AS owner_user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000001'::uuid) AS org_id
  FROM "user"
  WHERE username = 'system_seed'
  ORDER BY id
  LIMIT 1
), relation_rows AS (
  SELECT *
  FROM (VALUES
    ('92000028-0000-0000-0000-000000000001'::uuid, '90000028-0000-0000-0000-000000000001'::uuid, 'includes_stage', '90000028-0000-0000-0000-000000000002'::uuid, 'd0000028-0000-0000-0000-000000000001'),
    ('92000028-0000-0000-0000-000000000002'::uuid, '90000028-0000-0000-0000-000000000001'::uuid, 'includes_stage', '90000028-0000-0000-0000-000000000003'::uuid, 'd0000028-0000-0000-0000-000000000001'),
    ('92000028-0000-0000-0000-000000000003'::uuid, '90000028-0000-0000-0000-000000000001'::uuid, 'includes_stage', '90000028-0000-0000-0000-000000000004'::uuid, 'd0000028-0000-0000-0000-000000000002'),
    ('92000028-0000-0000-0000-000000000004'::uuid, '90000028-0000-0000-0000-000000000001'::uuid, 'includes_stage', '90000028-0000-0000-0000-000000000005'::uuid, 'd0000028-0000-0000-0000-000000000002'),
    ('92000028-0000-0000-0000-000000000005'::uuid, '90000028-0000-0000-0000-000000000001'::uuid, 'includes_stage', '90000028-0000-0000-0000-000000000006'::uuid, 'd0000028-0000-0000-0000-000000000005'),
    ('92000028-0000-0000-0000-000000000006'::uuid, '90000028-0000-0000-0000-000000000003'::uuid, 'requires_role', '90000028-0000-0000-0000-000000000007'::uuid, 'd0000028-0000-0000-0000-000000000003'),
    ('92000028-0000-0000-0000-000000000007'::uuid, '90000028-0000-0000-0000-000000000004'::uuid, 'requires_confirmation_from', '90000028-0000-0000-0000-000000000008'::uuid, 'd0000028-0000-0000-0000-000000000002')
  ) AS v(id, from_entity_id, relation_type, to_entity_id, evidence_ref)
)
INSERT INTO relation (id, owner_user_id, org_id, scope_type, from_entity_id, relation_type, to_entity_id, status, strength, evidence_ref, metadata)
SELECT
  rr.id,
  so.owner_user_id,
  so.org_id,
  'public',
  rr.from_entity_id,
  rr.relation_type,
  rr.to_entity_id,
  'active',
  0.9,
  rr.evidence_ref,
  '{"source":"demo_seed","domain":"sales"}'::jsonb
FROM relation_rows rr
CROSS JOIN seed_owner so
WHERE NOT EXISTS (SELECT 1 FROM relation r WHERE r.id = rr.id);

WITH seed_owner AS (
  SELECT id AS owner_user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000001'::uuid) AS org_id
  FROM "user"
  WHERE username = 'system_seed'
  ORDER BY id
  LIMIT 1
), skill_rows AS (
  SELECT *
  FROM (VALUES
    (
      'a0000028-0000-0000-0000-000000000001'::uuid,
      'b0000028-0000-0000-0000-000000000001'::uuid,
      'c0000028-0000-0000-0000-000000000001'::uuid,
      'meddic-b2b-sales-review',
      'MEDDIC B2B销售复盘、Pipeline Review、拜访复盘和销售辅导技能。',
      'workflow',
      'https://clawhub.ai/andyrenxu7255/meddic-b2b-sales-review',
      '1.2.3',
      '{"tools":[],"capabilities":["deal_review","pipeline_review","visit_debrief","forecast_calibration","next_best_action"],"entrypoint":"SKILL.md","source_type":"clawhub","clawhub_slug":"meddic-b2b-sales-review","risk_profile":{"api_key_required":false,"external_network":false,"overlaps_memory":false},"maintenance":{"latest_checked_version":"1.2.3","latest_changelog":"Version alignment update; no feature or functionality changes reported by ClawHub metadata."}}'::jsonb,
      '{"source":"clawhub.ai","installed_from":"clawhub.ai","clawhub_slug":"meddic-b2b-sales-review","clawhub_owner":"andyrenxu7255","clawhub_version":"1.2.3","clawhub_updated_at":"2026-05-21T11:54:16.419Z","curated":true,"risk":"low","category":"sales","rating":4.9,"downloads":468,"admin_managed":true}'::jsonb,
      'ClawHub metadata reports clean moderation and no suspicious patterns. Preseeded as a low-risk sales management workflow; no API key required.'
    ),
    (
      'a0000028-0000-0000-0000-000000000002'::uuid,
      'b0000028-0000-0000-0000-000000000002'::uuid,
      'c0000028-0000-0000-0000-000000000002'::uuid,
      'customer-research',
      '客户调研与竞品情报技能，生成调研报告和场景破冰PPT。',
      'search',
      'https://clawhub.ai/andyrenxu7255/customer-research',
      '1.3.3',
      '{"tools":["web_search","web_fetch","document_writer","presentation_builder"],"capabilities":["customer_research","competitor_intel","procurement_record_search","scenario_ppt"],"entrypoint":"SKILL.md","source_type":"clawhub","clawhub_slug":"customer-research","risk_profile":{"api_key_required":false,"external_network":true,"overlaps_memory":false},"maintenance":{"latest_checked_version":"1.3.3","latest_changelog":"Metadata and documentation synchronization; no feature, logic, or security changes reported by ClawHub metadata."}}'::jsonb,
      '{"source":"clawhub.ai","installed_from":"clawhub.ai","clawhub_slug":"customer-research","clawhub_owner":"andyrenxu7255","clawhub_version":"1.3.3","clawhub_updated_at":"2026-05-21T11:38:56.003Z","curated":true,"risk":"medium","category":"sales","rating":4.8,"downloads":645,"admin_managed":true}'::jsonb,
      'ClawHub metadata reports clean moderation and no suspicious patterns. It performs public web research, so external network access is expected; no API key required.'
    )
  ) AS v(skill_id, version_id, source_id, skill_name, description, skill_type, source_uri, upstream_version, definition_json, metadata, content_text)
)
INSERT INTO skill (id, owner_user_id, org_id, scope_type, skill_name, description, skill_type, status, metadata)
SELECT
  sr.skill_id,
  so.owner_user_id,
  so.org_id,
  'public',
  sr.skill_name,
  sr.description,
  sr.skill_type,
  'active',
  sr.metadata
FROM skill_rows sr
CROSS JOIN seed_owner so
ON CONFLICT (id) DO NOTHING;

WITH skill_rows AS (
  SELECT *
  FROM (VALUES
    ('a0000028-0000-0000-0000-000000000001'::uuid, 'b0000028-0000-0000-0000-000000000001'::uuid, 'meddic-b2b-sales-review', '1.2.3', '{"tools":[],"capabilities":["deal_review","pipeline_review","visit_debrief","forecast_calibration","next_best_action"],"entrypoint":"SKILL.md","source_type":"clawhub","clawhub_slug":"meddic-b2b-sales-review","risk_profile":{"api_key_required":false,"external_network":false,"overlaps_memory":false},"maintenance":{"latest_checked_version":"1.2.3","latest_changelog":"Version alignment update; no feature or functionality changes reported by ClawHub metadata."}}'::jsonb),
    ('a0000028-0000-0000-0000-000000000002'::uuid, 'b0000028-0000-0000-0000-000000000002'::uuid, 'customer-research', '1.3.3', '{"tools":["web_search","web_fetch","document_writer","presentation_builder"],"capabilities":["customer_research","competitor_intel","procurement_record_search","scenario_ppt"],"entrypoint":"SKILL.md","source_type":"clawhub","clawhub_slug":"customer-research","risk_profile":{"api_key_required":false,"external_network":true,"overlaps_memory":false},"maintenance":{"latest_checked_version":"1.3.3","latest_changelog":"Metadata and documentation synchronization; no feature, logic, or security changes reported by ClawHub metadata."}}'::jsonb)
  ) AS v(skill_id, version_id, skill_name, upstream_version, definition_json)
)
INSERT INTO skill_version (id, skill_id, version, definition_json, content_hash, status, metadata)
SELECT
  sr.version_id,
  sr.skill_id,
  1,
  sr.definition_json,
  'clawhub_' || sr.skill_name || '_' || replace(sr.upstream_version, '.', '_'),
  'active',
  jsonb_build_object('source', 'clawhub.ai', 'upstream_version', sr.upstream_version, 'curated', true)
FROM skill_rows sr
ON CONFLICT (skill_id, version) DO NOTHING;

WITH skill_rows AS (
  SELECT *
  FROM (VALUES
    ('b0000028-0000-0000-0000-000000000001'::uuid, 'c0000028-0000-0000-0000-000000000001'::uuid, 'https://clawhub.ai/andyrenxu7255/meddic-b2b-sales-review', 'ClawHub metadata reports clean moderation and no suspicious patterns. Preseeded as a low-risk sales management workflow; no API key required.', 'meddic-b2b-sales-review', '1.2.3'),
    ('b0000028-0000-0000-0000-000000000002'::uuid, 'c0000028-0000-0000-0000-000000000002'::uuid, 'https://clawhub.ai/andyrenxu7255/customer-research', 'ClawHub metadata reports clean moderation and no suspicious patterns. It performs public web research, so external network access is expected; no API key required.', 'customer-research', '1.3.3')
  ) AS v(version_id, source_id, source_uri, content_text, clawhub_slug, upstream_version)
)
INSERT INTO skill_source (id, skill_version_id, source_type, source_uri, content_text, metadata)
SELECT
  sr.source_id,
  sr.version_id,
  'manual',
  sr.source_uri,
  sr.content_text,
  jsonb_build_object('registry', 'clawhub.ai', 'clawhub_slug', sr.clawhub_slug, 'upstream_version', sr.upstream_version, 'curated', true)
FROM skill_rows sr
ON CONFLICT (id) DO NOTHING;
