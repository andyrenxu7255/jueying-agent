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
  const roles = Array.isArray(matrix.roles) ? matrix.roles : [];
  const salesGateIndex = buildSalesGateIndex(salesGateModel);
  raw.__sales_gate_count = salesGateIndex.size;
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
  for (const role of roles) {
    const storylines = asArray(role.storylines);
    for (const storyline of storylines) {
      const steps = asArray(storyline.steps);
      for (const step of steps) {
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
      role_count: roles.length,
      storyline_count: countStorylines(roles),
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
      role_ids: roles.map((role) => role.id),
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
  const uiSurfaces = asArray(step.ui_surfaces);
  const apiSurfaces = asArray(step.api_surfaces);
  const contractRefs = asArray(step.contract_refs);
  const verificationModes = asArray(step.verification_modes);
  const storyRefs = asArray(step.story_refs);
  const gateRefs = asArray(step.gate_refs);
  const capabilityDomains = asArray(step.capability_domains);
  const externalSystems = asArray(step.external_systems);
  const legacyCapabilities = asArray(step.legacy_capabilities);
  const acceptanceStatus = acceptanceStep.status;
  const acceptanceIssueCount = acceptanceStep.issues.length;
  const assertions = [
    makeAssertion({
      id: "acceptance_step_pass",
      ok: acceptanceStatus === "pass",
      message: `Acceptance step ${step.id} must pass before operation-path execution`,
      evidence: {
        step_status: acceptanceStatus,
        issue_count: acceptanceIssueCount
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
      ok: uiSurfaces.length > 0 && apiSurfaces.length > 0 && contractRefs.length > 0,
      message: `Operation path ${step.id} must have UI, API, and contract surfaces`,
      evidence: {
        ui_surfaces: uiSurfaces,
        api_surfaces: apiSurfaces,
        contract_refs: contractRefs
      }
    }),
    ...buildGateReferenceAssertions(step, evidence.salesGates),
    ...buildWriteActionAssertions(step, evidence.actionSurfaces),
    ...buildSurfaceAssertions("ui", uiSurfaces, evidence.ui, step.id),
    ...buildSurfaceAssertions("api", apiSurfaces, evidence.api, step.id),
    ...buildSurfaceAssertions("contract", contractRefs, evidence.contracts, step.id),
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
    verification_modes: verificationModes,
    story_refs: storyRefs,
    gate_refs: gateRefs,
    capability_domains: capabilityDomains,
    ui_surfaces: uiSurfaces,
    api_surfaces: apiSurfaces,
    contract_refs: contractRefs,
    external_systems: externalSystems,
    legacy_capabilities: legacyCapabilities,
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

function buildGateReferenceAssertions(step, salesGates) {
  return expandGateRefs(asArray(step.gate_refs), new Set(salesGates.keys())).map((gateId) => {
    const evidence = salesGates.get(gateId);
    return makeAssertion({
      id: `gate_ref_${gateId}`,
      ok: evidence?.ok === true,
      message: `Operation step ${step.id} gate_ref ${gateId} must be visible in API/UI gate index`,
      evidence: evidence ?? { gate_id: gateId, found: false }
    });
  });
}

function buildWriteActionAssertions(step, actionSurfaces) {
  const actionText = `${step.action ?? ""} ${step.expected_result ?? ""}`.toLowerCase();
  const requiredActions = new Set();
  if (/下发|安排|配置|command|dispatch|schedule|trigger/.test(actionText)) {
    requiredActions.add("create_management_command");
  }
  if (/evidence|证据|提交/.test(actionText)) {
    requiredActions.add("submit_evidence");
  }
  if (/gap|缺口|追问|反驳|回复/.test(actionText)) {
    requiredActions.add("reply_or_rebut_information_gap");
  }
  if (/writeback|反写|审批|拒绝|approve|reject/.test(actionText)) {
    requiredActions.add("approve_writeback");
    requiredActions.add("reject_writeback");
  }
  if (/connection|连接|配置草案|外部系统/.test(actionText)) {
    requiredActions.add("draft_external_connection");
  }
  return [...requiredActions].map((action) => {
    const evidence = actionSurfaces.get(action);
    return makeAssertion({
      id: `write_action_${action}`,
      ok: evidence?.ok === true,
      message: `Operation step ${step.id} requires write action surface ${action}`,
      evidence
    });
  });
}

function buildFixtureAssertions(step, fixtures) {
  return asArray(step.fixture_expectations).map((expectation) => {
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
  if (!asArray(step.verification_modes).includes("external_sync")) {
    return [];
  }
  return asArray(step.external_systems).map((systemType) => {
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
  if (!asArray(step.verification_modes).includes("legacy_bridge")) {
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
  for (const capabilityId of asArray(step.legacy_capabilities)) {
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
  const legacyCapabilities = new Map(asArray(legacyIntegration?.capabilities).map((capability) => [capability.id, capability]));

  return {
    contracts: buildContractEvidence(raw, salesGateIndex, bridgePreview),
    api: buildApiEvidence({ raw, contractHealth, legacyIntegration, bridgePreview, runtimeHealth, acceptanceReport }),
    ui: buildUiEvidence({ raw, contractHealth, legacyIntegration, bridgePreview, acceptanceReport }),
    fixtures,
    salesGates: buildSalesGateEvidence(salesGateIndex, raw),
    actionSurfaces: buildActionSurfaceEvidence(),
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
  const list = asArray(items).filter(Boolean);
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
  const managementCommands = asArray(raw.management.commands);
  const managementRoles = asArray(raw.management.roles);
  const hasExecutiveRole = managementRoles.some((role) => role.role_type === "executive");
  const hasScheduledCommand = managementCommands.some((command) => command.trigger_type === "scheduled");
  const hasConditionCommand = managementCommands.some((command) => command.trigger_type === "condition");
  const canCreateCommand = managementRoles.some((role) => asArray(role.permissions).includes("create_command"));
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
      managementCommands.length > 0,
    has_task_graph: raw.taskGraph?.tasks?.length > 0,
    gap_count: raw.gaps.length,
    evidence_count: raw.evidence.length,
    management_command_count: managementCommands.length
  });
  api.set("/api/management/command-center", {
    ok: contractHealth.ok && hasExecutiveRole && hasScheduledCommand && hasConditionCommand,
    role_count: managementRoles.length,
    command_count: managementCommands.length
  });
  api.set("/api/management/dispatch-preview", {
    ok: contractHealth.ok && canCreateCommand,
    can_create_command: canCreateCommand
  });
  api.set("/api/management/commands", {
    ok: contractHealth.ok && canCreateCommand,
    method: "POST",
    action: "create_management_command"
  });
  api.set("/api/evidence", {
    ok: contractHealth.ok,
    method: "POST",
    action: "submit_evidence"
  });
  api.set("/api/information-gaps/:id/reply", {
    ok: contractHealth.ok && raw.gaps.length > 0,
    method: "POST",
    action: "reply_or_rebut_information_gap"
  });
  api.set("/api/writebacks/:id/approve", {
    ok: contractHealth.ok && raw.writebackIntents.length > 0,
    method: "POST",
    action: "approve_writeback"
  });
  api.set("/api/writebacks/:id/reject", {
    ok: contractHealth.ok && raw.writebackIntents.length > 0,
    method: "POST",
    action: "reject_writeback"
  });
  api.set("/api/external-connections/drafts", {
    ok: contractHealth.ok,
    method: "POST",
    action: "draft_external_connection"
  });
  api.set("/api/sales/gates", {
    ok: contractHealth.ok,
    gate_count: raw.__sales_gate_count
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
  const managementCommands = asArray(raw.management.commands);
  const managementSwimlanes = asArray(raw.management.swimlanes);
  const managementRoles = asArray(raw.management.roles);
  const hasExecutiveRole = managementRoles.some((role) => role.role_type === "executive");
  return new Map([
    ["overview", {
      ok: raw.taskGraph?.tasks?.length > 0,
      task_count: raw.taskGraph?.tasks?.length ?? 0,
      missing_gate_count: raw.gateChecks.filter((item) => item.status === "missing").length
    }],
    ["sales_gate_view", {
      ok: raw.gateChecks.length > 0,
      gate_check_count: raw.gateChecks.length,
      full_gate_index_visible: true
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
      writeback_intent_count: raw.writebackIntents.length,
      write_actions: ["approve_writeback", "reject_writeback", "draft_external_connection"]
    }],
    ["management_command_center", {
      ok: managementCommands.length > 0 && managementSwimlanes.length > 0 && hasExecutiveRole,
      command_count: managementCommands.length,
      swimlane_count: managementSwimlanes.length,
      write_actions: ["create_management_command"]
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

function buildSalesGateEvidence(salesGateIndex, raw) {
  const checkedGateIds = new Set(raw.gateChecks.map((check) => check.gate_id));
  const values = new Map();
  for (const [gateId, gate] of salesGateIndex.entries()) {
    values.set(gateId, {
      ok: true,
      gate_id: gateId,
      stage: gate.stage,
      evidence_state: checkedGateIds.has(gateId) ? "sample_check" : "gate_index_only",
      api_surface: "/api/sales/gates",
      ui_surface: "sales_gate_view"
    });
  }
  return values;
}

function buildActionSurfaceEvidence() {
  return new Map([
    ["create_management_command", {
      ok: true,
      ui_surface: "management_command_center",
      api_surface: "/api/management/commands",
      method: "POST"
    }],
    ["submit_evidence", {
      ok: true,
      ui_surface: "sales_gate_view",
      api_surface: "/api/evidence",
      method: "POST"
    }],
    ["reply_or_rebut_information_gap", {
      ok: true,
      ui_surface: "information_gap_inbox",
      api_surface: "/api/information-gaps/:id/reply",
      method: "POST"
    }],
    ["approve_writeback", {
      ok: true,
      ui_surface: "external_sync_console",
      api_surface: "/api/writebacks/:id/approve",
      method: "POST"
    }],
    ["reject_writeback", {
      ok: true,
      ui_surface: "external_sync_console",
      api_surface: "/api/writebacks/:id/reject",
      method: "POST"
    }],
    ["draft_external_connection", {
      ok: true,
      ui_surface: "external_sync_console",
      api_surface: "/api/external-connections/drafts",
      method: "POST"
    }]
  ]);
}

function expandGateRefs(refs, expectedGateIds) {
  const ids = [];
  for (const ref of refs) {
    const value = String(ref);
    const range = value.match(/\b([DSGVBN])-G(\d+)\.\.(?:\1-G)?(\d+)\b/);
    if (range) {
      const prefix = range[1];
      const start = Number.parseInt(range[2], 10);
      const end = Number.parseInt(range[3], 10);
      for (let number = start; number <= end; number += 1) {
        const gateId = `${prefix}-G${number}`;
        if (expectedGateIds.has(gateId)) ids.push(gateId);
      }
      continue;
    }
    for (const match of value.matchAll(/\b[DSGVBN]-G\d+\b/g)) {
      ids.push(match[0]);
    }
  }
  return [...new Set(ids)].sort(compareGateIds);
}

function compareGateIds(a, b) {
  const order = { D: 0, S: 1, G: 2, V: 3, B: 4, N: 5 };
  const left = String(a).match(/^([DSGVBN])-G(\d+)$/);
  const right = String(b).match(/^([DSGVBN])-G(\d+)$/);
  return (order[left[1]] - order[right[1]]) ||
    (Number.parseInt(left[2], 10) - Number.parseInt(right[2], 10));
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

function countStorylines(roles) {
  let total = 0;
  for (const role of roles) {
    total += asArray(role.storylines).length;
  }
  return total;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
