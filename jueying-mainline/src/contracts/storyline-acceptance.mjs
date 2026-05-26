import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSalesGateIndex, loadSalesGateModel } from "./sales-gates.mjs";

const DEFAULT_MATRIX_PATH = "docs/role-storyline-acceptance.json";
const DEFAULT_SCENARIO_COVERAGE_PATH = "docs/scenario-coverage.json";

const IMPLEMENTED_UI_SURFACES = new Set([
  "overview",
  "sales_gate_view",
  "task_graph_view",
  "information_gap_inbox",
  "external_sync_console",
  "legacy_integration_view",
  "contract_health",
  "storyline_acceptance_view"
]);

const IMPLEMENTED_API_SURFACES = new Set([
  "/health",
  "/api/state",
  "/api/storylines",
  "/api/legacy/capabilities",
  "/api/legacy/bridge-preview",
  "/api/legacy/runtime-health",
  "/api/jueying/mainline/capabilities",
  "/api/jueying/mainline/bridge-preview",
  "/api/jueying/mainline/runtime-health"
]);

const IMPLEMENTED_CONTRACTS = new Set([
  "taskGraph",
  "informationGap",
  "evidence",
  "salesGateCheck",
  "externalFactMirror",
  "externalWritebackIntent",
  "agentOutput",
  "legacyBridge"
]);

const REQUIRED_ROLE_IDS = new Set([
  "executive_coo",
  "sales_manager",
  "sales_rep",
  "delivery_lead",
  "project_manager",
  "frontline_collector",
  "admin_it",
  "pm_agent",
  "human_twin_agent",
  "worker_agent"
]);

const SALES_GATE_STORY_IDS = new Set([
  "SS-05A",
  "SS-15",
  "SS-24A",
  "SS-24B",
  "SS-27",
  "SS-31A",
  "SS-38A"
]);

