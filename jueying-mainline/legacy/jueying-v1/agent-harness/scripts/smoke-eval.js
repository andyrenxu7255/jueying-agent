const startMs = Date.now();

const results = [];

function pushResult(name, ok, detail, ms) {
  results.push({ name, ok, ms, detail });
}

async function request(name, url, options = {}) {
  const t0 = Date.now();
  const timeoutMs = name.includes('litellm') ? 45000 : (name.includes('workflow.plan') ? 60000 : 10000);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 400);
    }

    pushResult(name, response.ok, { status: response.status, body }, Date.now() - t0);

    return {
      ok: response.ok,
      status: response.status,
      body,
      text,
    };
  } catch (error) {
    pushResult(name, false, { error: String(error) }, Date.now() - t0);
    return null;
  }
}

async function requestWithRetry(name, url, options = {}, retries = 1) {
  const first = await request(name, url, options);
  if (first && first.ok) {
    return first;
  }
  for (let i = 0; i < retries; i += 1) {
    const retryName = `${name}.retry${i + 1}`;
    const next = await request(retryName, url, options);
    if (next && next.ok) {
      return next;
    }
  }
  return first;
}

async function run() {
  const runRef = `smoke_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;

  await request("gateway.health.live", "http://localhost:3000/health/live");
  await request("workflow.health.live", "http://localhost:3001/health/live");
  await request("executor.health.live", "http://localhost:3002/health/live");
  await requestWithRetry("litellm.health", "http://localhost:4000/health/liveliness", {}, 1);
  await request("signoz.query.health", "http://localhost:8080/api/v1/health");
  await request("signoz.frontend.health", "http://localhost:3301");

  const normalizePayload = {
    channel_identity: "perf-user-01",
    session_hint: {
      channel_type: "web_portal",
      channel_account_id: "acct-perf",
      conversation_id: "conv-perf",
      thread_id: "thread-perf",
    },
    raw_message: {
      text: "end-to-end normalize",
    },
    attachments: [{ type: "text", value: "a1" }],
  };

  const normalize = await request(
    "gateway.normalize",
    "http://localhost:3000/internal/channel-ingress/normalize",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(normalizePayload),
    }
  );

  if (normalize && normalize.body && typeof normalize.body === "object") {
    const body = normalize.body;
    const ok =
      typeof body.session_ref === "string" &&
      body.session_ref.startsWith("web_portal:") &&
      typeof body.channel_type === "string";
    pushResult(
      "gateway.normalize.assert",
      ok,
      {
        session_ref: body.session_ref,
        channel_type: body.channel_type,
        identity_binding_state: body.identity_binding_state,
      },
      0
    );
  } else {
    pushResult("gateway.normalize.assert", false, { reason: "normalize body missing" }, 0);
  }

  const planPayload = {
    user_id: `u_${runRef}`,
    task_type_hint: "knowledge",
    risk_level: "medium",
    user_goal: "validate planning path",
    budget: {
      time_sec: 900,
      retrieval: 8,
      execution: 20,
    },
    policy_snapshot_hash: `sha256:${runRef}`,
  };

  const plan = await request(
    "workflow.plan",
    "http://localhost:3001/internal/workflows/plan",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(planPayload),
    }
  );

  let workflowRef = "wf_fallback";
  if (plan && plan.body && typeof plan.body === "object") {
    const body = plan.body;
    if (typeof body.workflow_instance_ref === "string") {
      workflowRef = body.workflow_instance_ref;
    }
    const ok =
      typeof body.workflow_instance_ref === "string" &&
      body.workflow_instance_ref.startsWith("wf_") &&
      body.workflow_plan &&
      typeof body.workflow_plan === "object" &&
      body.validation &&
      typeof body.validation === "object";
    pushResult("workflow.plan.assert", ok, { workflow_instance_ref: body.workflow_instance_ref, validation: body.validation }, 0);
  } else {
    pushResult("workflow.plan.assert", false, { reason: "plan body missing" }, 0);
  }

  const dispatch = await request(
    "workflow.dispatch",
    `http://localhost:3001/internal/workflows/${workflowRef}/dispatch`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trigger: "perf" }),
    }
  );

  if (dispatch && dispatch.body && typeof dispatch.body === "object") {
    const body = dispatch.body;
    const ok = body.dispatch_status === "accepted" && typeof body.executor_run_ref === "string" && body.executor_run_ref.startsWith("run_");
    pushResult("workflow.dispatch.assert", ok, body, 0);
  } else {
    pushResult("workflow.dispatch.assert", false, { reason: "dispatch body missing" }, 0);
  }

  let loopOk = true;
  for (let i = 1; i <= 20; i += 1) {
    const r = await request(`gateway.health.loop.${i}`, "http://localhost:3000/health/live");
    if (!r || !r.ok) {
      loopOk = false;
    }
  }
  pushResult("gateway.health.loop20.assert", loopOk, { iterations: 20 }, 0);

  const failed = results.filter((r) => !r.ok);
  const summary = {
    pass: failed.length === 0,
    total: results.length,
    failed: failed.length,
    duration_ms: Date.now() - startMs,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.pass ? 0 : 1);
}

run().catch((error) => {
  console.error(JSON.stringify({ pass: false, error: String(error) }, null, 2));
  process.exit(1);
});
