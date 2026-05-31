import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSalesGateIndex,
  decideWritebackPolicy,
  evaluateSalesStage,
  buildOperatingConsoleViewModel,
  buildManagementCommandCenterViewModel,
  buildManagementCommandDispatchPreview,
  buildRoleOperationPathTestReport,
  buildOperationPathTestViewModel,
  buildRoleStorylineAcceptanceReport,
  buildStorylineAcceptanceViewModel,
  loadSalesGateModel,
  loadRoleStorylineAcceptanceMatrix,
  loadScenarioCoverage,
  validateContract
} from "../src/contracts/index.mjs";
import {
  buildLegacyIntegrationViewModel,
  buildLegacyBridgePreview,
  buildLegacyRuntimeHealthCatalog,
  checkLegacyRuntimeHealth,
  createJueyingV1RuntimeClient,
  evidenceToLegacyFactWrite,
  informationGapToLegacyOrgTask,
  inspectJueyingV1Integration,
  taskGraphToLegacyWorkflowPlan,
  writebackIntentToLegacyAuditEvent
} from "../src/integrations/jueying-v1/index.mjs";

const baseTaskGraph = {
  id: "tg_test_001",
  run_id: "run_test_001",
  version: 1,
  status: "active",
  autonomy_level: "L1",
  tasks: [
    {
      id: "task_a",
      title: "Collect evidence",
      status: "accepted",
      owner_actor_type: "human",
      owner_actor_id: "user_001",
      depends_on: [],
      required_evidence: ["meeting_summary"],
      information_gap_ids: [],
      evidence_ids: ["ev_001"],
      acceptance_criteria: "Evidence is enough."
    }
  ]
};

const p1FixtureState = {
  raw: {
    taskGraph: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/task-graph.sales-discover.json", import.meta.url), "utf8")),
    gaps: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/information-gaps.json", import.meta.url), "utf8")),
    evidence: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/evidence.json", import.meta.url), "utf8")),
    gateChecks: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/sales-gate-checks.json", import.meta.url), "utf8")),
    mirrors: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/external-fact-mirrors.json", import.meta.url), "utf8")),
    writebackIntents: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/external-writeback-intents.json", import.meta.url), "utf8")),
    agentOutputs: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/agent-outputs.json", import.meta.url), "utf8")),
    management: JSON.parse(readFileSync(new URL("../fixtures/p1-demo/management-command-center.json", import.meta.url), "utf8"))
  }
};

test("valid task graph passes contract validation", () => {
  const result = validateContract("taskGraph", baseTaskGraph);
  assert.equal(result.ok, true);
});

test("accepted task without evidence is rejected", () => {
  const graph = structuredClone(baseTaskGraph);
  graph.tasks[0].evidence_ids = [];
  const result = validateContract("taskGraph", graph);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /accepted task must reference evidence/);
});

test("task dependency cycle is rejected", () => {
  const graph = structuredClone(baseTaskGraph);
  graph.tasks.push({
    id: "task_b",
    title: "Review evidence",
    status: "pending",
    owner_actor_type: "pm_agent",
    owner_actor_id: "pm_agent_001",
    depends_on: ["task_a"],
    required_evidence: [],
    information_gap_ids: [],
    evidence_ids: [],
    acceptance_criteria: "Review is done."
  });
  graph.tasks[0].depends_on = ["task_b"];
  const result = validateContract("taskGraph", graph);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /dependency cycle/);
});

test("sales gate stage mismatch is rejected", () => {
  const salesGateIndex = buildSalesGateIndex(loadSalesGateModel());
  const result = validateContract(
    "salesGateCheck",
    {
      id: "sgc_test",
      opportunity_id: "opp_001",
      stage: "scope",
      gate_id: "D-G1",
      status: "missing",
      evidence_ids: [],
      information_gap_ids: ["gap_001"],
      recommended_activity_ids: ["act_001"],
      owner_id: "user_sales",
      updated_at: "2026-05-26T10:00:00+08:00"
    },
    { salesGateIndex }
  );

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /belongs to discover/);
});

