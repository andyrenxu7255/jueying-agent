import { spawn } from "node:child_process";

const port = 4183;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["apps/ops-console/server.mjs"], {
  env: {
    ...process.env,
    PORT: String(port)
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForServer();
  await checkJson("/health", (json) => json.ok === true, "health ok");
  await checkJson("/api/state", (json) => {
    return json.health?.ok === true &&
      json.views?.operating_console &&
      json.sales?.discover_audit?.checks?.length === 7 &&
      json.views?.storyline_acceptance?.summary?.step_count >= 40 &&
      json.views?.storyline_acceptance?.ok === true &&
      json.product?.name === "JueYing Agent Harness" &&
      json.views?.legacy_integration?.summary?.critical_ready >= 10;
  }, "state payload");
  await checkJson("/api/storylines", (json) => {
    return json.report?.ok === true &&
      json.view_model?.summary?.role_count >= 10 &&
      json.view_model?.summary?.covered_story_count === json.view_model?.summary?.documented_story_count &&
      json.view_model?.summary?.covered_gate_count === json.view_model?.summary?.sales_gate_count;
  }, "storyline acceptance payload");
  await checkJson("/api/legacy/capabilities", (json) => {
    return json.report?.ok === true &&
      json.view_model?.summary?.route_count >= 50 &&
      json.view_model?.summary?.data_object_count >= 30;
  }, "legacy capabilities payload");
  await checkJson("/api/jueying/mainline/capabilities", (json) => {
    return json.report?.ok === true &&
      json.view_model?.summary?.route_count >= 50 &&
      json.view_model?.summary?.data_object_count >= 30;
  }, "JueYing mainline capabilities payload");
  await checkJson("/api/legacy/bridge-preview", (json) => {
    return json.ok === true &&
      json.summary?.workflow_stage_count >= 1 &&
      json.summary?.org_task_payload_count >= 1 &&
      json.summary?.fact_write_payload_count >= 1;
  }, "legacy bridge preview payload");
  await checkJson("/api/jueying/mainline/bridge-preview", (json) => {
    return json.ok === true &&
      json.summary?.workflow_stage_count >= 1 &&
      json.summary?.org_task_payload_count >= 1 &&
      json.summary?.fact_write_payload_count >= 1;
  }, "JueYing mainline bridge preview payload");
  await checkJson("/api/legacy/runtime-health?timeout_ms=120", (json) => {
    return typeof json.service_count === "number" &&
      Array.isArray(json.services) &&
      json.service_count >= 5;
  }, "legacy runtime health payload");
  await checkJson("/api/jueying/mainline/runtime-health?timeout_ms=120", (json) => {
    return typeof json.service_count === "number" &&
      Array.isArray(json.services) &&
      json.service_count >= 5;
  }, "JueYing mainline runtime health payload");
  await checkText("/", (text) => {
    return text.includes("JueYing") &&
      text.includes("Agent Harness") &&
      text.includes("view-overview") &&
      text.includes("view-legacy") &&
      text.includes("legacy-runtime") &&
      text.includes("view-storylines");
  }, "index html");
  console.log("App smoke OK");
} finally {
  child.kill();
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(150);
    }
  }
  throw new Error(`server did not start. Output:\n${output}`);
}

async function checkJson(path, predicate, label) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}`);
  }
  const json = await response.json();
  if (!predicate(json)) {
    throw new Error(`${label} predicate failed`);
  }
}

async function checkText(path, predicate, label) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}`);
  }
  const text = await response.text();
  if (!predicate(text)) {
    throw new Error(`${label} predicate failed`);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
