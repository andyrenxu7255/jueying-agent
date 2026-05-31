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
      json.views?.management_command_center?.summary?.scheduled_command_count >= 1 &&
      json.views?.management_command_center?.summary?.condition_command_count >= 1 &&
      json.views?.management_command_center?.permissions?.can_create_command === true &&
      json.sales?.discover_audit?.checks?.length === 7 &&
      json.views?.storyline_acceptance?.summary?.step_count >= 40 &&
      json.views?.storyline_acceptance?.ok === true &&
      json.views?.operation_path_tests?.summary?.operation_path_count >= 40 &&
      json.views?.operation_path_tests?.summary?.failed_operation_path_count === 0 &&
      json.views?.operation_path_tests?.ok === true &&
      json.product?.name === "JueYing Agent Harness" &&
      json.views?.legacy_integration?.summary?.critical_ready >= 10;
  }, "state payload");
  await checkJson("/api/management/command-center", (json) => {
    return json.view_model?.ok === true &&
      json.view_model?.summary?.command_count >= 3 &&
      json.view_model?.summary?.decomposed_task_count >= 5 &&
      json.view_model?.summary?.in_progress_task_count >= 1 &&
      json.view_model?.summary?.result_task_count >= 1 &&
      json.view_model?.swimlanes?.some((lane) => lane.title === "缺信息" && lane.tasks.length >= 1) &&
      json.view_model?.swimlanes?.some((lane) =>
        lane.tasks?.some((task) => task.progress_percent >= 0 && task.latest_update?.message)
      ) &&
      json.view_model?.swimlanes?.some((lane) =>
        lane.tasks?.some((task) => task.result_summary)
      ) &&
      json.raw?.commands?.some((command) => command.trigger_type === "condition");
  }, "management command center payload");
  await checkJson("/api/management/command-center?user_id=sales_agent_001", (json) => {
    return json.view_model?.ok === true &&
      json.view_model?.active_role?.user_id === "sales_agent_001" &&
      json.view_model?.permissions?.can_create_command === false &&
      json.view_model?.commands?.length >= 1 &&
      json.view_model?.swimlanes?.some((lane) =>
        lane.tasks?.some((task) => task.owner?.id === "sales_agent_001" && task.latest_update?.message)
      ) &&
      json.view_model?.commands?.every((command) =>
        command.delegation_chain?.some((item) => item.actor_id === "sales_agent_001")
      );
  }, "management command center sales-agent read-only payload");
  await checkJson("/api/management/dispatch-preview", (json) => {
    return json.ok === true &&
      json.command?.delegation_chain?.some((item) => item.actor_type === "executive") &&
      json.command?.delegation_chain?.some((item) => item.actor_type.endsWith("_agent")) &&
      json.command?.generated_task_ids?.length === 3 &&
      json.execution_tasks?.length === 3 &&
      json.execution_updates?.some((update) => update.update_type === "decomposition") &&
      json.task?.owner_actor_type === "pm_agent";
  }, "management dispatch preview payload");
  await checkJson("/api/management/dispatch-preview?user_id=sales_agent_001", (json) => {
    return json.ok === false &&
      json.warnings?.length >= 1 &&
      json.command?.created_by_role_id === "role_sales_agent" &&
      json.command?.delegation_chain?.[0]?.actor_type === "executive" &&
      json.command?.delegation_chain?.[0]?.actor_id === "user_exec_lina";
  }, "management dispatch preview read-only role payload");
  await checkJson("/api/storylines", (json) => {
    return json.report?.ok === true &&
      json.view_model?.summary?.role_count >= 10 &&
      json.view_model?.summary?.covered_story_count === json.view_model?.summary?.documented_story_count &&
      json.view_model?.summary?.covered_gate_count === json.view_model?.summary?.sales_gate_count;
  }, "storyline acceptance payload");
  await checkJson("/api/operation-paths", (json) => {
    return json.report?.ok === true &&
      json.view_model?.summary?.role_count >= 10 &&
      json.view_model?.summary?.operation_path_count >= 40 &&
      json.view_model?.summary?.failed_operation_path_count === 0 &&
      json.view_model?.summary?.failed_assertion_count === 0;
  }, "operation path payload");
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
      text.includes("view-management") &&
      text.includes("command-form") &&
      text.includes("role-switcher") &&
      text.includes("view-legacy") &&
      text.includes("legacy-runtime") &&
      text.includes("view-storylines") &&
      text.includes("operation-path-summary");
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
