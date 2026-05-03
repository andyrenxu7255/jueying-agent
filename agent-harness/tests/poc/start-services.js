const { spawn, exec } = require('child_process');
const http = require('http');

const SERVICES = [
  { name: 'workflow', port: 3001, path: 'services/workflow/dist/index.js' },
  { name: 'executor', port: 3002, path: 'services/executor-gateway/dist/index.js' },
  { name: 'gateway', port: 3000, path: 'apps/gateway-adapter/dist/index.js' }
];

const WORK_DIR = 'D:/teamclaw/agent-harness';

function checkPort(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function killPortProcess(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
      if (err || !stdout) {
        resolve();
        return;
      }
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) {
          exec(`taskkill /F /PID ${pid}`, () => {});
        }
      }
      setTimeout(resolve, 1000);
    });
  });
}

function waitForHealth(port, maxAttempts = 10) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      http.get(`http://localhost:${port}/health/live`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          if (attempts < maxAttempts) setTimeout(check, 500);
          else resolve(false);
        }
      }).on('error', () => {
        if (attempts < maxAttempts) setTimeout(check, 500);
        else resolve(false);
      });
    };
    check();
  });
}

async function main() {
  console.log('=== M1 服务启动器 ===\n');

  console.log('1. 检查并清理端口...');
  for (const svc of SERVICES) {
    const available = await checkPort(svc.port);
    if (!available) {
      console.log(`  端口 ${svc.port} 被占用，清理中...`);
      await killPortProcess(svc.port);
    }
  }
  console.log('  端口已清理\n');

  console.log('2. 启动服务...');
  const procs = [];
  for (const svc of SERVICES) {
    const env = {
      ...process.env,
      PORT: svc.port.toString(),
      LITELLM_URL: 'http://localhost:4000',
      EXECUTOR_URL: 'http://localhost:3002',
      WORKFLOW_URL: 'http://localhost:3001',
      SKIP_LLM_PLAN: 'true'
    };
    
    const proc = spawn('node', [svc.path], {
      cwd: WORK_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    proc.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg.includes('service.started')) {
        console.log(`  ✓ ${svc.name} 启动成功 (端口 ${svc.port})`);
      }
    });
    
    proc.stderr.on('data', (data) => {
      console.log(`  ! ${svc.name}: ${data.toString().trim()}`);
    });
    
    procs.push({ proc, svc });
  }

  console.log('\n3. 等待服务就绪...');
  await new Promise(r => setTimeout(r, 3000));
  
  const healthResults = await Promise.all(
    SERVICES.map(async (svc) => {
      const ok = await waitForHealth(svc.port, 15);
      return { svc, ok };
    })
  );
  
  const allHealthy = healthResults.every(r => r.ok);
  if (!allHealthy) {
    console.log('  服务健康检查失败');
    procs.forEach(p => p.proc.kill());
    process.exit(1);
  }
  console.log('  ✓ 所有服务健康\n');

  console.log('4. 运行PoC测试...\n');
  
  const testProc = spawn('node', ['tests/poc/m1-poc-test.js'], {
    cwd: WORK_DIR,
    stdio: 'inherit'
  });
  
  testProc.on('close', (code) => {
    console.log('\n5. 清理服务...');
    procs.forEach(p => {
      p.proc.kill();
      console.log(`  停止 ${p.svc.name}`);
    });
    process.exit(code);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});