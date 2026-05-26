import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildLegacyBridgePreview,
  checkLegacyRuntimeHealth,
  createJueyingV1RuntimeClient,
  inspectJueyingV1Integration
} from "../src/integrations/jueying-v1/index.mjs";
import { decideWritebackPolicy } from "../src/contracts/index.mjs";

const root = resolve(".");
const fixtureDir = join(root, "fixtures", "p1-demo");
const reportPath = join(root, "reports", "live-legacy-bridge-smoke.json");
loadLegacyEnv();
process.env.JUEYING_INTERNAL_TOKEN ??= process.env.INTERNAL_TOKEN ?? "dev_internal_token";
process.env.INTERNAL_TOKEN ??= process.env.JUEYING_INTERNAL_TOKEN;

const taskGraph = readJson("task-graph.sales-discover.json");
const gaps = readJson("information-gaps.json");
const evidence = readJson("evidence.json");
const writebackIntents = readJson("external-writeback-intents.json");
const writebackDecisions = writebackIntents.map((intent) => ({
  intent_id: intent.id,
  ...decideWritebackPolicy(intent)
}));

const integration = inspectJueyingV1Integration({ root });
const health = await checkLegacyRuntimeHealth(integration, { timeoutMs: 1500 });
const requiredServices = ["workflow-service", "gateway-adapter", "fact-retrieval"];
const offlineRequired = health.services.filter(
  (service) => requiredServices.includes(service.service_name) && !service.online
);

if (offlineRequired.length > 0) {
  writeReport({
    ok: false,
    phase: "runtime_health",
    health,
    operations: [],
    message: `Required legacy services are offline: ${offlineRequired.map((service) => service.service_name).join(", ")}`
  });
  throw new Error(`Required legacy services are offline: ${offlineRequired.map((service) => service.service_name).join(", ")}`);
}

const bridgePreview = buildLegacyBridgePreview({
  taskGraph,
  gaps,
  evidence,
  writebackIntents,
  writebackDecisions
});
const client = createJueyingV1RuntimeClient({ timeoutMs: 8000 });
const operations = [];

operations.push(await client.createWorkflowFromTaskGraph(taskGraph, {
  owner_user_id: "u_ai_native_ops",
  user_role: "admin"
}));

for (const gap of gaps.filter((item) => !["closed", "waived"].includes(item.status))) {
  operations.push(await client.createOrgTaskFromInformationGap(gap, {
    created_by: null,
    org_id: null,
    target_channels: ["wecom", "feishu"]
  }));
}

for (const item of evidence) {
  operations.push(await client.writeFactFromEvidence(item, {
    owner_user_id: "u_ai_native_ops"
  }));
}

const workflowRef = operations.find((operation) => operation.operation === "createWorkflowFromTaskGraph")
  ?.response?.body?.workflow_instance_ref;

if (workflowRef) {
  operations.push({
    operation: "readWorkflowProgress",
    response: await client.readWorkflowProgress(workflowRef, {
      owner_user_id: "u_ai_native_ops",
      acting_role: "admin"
    })
  });
}

operations.push({
  operation: "listOrgTasks",
  response: await client.get("gateway", "/admin/tasks", { internal: true })
});

const failed = operations.filter((operation) => {
  if ("ok" in operation) return !operation.ok;
  return !operation.response?.ok;
});
const report = {
  ok: failed.length === 0,
  generated_at: new Date().toISOString(),
  phase: "live_bridge",
  health,
  bridge_summary: bridgePreview.summary,
  workflow_ref: workflowRef ?? null,
  operations: operations.map(redactOperation),
  failed_operations: failed.map((operation) => operation.operation)
};

writeReport(report);

if (!report.ok) {
  throw new Error(`Live legacy bridge smoke failed: ${report.failed_operations.join(", ")}`);
}

console.log(
  `Live legacy bridge smoke OK: workflow=${workflowRef}, ` +
  `${bridgePreview.summary.org_task_payload_count} org task(s), ` +
  `${bridgePreview.summary.fact_write_payload_count} fact write(s)`
);

function readJson(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

function loadLegacyEnv() {
  const envPath = join(root, "legacy", "jueying-v1", "agent-harness", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
    if (key === "INTERNAL_TOKEN" && process.env.JUEYING_INTERNAL_TOKEN === undefined) {
      process.env.JUEYING_INTERNAL_TOKEN = value;
    }
  }
}

function writeReport(report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function redactOperation(operation) {
  const response = operation.response ?? {};
  return {
    operation: operation.operation,
    ok: "ok" in operation ? operation.ok : response.ok,
    degraded: "degraded" in operation ? operation.degraded : response.degraded,
    service: response.service,
    path: response.path,
    url: response.url,
    status: response.status,
    latency_ms: response.latency_ms,
    error: response.error,
    body: response.body
  };
}
