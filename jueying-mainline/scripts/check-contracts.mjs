import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  EVIDENCE_TYPES,
  assertContract,
  buildSalesGateIndex,
  expectedEvidenceTypes,
  loadSalesGateModel,
  validateContract
} from "../src/contracts/index.mjs";

const root = resolve(".");
const fixtureDir = join(root, "fixtures", "p1-demo");
const errors = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function addError(message) {
  errors.push(message);
}

function collectArrayFixture(fileName) {
  const value = readJson(`fixtures/p1-demo/${fileName}`);
  if (!Array.isArray(value)) {
    addError(`${fileName} must be an array`);
    return [];
  }
  return value;
}

function validateFixture(kind, value, options = {}) {
  const result = validateContract(kind, value, options);
  if (!result.ok) {
    for (const issue of result.issues) {
      addError(`${kind} ${value?.id ?? "<unknown>"} ${issue.path}: ${issue.message}`);
    }
  }
}

function checkSalesGateVocabulary() {
  const model = loadSalesGateModel();
  const gateEvidenceTypes = expectedEvidenceTypes(model);
  const known = new Set(EVIDENCE_TYPES);
  for (const evidenceType of gateEvidenceTypes) {
    if (!known.has(evidenceType)) {
      addError(`sales gate evidence type is not in EVIDENCE_TYPES: ${evidenceType}`);
    }
  }
}

function checkFixtureFiles() {
  const required = [
    "task-graph.sales-discover.json",
    "information-gaps.json",
    "evidence.json",
    "sales-gate-checks.json",
    "external-fact-mirrors.json",
    "external-writeback-intents.json",
    "agent-outputs.json",
    "management-command-center.json"
  ];
  const existing = new Set(readdirSync(fixtureDir));
  for (const fileName of required) {
    if (!existing.has(fileName)) {
      addError(`missing fixture: ${fileName}`);
    }
  }
}

function checkFixtures() {
  const model = loadSalesGateModel();
  const salesGateIndex = buildSalesGateIndex(model);

  const taskGraph = readJson("fixtures/p1-demo/task-graph.sales-discover.json");
  validateFixture("taskGraph", taskGraph);

  for (const gap of collectArrayFixture("information-gaps.json")) {
    validateFixture("informationGap", gap);
  }

  for (const evidence of collectArrayFixture("evidence.json")) {
    validateFixture("evidence", evidence);
  }

  for (const check of collectArrayFixture("sales-gate-checks.json")) {
    validateFixture("salesGateCheck", check, { salesGateIndex });
  }

  for (const mirror of collectArrayFixture("external-fact-mirrors.json")) {
    validateFixture("externalFactMirror", mirror);
  }

  for (const intent of collectArrayFixture("external-writeback-intents.json")) {
    validateFixture("externalWritebackIntent", intent);
  }

  for (const output of collectArrayFixture("agent-outputs.json")) {
    validateFixture("agentOutput", output);
  }

  validateFixture("managementCommandCenter", readJson("fixtures/p1-demo/management-command-center.json"));
}

