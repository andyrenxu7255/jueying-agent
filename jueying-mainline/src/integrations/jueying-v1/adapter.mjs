import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  JUEYING_V1_BRIDGE_PHASES,
  JUEYING_V1_CAPABILITY_MAP,
  JUEYING_V1_REQUIRED_CAPABILITY_IDS
} from "./capability-map.mjs";

const DEFAULT_LEGACY_ROOT = join("legacy", "jueying-v1", "agent-harness");

export function resolveLegacyRoot(root = resolve(".")) {
  return join(root, DEFAULT_LEGACY_ROOT);
}

export function inspectJueyingV1Integration(options = {}) {
  const root = resolve(options.root ?? ".");
  const legacyRoot = options.legacyRoot ? resolve(options.legacyRoot) : resolveLegacyRoot(root);
  const packageJson = readJsonIfExists(join(legacyRoot, "package.json"));
  const workspacePackages = discoverWorkspacePackages(legacyRoot, packageJson);
  const schemaTables = discoverSchemaTables(legacyRoot);

  const capabilities = JUEYING_V1_CAPABILITY_MAP.map((capability) =>
    inspectCapability(capability, legacyRoot, workspacePackages, schemaTables)
  );

  const totals = summarize(capabilities);
  const missingCritical = capabilities.filter((capability) => capability.critical && capability.status !== "adapter_ready");
  const serviceRuntime = buildServiceRuntime(capabilities);
  const bridgeContracts = buildBridgeContracts(capabilities);
  const cutoverPlan = buildCutoverPlan(capabilities);

  return {
    ok: missingCritical.length === 0,
    generated_at: new Date().toISOString(),
    integration_id: "jueying-v1-mainline",
    integration_name: "JueYing 主版本能力归并",
    root,
    legacy_root: legacyRoot,
    legacy_package: packageJson
      ? {
          name: packageJson.name,
          version: packageJson.version,
          workspaces: packageJson.workspaces ?? [],
          scripts: Object.keys(packageJson.scripts ?? {}).sort()
        }
      : null,
    phases: JUEYING_V1_BRIDGE_PHASES,
    required_capability_ids: JUEYING_V1_REQUIRED_CAPABILITY_IDS,
    totals,
    capabilities,
    service_runtime: serviceRuntime,
    bridge_contracts: bridgeContracts,
    cutover_plan: cutoverPlan,
    issues: capabilities.flatMap((capability) =>
      capability.issues.map((message) => ({ capability_id: capability.id, message }))
    ),
    warnings: capabilities.flatMap((capability) =>
      capability.warnings.map((message) => ({ capability_id: capability.id, message }))
    )
  };
}

export function assertJueyingV1Integration(report = inspectJueyingV1Integration()) {
  const errors = [];
  if (!report.legacy_package) {
    errors.push(`legacy package.json not found: ${report.legacy_root}`);
  }
  for (const issue of report.issues) {
    errors.push(`${issue.capability_id}: ${issue.message}`);
  }
  if (!report.ok) {
    errors.push("one or more critical legacy capabilities are not adapter_ready");
  }
  if (errors.length > 0) {
    const error = new Error(`JueYing v1 integration check failed:\n- ${errors.join("\n- ")}`);
    error.issues = errors;
    throw error;
  }
  return report;
}

export function buildLegacyIntegrationViewModel(report = inspectJueyingV1Integration()) {
  const capabilitiesByStatus = countBy(report.capabilities, "status");
  const criticalReady = report.capabilities.filter((capability) => capability.critical && capability.status === "adapter_ready").length;
  const criticalTotal = report.capabilities.filter((capability) => capability.critical).length;
  const readyPercent = report.capabilities.length
    ? Math.round((report.capabilities.filter((capability) => capability.status === "adapter_ready").length / report.capabilities.length) * 100)
    : 0;

  return {
    ok: report.ok,
    summary: {
      integration_id: report.integration_id,
      legacy_root: toDisplayPath(report.legacy_root),
      ready_percent: readyPercent,
      critical_ready: criticalReady,
      critical_total: criticalTotal,
      capability_count: report.capabilities.length,
      route_count: report.totals.route_count,
      data_object_count: report.totals.data_object_count,
      bridge_contract_count: report.totals.bridge_contract_count,
      issue_count: report.issues.length,
      warning_count: report.warnings.length,
      status_counts: capabilitiesByStatus
    },
    capability_groups: groupCapabilities(report.capabilities),
    service_runtime: report.service_runtime,
    bridge_contracts: report.bridge_contracts,
    cutover_plan: report.cutover_plan,
    phases: report.phases,
    issues: report.issues,
    warnings: report.warnings
  };
}

