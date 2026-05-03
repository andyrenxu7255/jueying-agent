#!/usr/bin/env node

const { spawn, spawnSync, exec } = require('child_process');
const http = require('http');
const { Client } = require('pg');

const WORK_DIR = 'D:/teamclaw/agent-harness';
const FACT_PORT = 3004;
const PROVIDER_PORT = 3901;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://agent_harness:dev_password@localhost:5432/agent_harness';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TEST_RESET_TOKEN = process.env.TEST_RESET_TOKEN || '';

function waitForHealth(port, maxAttempts = 30, path = '/health/live') {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts += 1;
      http.get(`http://localhost:${port}${path}`, (res) => {
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

async function postJson(baseUrl, path, payload, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
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
  console.log('=== M2 Provider Success Smoke ===');

  await killPortProcess(FACT_PORT);
  await killPortProcess(PROVIDER_PORT);

  const migration = spawnSync('npm', ['run', 'db:migrate'], {
    cwd: WORK_DIR,
    shell: true,
    stdio: 'inherit',
  });
  if (migration.status !== 0) {
    process.exit(migration.status || 1);
  }

  const provider = spawn('node', ['tests/poc/mock-provider.js'], {
    cwd: WORK_DIR,
    env: {
      ...process.env,
      PORT: String(PROVIDER_PORT),
      SERVER_PORT: String(PROVIDER_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  provider.stdout.on('data', (data) => process.stdout.write(data));
  provider.stderr.on('data', (data) => process.stderr.write(data));

  const service = spawn('node', ['services/fact-retrieval/dist/index.js'], {
    cwd: WORK_DIR,
    env: {
      ...process.env,
      PORT: String(FACT_PORT),
      SERVER_PORT: String(FACT_PORT),
      EMBEDDING_MODE: 'provider',
      RERANK_MODE: 'provider',
      EMBEDDING_PROVIDER_URL: `http://localhost:${PROVIDER_PORT}`,
      RERANK_PROVIDER_URL: `http://localhost:${PROVIDER_PORT}`,
      EMBEDDING_PROVIDER_TIMEOUT_MS: '3000',
      RERANK_PROVIDER_TIMEOUT_MS: '3000',
      DATABASE_URL,
      REDIS_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  service.stdout.on('data', (data) => process.stdout.write(data));
  service.stderr.on('data', (data) => process.stderr.write(data));

  try {
    const providerHealthy = await waitForHealth(PROVIDER_PORT, 30, '/health/live');
    assert(providerHealthy, 'mock provider not healthy');
    const serviceHealthy = await waitForHealth(FACT_PORT, 30, '/health/live');
    assert(serviceHealthy, 'fact-retrieval not healthy');

    const reset = await postJson(`http://localhost:${FACT_PORT}`, '/internal/test/reset', {});
    assert(reset.ok, `reset failed: ${reset.status}`);

    for (let i = 0; i < 24; i += 1) {
      const indexed = await postJson(`http://localhost:${FACT_PORT}`, '/internal/documents/index', {
        owner_user_id: 'u_providerok',
        scope_type: 'private',
        title: `provider success doc ${i}`,
        content_text: i === 0
          ? 'provider success golden chunk contains exact target marker and strongest relevance'
          : `provider success filler chunk ${i} with target marker`,
      });
      assert(indexed.ok, `index failed at ${i}`);
    }

    const queried = await postJson(`http://localhost:${FACT_PORT}`, '/internal/retrieval/query', {
      owner_user_id: 'u_providerok',
      query_text: 'target marker strongest relevance',
      intent_type: 'evidence',
      allowed_scopes: ['private:u_providerok'],
    });

    assert(queried.ok, 'query failed');
    assert(queried.body.degraded === false, 'provider success path unexpectedly degraded');
    assert((queried.body.evidence_pack?.items || []).length > 0, 'query produced no evidence items');

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    const trace = await client.query(
      'select degraded, result_summary from retrieval_trace where id = $1',
      [queried.body.retrieval_trace_id],
    );
    await client.end();

    assert(trace.rows.length === 1, 'trace row not found');
    assert(trace.rows[0].degraded === false, 'trace degraded should be false');
    assert(Array.isArray(trace.rows[0].result_summary?.degradation_reasons), 'trace degradation_reasons missing');
    assert(trace.rows[0].result_summary.degradation_reasons.length === 0, 'trace degradation_reasons should be empty');

    console.log('✓ M2 Provider Success Smoke passed');
  } finally {
    service.kill();
    provider.kill();
  }
}

main().catch((error) => {
  console.error('✗ M2 Provider Success Smoke failed');
  console.error(error.message || error);
  process.exit(1);
});