function checkCrossReferences() {
  const taskGraph = readJson("fixtures/p1-demo/task-graph.sales-discover.json");
  const gaps = collectArrayFixture("information-gaps.json");
  const evidence = collectArrayFixture("evidence.json");
  const gateChecks = collectArrayFixture("sales-gate-checks.json");
  const mirrors = collectArrayFixture("external-fact-mirrors.json");
  const management = readJson("fixtures/p1-demo/management-command-center.json");

  const taskIds = new Set(taskGraph.tasks.map((task) => task.id));
  const gapIds = new Set(gaps.map((gap) => gap.id));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const mirrorIds = new Set(mirrors.map((mirror) => mirror.id));
  const managementCommandIds = new Set((management.commands ?? []).map((command) => command.id));
  const managementProjectIds = new Set((management.projects ?? []).map((project) => project.id));
  const managementExecutionTaskIds = new Set((management.execution_tasks ?? []).map((task) => task.id));
  const managementExecutionUpdateIds = new Set((management.execution_updates ?? []).map((update) => update.id));

  for (const task of taskGraph.tasks) {
    for (const gapId of task.information_gap_ids ?? []) {
      if (!gapIds.has(gapId)) {
        addError(`task ${task.id} references unknown gap ${gapId}`);
      }
    }
    for (const evidenceId of task.evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        addError(`task ${task.id} references unknown evidence ${evidenceId}`);
      }
    }
    for (const externalRef of task.external_refs ?? []) {
      if (!mirrorIds.has(externalRef.mirror_id)) {
        addError(`task ${task.id} references unknown mirror ${externalRef.mirror_id}`);
      }
    }
  }

  for (const gap of gaps) {
    if (!taskIds.has(gap.task_id)) {
      addError(`gap ${gap.id} references unknown task ${gap.task_id}`);
    }
    for (const evidenceId of gap.closed_by_evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        addError(`gap ${gap.id} references unknown closing evidence ${evidenceId}`);
      }
    }
  }

  for (const check of gateChecks) {
    for (const gapId of check.information_gap_ids ?? []) {
      if (!gapIds.has(gapId)) {
        addError(`gate check ${check.id} references unknown gap ${gapId}`);
      }
    }
    for (const evidenceId of check.evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        addError(`gate check ${check.id} references unknown evidence ${evidenceId}`);
      }
    }
  }

  for (const command of management.commands ?? []) {
    if (!taskIds.has(command.task_graph_id) && command.task_graph_id !== taskGraph.id) {
      addError(`management command ${command.id} references unknown task graph ${command.task_graph_id}`);
    }
    for (const generatedTaskId of command.generated_task_ids ?? []) {
      if (!managementExecutionTaskIds.has(generatedTaskId)) {
        addError(`management command ${command.id} references unknown execution task ${generatedTaskId}`);
      }
    }
    if ((command.generated_task_ids ?? []).length === 0) {
      addError(`management command ${command.id} must have generated execution tasks`);
    }
  }

  for (const executionTask of management.execution_tasks ?? []) {
    if (!managementCommandIds.has(executionTask.command_id)) {
      addError(`management execution task ${executionTask.id} references unknown command ${executionTask.command_id}`);
    }
    if (!managementProjectIds.has(executionTask.project_id)) {
      addError(`management execution task ${executionTask.id} references unknown project ${executionTask.project_id}`);
    }
    if (executionTask.latest_update_id && !managementExecutionUpdateIds.has(executionTask.latest_update_id)) {
      addError(`management execution task ${executionTask.id} references unknown latest update ${executionTask.latest_update_id}`);
    }
    for (const evidenceId of executionTask.evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        addError(`management execution task ${executionTask.id} references unknown evidence ${evidenceId}`);
      }
    }
  }

  for (const update of management.execution_updates ?? []) {
    if (!managementExecutionTaskIds.has(update.task_id)) {
      addError(`management execution update ${update.id} references unknown execution task ${update.task_id}`);
    }
    for (const evidenceId of update.evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        addError(`management execution update ${update.id} references unknown evidence ${evidenceId}`);
      }
    }
  }

  for (const lane of management.swimlanes ?? []) {
    for (const taskId of lane.task_ids ?? []) {
      if (!managementExecutionTaskIds.has(taskId)) {
        addError(`management swimlane ${lane.id} references unknown execution task ${taskId}`);
      }
    }
  }
}

checkFixtureFiles();
checkSalesGateVocabulary();
checkFixtures();
checkCrossReferences();

if (errors.length > 0) {
  console.error("Contract audit failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const model = loadSalesGateModel();
assertContract("taskGraph", readJson("fixtures/p1-demo/task-graph.sales-discover.json"));
assertContract("managementCommandCenter", readJson("fixtures/p1-demo/management-command-center.json"));
console.log(`Contract audit OK: ${expectedEvidenceTypes(model).length} sales evidence types, ${buildSalesGateIndex(model).size} gates`);
