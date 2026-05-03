with ensure_seed_owner as (
  insert into "user" (id, org_id, username, display_name, role, status, metadata)
  select
    '00000000-0000-0000-0000-000000000001'::uuid,
    o.id,
    'system_seed',
    'System Seed User',
    'admin',
    'active',
    '{"source":"seed_migration","auto_created":true}'::jsonb
  from organization o
  where o.org_name = 'default'
  on conflict (id) do nothing
  returning id
), seed_owner as (
  select id as owner_user_id from ensure_seed_owner
  union all
  select u.id as owner_user_id
  from "user" u
  where u.username = 'system_seed'
  order by owner_user_id
  limit 1
), skill_rows as (
  select
    v.id::uuid as id,
    so.owner_user_id,
    v.scope_type::text as scope_type,
    v.skill_name::text as skill_name,
    v.description::text as description,
    v.skill_type::text as skill_type,
    v.status::text as status,
    v.metadata::jsonb as metadata
  from seed_owner so
  cross join (
    values
      ('a0000001-0000-0000-0000-000000000001', 'public', 'daily-report', 'Generate a daily work report from provided activity data', 'workflow', 'active', '{"source":"seed","task_type_hint":"knowledge","icon":"📊"}'),
      ('a0000001-0000-0000-0000-000000000002', 'public', 'code-review', 'Review code changes and provide improvement suggestions', 'workflow', 'active', '{"source":"seed","task_type_hint":"development","icon":"🔍"}'),
      ('a0000001-0000-0000-0000-000000000003', 'public', 'data-analysis', 'Analyze data and generate insights with visualizations', 'workflow', 'active', '{"source":"seed","task_type_hint":"analysis","icon":"📈"}'),
      ('a0000001-0000-0000-0000-000000000004', 'public', 'knowledge-qna', 'Answer questions based on organizational knowledge base', 'workflow', 'active', '{"source":"seed","task_type_hint":"knowledge","icon":"💡"}'),
      ('a0000001-0000-0000-0000-000000000005', 'public', 'sales-proposal', 'Generate sales proposals and customer communication drafts', 'workflow', 'active', '{"source":"seed","task_type_hint":"sales","icon":"💼"}'),
      ('a0000001-0000-0000-0000-000000000006', 'public', 'deploy-checklist', 'Generate deployment checklists and verify readiness', 'workflow', 'active', '{"source":"seed","task_type_hint":"implementation","icon":"🚀"}'),
      ('a0000001-0000-0000-0000-000000000007', 'public', 'meeting-summary', 'Summarize meeting notes and extract action items', 'prompt', 'active', '{"source":"seed","icon":"📝"}'),
      ('a0000001-0000-0000-0000-000000000008', 'public', 'doc-writer', 'Generate technical documentation from code or specifications', 'prompt', 'active', '{"source":"seed","icon":"📄"}')
  ) as v(id, scope_type, skill_name, description, skill_type, status, metadata)
)
insert into skill (id, owner_user_id, scope_type, skill_name, description, skill_type, status, metadata)
select id, owner_user_id, scope_type, skill_name, description, skill_type, status, metadata
from skill_rows
on conflict do nothing;

