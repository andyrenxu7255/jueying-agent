import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildRoleStorylineAcceptanceReport,
  loadRoleStorylineAcceptanceMatrix,
  loadSalesGateModel,
  loadScenarioCoverage
} from "../src/contracts/index.mjs";
import { inspectJueyingV1Integration } from "../src/integrations/jueying-v1/index.mjs";

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

const report = buildRoleStorylineAcceptanceReport({
  matrix: loadRoleStorylineAcceptanceMatrix(),
  scenarioCoverage: loadScenarioCoverage(),
  salesGateModel: loadSalesGateModel(),
  legacyIntegration: inspectJueyingV1Integration({ root }),
  state,
  root
});

const outDir = join(root, "reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "storyline-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!report.ok) {
  console.error("Storyline acceptance failed:");
  for (const error of report.issues) {
    console.error(`- ${error.kind}: ${error.message}`);
  }
  process.exit(1);
}

console.log(
  `Storyline acceptance OK: ${report.summary.role_count} roles, ` +
    `${report.summary.storyline_count} storylines, ` +
    `${report.summary.passed_step_count}/${report.summary.step_count} steps, ` +
    `${report.summary.covered_story_count}/${report.summary.documented_story_count} stories, ` +
    `${report.summary.covered_gate_count}/${report.summary.sales_gate_count} sales gates`
);
