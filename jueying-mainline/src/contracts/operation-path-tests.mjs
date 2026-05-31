import { buildSalesGateIndex, loadSalesGateModel } from "./sales-gates.mjs";
import {
  buildRoleStorylineAcceptanceReport,
  loadRoleStorylineAcceptanceMatrix,
  loadScenarioCoverage
} from "./storyline-acceptance.mjs";
import { validateContract } from "./validator.mjs";
import { decideWritebackPolicy } from "./writeback-policy.mjs";

const API_SURFACE_ALIASES = new Map([
  ["/api/jueying/mainline/capabilities", "/api/legacy/capabilities"],
  ["/api/jueying/mainline/bridge-preview", "/api/legacy/bridge-preview"],
  ["/api/jueying/mainline/runtime-health", "/api/legacy/runtime-health"]
]);

export function buildRoleOperationPathTestReport({
  matrix = loadRoleStorylineAcceptanceMatrix(),
  scenarioCoverage = loadScenarioCoverage(),
  salesGateModel = loadSalesGateModel(),
  legacyIntegration,
  state = {},
  bridgePreview,
  runtimeHealth,
  root = "."
} = {}) {
  const raw = normalizeRawState(state);
  const salesGateIndex = buildSalesGateIndex(salesGateModel);
  const acceptanceReport = buildRoleStorylineAcceptanceReport({
    matrix,
    scenarioCoverage,
    salesGateModel,
    legacyIntegration,
    state: { raw },
    root
  });
  const acceptanceSteps = new Map();
  for (const role of acceptanceReport.roles) {
    for (const storyline of role.storylines) {
      for (const step of storyline.steps) {
        acceptanceSteps.set(step.id, step);
      }
    }
  }

  const evidence = buildOperationEvidence({
    raw,
    salesGateIndex,
    legacyIntegration,
    bridgePreview,
    runtimeHealth,
    acceptanceReport
  });

  const testCases = [];
  for (const role of matrix.roles ?? []) {
    for (const storyline of role.storylines ?? []) {
      for (const step of storyline.steps ?? []) {
        testCases.push(buildOperationPathTestCase({
          role,
          storyline,
          step,
          acceptanceStep: acceptanceSteps.get(step.id),
          evidence
        }));
      }
    }
  }

  const failedCases = testCases.filter((item) => item.status !== "pass");
  const assertions = testCases.flatMap((item) => item.assertions);
  const failedAssertions = assertions.filter((item) => item.status !== "pass");

  return {
    ok: failedCases.length === 0,
    generated_at: new Date().toISOString(),
    matrix_version: matrix.version,
    root: String(root).replaceAll("\\", "/"),
    summary: {
      role_count: matrix.roles?.length ?? 0,
      storyline_count: (matrix.roles ?? []).reduce((sum, role) => sum + (role.storylines?.length ?? 0), 0),
      operation_path_count: testCases.length,
      passed_operation_path_count: testCases.length - failedCases.length,
      failed_operation_path_count: failedCases.length,
      assertion_count: assertions.length,
      passed_assertion_count: assertions.length - failedAssertions.length,
      failed_assertion_count: failedAssertions.length,
      ui_surface_count: uniqueCount(testCases.flatMap((item) => item.ui_surfaces)),
      api_surface_count: uniqueCount(testCases.flatMap((item) => item.api_surfaces)),
      contract_ref_count: uniqueCount(testCases.flatMap((item) => item.contract_refs)),
      external_sync_path_count: testCases.filter((item) => item.verification_modes.includes("external_sync")).length,
      legacy_bridge_path_count: testCases.filter((item) => item.verification_modes.includes("legacy_bridge")).length
    },
    coverage: {
      role_ids: (matrix.roles ?? []).map((role) => role.id),
      operation_path_ids: testCases.map((item) => item.id),
      verification_mode_counts: countValues(testCases.flatMap((item) => item.verification_modes)),
      ui_surface_counts: countValues(testCases.flatMap((item) => item.ui_surfaces)),
      api_surface_counts: countValues(testCases.flatMap((item) => item.api_surfaces)),
      contract_ref_counts: countValues(testCases.flatMap((item) => item.contract_refs))
    },
    test_cases: testCases,
    issues: failedAssertions.map((item) => ({
      test_case_id: item.test_case_id,
      assertion_id: item.id,
      message: item.message,
      evidence: item.evidence
    }))
  };
}

