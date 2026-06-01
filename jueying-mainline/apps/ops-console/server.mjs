import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  buildExternalSyncConsoleViewModel,
  buildInformationGapInboxViewModel,
  buildManagementCommandCenterViewModel,
  buildManagementCommandDispatchPreview,
  buildOperatingConsoleViewModel,
  buildOperationPathTestViewModel,
  buildRoleStorylineAcceptanceReport,
  buildRoleOperationPathTestReport,
  buildSalesGateIndex,
  buildStorylineAcceptanceViewModel,
  buildTaskGraphViewModel,
  decideWritebackPolicy,
  evaluateSalesStage,
  loadSalesGateModel,
  validateContract
} from "../../src/contracts/index.mjs";
import {
  buildLegacyRuntimeHealthCatalog,
  buildLegacyBridgePreview,
  buildLegacyIntegrationViewModel,
  checkLegacyRuntimeHealth,
  inspectJueyingV1Integration
} from "../../src/integrations/jueying-v1/index.mjs";

const root = resolve(".");
const appDir = join(root, "apps", "ops-console");
const publicDir = join(appDir, "public");
const port = parsePort(process.env.PORT, 4173);
const runtimeState = {
  taskGraph: null,
  gaps: null,
  evidence: null,
  gateChecks: null,
  mirrors: null,
  writebackIntents: null,
  agentOutputs: null,
  management: null,
  gapReplies: [],
  externalConnectionDrafts: []
};

function fixture(name) {
  return JSON.parse(readFileSync(join(root, "fixtures", "p1-demo", name), "utf8"));
}

function loadState(options = {}) {
  ensureRuntimeState();
  const taskGraph = clone(runtimeState.taskGraph);
  const gaps = clone(runtimeState.gaps);
  const evidence = clone(runtimeState.evidence);
  const gateChecks = clone(runtimeState.gateChecks);
  const mirrors = clone(runtimeState.mirrors);
  const writebackIntents = clone(runtimeState.writebackIntents);
  const agentOutputs = clone(runtimeState.agentOutputs);
  const management = clone(runtimeState.management);
  if (options.userId && management.roles.some((role) => role.user_id === options.userId)) {
    management.active_user_id = options.userId;
  }
  const salesGateModel = loadSalesGateModel();
  const salesGateIndex = buildSalesGateIndex(salesGateModel);
  const discoverAudit = evaluateSalesStage(
    {
      stage: "discover",
      opportunityId: "opp_acme_001",
      ownerId: "user_sales_andy",
      evidence
    },
    salesGateModel
  );

  const operatingConsole = buildOperatingConsoleViewModel({
    taskGraph,
    gateChecks,
    mirrors,
    writebackIntents,
    gaps,
    management
  });

  const taskGraphView = buildTaskGraphViewModel({ taskGraph, evidence, gaps });
  const gapInbox = buildInformationGapInboxViewModel({
    gaps,
    taskGraph,
    gapReplies: clone(runtimeState.gapReplies)
  });
  const externalSync = buildExternalSyncConsoleViewModel({ mirrors, writebackIntents });

  const writebackDecisions = writebackIntents.map((intent) => ({
    intent_id: intent.id,
    ...buildVisibleWritebackDecision(intent)
  }));
  const legacyIntegration = inspectJueyingV1Integration({ root });
  const legacyIntegrationView = buildLegacyIntegrationViewModel(legacyIntegration);
  const legacyBridgePreview = buildLegacyBridgePreview({
    taskGraph,
    gaps,
    evidence,
    writebackIntents,
    writebackDecisions
  });
  const managementCommandCenter = buildManagementCommandCenterViewModel({
    management,
    taskGraph,
    gaps,
    evidence,
    bridgePreview: legacyBridgePreview
  });
  const storylineAcceptance = buildRoleStorylineAcceptanceReport({
    legacyIntegration,
    salesGateModel,
    state: {
      raw: {
        taskGraph,
        gaps,
        evidence,
        gateChecks,
        mirrors,
        writebackIntents,
        agentOutputs,
        management
      }
    },
    root
  });
  const storylineAcceptanceView = buildStorylineAcceptanceViewModel(storylineAcceptance);
  const operationPathTests = buildRoleOperationPathTestReport({
    legacyIntegration,
    salesGateModel,
    state: {
      raw: {
        taskGraph,
        gaps,
        evidence,
        gateChecks,
        mirrors,
        writebackIntents,
        agentOutputs,
        management
      }
    },
    bridgePreview: legacyBridgePreview,
    runtimeHealth: buildLegacyRuntimeHealthCatalog(legacyIntegration),
    root
  });
  const operationPathTestView = buildOperationPathTestViewModel(operationPathTests);

  const contractHealth = validateState({
    taskGraph,
    gaps,
    evidence,
    gateChecks,
    mirrors,
    writebackIntents,
    agentOutputs,
    management,
    salesGateModel
  });

  return {
    generated_at: new Date().toISOString(),
    product: {
      name: "JueYing Agent Harness",
      workspace: "D:/teamclaw/jueying-mainline",
      stage: "P1 mainline operating console"
    },
    views: {
      operating_console: operatingConsole,
      management_command_center: managementCommandCenter,
      sales_stage_gate_index: buildSalesStageGateIndexViewModel({
        salesGateModel,
        gateChecks,
        evidence
      }),
      task_graph: taskGraphView,
      information_gap_inbox: gapInbox,
      external_sync_console: externalSync,
      legacy_integration: legacyIntegrationView,
      legacy_bridge_preview: legacyBridgePreview,
      storyline_acceptance: storylineAcceptanceView,
      operation_path_tests: operationPathTestView
    },
    sales: {
      discover_audit: discoverAudit,
      gate_count: salesGateIndex.size,
      stage_gate_index: buildSalesStageGateIndexViewModel({
        salesGateModel,
        gateChecks,
        evidence
      })
    },
    external_sync: {
      writeback_policy_decisions: writebackDecisions
    },
    legacy_integration: {
      report: legacyIntegration,
      bridge_preview: legacyBridgePreview
    },
    storyline_acceptance: {
      report: storylineAcceptance
    },
    operation_path_tests: {
      report: operationPathTests
    },
    raw: {
      taskGraph,
      gaps,
      evidence,
      gateChecks,
      mirrors,
      writebackIntents,
      agentOutputs,
      management,
      gapReplies: clone(runtimeState.gapReplies),
      externalConnectionDrafts: clone(runtimeState.externalConnectionDrafts)
    },
    health: contractHealth
  };
}

