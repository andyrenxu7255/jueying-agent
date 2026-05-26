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
    "agent-outputs.json"
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
}

function checkCrossReferences() {
  const taskGraph = readJson("fixtures/p1-demo/task-graph.sales-discover.json");
  const gaps = collectArrayFixture("information-gaps.json");
  const evidence = collectArrayFixture("evidence.json");
  const gateChecks = collectArrayFixture("sales-gate-checks.json");
  const mirrors = collectArrayFixture("external-fact-mirrors.json");

  const taskIds = new Set(taskGraph.tasks.map((task) => task.id));
  const gapIds = new Set(gaps.map((gap) => gap.id));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const mirrorIds = new Set(mirrors.map((mirror) => mirror.id));

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
console.log(`Contract audit OK: ${expectedEvidenceTypes(model).length} sales evidence types, ${buildSalesGateIndex(model).size} gates`);
