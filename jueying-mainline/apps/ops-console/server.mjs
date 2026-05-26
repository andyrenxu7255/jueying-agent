import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import {
  buildExternalSyncConsoleViewModel,
  buildInformationGapInboxViewModel,
  buildOperatingConsoleViewModel,
  buildRoleStorylineAcceptanceReport,
  buildSalesGateIndex,
  buildStorylineAcceptanceViewModel,
  buildTaskGraphViewModel,
  decideWritebackPolicy,
  evaluateSalesStage,
  loadSalesGateModel,
  validateContract
} from "../../src/contracts/index.mjs";
import {
  buildLegacyBridgePreview,
  buildLegacyIntegrationViewModel,
  checkLegacyRuntimeHealth,
  inspectJueyingV1Integration
} from "../../src/integrations/jueying-v1/index.mjs";

const root = resolve(".");
const appDir = join(root, "apps", "ops-console");
const publicDir = join(appDir, "public");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

function fixture(name) {
  return JSON.parse(readFileSync(join(root, "fixtures", "p1-demo", name), "utf8"));
}

function loadState() {
  const taskGraph = fixture("task-graph.sales-discover.json");
  const gaps = fixture("information-gaps.json");
  const evidence = fixture("evidence.json");
  const gateChecks = fixture("sales-gate-checks.json");
  const mirrors = fixture("external-fact-mirrors.json");
  const writebackIntents = fixture("external-writeback-intents.json");
  const agentOutputs = fixture("agent-outputs.json");
  const salesGateModel = loadSalesGateModel();
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
    writebackIntents
  });

  const taskGraphView = buildTaskGraphViewModel({ taskGraph, evidence, gaps });
  const gapInbox = buildInformationGapInboxViewModel({ gaps, taskGraph });
  const externalSync = buildExternalSyncConsoleViewModel({ mirrors, writebackIntents });

  const writebackDecisions = writebackIntents.map((intent) => ({
    intent_id: intent.id,
    ...decideWritebackPolicy(intent)
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
        agentOutputs
      }
    },
    root
  });
  const storylineAcceptanceView = buildStorylineAcceptanceViewModel(storylineAcceptance);

  const contractHealth = validateState({
    taskGraph,
    gaps,
    evidence,
    gateChecks,
    mirrors,
    writebackIntents,
    agentOutputs,
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
      task_graph: taskGraphView,
      information_gap_inbox: gapInbox,
      external_sync_console: externalSync,
      legacy_integration: legacyIntegrationView,
      legacy_bridge_preview: legacyBridgePreview,
      storyline_acceptance: storylineAcceptanceView
    },
    sales: {
      discover_audit: discoverAudit,
      gate_count: buildSalesGateIndex(salesGateModel).size
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
    raw: {
      taskGraph,
      gaps,
      evidence,
      gateChecks,
      mirrors,
      writebackIntents,
      agentOutputs
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
      sendJson(res, 200, loadState());
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
      const state = loadState();
      sendJson(res, 200, {
        report: state.storyline_acceptance.report,
        view_model: state.views.storyline_acceptance
      });
      return;
    }

    if (url.pathname === "/api/jueying/mainline/bridge-preview" || url.pathname === "/api/legacy/bridge-preview") {
      const state = loadState();
      sendJson(res, 200, state.legacy_integration.bridge_preview);
      return;
    }

    if (url.pathname === "/api/jueying/mainline/runtime-health" || url.pathname === "/api/legacy/runtime-health") {
      const report = inspectJueyingV1Integration({ root });
      const timeoutMs = Number.parseInt(url.searchParams.get("timeout_ms") ?? "600", 10);
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
    sendJson(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^[/\\]+/, "");
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
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

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
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

server.listen(port, () => {
  console.log(`Ops Console listening on http://localhost:${port}`);
});