export function buildOperationPathTestViewModel(report) {
  const roleGroups = new Map();
  for (const testCase of report.test_cases) {
    if (!roleGroups.has(testCase.role_id)) {
      roleGroups.set(testCase.role_id, {
        id: testCase.role_id,
        name: testCase.role_name,
        status: "pass",
        operation_path_count: 0,
        passed_operation_path_count: 0,
        failed_operation_path_count: 0,
        storylines: new Map()
      });
    }
    const role = roleGroups.get(testCase.role_id);
    role.operation_path_count += 1;
    if (testCase.status === "pass") role.passed_operation_path_count += 1;
    if (testCase.status !== "pass") {
      role.failed_operation_path_count += 1;
      role.status = "fail";
    }
    if (!role.storylines.has(testCase.storyline_id)) {
      role.storylines.set(testCase.storyline_id, {
        id: testCase.storyline_id,
        title: testCase.storyline_title,
        status: "pass",
        operation_path_count: 0,
        passed_operation_path_count: 0,
        failed_operation_path_count: 0,
        test_cases: []
      });
    }
    const storyline = role.storylines.get(testCase.storyline_id);
    storyline.operation_path_count += 1;
    if (testCase.status === "pass") storyline.passed_operation_path_count += 1;
    if (testCase.status !== "pass") {
      storyline.failed_operation_path_count += 1;
      storyline.status = "fail";
    }
    storyline.test_cases.push({
      id: testCase.id,
      step_id: testCase.step_id,
      action: testCase.action,
      expected_result: testCase.expected_result,
      status: testCase.status,
      assertion_count: testCase.assertion_count,
      passed_assertion_count: testCase.passed_assertion_count,
      failed_assertion_count: testCase.failed_assertion_count,
      verification_modes: testCase.verification_modes,
      ui_surfaces: testCase.ui_surfaces,
      api_surfaces: testCase.api_surfaces,
      contract_refs: testCase.contract_refs
    });
  }

  return {
    ok: report.ok,
    generated_at: report.generated_at,
    summary: report.summary,
    coverage: report.coverage,
    roles: [...roleGroups.values()].map((role) => ({
      ...role,
      storylines: [...role.storylines.values()]
    })),
    issues: report.issues
  };
}

function buildOperationPathTestCase({ role, storyline, step, acceptanceStep, evidence }) {
  const assertions = [
    makeAssertion({
      id: "acceptance_step_pass",
      ok: acceptanceStep?.status === "pass",
      message: `Acceptance step ${step.id} must pass before operation-path execution`,
      evidence: {
        step_status: acceptanceStep?.status ?? "missing",
        issue_count: acceptanceStep?.issues?.length ?? null
      }
    }),
    makeAssertion({
      id: "operation_path_has_action_and_expected_result",
      ok: Boolean(step.action && step.expected_result),
      message: `Operation path ${step.id} must define action and expected result`,
      evidence: {
        has_action: Boolean(step.action),
        has_expected_result: Boolean(step.expected_result)
      }
    }),
    makeAssertion({
      id: "operation_path_has_ui_api_and_contract_surfaces",
      ok: (step.ui_surfaces?.length ?? 0) > 0 &&
        (step.api_surfaces?.length ?? 0) > 0 &&
        (step.contract_refs?.length ?? 0) > 0,
      message: `Operation path ${step.id} must have UI, API, and contract surfaces`,
      evidence: {
        ui_surfaces: step.ui_surfaces ?? [],
        api_surfaces: step.api_surfaces ?? [],
        contract_refs: step.contract_refs ?? []
      }
    }),
    ...buildSurfaceAssertions("ui", step.ui_surfaces ?? [], evidence.ui, step.id),
    ...buildSurfaceAssertions("api", step.api_surfaces ?? [], evidence.api, step.id),
    ...buildSurfaceAssertions("contract", step.contract_refs ?? [], evidence.contracts, step.id),
    ...buildFixtureAssertions(step, evidence.fixtures),
    ...buildExternalSyncAssertions(step, evidence.externalSync),
    ...buildLegacyBridgeAssertions(step, evidence.legacyBridge)
  ];

  const failed = assertions.filter((item) => item.status !== "pass");
  const testCaseId = `op_${role.id}_${storyline.id}_${step.id}`.replaceAll(/[^a-zA-Z0-9_:-]/g, "_");
  return {
    id: testCaseId,
    role_id: role.id,
    role_name: role.name,
    storyline_id: storyline.id,
    storyline_title: storyline.title,
    step_id: step.id,
    action: step.action,
    expected_result: step.expected_result,
    status: failed.length === 0 ? "pass" : "fail",
    verification_modes: step.verification_modes ?? [],
    story_refs: step.story_refs ?? [],
    gate_refs: step.gate_refs ?? [],
    capability_domains: step.capability_domains ?? [],
    ui_surfaces: step.ui_surfaces ?? [],
    api_surfaces: step.api_surfaces ?? [],
    contract_refs: step.contract_refs ?? [],
    external_systems: step.external_systems ?? [],
    legacy_capabilities: step.legacy_capabilities ?? [],
    assertion_count: assertions.length,
    passed_assertion_count: assertions.length - failed.length,
    failed_assertion_count: failed.length,
    assertions: assertions.map((assertion) => ({
      ...assertion,
      test_case_id: testCaseId
    }))
  };
}

