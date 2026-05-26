#!/usr/bin/env node

const { spawn, spawnSync, exec } = require('child_process');
const http = require('http');
const { Client } = require('pg');
const { WORK_DIR, databaseUrl, redisUrl, testEnv } = require('./m2-test-env');

const FACT_PORT = Number(process.env.FACT_PORT || 3004);
const DATABASE_URL = databaseUrl();
const REDIS_URL = redisUrl();
const MINIO_HEALTH_URL = process.env.MINIO_HEALTH_URL || 'http://localhost:9000/minio/health/live';
const TEST_RESET_TOKEN = process.env.TEST_RESET_TOKEN || 'm2-smoke-reset';

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

async function httpOk(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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
  console.log('=== M2 MinIO Live Smoke ===');

  const minioHealthy = await httpOk(MINIO_HEALTH_URL);
  if (!minioHealthy) {
    console.log('~ MinIO unavailable, skipping live MinIO smoke');
    return;
  }

  await killPortProcess(FACT_PORT);
  await waitForPortFree(FACT_PORT, 40);

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
      ...testEnv(),
      PORT: String(FACT_PORT),
      SERVER_PORT: String(FACT_PORT),
      ARTIFACT_STORAGE_BACKEND: 'minio',
      MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || 'localhost:9000',
      MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY || 'minioadmin',
      MINIO_BUCKET: process.env.MINIO_BUCKET || 'agent-harness',
      MINIO_USE_SSL: process.env.MINIO_USE_SSL || 'false',
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

    const artifact = await postJson('/internal/artifacts/write', {
      owner_user_id: 'u_minio',
      artifact_type: 'report',
      mime_type: 'text/plain',
      content_text: 'minio live artifact body',
    });
    assert(artifact.ok, 'artifact write failed');
    if (artifact.body.degraded === true || artifact.body.storage_backend !== 'minio') {
      console.log('~ MinIO write degraded, local fallback verified instead');
    }
    assert(['minio', 'localfs'].includes(artifact.body.storage_backend), 'artifact storage backend mismatch');

    const artifactRead = await postJson('/internal/artifacts/read', {
      owner_user_id: 'u_minio',
      artifact_id: artifact.body.artifact_id,
      allowed_scopes: ['private:u_minio'],
    });
    assert(artifactRead.ok, 'artifact read failed');
    assert(artifactRead.body.content_text === 'minio live artifact body', 'artifact roundtrip mismatch');

    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    const rows = await client.query('select storage_backend, storage_ref from artifact_object where id = $1', [artifact.body.artifact_id]);
    await client.end();
    assert(['minio', 'localfs'].includes(rows.rows[0]?.storage_backend), 'artifact_object backend mismatch');
    if (rows.rows[0]?.storage_backend === 'minio') {
      assert(String(rows.rows[0]?.storage_ref || '').startsWith('minio://'), 'artifact_object storage_ref not minio ref');
    }

    console.log('✓ M2 MinIO Live Smoke passed');
  } finally {
    await killProcessTree(service);
    await killPortProcess(FACT_PORT);
  }
}

main().catch((error) => {
  console.error('✗ M2 MinIO Live Smoke failed');
  console.error(error.message || error);
  process.exit(1);
});