export function buildLegacyBridgePreview({ taskGraph, gaps = [], evidence = [], writebackIntents = [], writebackDecisions = [] }) {
  const decisionByIntentId = new Map(writebackDecisions.map((decision) => [decision.intent_id, decision]));
  const workflowPlanPayload = taskGraph ? taskGraphToLegacyWorkflowPlan(taskGraph) : null;
  const orgTaskPayloads = gaps
    .filter((gap) => !["closed", "waived"].includes(gap.status))
    .map((gap) => ({
      information_gap_id: gap.id,
      payload: informationGapToLegacyOrgTask(gap)
    }));
  const factWritePayloads = evidence.map((item) => ({
    evidence_id: item.id,
    payload: evidenceToLegacyFactWrite(item)
  }));
  const auditEventPayloads = writebackIntents.map((intent) => ({
    intent_id: intent.id,
    payload: writebackIntentToLegacyAuditEvent(intent, decisionByIntentId.get(intent.id))
  }));

  return {
    ok: Boolean(workflowPlanPayload),
    generated_at: new Date().toISOString(),
    workflow_plan_payload: workflowPlanPayload,
    org_task_payloads: orgTaskPayloads,
    fact_write_payloads: factWritePayloads,
    audit_event_payloads: auditEventPayloads,
    summary: {
      workflow_stage_count: workflowPlanPayload?.workflow_plan_preview?.stage_chain?.length ?? 0,
      org_task_payload_count: orgTaskPayloads.length,
      fact_write_payload_count: factWritePayloads.length,
      audit_event_payload_count: auditEventPayloads.length
    },
    target_routes: {
      workflow_plan: "/internal/workflows/plan",
      org_task_create: "/admin/tasks",
      fact_write: "/internal/facts/write",
      audit_projection: "/api/admin/audit"
    }
  };
}

export function buildLegacyRuntimeHealthCatalog(report = inspectJueyingV1Integration()) {
  const services = (report.service_runtime ?? []).map((service) => {
    const baseUrl = process.env[service.url_env] || service.default_url;
    return {
      service_name: service.service_name,
      url_env: service.url_env,
      health_url: `${baseUrl.replace(/\/$/, "")}${service.health_path}`,
      online: false,
      status: "not_checked",
      capabilities: service.capabilities
    };
  });

  return {
    ok: services.length > 0,
    generated_at: new Date().toISOString(),
    timeout_ms: 0,
    online_count: 0,
    service_count: services.length,
    services
  };
}

export async function checkLegacyRuntimeHealth(report = inspectJueyingV1Integration(), options = {}) {
  const timeoutMs = options.timeoutMs ?? 600;
  const services = [];
  for (const service of report.service_runtime ?? []) {
    const baseUrl = process.env[service.url_env] || service.default_url;
    const healthUrl = `${baseUrl.replace(/\/$/, "")}${service.health_path}`;
    const startedAt = Date.now();
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store"
      });
      services.push({
        service_name: service.service_name,
        url_env: service.url_env,
        health_url: healthUrl,
        online: response.ok,
        status: response.ok ? "online" : "unhealthy",
        http_status: response.status,
        latency_ms: Date.now() - startedAt,
        capabilities: service.capabilities
      });
    } catch (error) {
      services.push({
        service_name: service.service_name,
        url_env: service.url_env,
        health_url: healthUrl,
        online: false,
        status: "offline",
        error: error instanceof Error ? error.message : String(error),
        latency_ms: Date.now() - startedAt,
        capabilities: service.capabilities
      });
    }
  }

  return {
    ok: services.every((service) => service.online),
    generated_at: new Date().toISOString(),
    timeout_ms: timeoutMs,
    online_count: services.filter((service) => service.online).length,
    service_count: services.length,
    services
  };
}

