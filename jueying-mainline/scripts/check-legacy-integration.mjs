import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertJueyingV1Integration,
  buildLegacyBridgePreview,
  buildLegacyIntegrationViewModel
} from "../src/integrations/jueying-v1/index.mjs";

const root = resolve(".");
const report = assertJueyingV1Integration();
const viewModel = buildLegacyIntegrationViewModel(report);
const fixtureDir = join(root, "fixtures", "p1-demo");
const bridgePreview = buildLegacyBridgePreview({
  taskGraph: readJson(join(fixtureDir, "task-graph.sales-discover.json")),
  gaps: readJson(join(fixtureDir, "information-gaps.json")),
  evidence: readJson(join(fixtureDir, "evidence.json")),
  writebackIntents: readJson(join(fixtureDir, "external-writeback-intents.json"))
});

if (!bridgePreview.ok || bridgePreview.summary.workflow_stage_count < 1) {
  throw new Error("legacy bridge preview failed to build workflow payload");
}

mkdirSync(join(root, "reports"), { recursive: true });
writeFileSync(
  join(root, "reports", "legacy-integration.jueying-v1.json"),
  `${JSON.stringify({ report, view_model: viewModel, bridge_preview: bridgePreview }, null, 2)}\n`,
  "utf8"
);

console.log(
  `Legacy integration OK: ${report.totals.adapter_ready_count}/${report.totals.capability_count} capabilities, ` +
  `${report.totals.route_count} routes, ${report.totals.data_object_count} data objects`
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