function validateState(state) {
  const salesGateIndex = buildSalesGateIndex(state.salesGateModel);
  const issues = [];

  collectIssues("taskGraph", state.taskGraph, {});
  for (const item of state.gaps) collectIssues("informationGap", item, {});
  for (const item of state.evidence) collectIssues("evidence", item, {});
  for (const item of state.gateChecks) collectIssues("salesGateCheck", item, { salesGateIndex });
  for (const item of state.mirrors) collectIssues("externalFactMirror", item, {});
  for (const item of state.writebackIntents) collectIssues("externalWritebackIntent", item, {});
  for (const item of state.agentOutputs) collectIssues("agentOutput", item, {});
  collectIssues("managementCommandCenter", state.management, {});

  function collectIssues(kind, value, options) {
    const result = validateContract(kind, value, options);
    if (!result.ok) {
      for (const issue of result.issues) {
        issues.push({ kind, id: value?.id, ...issue });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issue_count: issues.length,
    issues
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/state") {
      sendJson(res, 200, loadState({ userId: url.searchParams.get("user_id") }));
      return;
    }

    if (url.pathname === "/api/management/command-center") {
      const state = loadState({ userId: url.searchParams.get("user_id") });
      sendJson(res, 200, {
        view_model: state.views.management_command_center,
        raw: state.raw.management
      });
      return;
    }

    if (url.pathname === "/api/management/dispatch-preview") {
      const state = loadState({ userId: url.searchParams.get("user_id") });
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      if (body.user_id && state.raw.management.roles.some((role) => role.user_id === body.user_id)) {
        state.raw.management.active_user_id = body.user_id;
      }
      sendJson(res, 200, buildManagementCommandDispatchPreview({
        management: state.raw.management,
        commandInput: body,
        taskGraph: state.raw.taskGraph
      }));
      return;
    }

    if (url.pathname === "/api/management/commands" && req.method === "POST") {
      const state = loadState({ userId: url.searchParams.get("user_id") });
      const body = await readJsonBody(req);
      if (body.user_id && state.raw.management.roles.some((role) => role.user_id === body.user_id)) {
        state.raw.management.active_user_id = body.user_id;
      }
      const preview = buildManagementCommandDispatchPreview({
        management: state.raw.management,
        commandInput: body,
        taskGraph: state.raw.taskGraph
      });
      if (!preview.ok) {
        sendJson(res, 403, {
          error: "forbidden",
          warnings: preview.warnings,
          preview
        });
        return;
      }
      const created = createManagementCommand(preview);
      sendJson(res, 201, {
        created,
        view_model: loadState({ userId: body.user_id ?? url.searchParams.get("user_id") }).views.management_command_center,
        raw: clone(runtimeState.management)
      });
      return;
    }

    if (url.pathname === "/api/evidence" && req.method === "POST") {
      const body = await readJsonBody(req);
      const created = createEvidence(body);
      sendJson(res, 201, {
        evidence: created,
        view_model: loadState({ userId: body.user_id ?? url.searchParams.get("user_id") }).views.task_graph,
        raw: clone(runtimeState.evidence)
      });
      return;
    }

    if (url.pathname.startsWith("/api/information-gaps/") && url.pathname.endsWith("/reply") && req.method === "POST") {
      const gapId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      const body = await readJsonBody(req);
      const updated = replyToInformationGap(gapId, body);
      sendJson(res, 200, {
        gap: updated,
        view_model: loadState({ userId: body.user_id ?? url.searchParams.get("user_id") }).views.information_gap_inbox,
        raw: clone(runtimeState.gaps)
      });
      return;
    }

    if (url.pathname.startsWith("/api/writebacks/") && req.method === "POST") {
      const [, , , intentId, action] = url.pathname.split("/");
      if (!["approve", "reject"].includes(action)) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      const body = await readJsonBody(req);
      const updated = decideWritebackIntent(decodeURIComponent(intentId ?? ""), action, body);
      sendJson(res, 200, {
        writeback_intent: updated,
        view_model: loadState({ userId: body.user_id ?? url.searchParams.get("user_id") }).views.external_sync_console,
        raw: clone(runtimeState.writebackIntents)
      });
      return;
    }

    if (url.pathname === "/api/external-connections/drafts" && req.method === "POST") {
      const body = await readJsonBody(req);
      const draft = createExternalConnectionDraft(body);
      sendJson(res, 201, {
        draft,
        drafts: clone(runtimeState.externalConnectionDrafts)
      });
      return;
    }

    if (url.pathname === "/api/sales/gates") {
      const state = loadState({ userId: url.searchParams.get("user_id") });
      sendJson(res, 200, state.sales.stage_gate_index);
      return;
    }

    if (url.pathname === "/api/jueying/mainline/capabilities" || url.pathname === "/api/legacy/capabilities") {
      const report = inspectJueyingV1Integration({ root });
      sendJson(res, 200, {
        report,
        view_model: buildLegacyIntegrationViewModel(report)
      });
      return;
    }

    if (url.pathname === "/api/storylines") {
      const state = loadState({ userId: url.searchParams.get("user_id") });
      sendJson(res, 200, {
        report: state.storyline_acceptance.report,
        view_model: state.views.storyline_acceptance
      });
      return;
    }

    if (url.pathname === "/api/operation-paths") {
      const state = loadState({ userId: url.searchParams.get("user_id") });
      sendJson(res, 200, {
        report: state.operation_path_tests.report,
        view_model: state.views.operation_path_tests
      });
      return;
    }

    if (url.pathname === "/api/jueying/mainline/bridge-preview" || url.pathname === "/api/legacy/bridge-preview") {
      const state = loadState({ userId: url.searchParams.get("user_id") });
      sendJson(res, 200, state.legacy_integration.bridge_preview);
      return;
    }

    if (url.pathname === "/api/jueying/mainline/runtime-health" || url.pathname === "/api/legacy/runtime-health") {
      const report = inspectJueyingV1Integration({ root });
      const timeoutMs = parseBoundedInteger(url.searchParams.get("timeout_ms"), 600, 50, 10000);
      sendJson(res, 200, await checkLegacyRuntimeHealth(report, { timeoutMs }));
      return;
    }

    if (url.pathname === "/health") {
      const state = loadState();
      sendJson(res, state.health.ok ? 200 : 500, state.health);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, status, {
      error: status >= 500 ? "internal_error" : "bad_request",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^[/\\]+/, "");
  const filePath = resolve(publicDir, requested);
  const relativePath = relative(publicDir, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function ensureRuntimeState() {
  if (runtimeState.taskGraph) return;
  runtimeState.taskGraph = fixture("task-graph.sales-discover.json");
  runtimeState.gaps = fixture("information-gaps.json");
  runtimeState.evidence = fixture("evidence.json");
  runtimeState.gateChecks = fixture("sales-gate-checks.json");
  runtimeState.mirrors = fixture("external-fact-mirrors.json");
  runtimeState.writebackIntents = fixture("external-writeback-intents.json");
  runtimeState.agentOutputs = fixture("agent-outputs.json");
  runtimeState.management = fixture("management-command-center.json");
  runtimeState.gapReplies = [];
  runtimeState.externalConnectionDrafts = [];
}

function buildSalesStageGateIndexViewModel({ salesGateModel, gateChecks, evidence }) {
  const checksByGate = new Map((gateChecks ?? []).map((check) => [check.gate_id, check]));
  const evidenceTypes = new Set((evidence ?? []).map((item) => item.evidence_type));
  const stages = Object.entries(salesGateModel?.stages ?? {}).map(([stageId, stage]) => {
    const gates = (stage.gates ?? []).map((gate) => {
      const check = checksByGate.get(gate.id);
      const sampleEvidenceTypes = (gate.evidence_types ?? []).filter((type) => evidenceTypes.has(type));
      return {
        id: gate.id,
        stage: stageId,
        label: gate.label,
        status: check?.status ?? "sample_not_loaded",
        evidence_state: check ? "sample_check" : "gate_index_only",
        evidence_ids: check?.evidence_ids ?? [],
        information_gap_ids: check?.information_gap_ids ?? [],
        evidence_types: gate.evidence_types ?? [],
        sample_evidence_types: sampleEvidenceTypes,
        recommended_activity_count: (gate.recommended_activities ?? []).length
      };
    });
    return {
      id: stageId,
      label: stage.label,
      goal: stage.goal,
      gate_count: gates.length,
      sample_check_count: gates.filter((gate) => gate.evidence_state === "sample_check").length,
      gates
    };
  });
  return {
    stage_order: salesGateModel?.stage_order ?? stages.map((stage) => stage.id),
    stage_count: stages.length,
    gate_count: stages.reduce((total, stage) => total + stage.gate_count, 0),
    checked_gate_count: stages.reduce((total, stage) => total + stage.sample_check_count, 0),
    sample_scope: "P1 fixture evidence currently exercises Discover; other stages are exposed as gate_index_only until evidence is submitted.",
    stages
  };
}

function createManagementCommand(preview) {
  ensureRuntimeState();
  const command = rewritePreviewTaskIds(preview.command);
  command.generated_task_ids = (command.generated_task_ids ?? []).map((id) => rewriteId(id));
  const executionTasks = preview.execution_tasks.map((task) => rewritePreviewTaskIds(task));
  const executionUpdates = preview.execution_updates.map((update) => rewritePreviewTaskIds(update));
  runtimeState.management.commands = upsertById(runtimeState.management.commands, command);
  runtimeState.management.execution_tasks = upsertManyById(runtimeState.management.execution_tasks, executionTasks);
  runtimeState.management.execution_updates = upsertManyById(runtimeState.management.execution_updates, executionUpdates);
  const project = runtimeState.management.projects.find((item) => item.id === command.project_id);
  if (project && !project.command_ids.includes(command.id)) {
    project.command_ids.push(command.id);
    project.status = command.trigger_type === "manual" ? "in_progress" : project.status;
  }
  for (const task of executionTasks) {
    const lane = runtimeState.management.swimlanes.find((item) => item.status === task.status) ??
      runtimeState.management.swimlanes.find((item) => item.id === "lane_in_progress");
    if (lane && !lane.task_ids.includes(task.id)) {
      lane.task_ids.push(task.id);
    }
  }
  return {
    command,
    execution_tasks: executionTasks,
    execution_updates: executionUpdates
  };
}

function createEvidence(input) {
  ensureRuntimeState();
  const now = nowIso();
  const evidence = {
    id: `ev_user_${slugify(input.title ?? input.evidence_type ?? "evidence")}_${Date.now().toString(36)}`,
    evidence_type: input.evidence_type ?? "customer_quote",
    source_type: input.source_type ?? "human",
    source_actor_id: input.source_actor_id ?? input.user_id ?? "user_exec_lina",
    capture_channel: input.capture_channel ?? "web",
    task_id: input.task_id || undefined,
    business_refs: input.opportunity_id ? { opportunity_id: input.opportunity_id } : undefined,
    content_ref: {
      kind: input.content_kind ?? "text",
      value: input.value ?? input.summary ?? "Submitted from Ops Console",
      summary: input.summary ?? input.value ?? "Submitted evidence"
    },
    quality_score: parseBoundedNumber(input.quality_score, 0.7, 0, 1),
    sensitivity: input.sensitivity ?? "internal",
    created_at: now
  };
  if (!evidence.business_refs) delete evidence.business_refs;
  if (!evidence.task_id) delete evidence.task_id;
  assertValid("evidence", evidence);
  runtimeState.evidence.push(evidence);
  if (evidence.task_id) {
    const task = runtimeState.taskGraph.tasks?.find((item) => item.id === evidence.task_id);
    if (task) {
      task.evidence_ids = [...new Set([...(task.evidence_ids ?? []), evidence.id])];
    }
    for (const gap of runtimeState.gaps.filter((item) => item.task_id === evidence.task_id)) {
      if ((gap.expected_evidence_types ?? []).includes(evidence.evidence_type)) {
        gap.closed_by_evidence_ids = [...new Set([...(gap.closed_by_evidence_ids ?? []), evidence.id])];
      }
    }
  }
  for (const check of runtimeState.gateChecks) {
    const stageGate = findSalesGate(check.gate_id);
    if (stageGate?.evidence_types?.includes(evidence.evidence_type)) {
      check.evidence_ids = [...new Set([...(check.evidence_ids ?? []), evidence.id])];
      check.updated_at = now;
    }
  }
  return evidence;
}

function replyToInformationGap(gapId, input) {
  ensureRuntimeState();
  const gap = runtimeState.gaps.find((item) => item.id === gapId);
  if (!gap) {
    const error = new Error(`unknown information gap: ${gapId}`);
    error.statusCode = 404;
    throw error;
  }
  if (input.decision === "reject" || input.decision === "rebut") {
    const reply = {
      id: `gap_reply_${slugify(gapId)}_${Date.now().toString(36)}`,
      gap_id: gapId,
      decision: "rebut",
      by: input.user_id ?? gap.collector_actor_id,
      reason: input.reason ?? input.reply ?? "Rejected from Ops Console",
      created_at: nowIso()
    };
    gap.status = "waived";
    runtimeState.gapReplies.push(reply);
    return gap;
  }
  const evidence = createEvidence({
    ...input,
    evidence_type: input.evidence_type ?? gap.expected_evidence_types?.[0] ?? "meeting_summary",
    task_id: gap.task_id,
    summary: input.reply ?? input.summary ?? gap.question,
    value: input.reply ?? input.value ?? gap.question
  });
  gap.closed_by_evidence_ids = [...new Set([...(gap.closed_by_evidence_ids ?? []), evidence.id])];
  runtimeState.gapReplies.push({
    id: `gap_reply_${slugify(gapId)}_${Date.now().toString(36)}`,
    gap_id: gapId,
    decision: "evidence_submitted",
    by: input.user_id ?? gap.collector_actor_id,
    evidence_id: evidence.id,
    message: input.reply ?? input.summary ?? "Evidence submitted",
    created_at: nowIso()
  });
  return gap;
}

function decideWritebackIntent(intentId, action, input) {
  ensureRuntimeState();
  const intent = runtimeState.writebackIntents.find((item) => item.id === intentId);
  if (!intent) {
    const error = new Error(`unknown writeback intent: ${intentId}`);
    error.statusCode = 404;
    throw error;
  }
  if (action === "approve") {
    intent.confirmed_by = input.user_id ?? "user_exec_lina";
    intent.confirmed_at = nowIso();
  } else {
    intent.confirmed_by = input.user_id ?? "user_exec_lina";
    intent.confirmed_at = nowIso();
    intent.policy_decision = "reject";
    intent.payload = {
      ...intent.payload,
      rejection_reason: input.reason ?? "Rejected from Ops Console"
    };
  }
  assertValid("externalWritebackIntent", intent);
  return intent;
}

function buildVisibleWritebackDecision(intent) {
  if (intent.policy_decision === "reject") {
    return {
      decision: "reject",
      reasons: [intent.payload?.rejection_reason ?? "Rejected by human decision"]
    };
  }
  return decideWritebackPolicy(intent);
}

function createExternalConnectionDraft(input) {
  ensureRuntimeState();
  const draft = {
    id: `conn_draft_${slugify(input.provider ?? input.system_type ?? "external")}_${Date.now().toString(36)}`,
    system_type: input.system_type ?? "crm",
    provider: input.provider ?? "hubspot",
    status: "draft",
    created_by: input.user_id ?? "user_admin_it",
    created_at: nowIso(),
    field_mapping_draft: {
      object_type: input.object_type ?? "opportunity",
      external_id_sample: input.external_id_sample ?? "demo_external_id",
      notes: input.notes ?? "Drafted from Ops Console"
    }
  };
  runtimeState.externalConnectionDrafts.push(draft);
  return draft;
}

function upsertManyById(items, nextItems) {
  return nextItems.reduce((current, item) => upsertById(current, item), items);
}

function upsertById(items, nextItem) {
  const next = items.filter((item) => item.id !== nextItem.id);
  next.push(rewritePreviewTaskIds(nextItem));
  return next;
}

function rewritePreviewTaskIds(item) {
  const rewritten = { ...item };
  for (const key of ["id", "command_id", "task_id", "latest_update_id"]) {
    if (typeof rewritten[key] === "string") {
      rewritten[key] = rewriteId(rewritten[key]);
    }
  }
  return rewritten;
}

function rewriteId(value) {
  return String(value)
    .replace("cmd_preview_", "cmd_live_")
    .replace("task_preview_", "mtask_live_");
}

function findSalesGate(gateId) {
  const model = loadSalesGateModel();
  for (const stage of Object.values(model.stages ?? {})) {
    const gate = (stage.gates ?? []).find((item) => item.id === gateId);
    if (gate) return gate;
  }
  return null;
}

function assertValid(kind, value) {
  const result = validateContract(kind, value, { salesGateIndex: buildSalesGateIndex(loadSalesGateModel()) });
  if (!result.ok) {
    const error = new Error(result.issues.map((issue) => issue.message).join("; "));
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";
}

function nowIso() {
  return new Date().toISOString();
}

function parseBoundedNumber(value, fallback, min, max) {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    let settled = false;

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      callback(value);
    }

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 1024 * 1024) {
        const error = new Error("request body too large");
        error.statusCode = 413;
        settle(rejectBody, error);
      }
    });
    req.on("end", () => {
      if (settled) return;
      if (!body.trim()) {
        settle(resolveBody, {});
        return;
      }
      try {
        settle(resolveBody, JSON.parse(body));
      } catch (error) {
        error.statusCode = 400;
        settle(rejectBody, error);
      }
    });
    req.on("error", (error) => {
      settle(rejectBody, error);
    });
  });
}

function sendText(res, status, value) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(value);
}

function contentType(filePath) {
  const extension = extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extension] ?? "application/octet-stream";
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

server.listen(port, () => {
  console.log(`Ops Console listening on http://localhost:${port}`);
});
