#!/usr/bin/env node

const { spawn, spawnSync, exec } = require('child_process');
const http = require('http');
const { Client } = require('pg');
const { WORK_DIR, databaseUrl, redisUrl, testEnv } = require('./m2-test-env');

const FACT_PORT = Number(process.env.FACT_PORT || 3004);
const PROVIDER_PORT = Number(process.env.PROVIDER_PORT || 3901);
const DATABASE_URL = databaseUrl();
const REDIS_URL = redisUrl();
const TEST_RESET_TOKEN = process.env.TEST_RESET_TOKEN || 'm2-smoke-reset';

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
          .filter((value) => value && /^\d+$/.test(value) && value !== '0'),
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

function killProcessTree(proc) {
  return new Promise((resolve) => {
    if (!proc || !proc.pid) {
      resolve();
      return;
    }
    exec(`taskkill /F /T /PID ${proc.pid}`, () => resolve());
  });
}

async function waitForPortFree(port, maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await new Promise((resolve) => {
      const server = http.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port);
    });
    if (result) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function main() {
  console.log('=== M2 Provider Success Smoke ===');

  await killPortProcess(FACT_PORT);
  await killPortProcess(PROVIDER_PORT);
  await waitForPortFree(FACT_PORT, 40);
  await waitForPortFree(PROVIDER_PORT, 40);

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
      ...testEnv(),
      PORT: String(PROVIDER_PORT),
      SERVER_PORT: String(PROVIDER_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  provider.stdout.on('data', (data) => process.stdout.write(data));
  provider.stderr.on('data', (data) => process.stderr.write(data));

  await waitForPortFree(FACT_PORT, 40);
  const service = spawn('node', ['services/fact-retrieval/dist/index.js'], {
    cwd: WORK_DIR,
    env: {
      ...testEnv(),
      PORT: String(FACT_PORT),
      SERVER_PORT: String(FACT_PORT),
      EMBEDDING_MODE: 'provider',
      RERANK_MODE: 'provider',
      EMBEDDING_PROVIDER_URL: `http://localhost:${PROVIDER_PORT}`,
      RERANK_PROVIDER_URL: `http://localhost:${PROVIDER_PORT}`,
      EMBEDDING_PROVIDER_TIMEOUT_MS: '3000',
      RERANK_PROVIDER_TIMEOUT_MS: '3000',
      ENABLE_GRAPH: 'false',
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
    assert(queried.body.degraded === false, `provider success path unexpectedly degraded: ${JSON.stringify(queried.body.degradation_reasons || [])}`);
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
    await killProcessTree(service);
    await killProcessTree(provider);
    await killPortProcess(FACT_PORT);
    await killPortProcess(PROVIDER_PORT);
  }
}

main().catch((error) => {
  console.error('✗ M2 Provider Success Smoke failed');
  console.error(error.message || error);
  process.exit(1);
});