export function loadRoleStorylineAcceptanceMatrix(path = DEFAULT_MATRIX_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadScenarioCoverage(path = DEFAULT_SCENARIO_COVERAGE_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function buildRoleStorylineAcceptanceReport({
  matrix = loadRoleStorylineAcceptanceMatrix(),
  scenarioCoverage = loadScenarioCoverage(),
  salesGateModel = loadSalesGateModel(),
  legacyIntegration,
  state,
  root = resolve(".")
} = {}) {
  const expectedStories = collectExpectedStories(scenarioCoverage);
  const expectedGateIds = new Set(buildSalesGateIndex(salesGateModel).keys());
  const coveredStories = new Set();
  const coveredGateIds = new Set();
  const capabilityDomains = new Set(Object.keys(scenarioCoverage.capability_domains ?? {}));
  const legacyCapabilities = new Set((legacyIntegration?.capabilities ?? []).map((capability) => capability.id));
  const readyLegacyCapabilities = new Set(
    (legacyIntegration?.capabilities ?? [])
      .filter((capability) => capability.status === "adapter_ready")
      .map((capability) => capability.id)
  );
  const fixtureIndex = buildFixtureIndex(state);

  const roleResults = [];
  const reportIssues = [];

  for (const role of matrix.roles ?? []) {
    const roleIssues = validateRole(role);
    const storylineResults = [];

    for (const storyline of role.storylines ?? []) {
      const storylineIssues = validateStoryline(storyline);
      const stepResults = [];

      for (const step of storyline.steps ?? []) {
        const result = validateStep({
          role,
          storyline,
          step,
          expectedStories,
          expectedGateIds,
          capabilityDomains,
          legacyCapabilities,
          readyLegacyCapabilities,
          fixtureIndex,
          root
        });
        for (const storyId of result.covered_story_ids) coveredStories.add(storyId);
        for (const gateId of result.covered_gate_ids) coveredGateIds.add(gateId);
        stepResults.push(result);
      }

      const issues = [
        ...storylineIssues,
        ...stepResults.flatMap((stepResult) => stepResult.issues)
      ];
      storylineResults.push({
        id: storyline.id,
        title: storyline.title,
        story_refs: storyline.story_refs ?? [],
        step_count: stepResults.length,
        passed_step_count: stepResults.filter((stepResult) => stepResult.status === "pass").length,
        status: issues.length === 0 ? "pass" : "fail",
        issues,
        steps: stepResults
      });
    }

    const issues = [
      ...roleIssues,
      ...storylineResults.flatMap((storylineResult) => storylineResult.issues)
    ];
    roleResults.push({
      id: role.id,
      name: role.name,
      type: role.type,
      primary_goal: role.primary_goal,
      storyline_count: storylineResults.length,
      step_count: storylineResults.reduce((sum, item) => sum + item.step_count, 0),
      passed_step_count: storylineResults.reduce((sum, item) => sum + item.passed_step_count, 0),
      status: issues.length === 0 ? "pass" : "fail",
      issues,
      storylines: storylineResults
    });
  }

  for (const roleId of REQUIRED_ROLE_IDS) {
    if (!(matrix.roles ?? []).some((role) => role.id === roleId)) {
      reportIssues.push(issue("role_missing", `Required role is missing from acceptance matrix: ${roleId}`));
    }
  }

  for (const storyId of expectedStories) {
    if (!coveredStories.has(storyId)) {
      reportIssues.push(issue("story_uncovered", `Documented scenario story is not covered by any acceptance step: ${storyId}`));
    }
  }

  for (const gateId of expectedGateIds) {
    if (!coveredGateIds.has(gateId)) {
      reportIssues.push(issue("gate_uncovered", `Sales gate is not covered by any acceptance step: ${gateId}`));
    }
  }

  const allStepResults = roleResults.flatMap((role) => role.storylines.flatMap((storyline) => storyline.steps));
  const failedSteps = allStepResults.filter((step) => step.status !== "pass");
  const allIssues = [
    ...reportIssues,
    ...roleResults.flatMap((role) => role.issues)
  ];

  return {
    ok: allIssues.length === 0,
    generated_at: new Date().toISOString(),
    matrix_version: matrix.version,
    root: root.replaceAll("\\", "/"),
    summary: {
      role_count: roleResults.length,
      storyline_count: roleResults.reduce((sum, role) => sum + role.storyline_count, 0),
      step_count: allStepResults.length,
      passed_step_count: allStepResults.length - failedSteps.length,
      failed_step_count: failedSteps.length,
      documented_story_count: expectedStories.size,
      covered_story_count: coveredStories.size,
      sales_gate_count: expectedGateIds.size,
      covered_gate_count: coveredGateIds.size,
      issue_count: allIssues.length
    },
    coverage: {
      documented_story_ids: [...expectedStories].sort(compareScenarioIds),
      covered_story_ids: [...coveredStories].sort(compareScenarioIds),
      missing_story_ids: [...expectedStories].filter((id) => !coveredStories.has(id)).sort(compareScenarioIds),
      sales_gate_ids: [...expectedGateIds].sort(compareGateIds),
      covered_gate_ids: [...coveredGateIds].sort(compareGateIds),
      missing_gate_ids: [...expectedGateIds].filter((id) => !coveredGateIds.has(id)).sort(compareGateIds)
    },
    implemented_surfaces: {
      ui: [...IMPLEMENTED_UI_SURFACES].sort(),
      api: [...IMPLEMENTED_API_SURFACES].sort(),
      contracts: [...IMPLEMENTED_CONTRACTS].sort()
    },
    roles: roleResults,
    issues: allIssues
  };
}

export function buildStorylineAcceptanceViewModel(report) {
  return {
    ok: report.ok,
    generated_at: report.generated_at,
    summary: report.summary,
    coverage: {
      missing_story_ids: report.coverage.missing_story_ids,
      missing_gate_ids: report.coverage.missing_gate_ids
    },
    roles: report.roles.map((role) => ({
      id: role.id,
      name: role.name,
      type: role.type,
      primary_goal: role.primary_goal,
      status: role.status,
      storyline_count: role.storyline_count,
      step_count: role.step_count,
      passed_step_count: role.passed_step_count,
      issue_count: role.issues.length,
      storylines: role.storylines.map((storyline) => ({
        id: storyline.id,
        title: storyline.title,
        status: storyline.status,
        step_count: storyline.step_count,
        passed_step_count: storyline.passed_step_count,
        issue_count: storyline.issues.length,
        steps: storyline.steps.map((step) => ({
          id: step.id,
          action: step.action,
          expected_result: step.expected_result,
          status: step.status,
          issue_count: step.issues.length,
          story_refs: step.story_refs,
          gate_refs: step.gate_refs,
          ui_surfaces: step.ui_surfaces,
          api_surfaces: step.api_surfaces,
          contract_refs: step.contract_refs,
          capability_domains: step.capability_domains,
          verification_modes: step.verification_modes,
          external_systems: step.external_systems,
          legacy_capabilities: step.legacy_capabilities
        }))
      }))
    }))
  };
}

function validateRole(role) {
  const issues = [];
  if (!role.id) issues.push(issue("role", "Role id is required"));
  if (!role.name) issues.push(issue("role", `Role ${role.id ?? "<unknown>"} name is required`));
  if (!role.primary_goal) issues.push(issue("role", `Role ${role.id ?? "<unknown>"} primary_goal is required`));
  if (!Array.isArray(role.storylines) || role.storylines.length === 0) {
    issues.push(issue("role", `Role ${role.id ?? "<unknown>"} must have at least one storyline`));
  }
  return issues;
}

function validateStoryline(storyline) {
  const issues = [];
  if (!storyline.id) issues.push(issue("storyline", "Storyline id is required"));
  if (!storyline.title) issues.push(issue("storyline", `Storyline ${storyline.id ?? "<unknown>"} title is required`));
  if (!Array.isArray(storyline.steps) || storyline.steps.length === 0) {
    issues.push(issue("storyline", `Storyline ${storyline.id ?? "<unknown>"} must have at least one step`));
  }
  return issues;
}

function validateStep({
  role,
  storyline,
  step,
  expectedStories,
  expectedGateIds,
  capabilityDomains,
  legacyCapabilities,
  readyLegacyCapabilities,
  fixtureIndex
}) {
  const issues = [];
  const coveredStoryIds = expandScenarioRefs(step.story_refs ?? []);
  const coveredGateIds = expandGateRefs(step.gate_refs ?? [], expectedGateIds);

  if (!step.id) issues.push(issue("step", "Step id is required"));
  if (!step.action) issues.push(issue("step", `Step ${step.id ?? "<unknown>"} action is required`));
  if (!step.expected_result) issues.push(issue("step", `Step ${step.id ?? "<unknown>"} expected_result is required`));

  if (coveredStoryIds.length === 0) {
    issues.push(issue("story_refs", `Step ${step.id} must reference at least one SS/PD/XS story`));
  }
  for (const storyId of coveredStoryIds) {
    if (!expectedStories.has(storyId)) {
      issues.push(issue("story_refs", `Step ${step.id} references unknown story: ${storyId}`));
    }
  }

  const isSalesGateStep =
    coveredStoryIds.some((storyId) => SALES_GATE_STORY_IDS.has(storyId)) ||
    (step.capability_domains ?? []).some((domain) =>
      ["sales_six_step_gate_engine", "sales_six_step_lens"].includes(domain)
    );
  if (isSalesGateStep && coveredGateIds.length === 0) {
    issues.push(issue("gate_refs", `Sales step ${step.id} must reference at least one DEV-30 gate`));
  }
  for (const gateId of coveredGateIds) {
    if (!expectedGateIds.has(gateId)) {
      issues.push(issue("gate_refs", `Step ${step.id} references unknown sales gate: ${gateId}`));
    }
  }

  for (const domain of step.capability_domains ?? []) {
    if (!capabilityDomains.has(domain)) {
      issues.push(issue("capability_domains", `Step ${step.id} references unknown capability domain: ${domain}`));
    }
  }

  for (const surface of step.ui_surfaces ?? []) {
    if (!IMPLEMENTED_UI_SURFACES.has(surface)) {
      issues.push(issue("ui_surfaces", `Step ${step.id} references unimplemented UI surface: ${surface}`));
    }
  }

  for (const surface of step.api_surfaces ?? []) {
    if (!IMPLEMENTED_API_SURFACES.has(surface)) {
      issues.push(issue("api_surfaces", `Step ${step.id} references unimplemented API surface: ${surface}`));
    }
  }

  for (const contract of step.contract_refs ?? []) {
    if (!IMPLEMENTED_CONTRACTS.has(contract)) {
      issues.push(issue("contract_refs", `Step ${step.id} references unimplemented contract: ${contract}`));
    }
  }

  for (const capabilityId of step.legacy_capabilities ?? []) {
    if (!legacyCapabilities.has(capabilityId)) {
      issues.push(issue("legacy_capabilities", `Step ${step.id} references unknown legacy capability: ${capabilityId}`));
    } else if (!readyLegacyCapabilities.has(capabilityId)) {
      issues.push(issue("legacy_capabilities", `Step ${step.id} legacy capability is not adapter_ready: ${capabilityId}`));
    }
  }

  for (const systemType of step.external_systems ?? []) {
    if (!fixtureIndex.externalSystemTypes.has(systemType)) {
      issues.push(issue("external_systems", `Step ${step.id} expects missing external mirror system: ${systemType}`));
    }
    if (!fixtureIndex.writebackSystemTypes.has(systemType)) {
      issues.push(issue("external_systems", `Step ${step.id} expects missing writeback intent for system: ${systemType}`));
    }
  }

  for (const expectation of step.fixture_expectations ?? []) {
    if (!fixtureExpectationPassed(expectation, fixtureIndex)) {
      issues.push(issue("fixture_expectations", `Step ${step.id} fixture expectation failed: ${expectation.kind}=${expectation.value}`));
    }
  }

  const verificationModes = new Set(step.verification_modes ?? []);
  if (verificationModes.has("ui") && (step.ui_surfaces ?? []).length === 0) {
    issues.push(issue("verification_modes", `Step ${step.id} has ui verification but no UI surface`));
  }
  if (verificationModes.has("api") && (step.api_surfaces ?? []).length === 0) {
    issues.push(issue("verification_modes", `Step ${step.id} has api verification but no API surface`));
  }
  if (verificationModes.has("contract") && (step.contract_refs ?? []).length === 0) {
    issues.push(issue("verification_modes", `Step ${step.id} has contract verification but no contract refs`));
  }
  if (verificationModes.has("legacy_bridge") && (step.legacy_capabilities ?? []).length === 0) {
    issues.push(issue("verification_modes", `Step ${step.id} has legacy bridge verification but no legacy capabilities`));
  }
  if (verificationModes.has("external_sync") && (step.external_systems ?? []).length === 0) {
    issues.push(issue("verification_modes", `Step ${step.id} has external sync verification but no external systems`));
  }

  return {
    id: step.id,
    role_id: role.id,
    storyline_id: storyline.id,
    action: step.action,
    expected_result: step.expected_result,
    status: issues.length === 0 ? "pass" : "fail",
    issues,
    story_refs: step.story_refs ?? [],
    gate_refs: step.gate_refs ?? [],
    covered_story_ids: coveredStoryIds,
    covered_gate_ids: coveredGateIds,
    capability_domains: step.capability_domains ?? [],
    ui_surfaces: step.ui_surfaces ?? [],
    api_surfaces: step.api_surfaces ?? [],
    contract_refs: step.contract_refs ?? [],
    verification_modes: step.verification_modes ?? [],
    external_systems: step.external_systems ?? [],
    legacy_capabilities: step.legacy_capabilities ?? []
  };
}

function collectExpectedStories(scenarioCoverage) {
  const ids = new Set();
  for (const group of Object.values(scenarioCoverage.scenario_groups ?? {})) {
    for (const range of Object.values(group.story_ranges ?? {})) {
      for (const storyId of expandScenarioRefs([range])) {
        ids.add(storyId);
      }
    }
    for (const storyId of group.p1_anchor_stories ?? []) {
      ids.add(storyId);
    }
  }
  return ids;
}

function expandScenarioRefs(refs) {
  const ids = [];
  for (const ref of refs ?? []) {
    if (Array.isArray(ref)) {
      ids.push(...expandScenarioRange(ref[0], ref[1]));
      continue;
    }
    const value = String(ref);
    const range = value.match(/\b(SS|PD|XS)-(\d+)([A-Z]?)\.\.(?:\1-)?(\d+)([A-Z]?)\b/);
    if (range) {
      ids.push(...expandScenarioRange(`${range[1]}-${range[2]}${range[3]}`, `${range[1]}-${range[4]}${range[5]}`));
      continue;
    }
    for (const match of value.matchAll(/\b(?:SS|PD|XS)-\d+[A-Z]?\b/g)) {
      ids.push(match[0]);
    }
  }
  return [...new Set(ids)].sort(compareScenarioIds);
}

function expandScenarioRange(start, end) {
  if (!start || !end) return [];
  const parsedStart = parseScenarioId(start);
  const parsedEnd = parseScenarioId(end);
  if (!parsedStart || !parsedEnd || parsedStart.prefix !== parsedEnd.prefix) {
    return [];
  }
  const ids = [];
  for (let number = parsedStart.number; number <= parsedEnd.number; number += 1) {
    ids.push(`${parsedStart.prefix}-${String(number).padStart(2, "0")}`);
    if (parsedStart.prefix === "SS" && number === 5) ids.push("SS-05A");
    if (parsedStart.prefix === "SS" && number === 24) {
      ids.push("SS-24A");
      ids.push("SS-24B");
    }
    if (parsedStart.prefix === "SS" && number === 31) ids.push("SS-31A");
    if (parsedStart.prefix === "SS" && number === 38) ids.push("SS-38A");
  }
  return ids.filter((id) => {
    const parsed = parseScenarioId(id);
    if (!parsed) return false;
    if (parsed.number < parsedStart.number || parsed.number > parsedEnd.number) return false;
    if (parsed.number === parsedStart.number && compareScenarioIds(id, start) < 0) return false;
    if (parsed.number === parsedEnd.number && compareScenarioIds(id, end) > 0) return false;
    return true;
  });
}

function parseScenarioId(id) {
  const match = String(id).match(/^(SS|PD|XS)-(\d+)([A-Z]?)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    number: Number.parseInt(match[2], 10),
    suffix: match[3] ?? ""
  };
}

function compareScenarioIds(a, b) {
  const order = { SS: 0, PD: 1, XS: 2 };
  const left = parseScenarioId(a);
  const right = parseScenarioId(b);
  if (!left || !right) return String(a).localeCompare(String(b));
  return (order[left.prefix] - order[right.prefix]) ||
    (left.number - right.number) ||
    left.suffix.localeCompare(right.suffix);
}

function expandGateRefs(refs, expectedGateIds) {
  const ids = [];
  for (const ref of refs ?? []) {
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
  if (!left || !right) return String(a).localeCompare(String(b));
  return (order[left[1]] - order[right[1]]) ||
    (Number.parseInt(left[2], 10) - Number.parseInt(right[2], 10));
}

function buildFixtureIndex(state = {}) {
  const taskGraph = state.raw?.taskGraph ?? state.taskGraph ?? {};
  const tasks = taskGraph.tasks ?? [];
  const gaps = state.raw?.gaps ?? state.gaps ?? [];
  const evidence = state.raw?.evidence ?? state.evidence ?? [];
  const gateChecks = state.raw?.gateChecks ?? state.gateChecks ?? [];
  const mirrors = state.raw?.mirrors ?? state.mirrors ?? [];
  const writebackIntents = state.raw?.writebackIntents ?? state.writebackIntents ?? [];
  const agentOutputs = state.raw?.agentOutputs ?? state.agentOutputs ?? [];

  return {
    taskStatuses: new Set(tasks.map((task) => task.status)),
    gapStatuses: new Set(gaps.map((gap) => gap.status)),
    evidenceTypes: new Set(evidence.map((item) => item.evidence_type)),
    gateStatuses: new Set(gateChecks.map((check) => check.status)),
    agentOutputKinds: new Set(agentOutputs.map((output) => output.kind)),
    externalSystemTypes: new Set(mirrors.map((mirror) => mirror.system_type)),
    writebackSystemTypes: new Set(writebackIntents.map((intent) => intent.system_type))
  };
}

function fixtureExpectationPassed(expectation, fixtureIndex) {
  const checks = {
    task_status: fixtureIndex.taskStatuses,
    gap_status: fixtureIndex.gapStatuses,
    evidence_type: fixtureIndex.evidenceTypes,
    gate_status: fixtureIndex.gateStatuses,
    agent_output_kind: fixtureIndex.agentOutputKinds,
    external_system: fixtureIndex.externalSystemTypes,
    writeback_system: fixtureIndex.writebackSystemTypes
  };
  const values = checks[expectation.kind];
  return values instanceof Set && values.has(expectation.value);
}

function issue(kind, message) {
  return { kind, message };
}
