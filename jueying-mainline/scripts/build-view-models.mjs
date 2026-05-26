import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildExternalSyncConsoleViewModel,
  buildInformationGapInboxViewModel,
  buildOperatingConsoleViewModel,
  buildTaskGraphViewModel
} from "../src/contracts/index.mjs";

const root = resolve(".");
const fixture = (name) => JSON.parse(readFileSync(join(root, "fixtures", "p1-demo", name), "utf8"));

const taskGraph = fixture("task-graph.sales-discover.json");
const gaps = fixture("information-gaps.json");
const evidence = fixture("evidence.json");
const gateChecks = fixture("sales-gate-checks.json");
const mirrors = fixture("external-fact-mirrors.json");
const writebackIntents = fixture("external-writeback-intents.json");

const viewModels = {
  operating_console: buildOperatingConsoleViewModel({ taskGraph, gateChecks, mirrors, writebackIntents }),
  task_graph: buildTaskGraphViewModel({ taskGraph, evidence, gaps }),
  information_gap_inbox: buildInformationGapInboxViewModel({ gaps, taskGraph }),
  external_sync_console: buildExternalSyncConsoleViewModel({ mirrors, writebackIntents })
};

const outDir = join(root, "reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "view-models.p1-demo.json"), `${JSON.stringify(viewModels, null, 2)}\n`, "utf8");

console.log("View model build OK: reports/view-models.p1-demo.json");
