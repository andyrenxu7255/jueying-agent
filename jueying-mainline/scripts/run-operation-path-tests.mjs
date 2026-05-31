import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildLegacyBridgePreview,
  checkLegacyRuntimeHealth,
  inspectJueyingV1Integration
} from "../src/integrations/jueying-v1/index.mjs";
import {
  buildRoleOperationPathTestReport,
  decideWritebackPolicy,
  loadRoleStorylineAcceptanceMatrix,
  loadSalesGateModel,
  loadScenarioCoverage
} from "../src/contracts/index.mjs";

const root = resolve(".");
const fixture = (name) => JSON.parse(readFileSync(join(root, "fixtures", "p1-demo", name), "utf8"));

const state = {
  raw: {
    taskGraph: fixture("task-graph.sales-discover.json"),
    gaps: fixture("information-gaps.json"),
    evidence: fixture("evidence.json"),
    gateChecks: fixture("sales-gate-checks.json"),
    mirrors: fixture("external-fact-mirrors.json"),
    writebackIntents: fixture("external-writeback-intents.json"),
    agentOutputs: fixture("agent-outputs.json"),
    management: fixture("management-command-center.json")
  }
};

const writebackDecisions = state.raw.writebackIntents.map((intent) => ({
  intent_id: intent.id,
  ...decideWritebackPolicy(intent)
}));
const legacyIntegration = inspectJueyingV1Integration({ root });
const bridgePreview = buildLegacyBridgePreview({
  taskGraph: state.raw.taskGraph,
  gaps: state.raw.gaps,
  evidence: state.raw.evidence,
  writebackIntents: state.raw.writebackIntents,
  writebackDecisions
});
const runtimeHealth = await checkLegacyRuntimeHealth(legacyIntegration, { timeoutMs: 120 });

const report = buildRoleOperationPathTestReport({
  matrix: loadRoleStorylineAcceptanceMatrix(),
  scenarioCoverage: loadScenarioCoverage(),
  salesGateModel: loadSalesGateModel(),
  legacyIntegration,
  state,
  bridgePreview,
  runtimeHealth,
  root
});

const outDir = join(root, "reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "role-operation-path-tests.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!report.ok) {
  console.error("Role operation path tests failed:");
  for (const issue of report.issues) {
    console.error(`- ${issue.test_case_id} ${issue.assertion_id}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(
  `Role operation path tests OK: ` +
    `${report.summary.role_count} roles, ` +
    `${report.summary.passed_operation_path_count}/${report.summary.operation_path_count} operation paths, ` +
    `${report.summary.passed_assertion_count}/${report.summary.assertion_count} assertions`
);
