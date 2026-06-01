import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertContract,
  buildSalesGateIndex,
  decideWritebackPolicy,
  evaluateSalesStage,
  expectedEvidenceTypes,
  gateIds,
  buildOperatingConsoleViewModel,
  buildTaskGraphViewModel,
  buildInformationGapInboxViewModel,
  buildExternalSyncConsoleViewModel,
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
  assertJueyingV1Integration,
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

function issueText(result) {
  return result.issues.map((issue) => issue.message).join("\n");
}

function buildValidRuntimeHealth(legacyIntegration = inspectJueyingV1Integration()) {
  return {
    ok: true,
    service_count: legacyIntegration.service_runtime.length,
    online_count: legacyIntegration.service_runtime.length,
    services: legacyIntegration.service_runtime.map((service) => ({
      service_name: service.service_name,
      online: true,
      status: "online",
      capabilities: service.capabilities
    }))
  };
}

function buildMinimalMatrix(step = {}) {
  return {
    version: "test",
    roles: [
      {
        id: "executive_coo",
        name: "COO",
        type: "human",
        primary_goal: "Keep operations visible.",
        storylines: [
          {
            id: "story_test",
            title: "Test story",
            story_refs: ["SS-01"],
            steps: [
              {
                id: "step_test",
                action: "Open the console.",
                expected_result: "The next action is clear.",
                story_refs: ["SS-01"],
                ui_surfaces: ["overview"],
                api_surfaces: ["/health"],
                contract_refs: ["taskGraph"],
                capability_domains: ["task_graph_orchestration"],
                verification_modes: ["ui", "api", "contract"],
                ...step
              }
            ]
          }
        ]
      }
    ]
  };
}

function buildMinimalScenarioCoverage() {
  return {
    capability_domains: {
      task_graph_orchestration: {}
    },
    scenario_groups: {
      sales: {
        story_ranges: {
          discover: "SS-01..SS-01"
        },
        p1_anchor_stories: []
      }
    }
  };
}

function buildMinimalSalesGateModel() {
  return {
    stages: {
      discover: {
        label: "Discover",
        gates: []
      }
    }
  };
}

test("valid task graph passes contract validation", () => {
  const result = validateContract("taskGraph", baseTaskGraph);
  assert.equal(result.ok, true);
});

test("assertContract returns valid values and throws structured validation errors", () => {
  assert.equal(assertContract("taskGraph", baseTaskGraph).id, "tg_test_001");

  assert.throws(
    () => assertContract("taskGraph", { ...baseTaskGraph, id: "" }),
    (error) => {
      assert.equal(error.name, "ValidationError");
      assert.ok(error.issues.some((issue) => issue.path === "$.id"));
      return true;
    }
  );
  assert.throws(() => validateContract("missingKind", {}), /Unknown contract kind/);
});

test("schema validation catches enum, type, integer, min items, pattern, and unknown fields", () => {
  const badGraph = structuredClone(baseTaskGraph);
  badGraph.version = 1.5;
  badGraph.status = "not_a_status";
  badGraph.tasks = [];
  badGraph.extra = true;
  const result = validateContract("taskGraph", badGraph);

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => `${issue.path}:${issue.message}`).join("\n"), /\$\.version:expected integer/);
  assert.match(result.issues.map((issue) => `${issue.path}:${issue.message}`).join("\n"), /\$\.status:expected one of/);
  assert.match(result.issues.map((issue) => `${issue.path}:${issue.message}`).join("\n"), /\$\.tasks:expected at least 1 item/);
  assert.match(result.issues.map((issue) => `${issue.path}:${issue.message}`).join("\n"), /\$\.extra:unknown field/);

  const badEvidence = {
    id: "ev_bad",
    evidence_type: "meeting_summary",
    source_type: "human",
    source_actor_id: "user_sales",
    capture_channel: "meeting",
    content_ref: { kind: "text", value: "ok" },
    created_at: "not-a-date"
  };
  const evidenceResult = validateContract("evidence", badEvidence);
  assert.equal(evidenceResult.ok, false);
  assert.match(evidenceResult.issues.map((issue) => issue.message).join("\n"), /does not match pattern/);
});

test("contract validation handles missing optional arrays and empty helper models", () => {
  const noDependencyGraph = structuredClone(baseTaskGraph);
  delete noDependencyGraph.tasks[0].depends_on;
  assert.equal(validateContract("taskGraph", noDependencyGraph).ok, true);

  const outputWithoutRequiredPayload = validateContract("agentOutput", {
    id: "out_no_payload_fields",
    kind: "pm_agent_plan",
    agent_id: "agent_001",
    created_at: "2026-05-26T10:00:00+08:00",
    payload: {}
  });
  assert.equal(outputWithoutRequiredPayload.ok, false);
  assert.match(issueText(outputWithoutRequiredPayload), /required field missing/);

  const emptyGates = { stages: { discover: { label: "Discover" }, empty: { label: "Empty", gates: [] } } };
  assert.deepEqual(gateIds(emptyGates), []);
  assert.deepEqual(expectedEvidenceTypes({}), []);

  const result = evaluateSalesStage(
    {
      stage: "discover",
      opportunityId: "opp_no_evidence_types",
      ownerId: "user_sales",
      evidence: []
    },
    {
      stages: {
        discover: {
          gates: [{
            id: "D-G8",
            questions: ["Need context?"],
            recommended_activities: []
          }]
        }
      }
    }
  );
  assert.equal(result.checks[0].status, "missing");
  assert.match(result.information_gaps[0].reason, /without evidence:/);
});

test("contract validation covers sparse management arrays and non-object payload branches", () => {
  const noPayloadRuleLoop = validateContract("agentOutput", {
    id: "out_string_payload",
    kind: "pm_agent_plan",
    agent_id: "agent_001",
    created_at: "2026-05-26T10:00:00+08:00",
    payload: "not object"
  });
  assert.equal(noPayloadRuleLoop.ok, false);
  assert.match(issueText(noPayloadRuleLoop), /expected object/);

  const sparseManagement = {
    id: "mcc_sparse",
    active_user_id: "user_exec",
    roles: [{
      id: "role_exec",
      name: "Exec",
      user_id: "user_exec",
      role_type: "executive",
      permissions: ["create_command", "schedule_command", "configure_trigger"],
      default_view: "management_command_center"
    }],
    commands: [{
      id: "cmd_sparse",
      title: "Sparse command",
      status: "active",
      trigger_type: "manual",
      created_by_role_id: "role_exec",
      target_agent_id: "pm_agent_ops",
      objective: "Sparse semantic checks.",
      task_graph_id: "tg_sparse",
      project_id: "project_sparse",
      created_at: "2026-05-26T10:00:00+08:00"
    }],
    projects: [{
      id: "project_sparse",
      name: "Sparse project",
      owner_role_id: "role_exec",
      health: "planning",
      command_ids: []
    }],
    execution_tasks: [],
    execution_updates: [],
    swimlanes: [{
      id: "lane_sparse",
      title: "Sparse lane",
      status: "planning",
      task_ids: []
    }]
  };
  const result = validateContract("managementCommandCenter", sparseManagement);
  assert.equal(result.ok, false);
  assert.match(issueText(result), /boss -> agent -> executor delegation/);
  assert.match(issueText(result), /must reference automatically decomposed execution tasks/);
  assert.match(issueText(result), /swimlane board must contain at least one task/);

  const missingCollections = structuredClone(sparseManagement);
  delete missingCollections.projects[0].command_ids;
  delete missingCollections.swimlanes[0].task_ids;
  const missingCollectionsResult = validateContract("managementCommandCenter", missingCollections);
  assert.equal(missingCollectionsResult.ok, false);
  assert.match(issueText(missingCollectionsResult), /required field missing/);
});