insert into skill_version (id, skill_id, version, definition_json, content_hash, status, metadata)
values
  ('b0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 1,
   '{"stage_chain":[{"stage_type":"IntentClarification","purpose":"Clarify report scope and date range","assigned_executor":"generic-executor"},{"stage_type":"EvidenceRetrieval","purpose":"Retrieve activity data and work logs","assigned_executor":"retrieval-aware-executor","retrieval_plan":{"enabled":true,"intent_type":"factual_lookup"}},{"stage_type":"DecisionMaking","purpose":"Organize findings into report structure","assigned_executor":"generic-executor"},{"stage_type":"ResultReporting","purpose":"Generate formatted daily report","assigned_executor":"generic-executor"}],"prompt_template":"Generate a daily work report for {date_range} covering: {topics}. Include key accomplishments, blockers, and next steps."}'::jsonb,
   'seed_daily_report_v1', 'active', '{"source":"seed"}'::jsonb),

  ('b0000001-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000002', 1,
   '{"stage_chain":[{"stage_type":"IntentClarification","purpose":"Understand code change scope","assigned_executor":"generic-executor"},{"stage_type":"EvidenceRetrieval","purpose":"Retrieve related code and documentation","assigned_executor":"retrieval-aware-executor","retrieval_plan":{"enabled":true,"intent_type":"code_search"}},{"stage_type":"DecisionMaking","purpose":"Analyze code quality and identify issues","assigned_executor":"generic-executor"},{"stage_type":"Verification","purpose":"Verify suggested improvements","assigned_executor":"verification-executor"},{"stage_type":"ResultReporting","purpose":"Present review findings","assigned_executor":"generic-executor"}],"prompt_template":"Review the following code changes for: {repository}. Focus on correctness, security, performance, and maintainability."}'::jsonb,
   'seed_code_review_v1', 'active', '{"source":"seed"}'::jsonb),

  ('b0000001-0000-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000003', 1,
   '{"stage_chain":[{"stage_type":"IntentClarification","purpose":"Clarify analysis objectives and data sources","assigned_executor":"generic-executor"},{"stage_type":"EvidenceRetrieval","purpose":"Retrieve relevant datasets and historical data","assigned_executor":"retrieval-aware-executor","retrieval_plan":{"enabled":true,"intent_type":"deep_analysis"}},{"stage_type":"DecisionMaking","purpose":"Perform analysis and identify patterns","assigned_executor":"generic-executor"},{"stage_type":"ResultReporting","purpose":"Present analysis with insights","assigned_executor":"generic-executor"}],"prompt_template":"Analyze {data_source} focusing on {metrics}. Identify trends, anomalies, and actionable insights."}'::jsonb,
   'seed_data_analysis_v1', 'active', '{"source":"seed"}'::jsonb),

  ('b0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000004', 1,
   '{"stage_chain":[{"stage_type":"IntentClarification","purpose":"Understand the question scope","assigned_executor":"generic-executor"},{"stage_type":"EvidenceRetrieval","purpose":"Search knowledge base for relevant information","assigned_executor":"retrieval-aware-executor","retrieval_plan":{"enabled":true,"intent_type":"factual_lookup"}},{"stage_type":"ResultReporting","purpose":"Present knowledge-based answer","assigned_executor":"generic-executor"}],"prompt_template":"Answer the following question based on organizational knowledge: {question}. Provide sources when possible."}'::jsonb,
   'seed_knowledge_qna_v1', 'active', '{"source":"seed"}'::jsonb),

  ('b0000001-0000-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000005', 1,
   '{"stage_chain":[{"stage_type":"IntentClarification","purpose":"Understand client needs and proposal scope","assigned_executor":"generic-executor"},{"stage_type":"EvidenceRetrieval","purpose":"Retrieve product info, pricing, and past proposals","assigned_executor":"retrieval-aware-executor","retrieval_plan":{"enabled":true,"intent_type":"deep_analysis"}},{"stage_type":"DecisionMaking","purpose":"Draft proposal structure and key terms","assigned_executor":"generic-executor"},{"stage_type":"Approval","purpose":"Review proposal before sending","assigned_executor":"approval-executor"},{"stage_type":"ResultReporting","purpose":"Finalize and present proposal","assigned_executor":"generic-executor"}],"prompt_template":"Generate a sales proposal for {client_name} regarding {product_service}. Include pricing, timeline, and value proposition."}'::jsonb,
   'seed_sales_proposal_v1', 'active', '{"source":"seed"}'::jsonb),

  ('b0000001-0000-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000006', 1,
   '{"stage_chain":[{"stage_type":"IntentClarification","purpose":"Understand deployment scope and environment","assigned_executor":"generic-executor"},{"stage_type":"EvidenceRetrieval","purpose":"Retrieve deployment configs and past runbooks","assigned_executor":"retrieval-aware-executor","retrieval_plan":{"enabled":true,"intent_type":"factual_lookup"}},{"stage_type":"DecisionMaking","purpose":"Generate deployment checklist","assigned_executor":"generic-executor"},{"stage_type":"Verification","purpose":"Verify checklist completeness","assigned_executor":"verification-executor"},{"stage_type":"ResultReporting","purpose":"Present deployment checklist","assigned_executor":"generic-executor"}],"prompt_template":"Generate a deployment checklist for {service_name} to {environment}. Include pre-deployment, deployment, and post-deployment verification steps."}'::jsonb,
   'seed_deploy_checklist_v1', 'active', '{"source":"seed"}'::jsonb),

  ('b0000001-0000-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000007', 1,
   '{"prompt_template":"Summarize the following meeting notes. Extract: 1) Key decisions made, 2) Action items with owners and deadlines, 3) Open questions, 4) Next meeting date if mentioned.\\n\\nMeeting Notes:\\n{meeting_notes}"}'::jsonb,
   'seed_meeting_summary_v1', 'active', '{"source":"seed"}'::jsonb),

  ('b0000001-0000-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000008', 1,
   '{"prompt_template":"Generate technical documentation for the following: \\n\\nSubject: {subject}\\nCode/Spec:\\n{code_or_spec}\\n\\nInclude: Overview, API Reference, Usage Examples, Configuration, and Error Handling sections."}'::jsonb,
   'seed_doc_writer_v1', 'active', '{"source":"seed"}'::jsonb)
on conflict do nothing;

insert into skill_source (id, skill_version_id, source_type, content_text, metadata)
values
  ('c0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001', 'manual', 'Built-in daily report generation workflow', '{"source":"seed"}'::jsonb),
  ('c0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000002', 'manual', 'Built-in code review workflow', '{"source":"seed"}'::jsonb),
  ('c0000001-0000-0000-0000-000000000003', 'b0000001-0000-0000-0000-000000000003', 'manual', 'Built-in data analysis workflow', '{"source":"seed"}'::jsonb),
  ('c0000001-0000-0000-0000-000000000004', 'b0000001-0000-0000-0000-000000000004', 'manual', 'Built-in knowledge Q&A workflow', '{"source":"seed"}'::jsonb),
  ('c0000001-0000-0000-0000-000000000005', 'b0000001-0000-0000-0000-000000000005', 'manual', 'Built-in sales proposal workflow', '{"source":"seed"}'::jsonb),
  ('c0000001-0000-0000-0000-000000000006', 'b0000001-0000-0000-0000-000000000006', 'manual', 'Built-in deployment checklist workflow', '{"source":"seed"}'::jsonb),
  ('c0000001-0000-0000-0000-000000000007', 'b0000001-0000-0000-0000-000000000007', 'manual', 'Built-in meeting summary prompt template', '{"source":"seed"}'::jsonb),
  ('c0000001-0000-0000-0000-000000000008', 'b0000001-0000-0000-0000-000000000008', 'manual', 'Built-in documentation writer prompt template', '{"source":"seed"}'::jsonb)
on conflict do nothing;
