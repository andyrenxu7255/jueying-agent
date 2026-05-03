#!/usr/bin/env node

const { spawn, spawnSync, exec } = require('child_process');
const http = require('http');
const { Client } = require('pg');

const WORK_DIR = 'D:/teamclaw/agent-harness';
const FACT_PORT = 3004;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://agent_harness:dev_password@localhost:5432/agent_harness';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_RESET_TOKEN = process.env.TEST_RESET_TOKEN || '';

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

async function postJson(path, payload, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://localhost:${FACT_PORT}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(TEST_RESET_TOKEN ? { authorization: `Bearer ${TEST_RESET_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: JSON.parse(text) };
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log('=== M2 Provider 回退验证 ===');

  await killPortProcess(FACT_PORT);

  const migration = spawnSync('npm', ['run', 'db:migrate'], {
    cwd: WORK_DIR,
    shell: true,
    stdio: 'inherit',
  });
  if (migration.status !== 0) {
    process.exit(migration.status || 1);
  }

  const service = spawn('node', ['services/fact-retrieval/dist/index.js'], {
    cwd: WORK_DIR,
    env: {
      ...process.env,
      PORT: String(FACT_PORT),
      SERVER_PORT: String(FACT_PORT),
      EMBEDDING_MODE: 'provider',
      RERANK_MODE: 'provider',
      EMBEDDING_PROVIDER_URL: 'http://127.0.0.1:9',
      RERANK_PROVIDER_URL: 'http://127.0.0.1:9',
      EMBEDDING_PROVIDER_TIMEOUT_MS: '300',
      RERANK_PROVIDER_TIMEOUT_MS: '300',
      ARTIFACT_STORAGE_BACKEND: 'minio',
      MINIO_ENDPOINT: '127.0.0.1:9',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin',
      MINIO_BUCKET: 'agent-harness',
      DATABASE_URL,
      REDIS_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  service.stdout.on('data', (data) => process.stdout.write(data));
  service.stderr.on('data', (data) => process.stderr.write(data));

  try {
    const healthy = await waitForHealth(FACT_PORT);
    assert(healthy, 'fact-retrieval not healthy');

    const reset = await postJson('/internal/test/reset', {});
    assert(reset.ok, `reset failed: ${reset.status}`);

    for (let i = 0; i < 24; i += 1) {
      const indexed = await postJson('/internal/documents/index', {
        owner_user_id: 'u_provider',
        scope_type: 'private',
        title: `provider fallback doc ${i}`,
        content_text: `provider fallback evidence ${i} with shared query marker`,
      });
      assert(indexed.ok, `index failed at ${i}`);
    }

    const queried = await postJson('/internal/retrieval/query', {
      owner_user_id: 'u_provider',
      query_text: 'shared query marker',
      intent_type: 'evidence',
      allowed_scopes: ['private:u_provider'],
    });

    assert(queried.ok, 'query failed');
    assert(queried.body.degraded === true, 'expected degraded=true when provider down');
    assert((queried.body.evidence_pack?.items || []).length > 0, 'query produced no evidence items');

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    const trace = await client.query(
      'select degraded, result_summary from retrieval_trace where id = $1',
      [queried.body.retrieval_trace_id],
    );

    assert(trace.rows.length === 1, 'trace row not found');
    assert(trace.rows[0].degraded === true, 'trace degraded not set');
    assert(Array.isArray(trace.rows[0].result_summary?.degradation_reasons), 'trace degradation reasons missing');

    const artifact = await postJson('/internal/artifacts/write', {
      owner_user_id: 'u_provider',
      artifact_type: 'report',
      mime_type: 'text/plain',
      content_text: 'artifact fallback validation',
    });
    assert(artifact.ok, 'artifact write failed');
    assert(artifact.body.degraded === true, 'artifact write expected degraded=true with minio down');
    assert(artifact.body.storage_backend === 'localfs', 'artifact write did not fallback to localfs');

    const audit = await client.query(
      `select action, detail_json
       from audit_event
       where action = 'artifact.storage.degraded'
       order by occurred_at desc
       limit 1`,
    );
    await client.end();
    assert(audit.rows.length === 1, 'artifact.storage.degraded audit event missing');

    console.log('✓ M2 Provider 回退验证通过');
  } finally {
    service.kill();
  }
}

main().catch((error) => {
  console.error('✗ M2 Provider 回退验证失败');
  console.error(error.message || error);
  process.exit(1);
});
