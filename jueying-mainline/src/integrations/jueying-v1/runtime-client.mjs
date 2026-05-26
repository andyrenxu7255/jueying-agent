import {
  evidenceToLegacyFactWrite,
  informationGapToLegacyOrgTask,
  taskGraphToLegacyWorkflowPlan
} from "./adapter.mjs";

const DEFAULT_ENDPOINTS = {
  workflow: {
    env: "JUEYING_WORKFLOW_URL",
    defaultUrl: "http://127.0.0.1:3001"
  },
  gateway: {
    env: "JUEYING_GATEWAY_URL",
    defaultUrl: "http://127.0.0.1:3000"
  },
  factRetrieval: {
    env: "JUEYING_FACT_RETRIEVAL_URL",
    defaultUrl: "http://127.0.0.1:3004"
  }
};

export class JueyingV1RuntimeClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.internalToken = options.internalToken ?? process.env.JUEYING_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? "";
    this.endpoints = {
      workflow: endpointUrl(options.workflowUrl, DEFAULT_ENDPOINTS.workflow),
      gateway: endpointUrl(options.gatewayUrl, DEFAULT_ENDPOINTS.gateway),
      factRetrieval: endpointUrl(options.factRetrievalUrl, DEFAULT_ENDPOINTS.factRetrieval)
    };
  }

  async createWorkflowFromTaskGraph(taskGraph, options = {}) {
    const payload = taskGraphToLegacyWorkflowPlan(taskGraph, options);
    const response = await this.post("workflow", "/internal/workflows/plan", payload);
    return {
      operation: "createWorkflowFromTaskGraph",
      ok: response.ok,
      degraded: !response.ok,
      payload,
      response
    };
  }

  async createOrgTaskFromInformationGap(gap, options = {}) {
    const payload = informationGapToLegacyOrgTask(gap, options);
    const response = await this.post("gateway", "/admin/tasks", payload, {
      internal: true,
      successStatus: 201
    });
    return {
      operation: "createOrgTaskFromInformationGap",
      ok: response.ok,
      degraded: !response.ok,
      payload,
      response
    };
  }

  async writeFactFromEvidence(evidence, options = {}) {
    const payload = evidenceToLegacyFactWrite(evidence, options);
    const response = await this.post("factRetrieval", "/internal/facts/write", payload);
    return {
      operation: "writeFactFromEvidence",
      ok: response.ok,
      degraded: !response.ok,
      payload,
      response
    };
  }

  async health() {
    const checks = await Promise.all([
      this.get("workflow", "/health"),
      this.get("gateway", "/health/live"),
      this.get("factRetrieval", "/health")
    ]);
    return {
      ok: checks.every((check) => check.ok),
      checks
    };
  }

  async readWorkflowProgress(workflowRef, options = {}) {
    const params = new URLSearchParams();
    if (options.owner_user_id) params.set("owner_user_id", options.owner_user_id);
    if (options.acting_role) params.set("acting_role", options.acting_role);
    if (options.policy_snapshot_hash) params.set("policy_snapshot_hash", options.policy_snapshot_hash);
    const query = params.toString();
    const path = `/internal/workflows/${encodeURIComponent(workflowRef)}/progress${query ? `?${query}` : ""}`;
    return this.get("workflow", path);
  }

  async get(service, path, options = {}) {
    const headers = {};
    if (options.internal && this.internalToken) {
      headers["x-internal-token"] = this.internalToken;
    }
    return this.request(service, path, {
      method: "GET",
      headers: Object.keys(headers).length > 0 ? headers : undefined
    });
  }

  async post(service, path, payload, options = {}) {
    const headers = { "content-type": "application/json" };
    if (options.internal && this.internalToken) {
      headers["x-internal-token"] = this.internalToken;
    }
    return this.request(service, path, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      successStatus: options.successStatus
    });
  }

  async request(service, path, options = {}) {
    const baseUrl = this.endpoints[service];
    if (!baseUrl) {
      return {
        ok: false,
        degraded: true,
        service,
        path,
        status: 0,
        error: "unknown_service"
      };
    }

    const url = `${baseUrl.replace(/\/$/, "")}${path}`;
    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      const body = await parseResponseBody(response);
      const ok = (options.successStatus ? response.status === options.successStatus : response.ok) && bodyIsOk(body);
      return {
        ok,
        degraded: !ok,
        service,
        path,
        url,
        status: response.status,
        latency_ms: Date.now() - startedAt,
        body
      };
    } catch (error) {
      return {
        ok: false,
        degraded: true,
        service,
        path,
        url,
        status: 0,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

function bodyIsOk(body) {
  return body && typeof body === "object" && "ok" in body ? body.ok === true : true;
}

export function createJueyingV1RuntimeClient(options = {}) {
  return new JueyingV1RuntimeClient(options);
}

function endpointUrl(explicit, config) {
  return explicit ?? process.env[config.env] ?? config.defaultUrl;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
