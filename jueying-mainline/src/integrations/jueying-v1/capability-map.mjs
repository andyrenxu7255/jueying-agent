export const JUEYING_V1_CAPABILITY_MAP = [
  {
    id: "mainline.workflow",
    name: "Workflow 编排主干",
    critical: true,
    new_concept: "TaskGraph execution substrate",
    ai_native_role: "把 JueYing TaskGraph 落到主版本多阶段 workflow_instance / workflow_stage 生命周期。",
    integration_mode: "contract_transform + optional_service_proxy",
    package_path: "services/workflow",
    required_paths: [
      "services/workflow/src/index.ts",
      "services/workflow/src/engine/workflow-machine.ts",
      "services/workflow/src/planner/planner.ts",
      "services/workflow/src/planner/plan-validator.ts",
      "services/workflow/src/checkpoint/manager.ts",
      "services/workflow/src/supervisor/manager.ts",
      "libs/contracts/src/workflow-types.ts"
    ],
    optional_paths: [
      "services/workflow/src/persistence/db.ts",
      "db/migrations/003_workflow_core.sql",
      "db/migrations/027_workflow_definition_review.sql"
    ],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "workflow-service",
      url_env: "JUEYING_WORKFLOW_URL",
      default_url: "http://127.0.0.1:3001",
      health_path: "/health"
    },
    routes: [
      { method: "POST", path: "/internal/workflows/plan", purpose: "创建 JueYing workflow plan", bridge_use: "TaskGraph -> workflow_plan" },
      { method: "POST", path: "/internal/workflows/:workflowRef/dispatch", purpose: "启动 workflow 执行", bridge_use: "Run dispatch" },
      { method: "POST", path: "/internal/workflows/:workflowRef/stages/:stageId/dispatch", purpose: "回写阶段执行结果", bridge_use: "Task status / Evidence update" },
      { method: "POST", path: "/internal/workflows/:workflowRef/complete", purpose: "完成 workflow", bridge_use: "TaskGraph completion" },
      { method: "GET", path: "/internal/workflows/:workflowRef/progress", purpose: "读取进度和观测摘要", bridge_use: "workflow_progress -> TaskGraph view" },
      { method: "GET", path: "/internal/workflows", purpose: "列出 workflow", bridge_use: "Operating Console list" }
    ],
    data_objects: [
      { legacy_table: "workflow_instance", ai_native_object: "Run / TaskGraph" },
      { legacy_table: "workflow_stage", ai_native_object: "Task" },
      { legacy_table: "checkpoint", ai_native_object: "Checkpoint / Resume Token" },
      { legacy_table: "workflow_event", ai_native_object: "Audit Event / Run Event" }
    ],
    bridge_contracts: ["taskGraphToLegacyWorkflowPlan", "legacyWorkflowProgressToTaskGraph"]
  },
  {
    id: "mainline.executor",
    name: "Executor 执行器主干",
    critical: true,
    new_concept: "Worker Agent execution substrate",
    ai_native_role: "承接 PM Agent 生成的阶段任务，执行通用、检索增强、审批、代码、验证、修复等工作。",
    integration_mode: "service_proxy + result_normalization",
    package_path: "services/executor-gateway",
    required_paths: [
      "services/executor-gateway/src/index.ts",
      "services/executor-gateway/src/executor/generic-executor.ts",
      "services/executor-gateway/src/executor/retrieval-aware-executor.ts",
      "services/executor-gateway/src/executor/approval-executor.ts",
      "services/executor-gateway/src/executor/code-executor.ts",
      "services/executor-gateway/src/executor/verification-executor.ts",
      "services/executor-gateway/src/executor/repair-executor.ts"
    ],
    optional_paths: ["db/migrations/003_workflow_core.sql"],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "executor-gateway",
      url_env: "JUEYING_EXECUTOR_URL",
      default_url: "http://127.0.0.1:3002",
      health_path: "/health"
    },
    routes: [
      { method: "POST", path: "/internal/executor/dispatch", purpose: "异步调度 workflow 执行", bridge_use: "TaskGraph run dispatch" },
      { method: "POST", path: "/internal/executor/execute", purpose: "同步执行单阶段任务", bridge_use: "Task -> ExecutionResult" },
      { method: "GET", path: "/internal/executor/runs/:runRef", purpose: "读取执行会话状态", bridge_use: "Run observability" }
    ],
    data_objects: [
      { legacy_table: "execution_session", ai_native_object: "Agent Run / Worker Session" },
      { legacy_table: "artifact_object", ai_native_object: "Artifact / Evidence" }
    ],
    bridge_contracts: ["legacyExecutionResultToAgentOutput"]
  },
  {
    id: "mainline.fact_retrieval",
    name: "事实检索与证据层",
    critical: true,
    new_concept: "Evidence and Retrieval substrate",
    ai_native_role: "把文档、事实、实体、检索 trace 和 evidence pack 作为 Agent 判断的事实底座。",
    integration_mode: "record_mirror + evidence_projection + optional_service_proxy",
    package_path: "services/fact-retrieval",
    required_paths: [
      "services/fact-retrieval/src/index.ts",
      "services/fact-retrieval/src/service.ts",
      "services/fact-retrieval/src/support.ts",
      "services/fact-retrieval/src/artifact-storage.ts",
      "libs/contracts/schemas/evidence.ts"
    ],
    optional_paths: [
      "db/migrations/004_document_evidence.sql",
      "db/migrations/005_entity_fact.sql",
      "db/migrations/007_retrieval_audit.sql",
      "db/migrations/022_align_fact_retrieval_trace_schema.sql"
    ],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "fact-retrieval",
      url_env: "JUEYING_FACT_RETRIEVAL_URL",
      default_url: "http://127.0.0.1:3004",
      health_path: "/health"
    },
    routes: [
      { method: "POST", path: "/internal/documents/index", purpose: "索引文档", bridge_use: "Evidence content_ref -> document" },
      { method: "POST", path: "/internal/retrieval/query", purpose: "检索事实和文档片段", bridge_use: "Information Gap -> retrieval query" },
      { method: "POST", path: "/internal/facts/write", purpose: "写入结构化事实", bridge_use: "Evidence -> fact write" },
      { method: "POST", path: "/internal/entities/write", purpose: "写入实体和属性", bridge_use: "Business object mirror -> entity graph" },
      { method: "POST", path: "/internal/fact/submit", purpose: "用户提交待审核知识", bridge_use: "Human Twin collected evidence" },
      { method: "GET", path: "/internal/fact/review", purpose: "知识审核队列", bridge_use: "Evidence review console" },
      { method: "POST", path: "/internal/files/upload", purpose: "用户文件存储", bridge_use: "File evidence" }
    ],
    data_objects: [
      { legacy_table: "document", ai_native_object: "Evidence Source" },
      { legacy_table: "document_chunk", ai_native_object: "Retrieval Item" },
      { legacy_table: "fact", ai_native_object: "Fact" },
      { legacy_table: "fact_evidence", ai_native_object: "Evidence Link" },
      { legacy_table: "retrieval_trace", ai_native_object: "Retrieval Trace" },
      { legacy_table: "artifact_object", ai_native_object: "Artifact" }
    ],
    bridge_contracts: ["evidenceToLegacyFactWrite", "evidenceToLegacyDocumentIndex"]
  },
  {
    id: "mainline.gateway_channels",
    name: "渠道接入与 Human Twin 入口",
    critical: true,
    new_concept: "Human Twin channel substrate",
    ai_native_role: "把飞书、企微、Web Portal 等外部入口统一成用户身份、会话、消息、附件和补采任务。",
    integration_mode: "channel_proxy + identity_resolution",
    package_path: "apps/gateway-adapter",
    required_paths: [
      "apps/gateway-adapter/src/index.ts",
      "apps/gateway-adapter/src/services/session-mapper.ts",
      "apps/gateway-adapter/src/services/identity-resolver.ts",
      "apps/gateway-adapter/src/services/file-validator.ts",
      "apps/gateway-adapter/src/services/gateway-state.ts",
      "services/feishu-longconn/src/index.ts"
    ],
    optional_paths: [
      "db/migrations/002_identity_policy.sql",
      "db/migrations/015_relation_org_id.sql"
    ],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "gateway-adapter",
      url_env: "JUEYING_GATEWAY_URL",
      default_url: "http://127.0.0.1:3000",
      health_path: "/health/live"
    },
    routes: [
      { method: "POST", path: "/internal/channel-ingress/normalize", purpose: "统一入口消息结构", bridge_use: "Channel Message -> Evidence / Task" },
      { method: "POST", path: "/channels/feishu/webhook", purpose: "飞书 webhook", bridge_use: "Human Twin channel" },
      { method: "POST", path: "/channels/feishu/longconn/event", purpose: "飞书长连接事件", bridge_use: "Human Twin channel" },
      { method: "POST", path: "/channels/wecom/webhook", purpose: "企微 webhook", bridge_use: "Human Twin channel" },
      { method: "POST", path: "/internal/notify/wecom", purpose: "企微通知", bridge_use: "Information Gap prompt" }
    ],
    data_objects: [
      { legacy_table: "channel_identity", ai_native_object: "Human Twin Identity Binding" },
      { legacy_table: "memory_item", ai_native_object: "Conversation Memory" }
    ],
    bridge_contracts: ["informationGapToHumanTwinPrompt"]
  },
  {
    id: "mainline.org_task_dispatch",
    name: "组织任务分发",
    critical: true,
    new_concept: "Assignment and information collection substrate",
    ai_native_role: "当 Agent 传感器不足时，把信息缺口转成可派发、可提醒、可反馈、可验收的人类采集任务。",
    integration_mode: "information_gap_to_org_task",
    package_path: "apps/gateway-adapter",
    required_paths: [
      "apps/gateway-adapter/src/index.ts",
      "tests/integration/task-dispatch-lui-test.ts",
      "db/migrations/017_org_task.sql",
      "db/migrations/020_org_task_nullable_created_by.sql"
    ],
    optional_paths: ["apps/mobile-app/src/index.ts"],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "gateway-adapter",
      url_env: "JUEYING_GATEWAY_URL",
      default_url: "http://127.0.0.1:3000",
      health_path: "/health/live"
    },
    routes: [
      { method: "POST", path: "/admin/tasks", purpose: "创建组织任务", bridge_use: "Information Gap -> org_task" },
      { method: "GET", path: "/admin/tasks", purpose: "任务分发列表", bridge_use: "Operating Console assignments" },
      { method: "POST", path: "/internal/tasks/assign", purpose: "给组织成员分配任务", bridge_use: "Human Twin assignment" },
      { method: "POST", path: "/internal/tasks/notify", purpose: "通知被分配人", bridge_use: "Collector prompt delivery" },
      { method: "GET", path: "/tasks", purpose: "我的任务", bridge_use: "Human information workbench" },
      { method: "POST", path: "/tasks/:assignmentId/submit", purpose: "提交反馈", bridge_use: "Human Twin collect result" }
    ],
    data_objects: [
      { legacy_table: "org_task", ai_native_object: "Assignment / Information Gap Work Order" },
      { legacy_table: "org_task_assignment", ai_native_object: "Human Twin Task Assignment" }
    ],
    bridge_contracts: ["informationGapToLegacyOrgTask"]
  },
  {
    id: "mainline.skill_library",
    name: "技能库与工作流模板",
    critical: true,
    new_concept: "Agent Skill and Workflow Template substrate",
    ai_native_role: "把可复用工作流、Prompt、工具定义和组织技能沉淀成可召回、可审核、可升级的能力资产。",
    integration_mode: "skill_registry_adapter",
    package_path: "services/skill-library",
    required_paths: [
      "services/skill-library/src/index.ts",
      "services/skill-library/README.md",
      "db/migrations/008_memory_skill.sql",
      "db/migrations/013_seed_skills.sql",
      "db/migrations/019_skill_constraint_expand.sql"
    ],
    optional_paths: [
      "db/migrations/024_align_seed_skill_retrieval_intents.sql",
      "db/migrations/027_workflow_definition_review.sql"
    ],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "skill-library",
      url_env: "JUEYING_SKILL_LIBRARY_URL",
      default_url: "http://127.0.0.1:3007",
      health_path: "/health/live"
    },
    routes: [
      { method: "POST", path: "/internal/skills/create", purpose: "创建技能", bridge_use: "Agent Template save" },
      { method: "GET", path: "/internal/skills/search", purpose: "搜索技能", bridge_use: "Skill recall" },
      { method: "POST", path: "/internal/skills/import", purpose: "导入 Markdown 技能", bridge_use: "Workflow template import" },
      { method: "POST", path: "/internal/skills/audit", purpose: "技能审核", bridge_use: "Skill quality gate" },
      { method: "POST", path: "/internal/skills/audit/batch", purpose: "批量技能审核", bridge_use: "Dream skill maintenance" },
      { method: "GET", path: "/internal/skills/org-registry", purpose: "组织技能库", bridge_use: "Org-level agent capability registry" },
      { method: "POST", path: "/internal/workflow-definition-reviews/nominate", purpose: "推荐工作流模板复用", bridge_use: "Successful workflow -> reusable skill" }
    ],
    data_objects: [
      { legacy_table: "skill", ai_native_object: "Skill" },
      { legacy_table: "skill_version", ai_native_object: "Skill Version" },
      { legacy_table: "org_skill_registry", ai_native_object: "Organization Skill Registry" },
      { legacy_table: "workflow_definition_review", ai_native_object: "Workflow Template Review" }
    ],
    bridge_contracts: ["taskGraphToWorkflowSkillCandidate"]
  },
  {
    id: "mainline.proactive_orchestrator",
    name: "主动运营编排",
    critical: true,
    new_concept: "COO Signal Layer",
    ai_native_role: "持续扫描事实、记忆、技能和任务状态，形成洞察、任务、报告，并通过组织任务闭环。",
    integration_mode: "signal_scan_adapter + mission_dispatch",
    package_path: "services/proactive-orchestrator",
    required_paths: [
      "services/proactive-orchestrator/src/index.ts",
      "services/proactive-orchestrator/src/domain.ts",
      "services/proactive-orchestrator/src/service.ts",
      "tests/integration/proactive-orchestration-test.ts",
      "db/migrations/029_proactive_orchestration.sql"
    ],
    optional_paths: ["db/migrations/026_recall_outcome_attribution.sql"],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "proactive-orchestrator",
      url_env: "JUEYING_PROACTIVE_ORCHESTRATOR_URL",
      default_url: "http://127.0.0.1:3010",
      health_path: "/health/live"
    },
    routes: [
      { method: "GET", path: "/api/admin/proactive/dashboard", purpose: "主动运营看板", bridge_use: "COO Signal dashboard" },
      { method: "POST", path: "/api/admin/proactive/rules", purpose: "创建扫描规则", bridge_use: "Operating rule" },
      { method: "POST", path: "/api/admin/proactive/runs", purpose: "执行扫描", bridge_use: "Signal scan" },
      { method: "POST", path: "/api/admin/proactive/insights/:id/review", purpose: "审核洞察", bridge_use: "Human confirmation" },
      { method: "POST", path: "/api/admin/proactive/missions/:id/dispatch", purpose: "派发任务", bridge_use: "Insight -> org_task" },
      { method: "POST", path: "/api/admin/proactive/reports/:id/publish", purpose: "发布报告", bridge_use: "Operating report" }
    ],
    data_objects: [
      { legacy_table: "proactive_rule", ai_native_object: "Operating Rule" },
      { legacy_table: "proactive_run", ai_native_object: "Signal Scan Run" },
      { legacy_table: "proactive_insight", ai_native_object: "Agent Insight" },
      { legacy_table: "proactive_mission", ai_native_object: "Mission / Assignment" },
      { legacy_table: "proactive_report", ai_native_object: "Operating Report" }
    ],
    bridge_contracts: ["signalToInformationGap", "insightToTaskGraph"]
  },
  {
    id: "mainline.web_portal",
    name: "JueYing 管理门户",
    critical: true,
    new_concept: "Legacy operational surface and migration source",
    ai_native_role: "承载 JueYing 已有的 workflow、审批、技能、知识、审计、检索、身份、派单、主动运营等界面经验。",
    integration_mode: "surface_reference + route_inventory",
    package_path: "apps/web-portal",
    required_paths: [
      "apps/web-portal/src/index.ts",
      "apps/web-portal/static/index.html",
      "apps/web-portal/static/app.js",
      "apps/web-portal/static/localization.js",
      "apps/web-portal/static/app.static.test.ts"
    ],
    optional_paths: ["tests/integration/portal-admin-functional-test.ts"],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "web-portal",
      url_env: "JUEYING_WEB_PORTAL_URL",
      default_url: "http://127.0.0.1:3003",
      health_path: "/health"
    },
    routes: [
      { method: "GET", path: "/api/system/overview", purpose: "系统概览", bridge_use: "Ops Console summary" },
      { method: "GET", path: "/api/workflows", purpose: "workflow 列表", bridge_use: "TaskGraph list" },
      { method: "GET", path: "/api/admin/audit", purpose: "审计日志", bridge_use: "Audit console" },
      { method: "GET", path: "/api/admin/retrieval-traces", purpose: "检索追踪", bridge_use: "Evidence trace console" },
      { method: "GET", path: "/api/channels/identity", purpose: "身份绑定", bridge_use: "Human Twin identities" },
      { method: "GET", path: "/api/tasks", purpose: "我的任务", bridge_use: "Human collection inbox" }
    ],
    data_objects: [
      { legacy_table: "audit_event", ai_native_object: "Audit Event" },
      { legacy_table: "channel_identity", ai_native_object: "Identity Binding" }
    ],
    bridge_contracts: ["legacyPortalRouteToOpsConsoleView"]
  },
  {
    id: "mainline.audit_policy_identity",
    name: "审计、权限和身份",
    critical: true,
    new_concept: "Trust, permission, and traceability substrate",
    ai_native_role: "保障 Agent 执行、人工确认、外部系统反写和身份绑定都可追踪、可约束、可追责。",
    integration_mode: "policy_snapshot + audit_projection",
    package_path: "libs/audit",
    required_paths: [
      "libs/audit/src/writer.ts",
      "libs/policy/src/manager.ts",
      "libs/contracts/schemas/envelope.ts",
      "apps/gateway-adapter/src/services/identity-resolver.ts",
      "db/migrations/002_identity_policy.sql",
      "db/migrations/010_audit_and_day3.sql"
    ],
    optional_paths: ["db/migrations/014_org_id_isolation.sql"],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "web-portal",
      url_env: "JUEYING_WEB_PORTAL_URL",
      default_url: "http://127.0.0.1:3003",
      health_path: "/health"
    },
    routes: [
      { method: "GET", path: "/api/admin/audit", purpose: "查看审计事件", bridge_use: "AI-native audit console" },
      { method: "GET", path: "/api/channels/identity", purpose: "查看身份绑定", bridge_use: "Human Twin identity management" },
      { method: "POST", path: "/api/channels/identity/:id/rebind", purpose: "重新绑定身份", bridge_use: "Channel identity repair" },
      { method: "GET", path: "/api/admin/policies", purpose: "查看组织策略", bridge_use: "Writeback and autonomy policy" }
    ],
    data_objects: [
      { legacy_table: "audit_event", ai_native_object: "Audit Event" },
      { legacy_table: "policy_snapshot", ai_native_object: "Policy Snapshot" },
      { legacy_table: "channel_identity", ai_native_object: "Human Twin Identity" }
    ],
    bridge_contracts: ["writebackIntentToLegacyAuditEvent"]
  },
  {
    id: "mainline.memory_dream",
    name: "记忆、梦境与归因",
    critical: true,
    new_concept: "Memory, recall, and compounding knowledge substrate",
    ai_native_role: "沉淀对话记忆、组织记忆、技能召回效果和业务结果归因，为 Agent 后续判断提供长期上下文。",
    integration_mode: "memory_projection + recall_outcome_attribution",
    package_path: "services/hermes-adapter",
    required_paths: [
      "services/hermes-adapter/src/index.ts",
      "services/hermes-adapter/src/db.ts",
      "tests/integration/dream-mode-test.ts",
      "db/migrations/021_dream_mode.sql",
      "db/migrations/026_recall_outcome_attribution.sql"
    ],
    optional_paths: [
      "db/migrations/028_seed_admin_demo_content.sql",
      "services/skill-library/src/index.ts"
    ],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "hermes-adapter",
      url_env: "JUEYING_HERMES_URL",
      default_url: "http://127.0.0.1:3005",
      health_path: "/health/live"
    },
    routes: [
      { method: "POST", path: "/internal/memory", purpose: "写入会话记忆", bridge_use: "Human Twin memory" },
      { method: "POST", path: "/internal/memory/analyze", purpose: "个人梦境分析", bridge_use: "Memory compression and extraction" },
      { method: "POST", path: "/internal/memory/analyze/org", purpose: "组织级记忆分析", bridge_use: "Organization memory summary" },
      { method: "GET", path: "/internal/memory/summary", purpose: "读取组织记忆汇总", bridge_use: "Agent context recall" },
      { method: "GET", path: "/api/admin/dream/attribution", purpose: "召回与结果归因", bridge_use: "Skill / knowledge compounding" }
    ],
    data_objects: [
      { legacy_table: "memory_item", ai_native_object: "Memory Item" },
      { legacy_table: "org_memory_summary", ai_native_object: "Organization Memory Summary" },
      { legacy_table: "knowledge_recall_event", ai_native_object: "Knowledge Recall Event" },
      { legacy_table: "skill_recall_event", ai_native_object: "Skill Recall Event" },
      { legacy_table: "workflow_outcome_eval", ai_native_object: "Outcome Evaluation" }
    ],
    bridge_contracts: ["memorySummaryToAgentContext"]
  },
  {
    id: "mainline.mobile_notifications",
    name: "移动通知与提醒",
    critical: false,
    new_concept: "Human notification substrate",
    ai_native_role: "为信息补采、任务提醒和派单闭环提供移动端通知通道。",
    integration_mode: "notification_adapter",
    package_path: "apps/mobile-app",
    required_paths: [
      "apps/mobile-app/src/index.ts",
      "apps/mobile-app/package.json"
    ],
    optional_paths: [],
    required_scripts: ["build", "type-check"],
    runtime: {
      service_name: "mobile-app",
      url_env: "JUEYING_MOBILE_APP_URL",
      default_url: "http://127.0.0.1:3009",
      health_path: "/health/live"
    },
    routes: [
      { method: "POST", path: "/internal/devices/register", purpose: "注册设备", bridge_use: "Human notification identity" },
      { method: "POST", path: "/internal/notifications/send", purpose: "发送移动通知", bridge_use: "Information Gap reminder" },
      { method: "GET", path: "/internal/notifications/history", purpose: "通知历史", bridge_use: "Notification audit" },
      { method: "GET", path: "/internal/badges/:userId", purpose: "未读数量", bridge_use: "Human task inbox badge" }
    ],
    data_objects: [
      { legacy_table: "org_task_assignment", ai_native_object: "Notification Target" }
    ],
    bridge_contracts: ["informationGapToNotification"]
  }
];