test("missing sales gate without information gap is rejected", () => {
  const salesGateIndex = buildSalesGateIndex(loadSalesGateModel());
  const result = validateContract(
    "salesGateCheck",
    {
      id: "sgc_test",
      opportunity_id: "opp_001",
      stage: "discover",
      gate_id: "D-G1",
      status: "missing",
      evidence_ids: [],
      information_gap_ids: [],
      recommended_activity_ids: ["act_001"],
      owner_id: "user_sales",
      updated_at: "2026-05-26T10:00:00+08:00"
    },
    { salesGateIndex }
  );

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /missing gate must reference/);
});

test("confirmed sales gate without evidence is rejected", () => {
  const salesGateIndex = buildSalesGateIndex(loadSalesGateModel());
  const result = validateContract(
    "salesGateCheck",
    {
      id: "sgc_confirmed_without_evidence",
      opportunity_id: "opp_001",
      stage: "discover",
      gate_id: "D-G7",
      status: "confirmed",
      evidence_ids: [],
      information_gap_ids: [],
      recommended_activity_ids: [],
      owner_id: "user_sales",
      updated_at: "2026-05-26T10:00:00+08:00"
    },
    { salesGateIndex }
  );

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /must reference evidence/);
});

test("evidence quality score must stay within contract bounds", () => {
  const result = validateContract("evidence", {
    id: "ev_bad_quality",
    evidence_type: "meeting_summary",
    source_type: "human",
    source_actor_id: "user_sales",
    capture_channel: "meeting",
    content_ref: {
      kind: "text",
      value: "Customer confirmed the next step."
    },
    quality_score: 1.2,
    created_at: "2026-05-26T10:00:00+08:00"
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /expected <= 1/);
});

test("high-risk writeback cannot auto execute", () => {
  const result = validateContract("externalWritebackIntent", {
    id: "wbi_test",
    connection_id: "conn_crm",
    system_type: "crm",
    provider: "hubspot",
    target: {
      object_type: "opportunity",
      external_id: "deal_1"
    },
    operation: "update_field",
    payload: {
      amount: 100000
    },
    source: {
      agent_id: "pm_agent_sales",
      reason: "Update amount"
    },
    risk_level: "high",
    idempotency_key: "high-risk-writeback-test",
    policy_decision: "auto_execute",
    created_at: "2026-05-26T10:00:00+08:00"
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /high-risk writeback cannot/);
});

test("writeback intent must carry idempotency key and source reason", () => {
  const result = validateContract("externalWritebackIntent", {
    id: "wbi_missing_idempotency",
    connection_id: "conn_crm",
    system_type: "crm",
    provider: "hubspot",
    target: {
      object_type: "opportunity",
      external_id: "deal_1"
    },
    operation: "create_note",
    payload: {
      body: "Gate summary"
    },
    source: {
      agent_id: "pm_agent_sales"
    },
    risk_level: "low",
    policy_decision: "auto_execute",
    created_at: "2026-05-26T10:00:00+08:00"
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /idempotency_key|required field missing/);
  assert.match(result.issues.map((issue) => issue.path).join("\n"), /\$\.source\.reason/);
});

test("accepted PM Agent verification must reference evidence", () => {
  const result = validateContract("agentOutput", {
    id: "out_verify_bad",
    kind: "pm_agent_verify",
    agent_id: "pm_agent_sales",
    run_id: "run_001",
    task_id: "task_001",
    created_at: "2026-05-26T10:00:00+08:00",
    payload: {
      decision: "accepted",
      task_id: "task_001",
      evidence_ids: [],
      reason: "Looks good"
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /accepted verification must reference evidence/);
});

test("human twin collect result completeness must be bounded", () => {
  const result = validateContract("agentOutput", {
    id: "out_collect_bad",
    kind: "human_twin_collect_result",
    agent_id: "twin_001",
    run_id: "run_001",
    task_id: "task_001",
    created_at: "2026-05-26T10:00:00+08:00",
    payload: {
      gap_id: "gap_001",
      collector_actor_id: "twin_001",
      evidence: {
        text: "partial answer"
      },
      completeness: 1.5
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /between 0 and 1/);
});

test("replan agent output must include trigger evidence, affected tasks, and new graph", () => {
  const result = validateContract("agentOutput", {
    id: "out_replan_bad",
    kind: "replan",
    agent_id: "pm_agent_delivery",
    run_id: "run_delivery_001",
    created_at: "2026-05-26T10:00:00+08:00",
    payload: {
      reason: "External PM status changed"
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.path).join("\n"), /\$\.payload\.trigger_evidence_ids/);
  assert.match(result.issues.map((issue) => issue.path).join("\n"), /\$\.payload\.affected_task_ids/);
  assert.match(result.issues.map((issue) => issue.path).join("\n"), /\$\.payload\.new_task_graph/);
});

test("writeback policy allows low-risk CRM note", () => {
  const decision = decideWritebackPolicy({
    operation: "create_note",
    risk_level: "low",
    payload: {
      body: "Gate summary"
    }
  });

  assert.equal(decision.decision, "auto_execute");
});

test("writeback policy requires confirmation for CRM amount update", () => {
  const decision = decideWritebackPolicy({
    operation: "update_field",
    risk_level: "low",
    payload: {
      amount: 100000
    }
  });

  assert.equal(decision.decision, "needs_confirmation");
  assert.match(decision.reasons.join("\n"), /high-risk operation|amount/);
});

test("writeback policy requires confirmation for nested high-risk fields", () => {
  const decision = decideWritebackPolicy({
    operation: "create_note",
    risk_level: "low",
    payload: {
      crm_update: {
        expected_close_date: "2026-06-30"
      }
    }
  });

  assert.equal(decision.decision, "needs_confirmation");
  assert.match(decision.reasons.join("\n"), /expected_close_date/);
});

test("writeback policy requires confirmation for PM status update", () => {
  const decision = decideWritebackPolicy({
    operation: "update_status",
    risk_level: "low",
    payload: {
      status: "Done"
    }
  });

  assert.equal(decision.decision, "needs_confirmation");
});

test("sales gate engine creates missing gaps and submitted checks", () => {
  const result = evaluateSalesStage(
    {
      stage: "discover",
      opportunityId: "opp_test",
      ownerId: "user_sales",
      evidence: [
        {
          id: "ev_next_action",
          evidence_type: "calendar_event"
        }
      ]
    },
    loadSalesGateModel()
  );

  const dG7 = result.checks.find((check) => check.gate_id === "D-G7");
  const dG1 = result.checks.find((check) => check.gate_id === "D-G1");

  assert.equal(result.checks.length, 7);
  assert.equal(dG7.status, "evidence_submitted");
  assert.deepEqual(dG7.evidence_ids, ["ev_next_action"]);
  assert.equal(dG1.status, "missing");
  assert.ok(result.information_gaps.some((gap) => gap.id.includes("d_g1")));
});

test("operating console view model surfaces missing gates and information tasks", () => {
  const viewModel = buildOperatingConsoleViewModel({
    taskGraph: {
      id: "tg_001",
      run_id: "run_001",
      status: "active",
      tasks: [
        { status: "needs_info" },
        { status: "accepted" }
      ]
    },
    gateChecks: [
      { status: "missing" },
      { status: "confirmed" }
    ],
    mirrors: [
      { freshness: "fresh" }
    ],
    writebackIntents: [
      { policy_decision: "auto_execute" }
    ]
  });

  assert.equal(viewModel.task_counts.needs_info, 1);
  assert.equal(viewModel.gate_counts.missing, 1);
  assert.match(viewModel.primary_alerts.join("\n"), /need information/);
});

test("management command center validates executive command, schedules, triggers, and swimlanes", () => {
  const result = validateContract("managementCommandCenter", p1FixtureState.raw.management);
  assert.equal(result.ok, true);
  assert.ok(p1FixtureState.raw.management.commands.some((command) => command.trigger_type === "scheduled"));
  assert.ok(p1FixtureState.raw.management.commands.some((command) => command.trigger_type === "condition"));
  assert.ok(p1FixtureState.raw.management.commands.every((command) => command.generated_task_ids.length >= 1));
  assert.ok(p1FixtureState.raw.management.execution_tasks.some((task) => task.status === "in_progress"));
  assert.ok(p1FixtureState.raw.management.execution_tasks.some((task) => task.status === "done" && task.result_summary));
  assert.ok(p1FixtureState.raw.management.execution_updates.some((update) => update.update_type === "progress"));
  assert.ok(p1FixtureState.raw.management.execution_updates.some((update) => update.update_type === "result"));
  assert.ok(p1FixtureState.raw.management.commands.some((command) =>
    command.delegation_chain.map((item) => item.actor_type).includes("executive") &&
    command.delegation_chain.some((item) => item.actor_type.endsWith("_agent")) &&
    command.delegation_chain.some((item) => ["human", "human_twin_agent"].includes(item.actor_type))
  ));
});

test("management command center view model exposes permissions and project swimlanes", () => {
  const viewModel = buildManagementCommandCenterViewModel({
    management: p1FixtureState.raw.management,
    taskGraph: p1FixtureState.raw.taskGraph,
    gaps: p1FixtureState.raw.gaps,
    evidence: p1FixtureState.raw.evidence,
    bridgePreview: { summary: { org_task_payload_count: 1 } }
  });

  assert.equal(viewModel.ok, true);
  assert.equal(viewModel.active_role.role_type, "executive");
  assert.equal(viewModel.permissions.can_create_command, true);
  assert.equal(viewModel.summary.scheduled_command_count, 1);
  assert.equal(viewModel.summary.condition_command_count, 1);
  assert.equal(viewModel.summary.decomposed_task_count, p1FixtureState.raw.management.execution_tasks.length);
  assert.ok(viewModel.summary.in_progress_task_count >= 1);
  assert.ok(viewModel.summary.result_task_count >= 1);
  assert.ok(viewModel.swimlanes.some((lane) => lane.title === "缺信息" && lane.tasks.length >= 1));
  assert.ok(viewModel.swimlanes.some((lane) =>
    lane.tasks.some((task) =>
      task.source === "management_execution_task" &&
      typeof task.progress_percent === "number" &&
      task.latest_update?.message
    )
  ));
  assert.ok(viewModel.swimlanes.some((lane) =>
    lane.tasks.some((task) => task.result_summary)
  ));
  assert.ok(viewModel.projects.some((project) => project.domain === "delivery"));
});

test("management command center applies role-specific command visibility and read-only permissions", () => {
  const management = structuredClone(p1FixtureState.raw.management);
  management.active_user_id = "sales_agent_001";
  const viewModel = buildManagementCommandCenterViewModel({
    management,
    taskGraph: p1FixtureState.raw.taskGraph,
    gaps: p1FixtureState.raw.gaps,
    evidence: p1FixtureState.raw.evidence,
    bridgePreview: { summary: { org_task_payload_count: 1 } }
  });

  assert.equal(viewModel.ok, true);
  assert.equal(viewModel.active_role.role_type, "specialized_agent");
  assert.equal(viewModel.permissions.can_create_command, false);
  assert.ok(viewModel.summary.command_count < p1FixtureState.raw.management.commands.length);
  assert.ok(viewModel.commands.length >= 1);
  assert.ok(viewModel.commands.every((command) =>
    command.delegation_chain.some((item) => item.actor_id === "sales_agent_001")
  ));
  assert.ok(viewModel.swimlanes.flatMap((lane) => lane.tasks).some((task) =>
    task.owner.id === "sales_agent_001" &&
    typeof task.progress_percent === "number"
  ));
});

test("management dispatch preview turns boss intent into agent delegation and task preview", () => {
  const preview = buildManagementCommandDispatchPreview({
    management: p1FixtureState.raw.management,
    commandInput: {
      title: "安排客户风险巡检",
      objective: "老板要求 PM Agent 检查项目风险并委派交付 Agent 跟进。",
      trigger_type: "condition",
      specialized_agent_type: "delivery_agent",
      specialized_agent_id: "delivery_agent_001",
      executor_type: "human",
      executor_id: "user_pm_chen"
    },
    taskGraph: p1FixtureState.raw.taskGraph
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.command.trigger_type, "condition");
  assert.equal(preview.command.delegation_chain[0].actor_type, "executive");
  assert.ok(preview.command.delegation_chain.some((item) => item.actor_type === "delivery_agent"));
  assert.equal(preview.command.generated_task_ids.length, 3);
  assert.equal(preview.execution_tasks.length, 3);
  assert.ok(preview.execution_tasks.some((task) => task.status === "in_progress"));
  assert.ok(preview.execution_tasks.some((task) => task.status === "needs_info"));
  assert.ok(preview.execution_updates.some((update) => update.update_type === "decomposition"));
  assert.equal(preview.task.owner_actor_type, "pm_agent");
  assert.match(preview.bridge_routes.org_task_create, /admin\/tasks/);
});

test("management dispatch preview blocks non-creator roles without breaking the boss delegation chain", () => {
  const management = structuredClone(p1FixtureState.raw.management);
  management.active_user_id = "sales_agent_001";
  const preview = buildManagementCommandDispatchPreview({
    management,
    commandInput: {
      title: "销售 Agent 试图越权下发",
      objective: "该角色只能查看被委派工作，不能代替老板创建管理指令。",
      trigger_type: "manual",
      specialized_agent_type: "sales_agent"
    },
    taskGraph: p1FixtureState.raw.taskGraph
  });

  assert.equal(preview.ok, false);
  assert.match(preview.warnings.join("\n"), /cannot create/);
  assert.equal(preview.command.created_by_role_id, "role_sales_agent");
  assert.equal(preview.command.delegation_chain[0].actor_type, "executive");
  assert.equal(preview.command.delegation_chain[0].actor_id, "user_exec_lina");
});

test("legacy JueYing v1 integration detects mainline capabilities", () => {
  const report = inspectJueyingV1Integration();
  assert.equal(report.ok, true);
  assert.equal(report.totals.capability_count >= 10, true);
  assert.equal(report.totals.route_count >= 50, true);
  assert.equal(report.totals.data_object_count >= 30, true);

  const workflow = report.capabilities.find((capability) => capability.id === "mainline.workflow");
  const orgTask = report.capabilities.find((capability) => capability.id === "mainline.org_task_dispatch");
  const proactive = report.capabilities.find((capability) => capability.id === "mainline.proactive_orchestrator");
  assert.equal(workflow.status, "adapter_ready");
  assert.equal(orgTask.status, "adapter_ready");
  assert.equal(proactive.status, "adapter_ready");
});

test("legacy integration view model summarizes cutover state", () => {
  const viewModel = buildLegacyIntegrationViewModel(inspectJueyingV1Integration());
  assert.equal(viewModel.ok, true);
  assert.equal(viewModel.summary.critical_ready, viewModel.summary.critical_total);
  assert.ok(viewModel.capability_groups.some((group) => group.id === "human_loop"));
  assert.ok(viewModel.cutover_plan.some((item) => item.area === "信息缺口和人类补采"));
});

test("legacy bridge preview summarizes runtime payload counts", () => {
  const preview = buildLegacyBridgePreview({
    taskGraph: baseTaskGraph,
    gaps: [
      {
        id: "gap_001",
        task_id: "task_a",
        status: "open",
        question: "还缺什么证据？",
        reason: "验收需要补齐证据。",
        collector_actor_id: "human_twin_andy",
        required_schema: { answer: "string" },
        expected_evidence_types: ["meeting_summary"],
        priority: "medium",
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    evidence: [
      {
        id: "ev_001",
        evidence_type: "meeting_summary",
        source_type: "human",
        source_actor_id: "user_sales",
        capture_channel: "meeting",
        content_ref: { kind: "text", value: "客户确认了下一步。" },
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    writebackIntents: []
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.summary.workflow_stage_count, 1);
  assert.equal(preview.summary.org_task_payload_count, 1);
  assert.equal(preview.summary.fact_write_payload_count, 1);
});

test("legacy runtime health returns bounded service checks", async () => {
  const health = await checkLegacyRuntimeHealth(inspectJueyingV1Integration(), { timeoutMs: 20 });
  assert.ok(health.service_count >= 5);
  assert.equal(Array.isArray(health.services), true);
  assert.ok(health.services.every((service) => typeof service.service_name === "string"));
});

test("TaskGraph can be transformed into a legacy workflow plan payload", () => {
  const payload = taskGraphToLegacyWorkflowPlan(baseTaskGraph, {
    owner_user_id: "u_sales_andy",
    org_id: "00000000-0000-0000-0000-000000000001"
  });
  assert.equal(payload.user_id, "u_sales_andy");
  assert.equal(payload.user_role, "admin");
  assert.equal(payload.policy_snapshot_hash.startsWith("sha256:"), true);
  assert.equal(payload.context.stage_chain.length, 1);
  assert.equal(payload.context.stage_chain[0].stage_id, "task_a");
  assert.equal(payload.context.stage_chain[0].assigned_executor, "approval-executor");
  assert.deepEqual(payload.markdown_steps, [
    {
      seq: 0,
      name: "task_a",
      description: "Collect evidence"
    }
  ]);
});

test("Information Gap can be transformed into legacy org_task payload", () => {
  const payload = informationGapToLegacyOrgTask({
    id: "gap_001",
    task_id: "task_a",
    status: "open",
    question: "Champion 有没有确认项目收益？",
    reason: "Scope Gate 需要 Champion 口头或书面确认收益。",
    collector_actor_id: "human_twin_andy",
    required_schema: { answer: "string" },
    expected_evidence_types: ["champion_confirmation"],
    priority: "high",
    created_at: "2026-05-26T10:00:00+08:00"
  });
  assert.equal(payload.task_type, "form");
  assert.equal(payload.schedule_type, "once");
  assert.match(payload.prompt_message, /Champion/);
  assert.deepEqual(payload.target_channels, ["wecom", "feishu"]);
});

test("Evidence and writeback intent can be projected to legacy fact and audit payloads", () => {
  const factPayload = evidenceToLegacyFactWrite({
    id: "ev_001",
    evidence_type: "meeting_summary",
    source_type: "human",
    source_actor_id: "user_sales",
    capture_channel: "meeting",
    task_id: "task_a",
    business_refs: { opportunity_id: "opp_001" },
    content_ref: {
      kind: "text",
      value: "客户确认了预算和下一步会议。",
      summary: "预算和下一步会议已确认"
    },
    quality_score: 0.8,
    created_at: "2026-05-26T10:00:00+08:00"
  });
  assert.equal(factPayload.subject_ref, "opp_001");
  assert.equal(factPayload.predicate, "evidence.meeting_summary");
  assert.equal(factPayload.confidence, 0.8);

  const auditPayload = writebackIntentToLegacyAuditEvent({
    id: "wbi_001",
    connection_id: "conn_crm",
    system_type: "crm",
    provider: "salesforce",
    target: { object_type: "opportunity", external_id: "006xx" },
    operation: "create_note",
    payload: { body: "Gate checked" },
    source: { agent_id: "pm_agent_sales", reason: "Record gate result" },
    risk_level: "low",
    idempotency_key: "writeback-001",
    policy_decision: "auto_execute",
    created_at: "2026-05-26T10:00:00+08:00"
  }, { decision: "auto_execute", reasons: [] });
  assert.equal(auditPayload.action, "external.writeback.intent");
  assert.match(auditPayload.resource_ref, /salesforce:opportunity/);
});

test("runtime client posts bridge payloads to legacy service endpoints", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, url }), {
      status: url.includes("/admin/tasks") ? 201 : 200,
      headers: { "content-type": "application/json" }
    });
  };
  const client = createJueyingV1RuntimeClient({
    fetchImpl,
    timeoutMs: 200,
    workflowUrl: "http://workflow.test",
    gatewayUrl: "http://gateway.test",
    factRetrievalUrl: "http://fact.test",
    internalToken: "test-token"
  });

  const workflow = await client.createWorkflowFromTaskGraph(baseTaskGraph, { owner_user_id: "u_sales_andy" });
  const orgTask = await client.createOrgTaskFromInformationGap({
    id: "gap_001",
    task_id: "task_a",
    status: "open",
    question: "需要补充 Champion 确认吗？",
    reason: "Scope Gate 缺证据。",
    collector_actor_id: "human_twin_andy",
    required_schema: { answer: "string" },
    expected_evidence_types: ["champion_confirmation"],
    priority: "high",
    created_at: "2026-05-26T10:00:00+08:00"
  });
  const fact = await client.writeFactFromEvidence({
    id: "ev_001",
    evidence_type: "meeting_summary",
    source_type: "human",
    source_actor_id: "user_sales",
    capture_channel: "meeting",
    content_ref: { kind: "text", value: "客户确认下一步。" },
    created_at: "2026-05-26T10:00:00+08:00"
  });

  assert.equal(workflow.ok, true);
  assert.equal(orgTask.ok, true);
  assert.equal(fact.ok, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /workflow\.test\/internal\/workflows\/plan/);
  assert.match(calls[1].url, /gateway\.test\/admin\/tasks/);
  assert.equal(calls[1].options.headers["x-internal-token"], "test-token");
  assert.match(calls[2].url, /fact\.test\/internal\/facts\/write/);
});

test("runtime client degrades cleanly when legacy service is offline", async () => {
  const client = createJueyingV1RuntimeClient({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    timeoutMs: 20,
    workflowUrl: "http://workflow.test"
  });
  const result = await client.createWorkflowFromTaskGraph(baseTaskGraph);
  assert.equal(result.ok, false);
  assert.equal(result.degraded, true);
  assert.equal(result.response.status, 0);
  assert.match(result.response.error, /offline/);
});

test("role storyline acceptance covers every documented role story and sales gate", () => {
  const report = buildRoleStorylineAcceptanceReport({
    matrix: loadRoleStorylineAcceptanceMatrix(),
    scenarioCoverage: loadScenarioCoverage(),
    salesGateModel: loadSalesGateModel(),
    legacyIntegration: inspectJueyingV1Integration(),
    state: p1FixtureState
  });

  assert.equal(report.ok, true);
  assert.equal(report.summary.role_count, 10);
  assert.equal(report.summary.storyline_count, 12);
  assert.equal(report.summary.step_count, 46);
  assert.equal(report.summary.failed_step_count, 0);
  assert.equal(report.summary.covered_story_count, report.summary.documented_story_count);
  assert.equal(report.summary.covered_story_count, 101);
  assert.equal(report.summary.covered_gate_count, report.summary.sales_gate_count);
  assert.equal(report.summary.covered_gate_count, 27);
});

test("storyline acceptance view model exposes role and step pass state", () => {
  const report = buildRoleStorylineAcceptanceReport({
    matrix: loadRoleStorylineAcceptanceMatrix(),
    scenarioCoverage: loadScenarioCoverage(),
    salesGateModel: loadSalesGateModel(),
    legacyIntegration: inspectJueyingV1Integration(),
    state: p1FixtureState
  });
  const viewModel = buildStorylineAcceptanceViewModel(report);

  assert.equal(viewModel.ok, true);
  assert.ok(viewModel.roles.some((role) => role.id === "sales_manager"));
  assert.ok(viewModel.roles.some((role) => role.id === "project_manager"));
  assert.ok(viewModel.roles.every((role) => role.status === "pass"));
  assert.ok(viewModel.roles.every((role) => role.step_count === role.passed_step_count));
});

test("storyline acceptance fails when a step references an unimplemented surface", () => {
  const matrix = structuredClone(loadRoleStorylineAcceptanceMatrix());
  matrix.roles[0].storylines[0].steps[0].ui_surfaces.push("missing_surface");

  const report = buildRoleStorylineAcceptanceReport({
    matrix,
    scenarioCoverage: loadScenarioCoverage(),
    salesGateModel: loadSalesGateModel(),
    legacyIntegration: inspectJueyingV1Integration(),
    state: p1FixtureState
  });

  assert.equal(report.ok, false);
  assert.match(report.issues.map((item) => item.message).join("\n"), /unimplemented UI surface/);
});

test("role operation path tests materialize every role step as executable assertions", () => {
  const legacyIntegration = inspectJueyingV1Integration();
  const bridgePreview = buildLegacyBridgePreview({
    taskGraph: p1FixtureState.raw.taskGraph,
    gaps: p1FixtureState.raw.gaps,
    evidence: p1FixtureState.raw.evidence,
    writebackIntents: p1FixtureState.raw.writebackIntents
  });
  const report = buildRoleOperationPathTestReport({
    matrix: loadRoleStorylineAcceptanceMatrix(),
    scenarioCoverage: loadScenarioCoverage(),
    salesGateModel: loadSalesGateModel(),
    legacyIntegration,
    state: p1FixtureState,
    bridgePreview,
    runtimeHealth: buildLegacyRuntimeHealthCatalog(legacyIntegration)
  });

  assert.equal(report.ok, true);
  assert.equal(report.summary.role_count, 10);
  assert.equal(report.summary.operation_path_count, 46);
  assert.equal(report.summary.failed_operation_path_count, 0);
  assert.equal(report.summary.assertion_count >= 478, true);
  assert.equal(report.summary.failed_assertion_count, 0);
  assert.equal(report.summary.external_sync_path_count, 9);
  assert.equal(report.summary.legacy_bridge_path_count, 7);
});

test("operation path test view model exposes role path pass state", () => {
  const legacyIntegration = inspectJueyingV1Integration();
  const bridgePreview = buildLegacyBridgePreview({
    taskGraph: p1FixtureState.raw.taskGraph,
    gaps: p1FixtureState.raw.gaps,
    evidence: p1FixtureState.raw.evidence,
    writebackIntents: p1FixtureState.raw.writebackIntents
  });
  const report = buildRoleOperationPathTestReport({
    matrix: loadRoleStorylineAcceptanceMatrix(),
    scenarioCoverage: loadScenarioCoverage(),
    salesGateModel: loadSalesGateModel(),
    legacyIntegration,
    state: p1FixtureState,
    bridgePreview,
    runtimeHealth: buildLegacyRuntimeHealthCatalog(legacyIntegration)
  });
  const viewModel = buildOperationPathTestViewModel(report);

  assert.equal(viewModel.ok, true);
  assert.ok(viewModel.roles.some((role) => role.id === "executive_coo"));
  assert.ok(viewModel.roles.some((role) => role.id === "worker_agent"));
  assert.ok(viewModel.roles.every((role) => role.status === "pass"));
  assert.ok(viewModel.roles.every((role) => role.operation_path_count === role.passed_operation_path_count));
});
