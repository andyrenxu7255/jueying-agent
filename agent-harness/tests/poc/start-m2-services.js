#!/usr/bin/env node

const { spawn, spawnSync, exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORK_DIR = 'D:/teamclaw/agent-harness';
const FACT_SERVICE = { name: 'fact-retrieval', port: 3004, path: 'services/fact-retrieval/dist/index.js' };
const EXECUTOR_PORT = 3002;
const DEFAULT_TIMEOUT_MS = 120000;
const LOCK_PATH = path.join(WORK_DIR, 'ops', 'm2-runner.lock');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', (error) => resolve(error.code !== 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port);
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

function runNodeScript(scriptPath, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath], {
      cwd: WORK_DIR,
      stdio: 'inherit',
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`timeout:${scriptPath}:${timeoutMs}`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`exit_code:${scriptPath}:${code}`));
    });

    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }

    try {
      const current = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
      if (current.pid && isProcessAlive(Number(current.pid))) {
        console.log(`~ M2 runner already active, skipping duplicate run (pid=${current.pid})`);
        return false;
      }
    } catch {
      // stale or unreadable lock will be replaced below
    }

    fs.rmSync(LOCK_PATH, { force: true });
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2), { flag: 'wx' });
    return true;
  }
}

function releaseLock() {
  try {
    fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    // best-effort cleanup only
  }
}

async function ensurePortsClean() {
  for (const port of [FACT_SERVICE.port, EXECUTOR_PORT]) {
    const free = await checkPort(port);
    if (!free) {
      await killPortProcess(port);
      await wait(300);
    }
  }
}

async function main() {
  if (!acquireLock()) {
    return;
  }

  console.log('=== M2 Autonomous Runner ===');
  const failures = [];
  let factProc;

  try {

    try {
      console.log('1) 端口清理...');
      await ensurePortsClean();

      console.log('2) 数据库迁移...');
      const migration = spawnSync('npm', ['run', 'db:migrate'], {
        cwd: WORK_DIR,
        shell: true,
        stdio: 'inherit',
        timeout: 120000,
      });
      if (migration.status !== 0) {
        throw new Error(`db_migrate_failed:${migration.status || 1}`);
      }

      console.log('3) 启动 fact-retrieval...');
      factProc = spawn('node', [FACT_SERVICE.path], {
        cwd: WORK_DIR,
        env: {
          ...process.env,
          PORT: String(FACT_SERVICE.port),
          SERVER_PORT: String(FACT_SERVICE.port),
          LOG_LEVEL: 'info',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      factProc.stdout.on('data', (data) => process.stdout.write(data));
      factProc.stderr.on('data', (data) => process.stderr.write(data));

      const healthy = await waitForHealth(FACT_SERVICE.port);
      if (!healthy) {
        throw new Error('fact_retrieval_health_failed');
      }

      console.log('4) M2 quick test...');
      await runNodeScript('tests/poc/m2-quick-test.js', 120000);

      console.log('5) P0-3 extended test...');
      await runNodeScript('tests/poc/m2-p0-3-extended.js', 120000);
    } catch (error) {
      failures.push(String(error));
    } finally {
      if (factProc) {
        factProc.kill();
        await wait(500);
      }
    }

    try {
      console.log('6) provider success smoke...');
      await runNodeScript('tests/poc/m2-provider-success-smoke.js', 180000);
    } catch (error) {
      failures.push(String(error));
    }

    try {
      console.log('7) minio live smoke...');
      await runNodeScript('tests/poc/m2-minio-live-smoke.js', 180000);
    } catch (error) {
      failures.push(String(error));
    }

    try {
      console.log('8) executor smoke...');
      await runNodeScript('tests/poc/m2-executor-smoke.js', 180000);
    } catch (error) {
      failures.push(String(error));
    }

    try {
      console.log('9) executor degraded smoke...');
      await runNodeScript('tests/poc/m2-executor-degraded-smoke.js', 180000);
    } catch (error) {
      failures.push(String(error));
    }

    try {
      console.log('10) provider fallback smoke...');
      await runNodeScript('tests/poc/m2-provider-fallback-smoke.js', 180000);
    } catch (error) {
      failures.push(String(error));
    }

    await ensurePortsClean();

    if (failures.length > 0) {
      console.error('✗ M2 Autonomous Runner failed');
      console.error(JSON.stringify({ failures }, null, 2));
      process.exit(1);
    }

    console.log('✓ M2 Autonomous Runner passed');
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  console.error('✗ M2 Autonomous Runner fatal');
  console.error(String(error));
  process.exit(1);
});