export const JUEYING_V1_REQUIRED_CAPABILITY_IDS = JUEYING_V1_CAPABILITY_MAP
  .filter((capability) => capability.critical)
  .map((capability) => capability.id);

export const JUEYING_V1_BRIDGE_PHASES = [
  {
    id: "phase_0_discover",
    name: "发现与只读映射",
    exit_gate: "主版本能定位历史代码、脚本、路由、数据表和关键能力，不依赖运行时在线。"
  },
  {
    id: "phase_1_contract_bridge",
    name: "契约转换",
    exit_gate: "TaskGraph、Information Gap、Evidence、Writeback Intent 能转换成 JueYing workflow/org_task/fact/audit payload。"
  },
  {
    id: "phase_2_runtime_proxy",
    name: "运行时代理",
    exit_gate: "JueYing 服务在线时，主版本控制台能健康检查并按能力路由调用；离线时保留静态适配状态。"
  },
  {
    id: "phase_3_fact_convergence",
    name: "事实层一致",
    exit_gate: "CRM/项目管理镜像、JueYing fact/evidence 和 Agent fact layer 有明确冲突策略和反写策略。"
  },
  {
    id: "phase_4_ui_cutover",
    name: "界面接管",
    exit_gate: "JueYing Operating Console 承接 Portal 的主能力入口，历史 Portal 退为排障和迁移参考。"
  }
];