function buildSurfaceAssertions(kind, values, evidenceMap, stepId) {
  return values.map((value) => {
    const canonical = kind === "api" ? API_SURFACE_ALIASES.get(value) ?? value : value;
    const evidence = evidenceMap.get(canonical);
    return makeAssertion({
      id: `${kind}_${value}`,
      ok: evidence?.ok === true,
      message: `Operation step ${stepId} requires ${kind} surface ${value}`,
      evidence: evidence ?? { surface: value, found: false }
    });
  });
}

function buildFixtureAssertions(step, fixtures) {
  return (step.fixture_expectations ?? []).map((expectation) => {
    const values = fixtures.get(expectation.kind);
    return makeAssertion({
      id: `fixture_${expectation.kind}_${expectation.value}`,
      ok: values instanceof Set && values.has(expectation.value),
      message: `Operation step ${step.id} fixture expectation must pass: ${expectation.kind}=${expectation.value}`,
      evidence: {
        kind: expectation.kind,
        expected: expectation.value,
        available: values instanceof Set ? [...values].sort() : []
      }
    });
  });
}

function buildExternalSyncAssertions(step, externalSync) {
  if (!(step.verification_modes ?? []).includes("external_sync")) {
    return [];
  }
  return (step.external_systems ?? []).map((systemType) => {
    const systemEvidence = externalSync.get(systemType);
    return makeAssertion({
      id: `external_sync_${systemType}`,
      ok: systemEvidence?.ok === true,
      message: `Operation step ${step.id} requires external sync path for ${systemType}`,
      evidence: systemEvidence ?? { system_type: systemType, found: false }
    });
  });
}

function buildLegacyBridgeAssertions(step, legacyBridge) {
  if (!(step.verification_modes ?? []).includes("legacy_bridge")) {
    return [];
  }
  const assertions = [
    makeAssertion({
      id: "legacy_bridge_preview",
      ok: legacyBridge.preview_ok === true,
      message: `Operation step ${step.id} requires a valid legacy bridge preview`,
      evidence: legacyBridge.preview
    })
  ];
  for (const capabilityId of step.legacy_capabilities ?? []) {
    const capability = legacyBridge.capabilities.get(capabilityId);
    assertions.push(makeAssertion({
      id: `legacy_capability_${capabilityId}`,
      ok: capability?.status === "adapter_ready",
      message: `Operation step ${step.id} requires adapter-ready legacy capability ${capabilityId}`,
      evidence: capability ?? { id: capabilityId, found: false }
    }));
  }
  return assertions;
}

function buildOperationEvidence({
  raw,
  salesGateIndex,
  legacyIntegration,
  bridgePreview,
  runtimeHealth,
  acceptanceReport
}) {
  const contractHealth = buildContractHealth(raw, salesGateIndex);
  const fixtures = buildFixtureIndex(raw);
  const legacyCapabilities = new Map((legacyIntegration?.capabilities ?? []).map((capability) => [capability.id, capability]));

  return {
    contracts: buildContractEvidence(raw, salesGateIndex, bridgePreview),
    api: buildApiEvidence({ raw, contractHealth, legacyIntegration, bridgePreview, runtimeHealth, acceptanceReport }),
    ui: buildUiEvidence({ raw, contractHealth, legacyIntegration, bridgePreview, acceptanceReport }),
    fixtures,
    externalSync: buildExternalSyncEvidence(raw),
    legacyBridge: {
      preview_ok: bridgePreview?.ok === true,
      preview: bridgePreview?.summary ?? null,
      capabilities: legacyCapabilities
    }
  };
}