test("contract validation covers defensive semantic branches and boundary messages", () => {
  const lowVersion = structuredClone(baseTaskGraph);
  lowVersion.version = 0;
  lowVersion.tasks[0].title = "";
  const lowVersionResult = validateContract("taskGraph", lowVersion);
  assert.equal(lowVersionResult.ok, false);
  assert.match(issueText(lowVersionResult), /expected >= 1/);
  assert.match(issueText(lowVersionResult), /expected length >= 1/);

  assert.equal(validateContract("taskGraph", null).ok, false);
  assert.equal(validateContract("salesGateCheck", null).ok, false);
  assert.equal(validateContract("externalWritebackIntent", null).ok, false);
  assert.equal(validateContract("agentOutput", { kind: "pm_agent_verify", payload: null }).ok, false);
  assert.equal(validateContract("managementCommandCenter", null).ok, false);

  const salesGateIndex = buildSalesGateIndex(loadSalesGateModel());
  const unknownGate = validateContract(
    "salesGateCheck",
    {
      id: "sgc_unknown_gate",
      opportunity_id: "opp_001",
      stage: "discover",
      gate_id: "D-G99",
      status: "missing",
      evidence_ids: [],
      information_gap_ids: ["gap_001"],
      recommended_activity_ids: [],
      owner_id: "user_sales",
      updated_at: "2026-05-26T10:00:00+08:00"
    },
    { salesGateIndex }
  );
  assert.match(issueText(unknownGate), /unknown gate id/);

  const statusAuto = validateContract("externalWritebackIntent", {
    id: "wbi_status_auto",
    connection_id: "conn_crm",
    system_type: "crm",
    provider: "hubspot",
    target: { object_type: "opportunity", external_id: "deal_1" },
    operation: "update_status",
    payload: { status: "Closed Won" },
    source: { agent_id: "pm_agent_sales", reason: "Update status" },
    risk_level: "low",
    idempotency_key: "status-auto-test",
    policy_decision: "auto_execute",
    created_at: "2026-05-26T10:00:00+08:00"
  });
  assert.match(issueText(statusAuto), /status updates require confirmation/);

  const unknownOutputKind = validateContract("agentOutput", {
    id: "out_unknown_kind",
    kind: "unknown_kind",
    agent_id: "agent_001",
    created_at: "2026-05-26T10:00:00+08:00",
    payload: {}
  });
  assert.equal(unknownOutputKind.ok, false);

  const badDecision = validateContract("agentOutput", {
    id: "out_bad_decision",
    kind: "pm_agent_verify",
    agent_id: "pm_agent_sales",
    task_id: "task_001",
    created_at: "2026-05-26T10:00:00+08:00",
    payload: {
      decision: "maybe",
      task_id: "task_001",
      evidence_ids: ["ev_001"],
      reason: "Ambiguous"
    }
  });
  assert.match(issueText(badDecision), /expected one of accepted/);

  const management = structuredClone(p1FixtureState.raw.management);
  management.commands[0].created_by_role_id = "role_ops_agent";
  const managementResult = validateContract("managementCommandCenter", management);
  assert.match(issueText(managementResult), /schedule creator must have schedule_command permission/);
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

test("task graph duplicate, unknown, and self dependencies are rejected", () => {
  const graph = structuredClone(baseTaskGraph);
  graph.tasks.push({
    id: "task_a",
    title: "Duplicate",
    status: "pending",
    owner_actor_type: "human",
    owner_actor_id: "user_002",
    depends_on: ["missing_task", "task_a"],
    required_evidence: [],
    information_gap_ids: [],
    evidence_ids: [],
    acceptance_criteria: "No duplicate ids."
  });
  const result = validateContract("taskGraph", graph);

  assert.equal(result.ok, false);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /duplicate task id/);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /unknown dependency/);
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /task cannot depend on itself/);
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

test("writeback policy is conservative for high, medium, unknown, and non-object inputs", () => {
  assert.equal(decideWritebackPolicy({
    operation: "create_note",
    risk_level: "high",
    payload: { body: "Sensitive update" }
  }).decision, "needs_confirmation");

  assert.equal(decideWritebackPolicy({
    operation: "create_comment",
    risk_level: "medium",
    payload: { body: "Needs review" }
  }).decision, "needs_confirmation");

  const unknown = decideWritebackPolicy({
    operation: "delete_record",
    risk_level: "low",
    payload: { body: "Not allowlisted" }
  });
  assert.equal(unknown.decision, "manual_only");
  assert.match(unknown.reasons.join("\n"), /not explicitly allowed/);

  assert.equal(decideWritebackPolicy({
    operation: "create_note",
    risk_level: "low",
    payload: ["amount"]
  }).decision, "auto_execute");

  assert.equal(decideWritebackPolicy({
    operation: "create_task",
    risk_level: "low",
    payload: "plain text"
  }).decision, "auto_execute");
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

test("sales gate model helpers expose gate and evidence vocabularies", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "jueying-gates-"));
  const modelPath = join(tempDir, "sales-gates.json");
  try {
    writeFileSync(modelPath, JSON.stringify({
      stages: {
        discover: {
          label: "Discover",
          gates: [
            { id: "D-G1", label: "Champion", evidence_types: ["meeting_summary", "customer_quote"] },
            { id: "D-G2", label: "Pain", evidence_types: ["meeting_summary"] }
          ]
        },
        scope: {
          label: "Scope",
          gates: [
            { id: "S-G1", label: "Scope", evidence_types: ["sow"] }
          ]
        }
      }
    }), "utf8");
    const model = loadSalesGateModel(modelPath);
    assert.deepEqual(gateIds(model), ["D-G1", "D-G2", "S-G1"]);
    assert.deepEqual(expectedEvidenceTypes(model), ["customer_quote", "meeting_summary", "sow"]);
    assert.equal(buildSalesGateIndex(model).get("S-G1").stage_label, "Scope");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sales gate model helpers tolerate stages without gate evidence arrays", () => {
  const model = {
    stages: {
      discover: {
        label: "Discover"
      },
      scope: {
        label: "Scope",
        gates: [
          { id: "S-G1", label: "Scope without evidence" },
          { id: "S-G2", label: "Scope with evidence", evidence_types: ["sow"] }
        ]
      }
    }
  };

  assert.deepEqual(gateIds(model), ["S-G1", "S-G2"]);
  assert.deepEqual(expectedEvidenceTypes(model), ["sow"]);
});

test("sales gate engine rejects unknown stages and marks existing gaps collecting", () => {
  assert.throws(() => evaluateSalesStage({ stage: "unknown", opportunityId: "opp", ownerId: "u" }, loadSalesGateModel()), /Unknown sales stage/);

  const result = evaluateSalesStage(
    {
      stage: "discover",
      opportunityId: "opp_existing",
      ownerId: "user_sales",
      evidence: [],
      existingGapIds: ["gap_opp_existing_d_g1"]
    },
    loadSalesGateModel()
  );

  assert.equal(result.information_gaps.find((gap) => gap.id === "gap_opp_existing_d_g1").status, "collecting");
  assert.equal(result.information_gaps.find((gap) => gap.id === "gap_opp_existing_d_g2").priority, "medium");
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

test("operating console builds a role-specific next-action queue", () => {
  const viewModel = buildOperatingConsoleViewModel({
    taskGraph: p1FixtureState.raw.taskGraph,
    gateChecks: p1FixtureState.raw.gateChecks,
    mirrors: p1FixtureState.raw.mirrors,
    writebackIntents: p1FixtureState.raw.writebackIntents,
    gaps: p1FixtureState.raw.gaps,
    management: p1FixtureState.raw.management
  });

  assert.equal(viewModel.active_role.user_id, "user_exec_lina");
  assert.equal(viewModel.role_action_count >= 3, true);
  assert.equal(viewModel.role_action_queue[0].priority, "high");
  assert.ok(viewModel.role_action_queue.some((action) => action.target_view === "management"));
  assert.ok(viewModel.role_action_queue.some((action) => action.target_view === "gates"));
  assert.ok(viewModel.role_action_queue.some((action) => action.target_view === "gaps"));
});

test("detail view models connect tasks, gaps, evidence, and external sync records", () => {
  const taskGraph = buildTaskGraphViewModel({
    taskGraph: p1FixtureState.raw.taskGraph,
    evidence: p1FixtureState.raw.evidence,
    gaps: p1FixtureState.raw.gaps
  });
  const championTask = taskGraph.tasks.find((task) => task.id === "task_discover_champion");
  assert.equal(taskGraph.id, p1FixtureState.raw.taskGraph.id);
  assert.equal(championTask.information_gaps[0].id, "gap_discover_champion");
  assert.equal(championTask.evidence.length, 0);

  const gapInbox = buildInformationGapInboxViewModel({
    gaps: [
      ...p1FixtureState.raw.gaps,
      { ...p1FixtureState.raw.gaps[0], id: "gap_closed", status: "closed", task_id: "missing_task" }
    ],
    taskGraph: p1FixtureState.raw.taskGraph,
    gapReplies: [
      {
        id: "gap_reply_rebut",
        gap_id: "gap_closed",
        decision: "rebut",
        by: "user_exec_lina",
        reason: "Owner waived this missing signal.",
        message: "No customer-facing follow-up is needed.",
        evidence_id: "ev_001",
        created_at: "2026-05-26T11:00:00+08:00"
      },
      {
        id: "gap_reply_missing_defaults",
        gap_id: "gap_closed",
        decision: "reply",
        by: "sales_agent_001"
      },
      {
        id: "gap_reply_older",
        gap_id: "gap_closed",
        decision: "reply",
        by: "sales_agent_001",
        reason: "Champion evidence was added from the meeting note.",
        message: "Please re-check the D-G1 gap.",
        evidence_id: "ev_001",
        created_at: "2026-05-26T10:30:00+08:00"
      },
      {
        id: "gap_reply_invalid_timestamp",
        gap_id: "gap_closed",
        decision: "reply",
        by: "sales_agent_001",
        created_at: "not-a-date"
      }
    ]
  });
  assert.equal(gapInbox.open_count, 1);
  const closedGap = gapInbox.gaps.find((gap) => gap.id === "gap_closed");
  assert.equal(closedGap.task, null);
  assert.equal(closedGap.last_reply.decision, "rebut");
  assert.equal(closedGap.last_reply.reason, "Owner waived this missing signal.");
  assert.deepEqual(closedGap.replies.map((reply) => reply.id), [
    "gap_reply_rebut",
    "gap_reply_older",
    "gap_reply_missing_defaults",
    "gap_reply_invalid_timestamp"
  ]);
  const missingDefaultReply = closedGap.replies.find((reply) => reply.id === "gap_reply_missing_defaults");
  assert.equal(missingDefaultReply.reason, null);
  assert.equal(missingDefaultReply.message, null);
  assert.equal(missingDefaultReply.evidence_id, null);

  const syncConsole = buildExternalSyncConsoleViewModel({
    mirrors: p1FixtureState.raw.mirrors,
    writebackIntents: p1FixtureState.raw.writebackIntents
  });
  assert.equal(syncConsole.mirrors.length, 2);
  assert.equal(syncConsole.writeback_queue[0].operation, "create_note");
});

test("operating console queues dashboard-only external sync work for governance roles", () => {
  const mirrors = [
    ...p1FixtureState.raw.mirrors,
    { ...p1FixtureState.raw.mirrors[0], id: "mirror_stale", freshness: "stale" }
  ];
  const writebackIntents = [
    ...p1FixtureState.raw.writebackIntents,
    {
      ...p1FixtureState.raw.writebackIntents[0],
      id: "wbi_high_confirm",
      risk_level: "high",
      policy_decision: "needs_confirmation",
      created_at: "2026-05-25T10:20:00+08:00"
    }
  ];
  const adminManagement = structuredClone(p1FixtureState.raw.management);
  adminManagement.active_user_id = "user_admin_it";
  adminManagement.execution_tasks = [];
  const adminView = buildOperatingConsoleViewModel({
    taskGraph: p1FixtureState.raw.taskGraph,
    gateChecks: [],
    mirrors,
    writebackIntents,
    gaps: [],
    management: adminManagement
  });
  assert.ok(adminView.role_action_queue.some((action) => action.source_type === "external_fact_mirror"));
  assert.ok(adminView.role_action_queue.some((action) => action.source_type === "external_writeback_intent"));

  const workerManagement = structuredClone(p1FixtureState.raw.management);
  workerManagement.active_user_id = "sales_agent_001";
  const workerView = buildOperatingConsoleViewModel({
    taskGraph: p1FixtureState.raw.taskGraph,
    gateChecks: p1FixtureState.raw.gateChecks,
    mirrors,
    writebackIntents,
    gaps: [
      { ...p1FixtureState.raw.gaps[0], status: "closed" },
      { ...p1FixtureState.raw.gaps[0], id: "gap_mine", collector_actor_id: "sales_agent_001", priority: undefined, due_at: "not-a-date" }
    ],
    management: workerManagement
  });
  assert.equal(workerView.role_action_queue.some((action) => action.source_type === "external_fact_mirror"), false);
  assert.equal(workerView.role_action_queue.some((action) => action.source_type === "external_writeback_intent"), false);
  assert.ok(workerView.role_action_queue.some((action) => action.id === "gap:gap_mine" && action.priority === "medium"));
});

test("operating console action sorting handles unknown priorities, dates, and statuses", () => {
  const management = {
    active_user_id: "user_exec",
    roles: [
      {
        id: "role_exec",
        name: "Exec",
        user_id: "user_exec",
        role_type: "executive",
        permissions: ["view_management_dashboard", "view_all_projects"],
        default_view: "management_command_center"
      }
    ],
    commands: [
      {
        id: "cmd_unknown",
        title: "Unknown status command",
        status: "active",
        trigger_type: "manual",
        objective: "Watch unknown status.",
        task_graph_id: baseTaskGraph.id,
        project_id: "project_ops",
        delegation_chain: [],
        generated_task_ids: ["task_unknown"],
        created_at: "2026-05-26T10:00:00+08:00"
      },
      {
        id: "cmd_blocked",
        title: "Blocked command",
        status: "active",
        trigger_type: "manual",
        objective: "Watch blocked status.",
        task_graph_id: baseTaskGraph.id,
        project_id: "project_ops",
        delegation_chain: [],
        generated_task_ids: ["task_blocked"],
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    projects: [{ id: "project_ops", name: "Ops", task_graph_id: baseTaskGraph.id, command_ids: ["cmd_unknown", "cmd_blocked"] }],
    execution_updates: [
      {
        id: "update_unknown",
        task_id: "task_unknown",
        update_type: "progress",
        actor_type: "pm_agent",
        actor_id: "pm_agent_ops",
        message: "Unknown state update.",
        progress_percent: 5,
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    execution_tasks: [
      {
        id: "task_unknown",
        command_id: "cmd_unknown",
        project_id: "project_ops",
        title: "ZZZ unknown status",
        status: "waiting",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Unknown status still needs a default next step.",
        due_at: "bad-date",
        latest_update_id: "update_unknown",
        progress_percent: 5
      },
      {
        id: "task_blocked",
        command_id: "cmd_blocked",
        project_id: "project_ops",
        title: "AAA blocked status",
        status: "blocked",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Blocked task needs escalation.",
        due_at: "2026-05-25T10:00:00+08:00",
        progress_percent: 5
      }
    ],
    swimlanes: []
  };

  const viewModel = buildOperatingConsoleViewModel({
    taskGraph: baseTaskGraph,
    gateChecks: [],
    mirrors: [],
    writebackIntents: [],
    gaps: [],
    management
  });

  assert.equal(viewModel.role_action_queue[0].status, "blocked");
  assert.match(viewModel.role_action_queue[0].next_step, /处理阻塞/);
  assert.equal(viewModel.role_action_queue[1].status, "waiting");
  assert.match(viewModel.role_action_queue[1].next_step, /最新状态/);
});

test("operating console action sorting covers invalid due dates and unknown priorities", () => {
  const viewModel = buildOperatingConsoleViewModel({
    taskGraph: {
      id: "tg_sort_edges",
      run_id: "run_sort_edges",
      status: "active",
      tasks: []
    },
    gateChecks: [],
    mirrors: [],
    writebackIntents: [],
    gaps: [
      {
        id: "gap_unknown_priority",
        status: "open",
        collector_actor_id: "user_exec",
        question: "Unknown priority?",
        reason: "Exercises priority fallback.",
        priority: "unknown",
        due_at: "bad-date"
      },
      {
        id: "gap_low_priority",
        status: "open",
        collector_actor_id: "user_exec",
        question: "Low priority?",
        reason: "Exercises valid date sorting.",
        priority: "low",
        due_at: "2026-05-20T10:00:00+08:00"
      }
    ],
    management: {
      active_user_id: "user_exec",
      roles: [{
        id: "role_exec",
        name: "Exec",
        user_id: "user_exec",
        role_type: "executive",
        permissions: ["view_management_dashboard"],
        default_view: "management_command_center"
      }],
      commands: [],
      projects: [],
      execution_tasks: [],
      execution_updates: []
    }
  });

  assert.equal(viewModel.role_action_queue.at(-1).priority, "unknown");

  const invalidDateView = buildOperatingConsoleViewModel({
    taskGraph: {
      id: "tg_invalid_date",
      run_id: "run_invalid_date",
      status: "active",
      tasks: []
    },
    gateChecks: [],
    mirrors: [],
    writebackIntents: [],
    gaps: [
      {
        id: "gap_invalid_a",
        status: "open",
        collector_actor_id: "user_exec",
        question: "Invalid A?",
        reason: "Invalid date A.",
        priority: "medium",
        due_at: "bad-date-a"
      },
      {
        id: "gap_invalid_b",
        status: "open",
        collector_actor_id: "user_exec",
        question: "Invalid B?",
        reason: "Invalid date B.",
        priority: "medium",
        due_at: "bad-date-b"
      }
    ],
    management: {
      active_user_id: "user_exec",
      roles: [{
        id: "role_exec",
        name: "Exec",
        user_id: "user_exec",
        role_type: "executive",
        permissions: ["view_management_dashboard"],
        default_view: "management_command_center"
      }],
      commands: [],
      projects: [],
      execution_tasks: [],
      execution_updates: []
    }
  });
  assert.deepEqual(invalidDateView.role_action_queue.map((action) => action.source_id), [
    "gap_invalid_a",
    "gap_invalid_b"
  ]);
});

test("operating console action sorting ranks every known status bucket", () => {
  const management = {
    active_user_id: "user_exec",
    roles: [
      {
        id: "role_exec",
        name: "Exec",
        user_id: "user_exec",
        role_type: "executive",
        permissions: ["view_management_dashboard"],
        default_view: "management_command_center"
      }
    ],
    commands: [
      {
        id: "cmd_statuses",
        title: "Status sort",
        status: "active",
        trigger_type: "manual",
        objective: "Sort all statuses.",
        task_graph_id: baseTaskGraph.id,
        project_id: "project_ops",
        generated_task_ids: ["task_blocked", "task_needs_info", "task_in_progress", "task_review", "task_delegated"],
        delegation_chain: [],
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    projects: [{ id: "project_ops", name: "Ops", task_graph_id: baseTaskGraph.id, command_ids: ["cmd_statuses"] }],
    execution_updates: [],
    execution_tasks: [
      {
        id: "task_delegated",
        command_id: "cmd_statuses",
        project_id: "project_ops",
        title: "Delegated",
        status: "delegated",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Delegated.",
        progress_percent: 0
      },
      {
        id: "task_in_progress",
        command_id: "cmd_statuses",
        project_id: "project_ops",
        title: "In progress",
        status: "in_progress",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "In progress.",
        progress_percent: 40
      },
      {
        id: "task_review",
        command_id: "cmd_statuses",
        project_id: "project_ops",
        title: "Review",
        status: "review",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Review.",
        progress_percent: 90
      },
      {
        id: "task_needs_info",
        command_id: "cmd_statuses",
        project_id: "project_ops",
        title: "Needs info",
        status: "needs_info",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Needs info.",
        progress_percent: 10
      },
      {
        id: "task_blocked",
        command_id: "cmd_statuses",
        project_id: "project_ops",
        title: "Blocked",
        status: "blocked",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Blocked.",
        progress_percent: 10
      }
    ],
    swimlanes: []
  };
  const gateChecks = [
    {
      id: "sgc_collecting",
      opportunity_id: "opp",
      stage: "discover",
      gate_id: "D-G1",
      status: "collecting",
      evidence_ids: [],
      information_gap_ids: ["gap_collecting"],
      recommended_activity_ids: [],
      owner_id: "user_exec",
      updated_at: "2026-05-26T10:00:00+08:00"
    },
    {
      id: "sgc_missing",
      opportunity_id: "opp",
      stage: "discover",
      gate_id: "D-G2",
      status: "missing",
      evidence_ids: [],
      information_gap_ids: ["gap_missing"],
      recommended_activity_ids: [],
      owner_id: "user_exec",
      updated_at: "2026-05-26T10:00:00+08:00"
    },
    {
      id: "sgc_supplement",
      opportunity_id: "opp",
      stage: "discover",
      gate_id: "D-G3",
      status: "needs_supplement",
      evidence_ids: [],
      information_gap_ids: ["gap_supplement"],
      recommended_activity_ids: [],
      owner_id: "user_exec",
      updated_at: "2026-05-26T10:00:00+08:00"
    }
  ];

  const viewModel = buildOperatingConsoleViewModel({
    taskGraph: baseTaskGraph,
    gateChecks,
    mirrors: [],
    writebackIntents: [],
    gaps: [],
    management
  });

  assert.deepEqual(viewModel.role_action_queue.map((action) => action.status), [
    "blocked",
    "missing",
    "needs_info",
    "collecting",
    "needs_supplement",
    "in_progress"
  ]);
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

test("management command center rejects broken command routing and execution references", () => {
  const management = structuredClone(p1FixtureState.raw.management);
  const unauthorizedRole = management.roles.find((role) => !role.permissions.includes("create_command"));
  management.roles = management.roles.filter((role) => role.role_type !== "executive");

  management.commands[0] = {
    ...management.commands[0],
    created_by_role_id: unauthorizedRole.id,
    trigger_type: "scheduled",
    schedule: undefined,
    condition: {
      signal: "task.blocked",
      operator: "greater_than",
      threshold: "0",
      evaluation_window: "rolling_1h"
    },
    delegation_chain: [{ order: 1, actor_type: "pm_agent", actor_id: "pm_agent_ops_001", responsibility: "Only agent." }],
    generated_task_ids: []
  };
  management.commands[1] = {
    ...management.commands[1],
    created_by_role_id: "role_missing",
    project_id: "project_missing",
    trigger_type: "condition",
    condition: undefined,
    generated_task_ids: ["task_missing"]
  };

  management.execution_tasks[0] = {
    ...management.execution_tasks[0],
    command_id: "cmd_missing",
    project_id: "project_missing",
    latest_update_id: "update_missing",
    status: "done",
    result_summary: "",
    progress_percent: 90
  };
  management.execution_tasks[1] = {
    ...management.execution_tasks[1],
    status: "in_progress"
  };
  delete management.execution_tasks[1].progress_percent;

  management.execution_updates[0] = {
    ...management.execution_updates[0],
    task_id: "task_missing",
    update_type: "result"
  };
  delete management.execution_updates[0].evidence_ids;

  management.projects[0] = {
    ...management.projects[0],
    owner_role_id: "role_missing",
    command_ids: ["cmd_missing"]
  };
  management.swimlanes = [{ ...management.swimlanes[0], task_ids: ["task_missing"] }];

  const result = validateContract("managementCommandCenter", management);
  assert.equal(result.ok, false);
  const messages = issueText(result);
  assert.match(messages, /requires an executive role/);
  assert.match(messages, /command creator must have create_command permission/);
  assert.match(messages, /scheduled command requires schedule/);
  assert.match(messages, /condition creator must have configure_trigger permission/);
  assert.match(messages, /boss -> agent -> executor/);
  assert.match(messages, /must include executive, agent, and human/);
  assert.match(messages, /must reference automatically decomposed execution tasks/);
  assert.match(messages, /unknown role: role_missing/);
  assert.match(messages, /condition command requires condition/);
  assert.match(messages, /unknown execution task: task_missing/);
  assert.match(messages, /unknown command: cmd_missing/);
  assert.match(messages, /unknown project: project_missing/);
  assert.match(messages, /unknown execution update: update_missing/);
  assert.match(messages, /done execution task must include result_summary and 100 progress/);
  assert.match(messages, /active execution task must include progress/);
  assert.match(messages, /result or evidence update must carry evidence_ids/);

  const emptyBoard = structuredClone(p1FixtureState.raw.management);
  emptyBoard.swimlanes = emptyBoard.swimlanes.map((lane) => ({ ...lane, task_ids: [] }));
  const emptyBoardResult = validateContract("managementCommandCenter", emptyBoard);
  assert.equal(emptyBoardResult.ok, false);
  assert.match(issueText(emptyBoardResult), /swimlane board must contain at least one task/);
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
  assert.equal(viewModel.swimlanes.flatMap((lane) => lane.tasks).some((task) =>
    task.owner.id === "delivery_agent_001"
  ), false);
});

test("management command center view model handles absent roles, assigned TaskGraph work, and hidden projects", () => {
  const noRoleView = buildManagementCommandCenterViewModel({
    management: { roles: [], commands: [], execution_tasks: [], execution_updates: [], projects: [], swimlanes: [] },
    taskGraph: { ...baseTaskGraph, tasks: [] },
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  assert.equal(noRoleView.ok, false);
  assert.equal(noRoleView.active_role, null);

  const management = structuredClone(p1FixtureState.raw.management);
  management.roles.push({
    id: "role_unassigned",
    name: "Unassigned",
    user_id: "user_unassigned",
    role_type: "worker",
    permissions: ["view_assigned_work"],
    default_view: "assigned_work"
  });
  management.active_user_id = "user_unassigned";
  const hiddenView = buildManagementCommandCenterViewModel({
    management,
    taskGraph: { ...baseTaskGraph, tasks: [] },
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  assert.equal(hiddenView.ok, true);
  assert.equal(hiddenView.commands.length, 0);
  assert.equal(hiddenView.projects.length, 0);
  assert.equal(hiddenView.swimlanes.flatMap((lane) => lane.tasks).length, 0);

  const assignedManagement = {
    roles: [
      {
        id: "role_worker",
        name: "Worker",
        user_id: "user_001",
        role_type: "worker",
        permissions: ["view_assigned_work"],
        default_view: "assigned_work"
      }
    ],
    active_user_id: "user_001",
    commands: [],
    execution_tasks: [],
    execution_updates: [],
    projects: [],
    swimlanes: [{ id: "lane_graph", title: "Mine", status: "in_progress", task_ids: ["task_a", "task_missing"] }]
  };
  const assignedView = buildManagementCommandCenterViewModel({
    management: assignedManagement,
    taskGraph: baseTaskGraph,
    gaps: [{ ...p1FixtureState.raw.gaps[0], task_id: "task_a" }],
    evidence: [{ ...p1FixtureState.raw.evidence[0], task_id: "task_a" }],
    bridgePreview: {}
  });
  const task = assignedView.swimlanes[0].tasks[0];
  assert.equal(task.source, "task_graph_task");
  assert.equal(task.gap_count, 1);
  assert.equal(task.evidence_count, 1);

  const allProjectsOnly = {
    roles: [
      {
        id: "role_portfolio",
        name: "Portfolio",
        user_id: "user_portfolio",
        role_type: "manager",
        permissions: ["view_all_projects"],
        default_view: "management_command_center"
      }
    ],
    active_user_id: "user_portfolio",
    commands: [
      {
        id: "cmd_portfolio",
        title: "Portfolio command",
        status: "active",
        trigger_type: "manual",
        objective: "View all projects.",
        task_graph_id: baseTaskGraph.id,
        project_id: "project_portfolio",
        generated_task_ids: [],
        delegation_chain: [],
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    execution_tasks: [],
    execution_updates: [],
    projects: [{
      id: "project_portfolio",
      name: "Portfolio",
      owner_role_id: "role_portfolio",
      task_graph_id: baseTaskGraph.id,
      command_ids: ["cmd_portfolio"]
    }],
    swimlanes: [{ id: "lane_graph", title: "All", status: "in_progress", task_ids: ["task_a"] }]
  };
  const portfolioView = buildManagementCommandCenterViewModel({
    management: allProjectsOnly,
    taskGraph: baseTaskGraph,
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  assert.equal(portfolioView.ok, true);
  assert.equal(portfolioView.commands.length, 1);
  assert.equal(portfolioView.projects.length, 1);
  assert.equal(portfolioView.swimlanes[0].tasks[0].source, "task_graph_task");

  const noPermissionManagement = structuredClone(assignedManagement);
  noPermissionManagement.roles[0].permissions = [];
  const noPermissionView = buildManagementCommandCenterViewModel({
    management: noPermissionManagement,
    taskGraph: baseTaskGraph,
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  assert.equal(noPermissionView.ok, false);
  assert.equal(noPermissionView.swimlanes[0].tasks.length, 0);

  noPermissionManagement.execution_tasks = [
    {
      id: "task_hidden_execution",
      command_id: "cmd_hidden",
      project_id: "project_hidden",
      title: "Hidden execution",
      status: "in_progress",
      owner_actor_type: "pm_agent",
      owner_actor_id: "pm_agent_ops",
      source_agent_id: "pm_agent_ops",
      acceptance_criteria: "Should stay hidden.",
      progress_percent: 10
    }
  ];
  noPermissionManagement.swimlanes = [{ id: "lane_hidden", title: "Hidden", status: "in_progress", task_ids: ["task_hidden_execution"] }];
  const noPermissionExecutionView = buildManagementCommandCenterViewModel({
    management: noPermissionManagement,
    taskGraph: baseTaskGraph,
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  assert.equal(noPermissionExecutionView.swimlanes[0].tasks.length, 0);
});

test("management command center keeps visible execution commands and gap-linked TaskGraph work", () => {
  const hiddenCommandManagement = structuredClone(p1FixtureState.raw.management);
  hiddenCommandManagement.active_user_id = "sales_agent_001";
  const weeklyCommand = hiddenCommandManagement.commands.find((command) => command.id === "cmd_weekly_pipeline_review");
  weeklyCommand.delegation_chain = weeklyCommand.delegation_chain.filter((item) => item.actor_id !== "sales_agent_001");
  const visibleExecutionView = buildManagementCommandCenterViewModel({
    management: hiddenCommandManagement,
    taskGraph: p1FixtureState.raw.taskGraph,
    gaps: p1FixtureState.raw.gaps,
    evidence: p1FixtureState.raw.evidence,
    bridgePreview: {}
  });
  const executionTask = visibleExecutionView.swimlanes.flatMap((lane) => lane.tasks)
    .find((task) => task.source === "management_execution_task");
  assert.equal(executionTask.command.id, "cmd_weekly_pipeline_review");
  assert.equal(executionTask.command.title, "每周一自动巡检销售与交付风险");

  const gapLinkedManagement = {
    roles: [{
      id: "role_gap_owner",
      name: "Gap Owner",
      user_id: "user_gap_owner",
      role_type: "worker",
      permissions: ["view_assigned_work"],
      default_view: "assigned_work"
    }],
    active_user_id: "user_gap_owner",
    commands: [],
    execution_tasks: [],
    execution_updates: [],
    projects: [],
    swimlanes: [{ id: "lane_gap", title: "Gap-linked", status: "needs_info", task_ids: ["task_gap_linked"] }]
  };
  const gapLinkedView = buildManagementCommandCenterViewModel({
    management: gapLinkedManagement,
    taskGraph: {
      ...baseTaskGraph,
      tasks: [{
        ...baseTaskGraph.tasks[0],
        id: "task_gap_linked",
        owner_actor_id: "other_user",
        information_gap_ids: ["gap_for_user_gap_owner"]
      }]
    },
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  assert.equal(gapLinkedView.swimlanes[0].tasks[0].id, "task_gap_linked");
  assert.equal(gapLinkedView.swimlanes[0].tasks[0].source, "task_graph_task");
});

test("view models keep empty optional collections usable for partial states", () => {
  const taskGraph = buildTaskGraphViewModel({
    taskGraph: {
      id: "tg_partial",
      run_id: "run_partial",
      version: 1,
      status: "active",
      tasks: [{
        id: "task_partial",
        title: "Partial task",
        status: "pending",
        owner_actor_type: "human",
        owner_actor_id: "user_partial",
        acceptance_criteria: "Stay visible."
      }]
    },
    evidence: [],
    gaps: []
  });
  assert.deepEqual(taskGraph.tasks[0].depends_on, []);
  assert.deepEqual(taskGraph.tasks[0].evidence, []);
  assert.deepEqual(taskGraph.tasks[0].information_gaps, []);

  const managementView = buildManagementCommandCenterViewModel({
    management: {
      roles: [{
        id: "role_exec",
        name: "Exec",
        user_id: "user_exec",
        role_type: "executive",
        permissions: ["view_management_dashboard"],
        default_view: "management_command_center"
      }],
      active_user_id: "user_exec",
      commands: [{
        id: "cmd_partial",
        title: "Partial command",
        status: "active",
        trigger_type: "manual",
        objective: "Keep partial command visible.",
        target_agent_id: "pm_agent_ops",
        task_graph_id: "tg_partial",
        project_id: "project_missing",
        created_at: "2026-05-26T10:00:00+08:00"
      }],
      projects: [{
        id: "project_partial",
        name: "Partial project",
        owner_role_id: "missing_role",
        command_ids: ["cmd_partial"]
      }],
      execution_tasks: [{
        id: "task_exec_partial",
        command_id: "cmd_partial",
        project_id: "project_partial",
        title: "Execution partial",
        status: "in_progress",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Keep execution task visible.",
        progress_percent: 20
      }],
      execution_updates: [],
      swimlanes: [{ id: "lane_partial", title: "Partial", status: "in_progress" }]
    },
    taskGraph: { id: "tg_partial", tasks: [] },
    gaps: null,
    evidence: null,
    bridgePreview: null
  });
  assert.equal(managementView.summary.bridge_org_task_count, 0);
  assert.equal(managementView.commands[0].generated_task_count, 0);
  assert.equal(managementView.commands[0].project, null);
  assert.deepEqual(managementView.commands[0].delegation_chain, []);
  assert.equal(managementView.projects[0].owner, null);
  assert.deepEqual(managementView.swimlanes[0].tasks, []);
});

test("management view model covers execution task display fallbacks", () => {
  const management = {
    roles: [{
      id: "role_exec",
      name: "Exec",
      user_id: "user_exec",
      role_type: "executive",
      permissions: ["view_management_dashboard"],
      default_view: "management_command_center"
    }],
    active_user_id: "user_exec",
    commands: [],
    execution_tasks: [
      {
        id: "task_no_update",
        command_id: "cmd_absent",
        project_id: "project_absent",
        title: "No update task",
        status: "in_progress",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "No update fallback.",
        progress_percent: 30
      },
      {
        id: "task_with_due",
        command_id: "cmd_absent",
        project_id: "project_absent",
        title: "Due task",
        status: "review",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Due date and evidence count.",
        due_at: "2026-06-02T10:00:00+08:00",
        progress_percent: 90,
        evidence_ids: ["ev_1"]
      }
    ],
    execution_updates: [],
    projects: [],
    swimlanes: [{
      id: "lane_exec",
      title: "Execution",
      status: "in_progress",
      task_ids: ["task_no_update", "task_with_due"]
    }]
  };
  const view = buildManagementCommandCenterViewModel({
    management,
    taskGraph: { id: "tg_exec", tasks: [] },
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  const tasks = view.swimlanes[0].tasks;
  assert.equal(tasks[0].command, null);
  assert.equal(tasks[0].latest_update, null);
  assert.equal(tasks[0].due_at, null);
  assert.equal(tasks[0].evidence_count, 0);
  assert.equal(tasks[1].due_at, "2026-06-02T10:00:00+08:00");
  assert.equal(tasks[1].evidence_count, 1);

  const nonCreator = buildManagementCommandDispatchPreview({
    management: {
      roles: [{
        id: "role_viewer",
        name: "Viewer",
        user_id: "user_viewer",
        role_type: "viewer",
        permissions: [],
        default_view: "assigned_work"
      }],
      active_user_id: "user_viewer",
      projects: []
    },
    commandInput: { title: "Viewer command" },
    taskGraph: { id: "tg_viewer" }
  });
  assert.equal(nonCreator.command.delegation_chain[0].actor_id, "unknown");

  const noRoleView = buildManagementCommandCenterViewModel({
    management: {
      roles: [],
      active_user_id: "nobody",
      commands: [],
      projects: [],
      execution_tasks: [{
        id: "task_hidden",
        command_id: "cmd_hidden",
        project_id: "project_hidden",
        title: "Hidden task",
        status: "in_progress",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Hidden without role.",
        progress_percent: 20
      }],
      execution_updates: [],
      swimlanes: [{
        id: "lane_hidden",
        title: "Hidden",
        status: "in_progress",
        task_ids: ["task_hidden", "task_graph_hidden"]
      }]
    },
    taskGraph: {
      id: "tg_hidden",
      tasks: [{
        id: "task_graph_hidden",
        title: "Graph hidden",
        status: "pending",
        owner_actor_type: "human",
        owner_actor_id: "user_hidden",
        acceptance_criteria: "Hidden graph task."
      }]
    },
    gaps: [],
    evidence: [],
    bridgePreview: {}
  });
  assert.equal(noRoleView.swimlanes[0].tasks.length, 0);
});

test("operating console role action queue respects assigned-work visibility", () => {
  const management = structuredClone(p1FixtureState.raw.management);
  management.active_user_id = "sales_agent_001";
  const viewModel = buildOperatingConsoleViewModel({
    taskGraph: p1FixtureState.raw.taskGraph,
    gateChecks: p1FixtureState.raw.gateChecks,
    mirrors: p1FixtureState.raw.mirrors,
    writebackIntents: p1FixtureState.raw.writebackIntents,
    gaps: p1FixtureState.raw.gaps,
    management
  });

  assert.equal(viewModel.active_role.user_id, "sales_agent_001");
  assert.ok(viewModel.role_action_queue.length >= 1);
  assert.ok(viewModel.role_action_queue.some((action) =>
    action.source_type === "management_execution_task" &&
    action.owner.id === "sales_agent_001"
  ));
  assert.equal(viewModel.role_action_queue.some((action) =>
    action.source_type === "management_execution_task" &&
    action.owner.id === "delivery_agent_001"
  ), false);
});

test("operating console action queue survives missing management and source metadata", () => {
  const noManagementView = buildOperatingConsoleViewModel({
    taskGraph: {
      id: "tg_no_management",
      run_id: "run_no_management",
      status: "active",
      tasks: [{ id: "task_a", status: "pending" }]
    },
    gateChecks: [
      {
        id: "sgc_owner_only",
        opportunity_id: "opp_owner",
        stage: "discover",
        gate_id: "D-G1",
        status: "missing",
        owner_id: "user_missing",
        updated_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    mirrors: [{ id: "mirror_stale", freshness: "stale", provider: "hubspot", object_type: "deal", external_id: "deal_1" }],
    writebackIntents: [{ id: "wbi_manual", policy_decision: "needs_confirmation", risk_level: "low", provider: "hubspot", operation: "create_note" }],
    gaps: [{ id: "gap_hidden", status: "open", collector_actor_id: "user_missing", question: "Hidden?", reason: "No active role." }],
    management: null
  });
  assert.equal(noManagementView.active_role, null);
  assert.equal(noManagementView.role_action_queue.length, 0);

  const dashboardView = buildOperatingConsoleViewModel({
    taskGraph: {
      id: "tg_dashboard",
      run_id: "run_dashboard",
      status: "active",
      tasks: [{ id: "task_a", status: "pending" }]
    },
    gateChecks: [],
    mirrors: [],
    writebackIntents: [{
      id: "wbi_unknown_agent",
      system_type: "crm",
      provider: "hubspot",
      operation: "create_note",
      target: { object_type: "deal", external_id: "deal_1" },
      risk_level: "low",
      policy_decision: "needs_confirmation"
    }],
    gaps: [],
    management: {
      active_user_id: "user_exec",
      roles: [{
        id: "role_exec",
        name: "Exec",
        user_id: "user_exec",
        role_type: "executive",
        permissions: ["view_management_dashboard"],
        default_view: "management_command_center"
      }],
      commands: [],
      projects: [],
      execution_tasks: [],
      execution_updates: []
    }
  });
  const writebackAction = dashboardView.role_action_queue.find((action) => action.source_type === "external_writeback_intent");
  assert.equal(writebackAction.owner.id, "unknown");
  assert.equal(writebackAction.due_at, null);
  assert.equal(writebackAction.priority, "medium");
});

test("operating console action queue covers fallback reasons, related records, and visibility guards", () => {
  const management = {
    active_user_id: "user_exec",
    roles: [{
      id: "role_exec",
      name: "Exec",
      user_id: "user_exec",
      role_type: "executive",
      permissions: ["view_management_dashboard"],
      default_view: "management_command_center"
    }],
    commands: [{
      id: "cmd_related",
      title: "Related command",
      status: "active",
      trigger_type: "manual",
      objective: "Command objective fallback.",
      target_agent_id: "pm_agent_ops",
      task_graph_id: "tg_related",
      project_id: "project_related",
      generated_task_ids: ["task_with_command"],
      delegation_chain: [],
      created_at: "2026-05-26T10:00:00+08:00"
    }],
    projects: [{
      id: "project_related",
      name: "Related project",
      owner_role_id: "role_exec",
      task_graph_id: "tg_related",
      command_ids: ["cmd_related"]
    }],
    execution_updates: [{
      id: "update_reason",
      task_id: "task_with_update",
      update_type: "progress",
      actor_type: "pm_agent",
      actor_id: "pm_agent_ops",
      message: "Update reason fallback.",
      progress_percent: 30,
      created_at: "2026-05-26T10:00:00+08:00"
    }],
    execution_tasks: [
      {
        id: "task_with_update",
        command_id: "cmd_missing",
        project_id: "project_missing",
        title: "BBB update reason",
        status: "review",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        latest_update_id: "update_reason",
        acceptance_criteria: "Update reason should win.",
        progress_percent: 80
      },
      {
        id: "task_with_command",
        command_id: "cmd_related",
        project_id: "project_related",
        title: "CCC command reason",
        status: "delegated",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Command objective should win.",
        progress_percent: 0
      },
      {
        id: "task_criteria_only",
        command_id: "cmd_absent",
        project_id: "project_absent",
        title: "DDD criteria reason",
        status: "assigned",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        source_agent_id: "pm_agent_ops",
        acceptance_criteria: "Criteria fallback only."
      }
    ],
    swimlanes: []
  };
  const viewModel = buildOperatingConsoleViewModel({
    taskGraph: { id: "tg_related", run_id: "run_related", status: "active", tasks: [] },
    gateChecks: [],
    mirrors: [],
    writebackIntents: [{
      id: "wbi_high",
      system_type: "crm",
      provider: "hubspot",
      operation: "update_field",
      target: { object_type: "deal", external_id: "deal_1" },
      risk_level: "high",
      policy_decision: "needs_confirmation",
      created_at: "2026-05-24T10:00:00+08:00",
      source: { agent_id: "pm_agent_sales" }
    }],
    gaps: [{
      id: "gap_unlinked",
      status: "open",
      collector_actor_id: "user_exec",
      question: "Unlinked gap?",
      reason: "No task record.",
      expected_evidence_types: ["meeting_summary"]
    }],
    management
  });

  assert.ok(viewModel.role_action_queue.some((action) =>
    action.id === "management:task_with_update" &&
    action.reason === "Update reason fallback." &&
    action.related.command_id === "cmd_missing" &&
    action.related.project_id === "project_missing"
  ));
  assert.ok(viewModel.role_action_queue.some((action) =>
    action.id === "management:task_with_command" &&
    action.reason === "Command objective fallback." &&
    action.related.command_title === "Related command" &&
    action.related.project_name === "Related project"
  ));
  assert.ok(viewModel.role_action_queue.some((action) =>
    action.id === "management:task_criteria_only" &&
    action.reason === "Criteria fallback only."
  ));
  assert.ok(viewModel.role_action_queue.some((action) =>
    action.id === "gap:gap_unlinked" &&
    action.related.task_id === undefined &&
    action.related.task_title === null
  ));
  assert.ok(viewModel.role_action_queue.some((action) => action.id === "writeback:wbi_high" && action.priority === "high"));

  const workerManagement = {
    active_user_id: "user_worker",
    roles: [{
      id: "role_worker",
      name: "Worker",
      user_id: "user_worker",
      role_type: "worker",
      permissions: ["view_assigned_work"],
      default_view: "assigned_work"
    }],
    commands: [],
    projects: [],
    execution_tasks: [],
    execution_updates: []
  };
  const workerView = buildOperatingConsoleViewModel({
    taskGraph: { id: "tg_worker", run_id: "run_worker", status: "active", tasks: [] },
    gateChecks: [{ id: "sgc_hidden", status: "missing", owner_id: "someone_else" }],
    mirrors: [{ id: "mirror_hidden", freshness: "stale" }],
    writebackIntents: [{ id: "wbi_hidden", policy_decision: "needs_confirmation" }],
    gaps: [{ id: "gap_hidden", status: "open", collector_actor_id: "someone_else" }],
    management: workerManagement
  });
  assert.equal(workerView.role_action_queue.length, 0);
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

test("management dispatch preview applies defaults for manual, scheduled, and non-ascii titles", () => {
  const manual = buildManagementCommandDispatchPreview({
    management: p1FixtureState.raw.management,
    commandInput: {},
    taskGraph: p1FixtureState.raw.taskGraph
  });
  assert.equal(manual.ok, true);
  assert.equal(manual.command.id, "cmd_preview_management_command");
  assert.equal(manual.command.status, "delegated");
  assert.equal(manual.command.project_id, p1FixtureState.raw.management.projects[0].id);
  assert.equal(manual.command.schedule, undefined);
  assert.equal(manual.command.condition, undefined);

  const scheduled = buildManagementCommandDispatchPreview({
    management: p1FixtureState.raw.management,
    commandInput: {
      title: "例行检查",
      trigger_type: "scheduled"
    },
    taskGraph: p1FixtureState.raw.taskGraph
  });
  assert.equal(scheduled.command.id, "cmd_preview_command");
  assert.equal(scheduled.command.status, "scheduled");
  assert.equal(scheduled.command.schedule.kind, "weekly");
  assert.equal(scheduled.command.condition, undefined);
});

test("management dispatch preview falls back when roles, project, and boss role are absent", () => {
  const creatorWithoutUserId = buildManagementCommandDispatchPreview({
    management: {
      active_user_id: "missing_user_id",
      roles: [{
        id: "role_creator_without_user",
        name: "Creator Without User",
        role_type: "executive",
        permissions: ["create_command"],
        default_view: "management_command_center"
      }],
      projects: []
    },
    commandInput: {
      title: "Creator missing user id"
    },
    taskGraph: { id: "tg_creator_without_user" }
  });
  assert.equal(creatorWithoutUserId.ok, true);
  assert.equal(creatorWithoutUserId.command.delegation_chain[0].actor_id, "unknown");

  const preview = buildManagementCommandDispatchPreview({
    management: {
      active_user_id: "nobody",
      roles: [],
      projects: []
    },
    commandInput: {
      title: "No creator",
      trigger_type: "condition"
    },
    taskGraph: { id: "tg_no_creator" }
  });

  assert.equal(preview.ok, false);
  assert.equal(preview.command.created_by_role_id, null);
  assert.equal(preview.command.project_id, undefined);
  assert.equal(preview.command.delegation_chain[0].actor_id, "unknown");
  assert.equal(preview.command.condition.signal, "task_graph.blocked_count");
  assert.match(preview.warnings.join("\n"), /cannot create/);
});

test("legacy JueYing v1 integration detects mainline capabilities", () => {
  const report = inspectJueyingV1Integration();
  assert.equal(report.ok, true);
  assert.equal(assertJueyingV1Integration(report), report);
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

test("legacy integration reports missing, partial, malformed, and empty legacy roots", () => {
  const missingReport = inspectJueyingV1Integration({ legacyRoot: join(tmpdir(), `missing-jueying-${Date.now()}`) });
  assert.equal(missingReport.ok, false);
  assert.equal(missingReport.legacy_package, null);
  assert.ok(missingReport.totals.missing_count > 0);
  assert.throws(() => assertJueyingV1Integration(missingReport), /legacy package\.json not found/);

  const tempDir = mkdtempSync(join(tmpdir(), "jueying-legacy-"));
  const legacyRoot = join(tempDir, "agent-harness");
  try {
    mkdirSync(join(legacyRoot, "services", "workflow", "src"), { recursive: true });
    writeFileSync(join(legacyRoot, "package.json"), "{bad json", "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "src", "index.ts"), "export {};\n", "utf8");
    const malformed = inspectJueyingV1Integration({ legacyRoot });
    assert.equal(malformed.legacy_package, null);
    assert.ok(malformed.capabilities.some((capability) => capability.status === "partial"));
    assert.throws(() => assertJueyingV1Integration(malformed), /one or more critical/);

    writeFileSync(join(legacyRoot, "package.json"), JSON.stringify({
      name: "mini-legacy",
      version: "0.0.1",
      workspaces: ["services/*"],
      scripts: {}
    }), "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "package.json"), JSON.stringify({
      name: "workflow",
      version: "0.0.1",
      scripts: { build: "tsc" },
      dependencies: { "@types/node": "latest" },
      optionalDependencies: { sharp: "latest" }
    }), "utf8");
    const partial = inspectJueyingV1Integration({ legacyRoot });
    const workflow = partial.capabilities.find((capability) => capability.id === "mainline.workflow");
    assert.equal(partial.legacy_package.name, "mini-legacy");
    assert.equal(workflow.status, "partial");
    assert.ok(workflow.issues.some((message) => message.includes("missing package script")));
    assert.ok(workflow.issues.some((message) => message.includes("missing required path")));
    assert.ok(workflow.warnings.some((message) => message.includes("missing optional path")));
    assert.equal(workflow.required_paths.find((item) => item.path.endsWith("index.ts")).kind, "file");
    assert.deepEqual(workflow.package.dependencies, ["@types/node"]);
    assert.deepEqual(workflow.package.optional_dependencies, ["sharp"]);

    mkdirSync(join(legacyRoot, "libs", "shared", "src", "db"), { recursive: true });
    writeFileSync(join(legacyRoot, "libs", "shared", "src", "db", "schema.ts"), "pgTable('workflow_instance', {})\n", "utf8");
    const withSchema = inspectJueyingV1Integration({ legacyRoot });
    assert.equal(withSchema.capabilities.find((capability) => capability.id === "mainline.workflow").data_objects[0].exists, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const emptyView = buildLegacyIntegrationViewModel({
    ok: false,
    integration_id: "empty",
    legacy_root: join(process.cwd(), "..", "outside-root"),
    totals: { route_count: 0, data_object_count: 0, bridge_contract_count: 0 },
    capabilities: [],
    service_runtime: [],
    bridge_contracts: [],
    cutover_plan: [],
    phases: [],
    issues: [],
    warnings: []
  });
  assert.equal(emptyView.summary.ready_percent, 0);
  assert.match(emptyView.summary.legacy_root, /outside-root/);
});

test("legacy integration helpers handle absent runtime and package defaults", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "jueying-package-defaults-"));
  const legacyRoot = join(tempDir, "agent-harness");
  try {
    mkdirSync(join(legacyRoot, "apps", "web-portal"), { recursive: true });
    writeFileSync(join(legacyRoot, "package.json"), JSON.stringify({
      name: "package-defaults",
      version: "0.0.1"
    }), "utf8");
    writeFileSync(join(legacyRoot, "apps", "web-portal", "package.json"), JSON.stringify({
      name: "web-portal",
      version: "0.0.1"
    }), "utf8");
    const report = inspectJueyingV1Integration({ legacyRoot });
    assert.deepEqual(report.legacy_package.workspaces, []);
    assert.deepEqual(report.legacy_package.scripts, []);
    assert.ok(report.capabilities.some((capability) => capability.package?.scripts));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const emptyCatalog = buildLegacyRuntimeHealthCatalog({});
  assert.equal(emptyCatalog.ok, false);
  assert.equal(emptyCatalog.service_count, 0);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw "offline-string";
    };
    const health = await checkLegacyRuntimeHealth({
      service_runtime: [{
        service_name: "svc-string-error",
        url_env: "JUEYING_STRING_ERROR_URL",
        default_url: "http://string-error.test",
        health_path: "/health",
        capabilities: []
      }]
    });
    assert.equal(health.timeout_ms, 600);
    assert.equal(health.services[0].status, "offline");
    assert.equal(health.services[0].error, "offline-string");

    const noServices = await checkLegacyRuntimeHealth({});
    assert.equal(noServices.ok, true);
    assert.equal(noServices.service_count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy integration helper branches cover root packages, empty errors, and display paths", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "jueying-helper-branches-"));
  const legacyRoot = join(tempDir, "agent-harness");
  try {
    mkdirSync(join(legacyRoot, "root-package"), { recursive: true });
    writeFileSync(join(legacyRoot, "root-package", "package.json"), JSON.stringify({
      name: "root-package",
      version: "0.0.1"
    }), "utf8");
    writeFileSync(join(legacyRoot, "root-package-file"), "not a directory\n", "utf8");
    mkdirSync(join(legacyRoot, "services", "workflow", "src"), { recursive: true });
    mkdirSync(join(legacyRoot, "libs", "contracts", "src"), { recursive: true });
    mkdirSync(join(legacyRoot, "services", "workflow", "src", "engine"), { recursive: true });
    mkdirSync(join(legacyRoot, "services", "workflow", "src", "planner"), { recursive: true });
    mkdirSync(join(legacyRoot, "services", "workflow", "src", "checkpoint"), { recursive: true });
    mkdirSync(join(legacyRoot, "services", "workflow", "src", "supervisor"), { recursive: true });
    writeFileSync(join(legacyRoot, "package.json"), JSON.stringify({
      name: "helper-root",
      version: "0.0.1",
      workspaces: ["root-package", "root-package-file", "services/*"]
    }), "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "package.json"), JSON.stringify({
      name: "workflow",
      version: "0.0.1",
      scripts: {
        build: "tsc",
        "type-check": "tsc --noEmit"
      }
    }), "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "src", "index.ts"), "export {};\n", "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "src", "engine", "workflow-machine.ts"), "export {};\n", "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "src", "planner", "planner.ts"), "export {};\n", "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "src", "planner", "plan-validator.ts"), "export {};\n", "utf8");
    writeFileSync(join(legacyRoot, "services", "workflow", "src", "checkpoint", "manager.ts"), "export {};\n", "utf8");
    mkdirSync(join(legacyRoot, "services", "workflow", "src", "supervisor", "manager.ts"), { recursive: true });
    writeFileSync(join(legacyRoot, "libs", "contracts", "src", "workflow-types.ts"), "export {};\n", "utf8");

    const report = inspectJueyingV1Integration({ legacyRoot });
    const workflow = report.capabilities.find((capability) => capability.id === "mainline.workflow");
    assert.equal(workflow.package.path, "services/workflow");
    assert.ok(workflow.required_paths.some((item) => item.kind === "file"));
    assert.ok(workflow.required_paths.some((item) =>
      item.path.endsWith("supervisor/manager.ts") &&
      item.kind === "directory" &&
      item.exists === true
    ));
    assert.ok(report.totals.partial_count >= 0);

    assert.equal(assertJueyingV1Integration({
      ok: true,
      legacy_root: join(process.cwd(), "..", "jueying-helper-outside-root"),
      legacy_package: { name: "ok" },
      issues: []
    }).ok, true);

    assert.throws(() => assertJueyingV1Integration({
      ok: true,
      legacy_root: legacyRoot,
      legacy_package: { name: "broken" },
      issues: [{ capability_id: "cap", message: "broken" }]
    }), /cap: broken/);
    const outsideView = buildLegacyIntegrationViewModel({
      ok: true,
      integration_id: "outside",
      legacy_root: "C:\\outside-root\\agent-harness",
      totals: { route_count: 0, data_object_count: 0, bridge_contract_count: 0 },
      capabilities: [{ id: "unknown", critical: false, status: "weird" }],
      service_runtime: [],
      bridge_contracts: [],
      cutover_plan: [],
      phases: [],
      issues: [],
      warnings: []
    });
    assert.equal(outsideView.summary.status_counts.weird, 1);
    assert.match(outsideView.summary.legacy_root, /outside-root/);

    const emptyGraphPayload = taskGraphToLegacyWorkflowPlan({
      id: "tg_empty",
      run_id: "run_empty",
      version: 1,
      status: "active",
      tasks: []
    });
    assert.equal(emptyGraphPayload.context.stage_chain.length, 0);

    const missingTasksPayload = taskGraphToLegacyWorkflowPlan({
      id: "tg_missing_tasks",
      run_id: "run_missing_tasks",
      version: 1,
      status: "active"
    });
    assert.equal(missingTasksPayload.context.stage_chain.length, 0);

    const noWorkspaceReport = inspectJueyingV1Integration({
      legacyRoot: join(tempDir, "agent-harness", "missing-workspace-root")
    });
    assert.equal(noWorkspaceReport.legacy_package, null);

    const grouped = buildLegacyIntegrationViewModel({
      ok: true,
      integration_id: "grouped",
      legacy_root: legacyRoot,
      totals: { route_count: 0, data_object_count: 0, bridge_contract_count: 0 },
      capabilities: [
        { id: "mainline.workflow", critical: true, status: "adapter_ready" },
        { id: "unknown_status", critical: false }
      ],
      service_runtime: [],
      bridge_contracts: [],
      cutover_plan: [],
      phases: [],
      issues: [],
      warnings: []
    });
    assert.equal(grouped.capability_groups[0].capabilities.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("legacy integration tolerates unreadable workspace directories", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "jueying-unreadable-workspace-"));
  const legacyRoot = join(tempDir, "agent-harness");
  mkdirSync(join(legacyRoot, "apps"), { recursive: true });
  writeFileSync(join(legacyRoot, "package.json"), JSON.stringify({
    name: "unreadable-legacy",
    version: "0.0.1",
    workspaces: ["apps/*"]
  }), "utf8");

  const originalStatSync = fs.statSync;
  fs.statSync = function patchedStatSync(path, ...args) {
    if (String(path).endsWith(join("agent-harness", "apps"))) {
      throw new Error("workspace directory cannot be inspected");
    }
    return originalStatSync.call(this, path, ...args);
  };
  syncBuiltinESMExports();

  try {
    const report = inspectJueyingV1Integration({ legacyRoot });
    assert.equal(report.legacy_package.name, "unreadable-legacy");
    assert.equal(report.capabilities.every((capability) => capability.package === null), true);
  } finally {
    fs.statSync = originalStatSync;
    syncBuiltinESMExports();
    rmSync(tempDir, { recursive: true, force: true });
  }
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

test("legacy bridge preview handles absent TaskGraph and writeback decision outcomes", () => {
  const preview = buildLegacyBridgePreview({
    taskGraph: null,
    gaps: [
      {
        id: "gap_closed",
        task_id: "task_a",
        status: "closed",
        question: "Closed gap?",
        reason: "Should not dispatch.",
        collector_actor_id: "human_twin_andy",
        required_schema: {},
        expected_evidence_types: ["meeting_summary"],
        priority: "low",
        created_at: "2026-05-26T10:00:00+08:00"
      },
      {
        id: "gap_open",
        task_id: "task_a",
        status: "open",
        question: "Open gap?",
        reason: "Should dispatch.",
        collector_actor_id: "human_twin_andy",
        required_schema: {},
        expected_evidence_types: [],
        priority: "low",
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    evidence: [
      {
        id: "ev_default_confidence",
        evidence_type: "sales_note",
        source_type: "human",
        source_actor_id: "user_sales",
        capture_channel: "crm",
        content_ref: { kind: "text", value: "Plain note" },
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    writebackIntents: [
      {
        id: "wbi_reject",
        connection_id: "conn_crm",
        system_type: "crm",
        provider: "hubspot",
        target: { object_type: "opportunity", external_id: "deal_1" },
        operation: "create_note",
        payload: { body: "No" },
        source: { agent_id: "pm_agent_sales", reason: "Audit" },
        risk_level: "low",
        idempotency_key: "reject-writeback",
        policy_decision: "needs_confirmation",
        confirmed_by: "user_exec",
        created_at: "2026-05-26T10:00:00+08:00"
      }
    ],
    writebackDecisions: [
      { intent_id: "wbi_reject", decision: "reject", reasons: ["bad target"] }
    ]
  });

  assert.equal(preview.ok, false);
  assert.equal(preview.workflow_plan_payload, null);
  assert.equal(preview.summary.workflow_stage_count, 0);
  assert.equal(preview.summary.org_task_payload_count, 1);
  assert.equal(preview.summary.fact_write_payload_count, 1);
  assert.equal(preview.fact_write_payloads[0].payload.confidence, 0.72);
  assert.equal(preview.audit_event_payloads[0].payload.result, "failure");
});

test("legacy runtime health returns bounded service checks", async () => {
  const health = await checkLegacyRuntimeHealth(inspectJueyingV1Integration(), { timeoutMs: 20 });
  assert.ok(health.service_count >= 5);
  assert.equal(Array.isArray(health.services), true);
  assert.ok(health.services.every((service) => typeof service.service_name === "string"));
});

test("legacy runtime health reports online and unhealthy services from fetch responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return new Response("ok", { status: calls.length === 1 ? 200 : 503 });
    };
    const report = {
      service_runtime: [
        {
          service_name: "svc-online",
          url_env: "JUEYING_TEST_ONLINE_URL",
          default_url: "http://online.test/",
          health_path: "/health",
          capabilities: ["cap.online"]
        },
        {
          service_name: "svc-unhealthy",
          url_env: "JUEYING_TEST_UNHEALTHY_URL",
          default_url: "http://unhealthy.test",
          health_path: "/health",
          capabilities: ["cap.unhealthy"]
        }
      ]
    };
    const health = await checkLegacyRuntimeHealth(report, { timeoutMs: 50 });
    assert.equal(health.ok, false);
    assert.equal(health.online_count, 1);
    assert.equal(health.services[0].status, "online");
    assert.equal(health.services[0].http_status, 200);
    assert.equal(health.services[1].status, "unhealthy");
    assert.equal(health.services[1].http_status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("TaskGraph legacy projection handles retrieval, generic executors, defaults, and next links", () => {
  const graph = {
    id: "tg_projection",
    run_id: "run_projection",
    version: 2,
    status: "active",
    autonomy_level: "L2",
    tasks: [
      {
        id: "task_retrieval",
        title: "Retrieve context",
        status: "pending",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        required_evidence: ["meeting_summary"],
        information_gap_ids: ["gap_001"],
        evidence_ids: [],
        acceptance_criteria: "Context is ready."
      },
      {
        id: "task_generic",
        title: "Generic agent work",
        status: "pending",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        required_evidence: [],
        information_gap_ids: [],
        evidence_ids: [],
        acceptance_criteria: "Work is ready."
      }
    ]
  };
  const payload = taskGraphToLegacyWorkflowPlan(graph);
  assert.equal(payload.user_id, "u_ai_native_ops");
  assert.equal(payload.user_goal, "Run AI-native TaskGraph tg_projection");
  assert.equal(payload.org_id, undefined);
  assert.equal(payload.context.stage_chain[0].stage_type, "Retrieval");
  assert.equal(payload.context.stage_chain[0].assigned_executor, "retrieval-aware-executor");
  assert.equal(payload.context.stage_chain[0].on_success, "task_generic");
  assert.equal(payload.context.stage_chain[1].stage_type, "Generic");
  assert.equal(payload.context.stage_chain[1].assigned_executor, "generic-executor");
  assert.equal(payload.context.stage_chain[1].on_success, "complete");
});

test("TaskGraph legacy projection tolerates sparse task fields and worker repair policy", () => {
  const payload = taskGraphToLegacyWorkflowPlan({
    id: "tg_sparse",
    run_id: "run_sparse",
    version: 1,
    status: "active",
    autonomy_level: "L2",
    tasks: [
      {
        id: "task_gap_only",
        title: "Gap-only retrieval",
        status: "pending",
        owner_actor_type: "pm_agent",
        owner_actor_id: "pm_agent_ops",
        information_gap_ids: ["gap_sparse"],
        acceptance_criteria: "Gap is handled."
      },
      {
        id: "task_worker",
        title: "Worker repair",
        status: "pending",
        owner_actor_type: "worker_agent",
        owner_actor_id: "worker_ops",
        acceptance_criteria: "Worker completes."
      }
    ]
  }, {
    user_role: "operator",
    user_goal: "Run sparse graph",
    task_type_hint: "support",
    risk_level: "low",
    policy_snapshot_hash: "sha256:custom",
    org_id: "org_001"
  });

  assert.equal(payload.user_role, "operator");
  assert.equal(payload.user_goal, "Run sparse graph");
  assert.equal(payload.task_type_hint, "support");
  assert.equal(payload.risk_level, "low");
  assert.equal(payload.policy_snapshot_hash, "sha256:custom");
  assert.equal(payload.context.stage_chain[0].stage_type, "Retrieval");
  assert.equal(payload.context.stage_chain[0].inputs.required_refs.length, 0);
  assert.equal(payload.context.stage_chain[0].retrieval_plan.enabled, true);
  assert.deepEqual(payload.context.stage_chain[0].acceptance.must_have, []);
  assert.deepEqual(payload.context.stage_chain[0].ai_native_refs.evidence_ids, []);
  assert.deepEqual(payload.context.stage_chain[0].ai_native_refs.external_refs, []);
  assert.equal(payload.context.stage_chain[1].retry_policy.max_repairs, 1);
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

test("legacy fact and audit projections keep safe fallbacks for sparse payloads", () => {
  const valueFact = evidenceToLegacyFactWrite({
    id: "ev_value_only",
    evidence_type: "status_note",
    source_type: "human",
    source_actor_id: "user_sales",
    capture_channel: "crm",
    task_id: "task_value",
    content_ref: { kind: "text", value: "Value only summary" },
    created_at: "2026-05-26T10:00:00+08:00"
  });
  assert.equal(valueFact.fact_text, "Value only summary");
  assert.equal(valueFact.subject_ref, "task_value");
  assert.deepEqual(valueFact.scope, ["private"]);

  const typeFact = evidenceToLegacyFactWrite({
    id: "ev_type_only",
    evidence_type: "system_snapshot",
    source_type: "system",
    source_actor_id: "system",
    capture_channel: "api",
    content_ref: {},
    created_at: "2026-05-26T10:00:00+08:00"
  }, {
    subject_ref: "custom_subject",
    predicate: "custom.predicate",
    scope: ["team"],
    mode: "upsert",
    evidence_pack_hash: "hash:custom"
  });
  assert.equal(typeFact.fact_text, "system_snapshot");
  assert.equal(typeFact.subject_ref, "custom_subject");
  assert.equal(typeFact.predicate, "custom.predicate");
  assert.deepEqual(typeFact.scope, ["team"]);
  assert.equal(typeFact.mode, "upsert");
  assert.equal(typeFact.evidence_refs[0].evidence_pack_hash, "hash:custom");

  const sourceFallbackAudit = writebackIntentToLegacyAuditEvent({
    id: "wbi_source_fallback",
    connection_id: "conn_pm",
    system_type: "project_management",
    provider: "jira",
    target: {},
    operation: "create_comment",
    payload: { body: "Fallback source" },
    source: { agent_id: "pm_agent_ops", reason: "Fallback source" },
    risk_level: "low",
    idempotency_key: "source-fallback",
    policy_decision: "auto_execute",
    created_at: "2026-05-26T10:00:00+08:00"
  });
  assert.equal(sourceFallbackAudit.user_id, "pm_agent_ops");
  assert.match(sourceFallbackAudit.resource_ref, /jira:undefined:undefined/);

  const systemFallbackAudit = writebackIntentToLegacyAuditEvent({
    id: "wbi_system_fallback",
    connection_id: "conn_pm",
    system_type: "project_management",
    provider: "jira",
    target: { object_type: "issue", external_id: "OPS-1" },
    operation: "create_comment",
    payload: { body: "Fallback system" },
    risk_level: "low",
    idempotency_key: "system-fallback",
    policy_decision: "auto_execute",
    created_at: "2026-05-26T10:00:00+08:00"
  });
  assert.equal(systemFallbackAudit.user_id, "system");
  assert.deepEqual(systemFallbackAudit.detail_json.reasons, []);
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

test("runtime client exposes health, progress query params, raw text, empty body, and unknown services", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/health/live")) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.includes("/progress")) {
      return new Response("not json", { status: 200 });
    }
    return new Response("", { status: 200 });
  };
  const client = createJueyingV1RuntimeClient({
    fetchImpl,
    timeoutMs: 100,
    workflowUrl: "http://workflow.test/",
    gatewayUrl: "http://gateway.test",
    factRetrievalUrl: "http://fact.test"
  });

  const health = await client.health();
  assert.equal(health.ok, false);
  assert.equal(health.checks.length, 3);
  assert.equal(health.checks.find((check) => check.service === "gateway").ok, false);
  assert.equal(health.checks.find((check) => check.service === "workflow").body, null);

  const progress = await client.readWorkflowProgress("workflow / 1", {
    owner_user_id: "user_001",
    acting_role: "admin",
    policy_snapshot_hash: "sha256:test"
  });
  assert.equal(progress.ok, true);
  assert.deepEqual(progress.body, { raw: "not json" });
  assert.match(progress.url, /workflow%20%2F%201\/progress\?owner_user_id=user_001&acting_role=admin&policy_snapshot_hash=sha256%3Atest/);

  const unknown = await client.request("missingService", "/health");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.degraded, true);
  assert.equal(unknown.error, "unknown_service");

  const internal = await client.get("workflow", "/internal/ping", { internal: true });
  assert.equal(internal.ok, true);
  assert.equal(internal.body, null);
  assert.equal(calls.some((url) => url.includes("/internal/ping")), true);
});

test("runtime client attaches internal headers for GET requests when a token exists", async () => {
  const calls = [];
  const client = createJueyingV1RuntimeClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    workflowUrl: "http://workflow.test",
    internalToken: "internal-token"
  });

  const result = await client.get("workflow", "/internal/secure", { internal: true });
  assert.equal(result.ok, true);
  assert.equal(calls[0].options.headers["x-internal-token"], "internal-token");
});

test("runtime client treats application ok false and success status mismatches as degraded", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/admin/tasks")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const client = createJueyingV1RuntimeClient({
    fetchImpl,
    timeoutMs: 100,
    workflowUrl: "http://workflow.test",
    gatewayUrl: "http://gateway.test"
  });

  const workflow = await client.createWorkflowFromTaskGraph(baseTaskGraph);
  assert.equal(workflow.ok, false);
  assert.equal(workflow.degraded, true);
  assert.deepEqual(workflow.response.body, { ok: false });

  const orgTask = await client.createOrgTaskFromInformationGap({
    id: "gap_001",
    task_id: "task_a",
    status: "open",
    question: "Need confirmation?",
    reason: "Evidence missing.",
    collector_actor_id: "human_twin_andy",
    required_schema: {},
    priority: "high",
    created_at: "2026-05-26T10:00:00+08:00"
  });
  assert.equal(orgTask.ok, false);
  assert.equal(orgTask.response.status, 200);
});

test("runtime client covers default constructor, no-query progress, request defaults, and non-error throws", async () => {
  const calls = [];
  const client = createJueyingV1RuntimeClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/throws-string")) {
        throw "string failure";
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    timeoutMs: 30,
    workflowUrl: "http://workflow.test"
  });

  const progress = await client.readWorkflowProgress("workflow-no-query");
  assert.equal(progress.ok, true);
  assert.match(progress.path, /workflow-no-query\/progress$/);

  const request = await client.request("workflow", "/internal/default-method");
  assert.equal(request.ok, true);
  assert.equal(calls.at(-1).options.method, "GET");

  const failed = await client.request("workflow", "/throws-string");
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "string failure");

  const defaultClient = createJueyingV1RuntimeClient();
  assert.equal(typeof defaultClient.fetchImpl, "function");
  assert.equal(defaultClient.timeoutMs, 3000);
  assert.match(defaultClient.endpoints.workflow, /127\.0\.0\.1/);
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

test("storyline acceptance reports missing roles, stories, gates, surfaces, fixtures, and bridge readiness", () => {
  const matrix = buildMinimalMatrix({
    id: "",
    action: "",
    expected_result: "",
    story_refs: ["SS-05A", "SS-99"],
    gate_refs: ["D-G99"],
    ui_surfaces: [],
    api_surfaces: ["/api/missing"],
    contract_refs: ["missingContract"],
    capability_domains: ["sales_six_step_gate_engine", "unknown_domain"],
    legacy_capabilities: ["mainline.workflow", "mainline.unknown"],
    external_systems: ["crm", "erp"],
    fixture_expectations: [
      { kind: "task_status", value: "missing_status" },
      { kind: "unknown_kind", value: "anything" }
    ],
    verification_modes: ["ui", "api", "contract", "legacy_bridge", "external_sync"]
  });
  matrix.roles[0].storylines[0].steps.push({
    id: "sales_no_gate",
    action: "Check a sales gate story.",
    expected_result: "The gate coverage is explicit.",
    story_refs: ["SS-05A"],
    gate_refs: [],
    ui_surfaces: ["overview"],
    api_surfaces: ["/health"],
    contract_refs: ["taskGraph"],
    capability_domains: ["task_graph_orchestration"],
    verification_modes: ["ui", "api", "contract"]
  });
  matrix.roles[0].id = "";
  matrix.roles[0].name = "";
  matrix.roles[0].primary_goal = "";
  matrix.roles.push({
    id: "empty_role",
    name: "Empty role",
    type: "human",
    primary_goal: "Needs a storyline.",
    storylines: []
  });
  matrix.roles[0].storylines[0].id = "";
  matrix.roles[0].storylines[0].title = "";
  matrix.roles[0].storylines.push({
    id: "empty_storyline",
    title: "Empty storyline",
    story_refs: ["SS-01"],
    steps: []
  });
  const legacyIntegration = inspectJueyingV1Integration();
  legacyIntegration.capabilities = legacyIntegration.capabilities.map((capability) =>
    capability.id === "mainline.workflow"
      ? { ...capability, status: "partial" }
      : capability
  );

  const report = buildRoleStorylineAcceptanceReport({
    matrix,
    scenarioCoverage: buildMinimalScenarioCoverage(),
    salesGateModel: {
      stages: {
        discover: {
          label: "Discover",
          gates: [{ id: "D-G1", label: "Gate", evidence_types: [] }]
        }
      }
    },
    legacyIntegration,
    state: p1FixtureState
  });
  const messages = report.issues.map((item) => item.message).join("\n");

  assert.equal(report.ok, false);
  assert.match(messages, /Required role is missing/);
  assert.match(messages, /Documented scenario story is not covered/);
  assert.match(messages, /Sales gate is not covered/);
  assert.match(messages, /Role id is required/);
  assert.match(messages, /name is required/);
  assert.match(messages, /primary_goal is required/);
  assert.match(messages, /must have at least one storyline/);
  assert.match(messages, /Storyline id is required/);
  assert.match(messages, /title is required/);
  assert.match(messages, /must have at least one step/);
  assert.match(messages, /Step\s+action is required/);
  assert.match(messages, /expected_result is required/);
  assert.match(messages, /references unknown story: SS-99/);
  assert.match(messages, /must reference at least one DEV-30 gate/);
  assert.match(messages, /references unknown sales gate: D-G99/);
  assert.match(messages, /unknown capability domain: unknown_domain/);
  assert.match(messages, /unimplemented API surface/);
  assert.match(messages, /unimplemented contract/);
  assert.match(messages, /legacy capability is not adapter_ready/);
  assert.match(messages, /unknown legacy capability/);
  assert.match(messages, /expects missing external mirror system: erp/);
  assert.match(messages, /expects missing writeback intent for system: erp/);
  assert.match(messages, /fixture expectation failed: task_status=missing_status/);
  assert.match(messages, /fixture expectation failed: unknown_kind=anything/);
  assert.match(messages, /has ui verification but no UI surface/);
});

test("storyline acceptance reports missing story refs, invalid ranges, and verification mode surface gaps", () => {
  const matrix = buildMinimalMatrix({
    story_refs: [["PD-02", "SS-03"]],
    ui_surfaces: ["overview"],
    api_surfaces: [],
    contract_refs: [],
    legacy_capabilities: [],
    external_systems: [],
    verification_modes: ["api", "contract", "legacy_bridge", "external_sync"]
  });
  const report = buildRoleStorylineAcceptanceReport({
    matrix,
    scenarioCoverage: buildMinimalScenarioCoverage(),
    salesGateModel: buildMinimalSalesGateModel(),
    legacyIntegration: inspectJueyingV1Integration(),
    state: p1FixtureState
  });
  const messages = report.issues.map((item) => item.message).join("\n");

  assert.equal(report.ok, false);
  assert.match(messages, /must reference at least one SS\/PD\/XS story/);
  assert.match(messages, /has api verification but no API surface/);
  assert.match(messages, /has contract verification but no contract refs/);
  assert.match(messages, /has legacy bridge verification but no legacy capabilities/);
  assert.match(messages, /has external sync verification but no external systems/);
});

test("storyline acceptance tolerates empty matrices, sparse coverage, fallback state, and odd refs", () => {
  const emptyReport = buildRoleStorylineAcceptanceReport({
    matrix: { version: "empty" },
    scenarioCoverage: {},
    salesGateModel: {},
    legacyIntegration: null,
    state: {}
  });
  assert.equal(emptyReport.ok, false);
  assert.equal(emptyReport.summary.role_count, 0);
  assert.equal(emptyReport.summary.step_count, 0);
  assert.ok(emptyReport.issues.some((item) => item.kind === "role_missing"));

  const sparseMatrix = {
    version: "sparse",
    roles: [{
      id: "executive_coo",
      name: "COO",
      type: "human",
      primary_goal: "Keep sparse data visible.",
      storylines: [{
        id: "story_sparse",
        title: "Sparse story",
        steps: [{
          id: "step_sparse",
          action: "Review sparse data.",
          expected_result: "Every missing reference is explicit.",
          story_refs: ["Noise SS-02 and PD-01", ["SS-05A", "SS-24B"], "XS-01..XS-02", 42],
          gate_refs: ["D-G1..D-G2", "bad", "Z-G1"],
          capability_domains: [],
          ui_surfaces: [],
          api_surfaces: [],
          contract_refs: [],
          fixture_expectations: [{ kind: "evidence_type", value: "meeting_summary" }]
        }]
      }]
    }]
  };
  const sparseReport = buildRoleStorylineAcceptanceReport({
    matrix: sparseMatrix,
    scenarioCoverage: {
      scenario_groups: {
        mixed: {
          story_ranges: { invalid: "PD-02..SS-03", sparse: "SS-02..SS-24B" }
        },
        anchors: {
          p1_anchor_stories: ["PD-01", "XS-01", "XS-02"]
        }
      }
    },
    salesGateModel: {
      stages: {
        discover: {
          gates: [
            { id: "D-G1", label: "Gate 1", evidence_types: [] },
            { id: "D-G2", label: "Gate 2", evidence_types: [] },
            { id: "D-G3", label: "Gate 3", evidence_types: [] }
          ]
        }
      }
    },
    legacyIntegration: null,
    state: { evidence: [{ evidence_type: "meeting_summary" }] }
  });
  assert.equal(sparseReport.summary.role_count, 1);
  assert.ok(sparseReport.coverage.covered_story_ids.includes("SS-05A"));
  assert.ok(sparseReport.coverage.covered_story_ids.includes("SS-24B"));
  assert.ok(sparseReport.coverage.covered_gate_ids.includes("D-G1"));
  assert.ok(sparseReport.coverage.covered_gate_ids.includes("D-G2"));
  assert.ok(sparseReport.issues.some((item) => /Sales gate is not covered/.test(item.message)));
});

test("storyline acceptance covers sparse role and reference edge cases", () => {
  const report = buildRoleStorylineAcceptanceReport({
    matrix: {
      version: "edge",
      roles: [
        {},
        {
          id: "role_unknown_storyline",
          name: "Unknown storyline role",
          type: "human",
          primary_goal: "Expose unknown storyline ids.",
          storylines: [{}]
        },
        {
          id: "role_unknown_step",
          name: "Unknown step role",
          type: "human",
          primary_goal: "Expose unknown step ids.",
          storylines: [{
            id: "story_unknown_step",
            title: "Unknown step",
            steps: [{}]
          }]
        },
        {
          id: "role_no_details",
          type: "human"
        },
        {
          id: "role_sparse_story",
          name: "Sparse story role",
          type: "human",
          primary_goal: "Expose sparse story problems.",
          storylines: [{
            id: "story_no_details"
          }]
        },
        {
          id: "role_sparse_step",
          name: "Sparse step role",
          type: "human",
          primary_goal: "Expose sparse step problems.",
          storylines: [{
            id: "story_sparse_step",
            title: "Sparse step",
            steps: [{
              id: "step_no_details",
              story_refs: ["SS-01..SS-01", "SS-24A..SS-24A", ["SS-02", ""], "bad-story"],
              gate_refs: ["bad-gate", "D-G1"]
            }]
          }]
        }
      ]
    },
    scenarioCoverage: {
      scenario_groups: {
        edge: {
          story_ranges: {
            mixed: "bad-story",
            valid: "SS-01..SS-02"
          },
          p1_anchor_stories: ["bad-story"]
        }
      }
    },
    salesGateModel: {
      stages: {
        discover: {
          gates: [
            { id: "bad-gate", label: "Bad", evidence_types: [] },
            { id: "D-G1", label: "Gate 1", evidence_types: [] }
          ]
        }
      }
    },
    legacyIntegration: null,
    state: {}
  });
  const messages = report.issues.map((item) => item.message).join("\n");

  assert.equal(report.ok, false);
  assert.match(messages, /name is required/);
  assert.match(messages, /primary_goal is required/);
  assert.match(messages, /must have at least one storyline/);
  assert.match(messages, /title is required/);
  assert.match(messages, /must have at least one step/);
  assert.match(messages, /action is required/);
  assert.match(messages, /expected_result is required/);
  assert.equal(report.coverage.documented_story_ids.includes("bad-story"), true);
  assert.ok(report.coverage.sales_gate_ids.includes("bad-gate"));
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
  assert.equal(report.summary.assertion_count, 671);
  assert.equal(report.summary.failed_assertion_count, 0);
  assert.equal(report.summary.external_sync_path_count, 9);
  assert.equal(report.summary.legacy_bridge_path_count, 7);
});

test("operation path assertions cover gate refs, write actions, and read-only steps", () => {
  const baseStep = {
    story_refs: ["SS-01"],
    ui_surfaces: ["overview"],
    api_surfaces: ["/health"],
    contract_refs: ["taskGraph"],
    capability_domains: ["task_graph_orchestration"],
    verification_modes: ["ui", "api", "contract"]
  };
  const matrix = buildMinimalMatrix();
  matrix.roles[0].storylines[0].steps = [
    {
      ...baseStep,
      id: "step_dispatch_command",
      action: "Dispatch a scheduled management command for the sales owner.",
      expected_result: "The command center can create_management_command for follow-up work.",
      gate_refs: ["D-G1..D-G2"]
    },
    {
      ...baseStep,
      id: "step_submit_evidence",
      action: "Submit Evidence that proves the champion was confirmed.",
      expected_result: "The evidence is available for the referenced gate.",
      gate_refs: ["D-G1"]
    },
    {
      ...baseStep,
      id: "step_reply_gap",
      action: "Reply to the information gap and rebut stale missing-data claims.",
      expected_result: "The gap reply is recorded for reviewer follow-up."
    },
    {
      ...baseStep,
      id: "step_writeback_decision",
      action: "Approve or reject the CRM writeback.",
      expected_result: "Both approve_writeback and reject_writeback actions are exposed."
    },
    {
      ...baseStep,
      id: "step_draft_connection",
      action: "Draft an external system connection configuration.",
      expected_result: "A draft_external_connection payload is ready for review."
    },
    {
      ...baseStep,
      id: "step_read_only",
      action: "Open the operations overview.",
      expected_result: "The current run health is visible without writing data."
    }
  ];

  const report = buildRoleOperationPathTestReport({
    matrix,
    scenarioCoverage: buildMinimalScenarioCoverage(),
    salesGateModel: loadSalesGateModel(),
    legacyIntegration: null,
    state: p1FixtureState
  });

  const assertionsForStep = (stepId) =>
    report.test_cases.find((testCase) => testCase.step_id === stepId).assertions.map((assertion) => assertion.id);

  assert.equal(report.ok, true);
  assert.deepEqual(
    assertionsForStep("step_dispatch_command").filter((id) => id.startsWith("gate_ref_")),
    ["gate_ref_D-G1", "gate_ref_D-G2"]
  );
  assert.ok(assertionsForStep("step_dispatch_command").includes("write_action_create_management_command"));
  assert.ok(assertionsForStep("step_submit_evidence").includes("write_action_submit_evidence"));
  assert.ok(assertionsForStep("step_reply_gap").includes("write_action_reply_or_rebut_information_gap"));
  assert.ok(assertionsForStep("step_writeback_decision").includes("write_action_approve_writeback"));
  assert.ok(assertionsForStep("step_writeback_decision").includes("write_action_reject_writeback"));
  assert.ok(assertionsForStep("step_draft_connection").includes("write_action_draft_external_connection"));
  assert.equal(assertionsForStep("step_read_only").some((id) => id.startsWith("write_action_")), false);
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

test("operation path report and view model surface failing assertions by role and storyline", () => {
  const matrix = buildMinimalMatrix({
    action: "",
    expected_result: "",
    ui_surfaces: ["overview", "missing_ui"],
    api_surfaces: ["/api/jueying/mainline/capabilities", "/api/missing"],
    contract_refs: ["taskGraph", "externalWritebackIntent", "missingContract"],
    gate_refs: ["D-G999"],
    external_systems: ["erp"],
    legacy_capabilities: ["mainline.workflow", "mainline.unknown"],
    fixture_expectations: [{ kind: "gap_status", value: "missing_status" }],
    verification_modes: ["ui", "api", "contract", "external_sync", "legacy_bridge"]
  });
  const legacyIntegration = inspectJueyingV1Integration();
  legacyIntegration.capabilities = legacyIntegration.capabilities.map((capability) =>
    capability.id === "mainline.workflow"
      ? { ...capability, status: "partial" }
      : capability
  );
  const report = buildRoleOperationPathTestReport({
    matrix,
    scenarioCoverage: buildMinimalScenarioCoverage(),
    salesGateModel: buildMinimalSalesGateModel(),
    legacyIntegration,
    state: {
      taskGraph: baseTaskGraph,
      gaps: [],
      evidence: [],
      gateChecks: [],
      mirrors: [],
      writebackIntents: [
        {
          id: "wbi_mismatch",
          connection_id: "conn_crm",
          system_type: "crm",
          provider: "hubspot",
          target: { object_type: "opportunity", external_id: "deal_1" },
          operation: "update_field",
          payload: { amount: 100 },
          source: { agent_id: "pm_agent_sales", reason: "Mismatch" },
          risk_level: "low",
          idempotency_key: "policy-mismatch",
          policy_decision: "auto_execute",
          created_at: "2026-05-26T10:00:00+08:00"
        }
      ],
      agentOutputs: [],
      management: {}
    },
    bridgePreview: { ok: false, summary: null },
    runtimeHealth: null
  });
  const viewModel = buildOperationPathTestViewModel(report);

  assert.equal(report.ok, false);
  assert.equal(report.summary.failed_operation_path_count, 1);
  assert.ok(report.issues.some((issue) => issue.assertion_id === "acceptance_step_pass"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "operation_path_has_action_and_expected_result"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "ui_missing_ui"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "api_/api/missing"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "contract_externalWritebackIntent"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "contract_missingContract"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "gate_ref_D-G999"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "fixture_gap_status_missing_status"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "external_sync_erp"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "legacy_bridge_preview"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "legacy_capability_mainline.workflow"));
  assert.ok(report.issues.some((issue) => issue.assertion_id === "legacy_capability_mainline.unknown"));
  assert.equal(viewModel.ok, false);
  assert.equal(viewModel.roles[0].status, "fail");
  assert.equal(viewModel.roles[0].failed_operation_path_count, 1);
  assert.equal(viewModel.roles[0].storylines[0].status, "fail");
  assert.equal(viewModel.roles[0].storylines[0].failed_operation_path_count, 1);
});

test("operation path report handles empty matrices, absent state, and sparse step metadata", () => {
  const emptyReport = buildRoleOperationPathTestReport({
    matrix: { version: "empty" },
    scenarioCoverage: {},
    salesGateModel: {},
    legacyIntegration: null,
    state: {}
  });
  assert.equal(emptyReport.ok, true);
  assert.equal(emptyReport.summary.role_count, 0);
  assert.equal(emptyReport.summary.storyline_count, 0);
  assert.equal(emptyReport.summary.operation_path_count, 0);
  assert.deepEqual(emptyReport.coverage.role_ids, []);

  const sparseReport = buildRoleOperationPathTestReport({
    matrix: {
      version: "sparse",
      roles: [{
        id: "executive_coo",
        name: "COO",
        type: "human",
        primary_goal: "Keep sparse operations inspectable.",
        storylines: [{
          id: "story_sparse",
          title: "Sparse operation",
          steps: [{
            id: "step_sparse",
            action: "Run sparse operation.",
            expected_result: "Missing evidence is explicit.",
            story_refs: ["SS-01"],
            fixture_expectations: [{ kind: "unknown_kind", value: "missing" }]
          }, {
            id: "step_missing_action_text",
            story_refs: ["SS-01"],
            ui_surfaces: ["overview"],
            api_surfaces: ["/health"],
            contract_refs: ["taskGraph"],
            verification_modes: ["ui", "api", "contract"]
          }]
        }]
      }]
    },
    scenarioCoverage: buildMinimalScenarioCoverage(),
    salesGateModel: buildMinimalSalesGateModel(),
    legacyIntegration: null,
    state: { raw: {} },
    bridgePreview: null,
    runtimeHealth: {}
  });
  const testCase = sparseReport.test_cases[0];
  assert.equal(sparseReport.ok, false);
  assert.equal(sparseReport.summary.role_count, 1);
  assert.equal(sparseReport.summary.storyline_count, 1);
  assert.deepEqual(testCase.verification_modes, []);
  assert.deepEqual(testCase.ui_surfaces, []);
  assert.deepEqual(testCase.api_surfaces, []);
  assert.deepEqual(testCase.contract_refs, []);
  assert.ok(testCase.assertions.some((assertion) => assertion.id === "operation_path_has_ui_api_and_contract_surfaces"));
  assert.ok(testCase.assertions.some((assertion) => assertion.id === "fixture_unknown_kind_missing"));
});