export function taskGraphToLegacyWorkflowPlan(taskGraph, options = {}) {
  const ownerUserId = options.owner_user_id ?? "u_ai_native_ops";
  const policySnapshotHash = options.policy_snapshot_hash ?? `sha256:${"0".repeat(64)}`;
  const tasks = Array.isArray(taskGraph.tasks) ? taskGraph.tasks : [];
  const stageChain = tasks.map((task, index) => ({
    stage_id: task.id,
    seq: index,
    stage_key: task.id,
    stage_type: inferLegacyStageType(task),
    assigned_executor: inferLegacyExecutor(task),
    purpose: task.title,
    inputs: {
      required_refs: task.required_evidence ?? [],
      optional_refs: task.evidence_ids ?? []
    },
    retrieval_plan: {
      enabled: (task.required_evidence ?? []).length > 0 || (task.information_gap_ids ?? []).length > 0
    },
    acceptance: {
      must_have: task.required_evidence ?? [],
      pass_rules: [task.acceptance_criteria],
      fail_rules: ["required evidence missing", "acceptance criteria not met"]
    },
    timeouts: {
      soft_timeout_sec: 900,
      hard_timeout_sec: 3600
    },
    retry_policy: {
      max_retries: 1,
      max_repairs: task.owner_actor_type === "worker_agent" ? 1 : 0
    },
    checkpoint_policy: {
      on_enter: true,
      on_progress: true,
      on_exit: true
    },
    on_success: nextTaskId(tasks, index) ?? "complete",
    on_failure: "repair_or_fail",
    ai_native_refs: {
      task_graph_id: taskGraph.id,
      task_id: task.id,
      owner_actor_type: task.owner_actor_type,
      owner_actor_id: task.owner_actor_id,
      information_gap_ids: task.information_gap_ids ?? [],
      evidence_ids: task.evidence_ids ?? [],
      external_refs: task.external_refs ?? []
    }
  }));

  return {
    user_id: ownerUserId,
    user_role: options.user_role ?? "admin",
    user_goal: options.user_goal ?? `Run AI-native TaskGraph ${taskGraph.id}`,
    task_type_hint: options.task_type_hint ?? "implementation",
    risk_level: options.risk_level ?? "medium",
    policy_snapshot_hash: policySnapshotHash,
    org_id: options.org_id,
    context: {
      ai_native_task_graph_id: taskGraph.id,
      ai_native_run_id: taskGraph.run_id,
      autonomy_level: taskGraph.autonomy_level,
      business_refs: taskGraph.business_refs ?? {},
      stage_chain: stageChain
    },
    source: "ai_native_ops_bridge",
    markdown_steps: stageChain.map((stage, index) => ({
      seq: index,
      name: stage.stage_key,
      description: stage.purpose
    })),
    workflow_plan_preview: {
      plan_hash_seed: `${taskGraph.id}:${taskGraph.version}`,
      stage_chain: stageChain
    }
  };
}

export function informationGapToLegacyOrgTask(gap, options = {}) {
  return {
    title: options.title ?? `补充信息: ${gap.question.slice(0, 80)}`,
    description: gap.reason,
    task_type: "form",
    schedule_type: "once",
    cron_expression: null,
    prompt_message: [
      gap.question,
      "",
      `为什么需要: ${gap.reason}`,
      `期望证据: ${(gap.expected_evidence_types ?? []).join(", ") || "human_confirmation"}`,
      "请补充可验证的信息、截图、会议纪要、CRM链接或项目系统链接。"
    ].join("\n"),
    target_channels: options.target_channels ?? ["wecom", "feishu"],
    org_id: options.org_id ?? null,
    created_by: options.created_by ?? null,
    ai_native_refs: {
      information_gap_id: gap.id,
      task_id: gap.task_id,
      collector_actor_id: gap.collector_actor_id,
      priority: gap.priority,
      due_at: gap.due_at ?? null,
      required_schema: gap.required_schema
    }
  };
}