function buildContractEvidence(raw, salesGateIndex, bridgePreview) {
  const values = new Map();
  values.set("taskGraph", contractSetEvidence("taskGraph", [raw.taskGraph], {}));
  values.set("informationGap", contractSetEvidence("informationGap", raw.gaps, {}));
  values.set("evidence", contractSetEvidence("evidence", raw.evidence, {}));
  values.set("salesGateCheck", contractSetEvidence("salesGateCheck", raw.gateChecks, { salesGateIndex }));
  values.set("externalFactMirror", contractSetEvidence("externalFactMirror", raw.mirrors, {}));
  values.set("externalWritebackIntent", {
    ...contractSetEvidence("externalWritebackIntent", raw.writebackIntents, {}),
    policy_decisions_match: raw.writebackIntents.every((intent) =>
      decideWritebackPolicy(intent).decision === intent.policy_decision
    )
  });
  const writeback = values.get("externalWritebackIntent");
  writeback.ok = writeback.ok && writeback.policy_decisions_match;
  values.set("agentOutput", contractSetEvidence("agentOutput", raw.agentOutputs, {}));
  values.set("managementCommandCenter", contractSetEvidence("managementCommandCenter", [raw.management], {}));
  values.set("legacyBridge", {
    ok: bridgePreview?.ok === true,
    summary: bridgePreview?.summary ?? null
  });
  return values;
}

function contractSetEvidence(kind, items, options) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const issues = [];
  for (const item of list) {
    const result = validateContract(kind, item, options);
    if (!result.ok) {
      issues.push({
        id: item?.id ?? "<unknown>",
        issues: result.issues
      });
    }
  }
  return {
    ok: list.length > 0 && issues.length === 0,
    count: list.length,
    issue_count: issues.length,
    issues
  };
}

function buildContractHealth(raw, salesGateIndex) {
  const contractEvidence = buildContractEvidence(raw, salesGateIndex, { ok: true, summary: {} });
  const issues = [...contractEvidence.values()].filter((item) => !item.ok);
  return {
    ok: issues.length === 0,
    issue_count: issues.length
  };
}

function buildApiEvidence({ raw, contractHealth, legacyIntegration, bridgePreview, runtimeHealth, acceptanceReport }) {
  const api = new Map();
  api.set("/health", {
    ok: contractHealth.ok,
    health_ok: contractHealth.ok,
    issue_count: contractHealth.issue_count
  });
  api.set("/api/state", {
    ok: contractHealth.ok &&
      raw.taskGraph?.tasks?.length > 0 &&
      raw.gaps.length > 0 &&
      raw.evidence.length > 0 &&
      (raw.management?.commands?.length ?? 0) > 0,
    has_task_graph: raw.taskGraph?.tasks?.length > 0,
    gap_count: raw.gaps.length,
    evidence_count: raw.evidence.length,
    management_command_count: raw.management?.commands?.length ?? 0
  });
  api.set("/api/management/command-center", {
    ok: contractHealth.ok &&
      (raw.management?.roles?.some((role) => role.role_type === "executive") ?? false) &&
      (raw.management?.commands?.some((command) => command.trigger_type === "scheduled") ?? false) &&
      (raw.management?.commands?.some((command) => command.trigger_type === "condition") ?? false),
    role_count: raw.management?.roles?.length ?? 0,
    command_count: raw.management?.commands?.length ?? 0
  });
  api.set("/api/management/dispatch-preview", {
    ok: contractHealth.ok &&
      (raw.management?.roles?.some((role) => role.permissions?.includes("create_command")) ?? false),
    can_create_command: raw.management?.roles?.some((role) => role.permissions?.includes("create_command")) ?? false
  });
  api.set("/api/storylines", {
    ok: acceptanceReport.ok,
    step_count: acceptanceReport.summary.step_count,
    role_count: acceptanceReport.summary.role_count
  });
  api.set("/api/legacy/capabilities", {
    ok: legacyIntegration?.ok === true,
    capability_count: legacyIntegration?.totals?.capability_count ?? 0,
    adapter_ready_count: legacyIntegration?.totals?.adapter_ready_count ?? 0
  });
  api.set("/api/legacy/bridge-preview", {
    ok: bridgePreview?.ok === true,
    summary: bridgePreview?.summary ?? null
  });
  api.set("/api/legacy/runtime-health", {
    ok: Array.isArray(runtimeHealth?.services) && typeof runtimeHealth?.service_count === "number",
    service_count: runtimeHealth?.service_count ?? 0,
    online_count: runtimeHealth?.online_count ?? 0
  });
  return api;
}

