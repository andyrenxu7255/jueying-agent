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
      json.views?.operating_console?.role_action_count >= 3 &&
      json.views?.operating_console?.role_action_queue?.some((action) => action.target_view === "management") &&
      json.views?.operating_console?.role_action_queue?.some((action) => action.target_view === "gates") &&
      json.views?.management_command_center?.summary?.scheduled_command_count >= 1 &&
      json.views?.management_command_center?.summary?.condition_command_count >= 1 &&
      json.views?.management_command_center?.permissions?.can_create_command === true &&
      json.views?.sales_stage_gate_index?.stage_count === 6 &&
      json.views?.sales_stage_gate_index?.gate_count >= 27 &&
      json.views?.sales_stage_gate_index?.stages?.every((stage) => stage.gates?.length > 0) &&
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
      !json.view_model?.swimlanes?.some((lane) =>
        lane.tasks?.some((task) => task.owner?.id === "delivery_agent_001")
      ) &&
      json.view_model?.commands?.every((command) =>
        command.delegation_chain?.some((item) => item.actor_id === "sales_agent_001")
      );
  }, "management command center sales-agent read-only payload");
  await checkJson("/api/state?user_id=sales_agent_001", (json) => {
    return json.views?.operating_console?.active_role?.user_id === "sales_agent_001" &&
      json.views?.operating_console?.role_action_queue?.length >= 1 &&
      json.views?.operating_console?.role_action_queue?.every((action) =>
        action.source_type !== "management_execution_task" ||
        action.owner?.id === "sales_agent_001"
      ) &&
      json.views?.operating_console?.role_action_queue?.some((action) =>
        action.source_type === "management_execution_task" &&
        action.status === "needs_info"
      );
  }, "role action queue sales-agent payload");
  await checkJson("/api/management/dispatch-preview", (json) => {
    return json.ok === true &&
      json.command?.delegation_chain?.some((item) => item.actor_type === "executive") &&
      json.command?.delegation_chain?.some((item) => item.actor_type.endsWith("_agent")) &&
      json.command?.generated_task_ids?.length === 3 &&
      json.execution_tasks?.length === 3 &&
      json.execution_updates?.some((update) => update.update_type === "decomposition") &&
      json.task?.owner_actor_type === "pm_agent";
  }, "management dispatch preview payload");
  await checkJson("/api/management/dispatch-preview", (json) => {
    return json.ok === true;
  }, "management dispatch preview empty POST payload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: ""
  });
  await checkStatus("/api/management/dispatch-preview", 400, "management dispatch preview malformed JSON", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });
  await checkStatus("/api/management/dispatch-preview", 413, "management dispatch preview oversized body", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat((1024 * 1024) + 1)
  });
  await checkJson("/api/management/dispatch-preview?user_id=sales_agent_001", (json) => {
    return json.ok === false &&
      json.warnings?.length >= 1 &&
      json.command?.created_by_role_id === "role_sales_agent" &&
      json.command?.delegation_chain?.[0]?.actor_type === "executive" &&
      json.command?.delegation_chain?.[0]?.actor_id === "user_exec_lina";
  }, "management dispatch preview read-only role payload");
  const commandTitle = `Smoke live command ${Date.now()}`;
  await checkJson("/api/management/commands", (json) => {
    return json.created?.command?.title === commandTitle &&
      json.raw?.commands?.some((command) => command.title === commandTitle) &&
      json.view_model?.commands?.some((command) => command.title === commandTitle) &&
      json.view_model?.swimlanes?.some((lane) => lane.tasks?.some((task) => task.title.includes(commandTitle)));
  }, "management command create persists payload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "user_exec_lina",
      title: commandTitle,
      objective: "Smoke verifies a submitted command survives a refreshed command-center model.",
      trigger_type: "manual",
      specialized_agent_type: "sales_agent"
    })
  });
  await checkJson("/api/management/command-center", (json) => {
    return json.raw?.commands?.some((command) => command.title === commandTitle) &&
      json.view_model?.swimlanes?.some((lane) => lane.tasks?.some((task) => task.title.includes(commandTitle)));
  }, "management command remains after refresh");
  await checkJson("/api/evidence", (json) => {
    return json.evidence?.evidence_type === "customer_quote" &&
      json.raw?.some((item) => item.id === json.evidence.id);
  }, "evidence submit payload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "user_exec_lina",
      task_id: "task_discover_champion",
      evidence_type: "customer_quote",
      summary: "Smoke evidence confirms a champion signal."
    })
  });
  await checkJson("/api/external-connections/drafts", (json) => {
    return json.draft?.status === "draft" &&
      json.drafts?.some((draft) => draft.id === json.draft.id);
  }, "external connection draft payload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "user_admin_it",
      system_type: "crm",
      provider: "hubspot",
      notes: "Smoke draft mapping."
    })
  });
  await checkJson("/api/sales/gates", (json) => {
    return json.stage_count === 6 &&
      json.gate_count >= 27 &&
      json.stages?.some((stage) => stage.id === "negotiate_close" && stage.gates?.some((gate) => gate.id === "N-G4")) &&
      json.stages?.some((stage) => stage.id === "discover" && stage.sample_check_count >= 1);
  }, "sales six stage gate index payload");
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
  await checkJson("/api/jueying/mainline/runtime-health?timeout_ms=not-a-number", (json) => {
    return typeof json.service_count === "number" &&
      Array.isArray(json.services) &&
      json.service_count >= 5;
  }, "JueYing mainline runtime health fallback timeout payload");
  await checkStatus("/../package.json", 404, "static traversal normalized by URL is not served");
  await checkStatus("/%2e%2e/package.json", 404, "encoded static traversal is not served");
  await checkText("/", (text) => {
    return text.includes("JueYing") &&
      text.includes("Agent Harness") &&
      text.includes("view-overview") &&
      text.includes("role-action-list") &&
      text.includes("view-management") &&
      text.includes("command-form") &&
      text.includes("role-switcher") &&
      text.includes("view-legacy") &&
      text.includes("legacy-runtime") &&
      text.includes("view-storylines") &&
      text.includes("operation-path-summary");
  }, "index html");
  await checkJson("/api/information-gaps/gap_discover_champion/reply", (json) => {
    const gapView = json.view_model?.gaps?.find((gap) => gap.id === "gap_discover_champion");
    return json.gap?.status === "waived" &&
      gapView?.status === "waived" &&
      gapView?.last_reply?.decision === "rebut" &&
      gapView?.last_reply?.reason === "Smoke rebuts this gap.";
  }, "information gap rebut payload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "user_exec_lina",
      decision: "rebut",
      reason: "Smoke rebuts this gap."
    })
  });
  await checkJson("/api/writebacks/wbi_crm_note_acme_001/reject", (json) => {
    const visibleIntent = json.view_model?.writeback_queue?.find((intent) => intent.id === "wbi_crm_note_acme_001");
    return json.writeback_intent?.policy_decision === "reject" &&
      json.writeback_intent?.confirmed_by === "user_exec_lina" &&
      visibleIntent?.policy_decision === "reject";
  }, "writeback reject payload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: "user_exec_lina",
      reason: "Smoke rejects this writeback."
    })
  });
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

async function checkJson(path, predicate, label, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}`);
  }
  const json = await response.json();
  if (!predicate(json)) {
    throw new Error(`${label} predicate failed`);
  }
}

async function checkStatus(path, expectedStatus, label, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected status ${expectedStatus}, got ${response.status}`);
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