export function evidenceToLegacyFactWrite(evidence, options = {}) {
  const summary = evidence.content_ref?.summary ?? evidence.content_ref?.value ?? evidence.evidence_type;
  return {
    owner_user_id: options.owner_user_id ?? "u_ai_native_ops",
    org_id: options.org_id,
    fact_text: summary,
    object_value: summary,
    subject_ref: options.subject_ref ?? evidence.business_refs?.opportunity_id ?? evidence.task_id ?? evidence.id,
    predicate: options.predicate ?? `evidence.${evidence.evidence_type}`,
    scope: options.scope ?? ["private"],
    mode: options.mode ?? "insert",
    evidence_refs: [
      {
        evidence_pack_id: evidence.id,
        evidence_pack_hash: options.evidence_pack_hash ?? `ai-native:${evidence.id}`
      }
    ],
    confidence: typeof evidence.quality_score === "number" ? evidence.quality_score : 0.72,
    ai_native_refs: {
      evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
      capture_channel: evidence.capture_channel,
      content_ref: evidence.content_ref
    }
  };
}

export function writebackIntentToLegacyAuditEvent(intent, decision) {
  return {
    user_id: intent.confirmed_by ?? intent.source?.agent_id ?? "system",
    action: "external.writeback.intent",
    resource_type: intent.system_type,
    resource_ref: `${intent.provider}:${intent.target?.object_type}:${intent.target?.external_id}`,
    resource_scope: intent.connection_id,
    result: decision?.decision === "reject" ? "failure" : "success",
    detail_json: {
      intent_id: intent.id,
      provider: intent.provider,
      operation: intent.operation,
      risk_level: intent.risk_level,
      policy_decision: decision?.decision ?? intent.policy_decision,
      reasons: decision?.reasons ?? [],
      payload: intent.payload,
      source: intent.source
    }
  };
}

function inspectCapability(capability, legacyRoot, workspacePackages, schemaTables) {
  const requiredPathResults = capability.required_paths.map((path) => pathCheck(legacyRoot, path));
  const optionalPathResults = capability.optional_paths.map((path) => pathCheck(legacyRoot, path));
  const packageInfo = workspacePackages.get(capability.package_path) ?? null;
  const scriptResults = capability.required_scripts.map((script) => ({
    script,
    exists: Boolean(packageInfo?.scripts?.[script])
  }));
  const dataObjectResults = capability.data_objects.map((object) => ({
    ...object,
    exists: schemaTables.has(object.legacy_table)
  }));

  const issues = [
    ...requiredPathResults.filter((item) => !item.exists).map((item) => `missing required path: ${item.path}`),
    ...scriptResults.filter((item) => !item.exists).map((item) => `missing package script in ${capability.package_path}: ${item.script}`),
    ...dataObjectResults.filter((item) => !item.exists).map((item) => `missing legacy table in shared schema: ${item.legacy_table}`)
  ];
  const warnings = [
    ...optionalPathResults.filter((item) => !item.exists).map((item) => `missing optional path: ${item.path}`)
  ];
  if (!packageInfo) {
    issues.push(`workspace package not found: ${capability.package_path}/package.json`);
  }

  const status = issues.length === 0
    ? "adapter_ready"
    : requiredPathResults.some((item) => item.exists)
      ? "partial"
      : "missing";

  return {
    ...capability,
    status,
    package: packageInfo,
    required_paths: requiredPathResults,
    optional_paths: optionalPathResults,
    required_scripts: scriptResults,
    data_objects: dataObjectResults,
    route_count: capability.routes.length,
    bridge_contract_count: capability.bridge_contracts.length,
    issues,
    warnings
  };
}

