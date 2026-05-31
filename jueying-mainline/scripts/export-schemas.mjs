import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contractSchemas } from "../src/contracts/index.mjs";

const root = resolve(".");
const schemaDir = join(root, "schemas");

mkdirSync(schemaDir, { recursive: true });

const schemaFiles = {
  taskGraph: "task-graph.schema.json",
  informationGap: "information-gap.schema.json",
  evidence: "evidence.schema.json",
  salesGateCheck: "sales-gate-check.schema.json",
  externalFactMirror: "external-fact-mirror.schema.json",
  externalWritebackIntent: "external-writeback-intent.schema.json",
  agentOutput: "agent-output.schema.json",
  managementCommandCenter: "management-command-center.schema.json"
};

for (const [kind, fileName] of Object.entries(schemaFiles)) {
  const schema = contractSchemas[kind];
  writeFileSync(join(schemaDir, fileName), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}

console.log(`Exported ${Object.keys(schemaFiles).length} schemas to schemas/`);
