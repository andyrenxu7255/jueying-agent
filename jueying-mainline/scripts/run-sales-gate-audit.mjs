import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateSalesStage, loadSalesGateModel } from "../src/contracts/index.mjs";

const root = resolve(".");
const evidence = JSON.parse(readFileSync(join(root, "fixtures/p1-demo/evidence.json"), "utf8"));
const model = loadSalesGateModel();

const report = evaluateSalesStage(
  {
    stage: "discover",
    opportunityId: "opp_acme_001",
    ownerId: "user_sales_andy",
    evidence
  },
  model
);

const outDir = join(root, "reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "sales-gate-audit.discover.acme.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

const confirmedLike = report.checks.filter((check) => check.status === "evidence_submitted").length;
const missing = report.checks.filter((check) => check.status === "missing").length;
console.log(`Sales gate audit OK: ${confirmedLike} evidence_submitted, ${missing} missing`);