function discoverWorkspacePackages(legacyRoot, packageJson) {
  const packages = new Map();
  const workspaceGlobs = packageJson?.workspaces ?? ["apps/*", "services/*", "libs/*"];
  for (const glob of workspaceGlobs) {
    const prefix = glob.replace(/\/\*$/, "");
    const dir = join(legacyRoot, prefix);
    if (!existsSync(dir)) continue;
    let children = [];
    try {
      if (statSync(dir).isDirectory()) {
        children = Array.from(new Set(requireDirNames(dir)));
      }
    } catch {
      children = [];
    }
    for (const child of children) {
      const packagePath = join(dir, child, "package.json");
      const packageInfo = readJsonIfExists(packagePath);
      if (!packageInfo) continue;
      const packageDir = `${prefix}/${child}`;
      packages.set(packageDir, {
        path: packageDir,
        name: packageInfo.name,
        version: packageInfo.version,
        scripts: packageInfo.scripts ?? {},
        dependencies: Object.keys(packageInfo.dependencies ?? {}).sort(),
        optional_dependencies: Object.keys(packageInfo.optionalDependencies ?? {}).sort()
      });
    }
  }
  return packages;
}

function discoverSchemaTables(legacyRoot) {
  const schemaPath = join(legacyRoot, "libs", "shared", "src", "db", "schema.ts");
  const text = readTextIfExists(schemaPath);
  const tables = new Set();
  if (!text) return tables;
  for (const match of text.matchAll(/pgTable\('([^']+)'/g)) {
    tables.add(match[1]);
  }
  return tables;
}

function buildServiceRuntime(capabilities) {
  const byName = new Map();
  for (const capability of capabilities) {
    const runtime = capability.runtime;
    if (!runtime || byName.has(runtime.service_name)) continue;
    byName.set(runtime.service_name, {
      ...runtime,
      capabilities: capabilities
        .filter((item) => item.runtime?.service_name === runtime.service_name)
        .map((item) => item.id),
      status: capabilities
        .filter((item) => item.runtime?.service_name === runtime.service_name)
        .every((item) => item.status === "adapter_ready")
        ? "adapter_ready"
        : "partial"
    });
  }
  return [...byName.values()];
}