function buildUiEvidence({ raw, contractHealth, legacyIntegration, bridgePreview, acceptanceReport }) {
  return new Map([
    ["overview", {
      ok: raw.taskGraph?.tasks?.length > 0,
      task_count: raw.taskGraph?.tasks?.length ?? 0,
      missing_gate_count: raw.gateChecks.filter((item) => item.status === "missing").length
    }],
    ["sales_gate_view", {
      ok: raw.gateChecks.length > 0,
      gate_check_count: raw.gateChecks.length
    }],
    ["task_graph_view", {
      ok: raw.taskGraph?.tasks?.length > 0,
      task_count: raw.taskGraph?.tasks?.length ?? 0
    }],
    ["information_gap_inbox", {
      ok: raw.gaps.length > 0,
      gap_count: raw.gaps.length
    }],
    ["external_sync_console", {
      ok: raw.mirrors.length > 0 && raw.writebackIntents.length > 0,
      mirror_count: raw.mirrors.length,
      writeback_intent_count: raw.writebackIntents.length
    }],
    ["management_command_center", {
      ok: (raw.management?.commands?.length ?? 0) > 0 &&
        (raw.management?.swimlanes?.length ?? 0) > 0 &&
        (raw.management?.roles?.some((role) => role.role_type === "executive") ?? false),
      command_count: raw.management?.commands?.length ?? 0,
      swimlane_count: raw.management?.swimlanes?.length ?? 0
    }],
    ["legacy_integration_view", {
      ok: legacyIntegration?.ok === true && bridgePreview?.ok === true,
      capability_count: legacyIntegration?.totals?.capability_count ?? 0,
      bridge_ok: bridgePreview?.ok === true
    }],
    ["contract_health", {
      ok: contractHealth.ok,
      issue_count: contractHealth.issue_count
    }],
    ["storyline_acceptance_view", {
      ok: acceptanceReport.ok,
      step_count: acceptanceReport.summary.step_count
    }]
  ]);
}

function buildExternalSyncEvidence(raw) {
  const values = new Map();
  const systemTypes = new Set([
    ...raw.mirrors.map((item) => item.system_type),
    ...raw.writebackIntents.map((item) => item.system_type)
  ]);
  for (const systemType of systemTypes) {
    const mirrorCount = raw.mirrors.filter((item) => item.system_type === systemType).length;
    const writebackCount = raw.writebackIntents.filter((item) => item.system_type === systemType).length;
    values.set(systemType, {
      ok: mirrorCount > 0 && writebackCount > 0,
      system_type: systemType,
      mirror_count: mirrorCount,
      writeback_intent_count: writebackCount
    });
  }
  return values;
}

function normalizeRawState(state) {
  const raw = state.raw ?? state;
  return {
    taskGraph: raw.taskGraph ?? {},
    gaps: raw.gaps ?? [],
    evidence: raw.evidence ?? [],
    gateChecks: raw.gateChecks ?? [],
    mirrors: raw.mirrors ?? [],
    writebackIntents: raw.writebackIntents ?? [],
    agentOutputs: raw.agentOutputs ?? [],
    management: raw.management ?? {}
  };
}

function buildFixtureIndex(raw) {
  return new Map([
    ["task_status", new Set((raw.taskGraph.tasks ?? []).map((task) => task.status))],
    ["gap_status", new Set(raw.gaps.map((gap) => gap.status))],
    ["evidence_type", new Set(raw.evidence.map((item) => item.evidence_type))],
    ["gate_status", new Set(raw.gateChecks.map((check) => check.status))],
    ["agent_output_kind", new Set(raw.agentOutputs.map((output) => output.kind))],
    ["external_system", new Set(raw.mirrors.map((mirror) => mirror.system_type))],
    ["writeback_system", new Set(raw.writebackIntents.map((intent) => intent.system_type))],
    ["management_trigger_type", new Set((raw.management.commands ?? []).map((command) => command.trigger_type))],
    ["management_command_status", new Set((raw.management.commands ?? []).map((command) => command.status))],
    ["management_project_domain", new Set((raw.management.projects ?? []).map((project) => project.domain))],
    ["management_role_type", new Set((raw.management.roles ?? []).map((role) => role.role_type))],
    ["management_execution_task_status", new Set((raw.management.execution_tasks ?? []).map((task) => task.status))],
    ["management_execution_update_type", new Set((raw.management.execution_updates ?? []).map((update) => update.update_type))]
  ]);
}

function makeAssertion({ id, ok, message, evidence }) {
  return {
    id,
    status: ok ? "pass" : "fail",
    message,
    evidence
  };
}

function countValues(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function uniqueCount(values) {
  return new Set(values).size;
}
