#!/usr/bin/env node

const { spawn, spawnSync, exec } = require('child_process');
const http = require('http');

const WORK_DIR = 'D:/teamclaw/agent-harness';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://agent_harness:dev_password@localhost:5432/agent_harness';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_RESET_TOKEN = process.env.TEST_RESET_TOKEN || '';
const SERVICES = [
  {
    name: 'fact-retrieval',
    port: 3004,
    path: 'services/fact-retrieval/dist/index.js',
    env: {
      EMBEDDING_MODE: 'provider',
      RERANK_MODE: 'provider',
      EMBEDDING_PROVIDER_URL: 'http://127.0.0.1:9',
      RERANK_PROVIDER_URL: 'http://127.0.0.1:9',
      EMBEDDING_PROVIDER_TIMEOUT_MS: '300',
      RERANK_PROVIDER_TIMEOUT_MS: '300',
    },
  },
  {
    name: 'executor-gateway',
    port: 3002,
    path: 'services/executor-gateway/dist/index.js',
    env: { FACT_RETRIEVAL_URL: 'http://localhost:3004' },
  },
];

function waitForHealth(port, maxAttempts = 30) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts += 1;
      http.get(`http://localhost:${port}/health/live`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(true);
          return;
        }
        if (attempts >= maxAttempts) {
          resolve(false);
          return;
        }
        setTimeout(check, 500);
      }).on('error', () => {
        if (attempts >= maxAttempts) {
          resolve(false);
          return;
        }
        setTimeout(check, 500);
      });
    };
    check();
  });
}

function killPortProcess(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
      if (error || !stdout) {
        resolve();
        return;
      }

      const pids = Array.from(new Set(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((value) => value && /^\d+$/.test(value)),
      ));

      if (pids.length === 0) {
        resolve();
        return;
      }

      exec(`taskkill /F ${pids.map((pid) => `/PID ${pid}`).join(' ')}`, () => resolve());
    });
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TEST_RESET_TOKEN ? { authorization: `Bearer ${TEST_RESET_TOKEN}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: JSON.parse(text) };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log('=== M2 Executor Degraded Smoke ===');

  for (const service of SERVICES) {
    await killPortProcess(service.port);
  }

  const migration = spawnSync('npm', ['run', 'db:migrate'], {
    cwd: WORK_DIR,
    shell: true,
    stdio: 'inherit',
  });
  if (migration.status !== 0) {
    process.exit(migration.status || 1);
  }

  const processes = SERVICES.map((service) => spawn('node', [service.path], {
    cwd: WORK_DIR,
    env: {
      ...process.env,
      PORT: String(service.port),
      SERVER_PORT: String(service.port),
      LOG_LEVEL: 'info',
      DATABASE_URL,
      REDIS_URL,
      ...service.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));

  processes.forEach((proc) => {
    proc.stdout.on('data', (data) => process.stdout.write(data));
    proc.stderr.on('data', (data) => process.stderr.write(data));
  });

  try {
    const healthy = await Promise.all(SERVICES.map((service) => waitForHealth(service.port)));
    assert(healthy.every(Boolean), 'service health failed');

    const reset = await postJson('http://localhost:3004/internal/test/reset', {});
    assert(reset.ok, `reset failed: ${reset.status}`);
    for (let i = 0; i < 24; i += 1) {
      const indexed = await postJson('http://localhost:3004/internal/documents/index', {
        owner_user_id: 'u_execdegraded',
        scope_type: 'private',
        title: `executor degraded doc ${i}`,
        content_text: `executor degraded retrieval document ${i} contains shared degraded marker`,
      });
      assert(indexed.ok, `document index failed at ${i}`);
    }

    const executed = await postJson('http://localhost:3002/internal/executor/execute', {
      workflow_instance_id: 'wf_exec_degraded',
      workflow_stage_id: 'st_exec_degraded',
      user_goal: 'shared degraded marker',
      policy_snapshot_hash: 'sha256:execdegraded0000000000000000000000000000000000000000000000000000',
      context: {
        owner_user_id: 'u_execdegraded',
        allowed_scopes: ['private:u_execdegraded'],
      },
      stage: {
        stage_id: 'st_exec_degraded',
        seq: 0,
        stage_key: 'evidence_retrieval',
        stage_type: 'EvidenceRetrieval',
        assigned_executor: 'retrieval-aware-executor',
        purpose: 'retrieve evidence',
        inputs: { required_refs: [], optional_refs: [] },
        retrieval_plan: { enabled: true, intent_type: 'evidence' },
        acceptance: { must_have: ['evidence'], pass_rules: [], fail_rules: [] },
        timeouts: { soft_timeout_sec: 30, hard_timeout_sec: 60 },
        retry_policy: { max_retries: 1, max_repairs: 0, retryable_errors: [] },
        checkpoint_policy: { on_enter: true, on_progress: false, on_exit: true },
        on_success: 'next_stage',
        on_failure: 'repair_or_fail',
      },
    });

    assert(executed.ok && executed.body.ok, 'executor request failed');
    assert(executed.body.degraded === true, 'executor degraded flag not set');
    assert(Array.isArray(executed.body.degradation_reasons), 'executor degradation reasons missing');
    assert(executed.body.degradation_reasons.length > 0, 'executor degradation reasons empty');
    assert(Boolean(executed.body.retrieval_trace_id), 'executor retrieval_trace_id missing');
    assert(Boolean(executed.body.evidence_pack_hash), 'executor evidence_pack_hash missing');

    console.log('✓ M2 Executor Degraded Smoke passed');
  } finally {
    processes.forEach((proc) => proc.kill());
  }
}

main().catch((error) => {
  console.error('✗ M2 Executor Degraded Smoke failed');
  console.error(error.message || error);
  process.exit(1);
});