function buildBridgeContracts(capabilities) {
  const contracts = new Map();
  for (const capability of capabilities) {
    for (const contract of capability.bridge_contracts) {
      if (!contracts.has(contract)) {
        contracts.set(contract, {
          name: contract,
          capability_ids: [],
          status: "implemented_or_declared"
        });
      }
      contracts.get(contract).capability_ids.push(capability.id);
    }
  }
  return [...contracts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildCutoverPlan(capabilities) {
  return [
    {
      area: "工作流和执行",
      legacy_capability_ids: ["mainline.workflow", "mainline.executor"],
      new_surface: "TaskGraph + Operating Console",
      current_state: statusFor(capabilities, ["mainline.workflow", "mainline.executor"]),
      next_step: "把 P1 TaskGraph 通过 taskGraphToLegacyWorkflowPlan 提交到 workflow-service，执行结果归一成 AgentOutput。"
    },
    {
      area: "信息缺口和人类补采",
      legacy_capability_ids: ["mainline.gateway_channels", "mainline.org_task_dispatch", "mainline.mobile_notifications"],
      new_surface: "Information Gap Inbox + Human Twin Workbench",
      current_state: statusFor(capabilities, ["mainline.gateway_channels", "mainline.org_task_dispatch"]),
      next_step: "把 Information Gap 转成 org_task / assignment，并把提交结果转成 Evidence。"
    },
    {
      area: "事实、证据、检索",
      legacy_capability_ids: ["mainline.fact_retrieval", "mainline.audit_policy_identity"],
      new_surface: "Evidence Trace + External Fact Mirror",
      current_state: statusFor(capabilities, ["mainline.fact_retrieval", "mainline.audit_policy_identity"]),
      next_step: "把 CRM/项目管理 mirror 和人工补采内容投影到 fact/document/evidence pack。"
    },
    {
      area: "技能、记忆、主动运营",
      legacy_capability_ids: ["mainline.skill_library", "mainline.memory_dream", "mainline.proactive_orchestrator"],
      new_surface: "Agent Skill Registry + COO Signal Layer",
      current_state: statusFor(capabilities, ["mainline.skill_library", "mainline.memory_dream", "mainline.proactive_orchestrator"]),
      next_step: "把成功工作流沉淀为技能候选，并让主动运营洞察回流到 TaskGraph。"
    },
    {
      area: "界面归并",
      legacy_capability_ids: ["mainline.web_portal"],
      new_surface: "JueYing Operating Console",
      current_state: statusFor(capabilities, ["mainline.web_portal"]),
      next_step: "主版本控制台先显示运行状态，再逐步承接历史 Portal 中高频功能页。"
    }
  ];
}

function statusFor(capabilities, ids) {
  const selected = capabilities.filter((capability) => ids.includes(capability.id));
  if (selected.every((capability) => capability.status === "adapter_ready")) return "adapter_ready";
  if (selected.some((capability) => capability.status !== "missing")) return "partial";
  return "missing";
}

function groupCapabilities(capabilities) {
  const groups = [
    { id: "execution", name: "编排执行", ids: ["mainline.workflow", "mainline.executor"] },
    { id: "human_loop", name: "人类闭环", ids: ["mainline.gateway_channels", "mainline.org_task_dispatch", "mainline.mobile_notifications"] },
    { id: "facts", name: "事实证据", ids: ["mainline.fact_retrieval", "mainline.audit_policy_identity"] },
    { id: "compound", name: "复利能力", ids: ["mainline.skill_library", "mainline.memory_dream", "mainline.proactive_orchestrator"] },
    { id: "surface", name: "界面入口", ids: ["mainline.web_portal"] }
  ];
  return groups.map((group) => ({
    ...group,
    capabilities: capabilities.filter((capability) => group.ids.includes(capability.id))
  }));
}

function summarize(capabilities) {
  return {
    capability_count: capabilities.length,
    critical_count: capabilities.filter((capability) => capability.critical).length,
    adapter_ready_count: capabilities.filter((capability) => capability.status === "adapter_ready").length,
    partial_count: capabilities.filter((capability) => capability.status === "partial").length,
    missing_count: capabilities.filter((capability) => capability.status === "missing").length,
    route_count: capabilities.reduce((sum, capability) => sum + capability.routes.length, 0),
    data_object_count: capabilities.reduce((sum, capability) => sum + capability.data_objects.length, 0),
    bridge_contract_count: new Set(capabilities.flatMap((capability) => capability.bridge_contracts)).size
  };
}

function pathCheck(legacyRoot, path) {
  const fullPath = join(legacyRoot, path);
  let size = 0;
  let kind = "missing";
  if (existsSync(fullPath)) {
    const stats = statSync(fullPath);
    size = stats.size;
    kind = stats.isDirectory() ? "directory" : "file";
  }
  return {
    path,
    full_path: fullPath,
    exists: existsSync(fullPath),
    kind,
    size
  };
}

function requireDirNames(dir) {
  return Array.from(new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  ));
}

function readJsonIfExists(path) {
  const text = readTextIfExists(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readTextIfExists(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function countBy(items, field) {
  const counts = {};
  for (const item of items) {
    const key = item[field] ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function inferLegacyStageType(task) {
  if (task.owner_actor_type === "human" || task.owner_actor_type === "human_twin_agent") return "Approval";
  if ((task.required_evidence ?? []).length > 0 || (task.information_gap_ids ?? []).length > 0) return "Retrieval";
  return "Generic";
}

function inferLegacyExecutor(task) {
  if (task.owner_actor_type === "human" || task.owner_actor_type === "human_twin_agent") return "approval-executor";
  if ((task.required_evidence ?? []).length > 0 || (task.information_gap_ids ?? []).length > 0) return "retrieval-aware-executor";
  return "generic-executor";
}

function nextTaskId(tasks, index) {
  return tasks[index + 1]?.id ?? null;
}

function toDisplayPath(path) {
  const rel = relative(resolve("."), path);
  if (rel && !rel.startsWith("..")) {
    return rel.replaceAll("\\", "/");
  }
  return path.replaceAll("\\", "/");
}
