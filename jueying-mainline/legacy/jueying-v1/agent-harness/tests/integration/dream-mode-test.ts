const RESULTS: Array<{ name: string; passed: boolean; detail: string; duration_ms: number }> = [];
let passed = 0;
let failed = 0;
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const DREAM_TEST_ORG_ID = '10000000-0000-4000-8000-000000000001';

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    RESULTS.push({ name, passed: true, detail: 'OK', duration_ms: Date.now() - start });
    passed++;
  } catch (error) {
    RESULTS.push({ name, passed: false, detail: String(error), duration_ms: Date.now() - start });
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body };
}

async function getDatabaseUrl(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { existsSync, readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const envFile = resolve(process.cwd(), '.env');
  const env: Record<string, string> = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }
  const merged = { ...env, ...(process.env as Record<string, string | undefined>) };
  const user = merged.POSTGRES_USER || 'agent_harness';
  const password = merged.POSTGRES_PASSWORD || 'dev_password_changeme';
  const db = merged.POSTGRES_DB || 'agent_harness';
  const host = merged.POSTGRES_HOST || '127.0.0.1';
  const port = merged.POSTGRES_PORT || '5432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

async function ensureDreamTestOrg(): Promise<void> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: await getDatabaseUrl() });
  try {
    await pool.query(
      `INSERT INTO organization (id, org_name, display_name, status, settings, metadata)
       VALUES ($1::uuid, 'dream_mode_test', 'Dream Mode Test Organization', 'active', '{}'::jsonb, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = 'active', updated_at = now()`,
      [DREAM_TEST_ORG_ID, JSON.stringify({ source: 'dream_mode_integration_test' })]
    );
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  console.log('=== 梦境模式集成测试 (Dream Mode Integration Test) ===\n');

  const hermesUrl = process.env.HERMES_URL || 'http://localhost:3005';
  const skillUrl = process.env.SKILL_LIBRARY_URL || 'http://localhost:3007';

  await ensureDreamTestOrg();

  // ============================================================
  // Phase 1: 记忆分析端点测试
  // ============================================================
  console.log('Phase 1: Hermes Memory Analysis Endpoints\n');

  await test('POST /internal/memory/analyze - 个人梦境分析', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/analyze`, {
      method: 'POST',
      body: JSON.stringify({ owner_user_id: '3e1b0f95-7387-6035-4f3f-2855f28e1f12', date: '2026-05-04' }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${JSON.stringify(body)}`);
    assert(body.items_scanned !== undefined, 'Expected items_scanned field');
    assert(body.items_compressed !== undefined, 'Expected items_compressed field');
    assert(body.facts_generated !== undefined, 'Expected facts_generated field');
  });

  await test('POST /internal/memory/analyze - 缺少owner_user_id返回400', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/analyze`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'missing_owner_user_id', `Expected missing_owner_user_id, got ${body.error}`);
  });

  await test('POST /internal/memory/analyze/org - 组织级记忆分析', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/analyze/org`, {
      method: 'POST',
      body: JSON.stringify({ org_id: DEFAULT_ORG_ID }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${JSON.stringify(body)}`);
    assert(body.items_scanned !== undefined, 'Expected items_scanned');
    assert(body.merged_to_org !== undefined, 'Expected merged_to_org');
  });

  await test('GET /internal/memory/summary - 组织级记忆汇总', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/summary?org_id=${DEFAULT_ORG_ID}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, `Expected ok=true, got ${JSON.stringify(body)}`);
    assert(Array.isArray(body.summaries), 'Expected summaries array');
  });

  await test('GET /internal/memory/summary - 缺少org_id返回400', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/summary`);
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'missing_org_id', `Expected missing_org_id, got ${body.error}`);
  });

  await test('GET /internal/memory/analysis-runs - 运行历史查询', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/analysis-runs?org_id=${DEFAULT_ORG_ID}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(Array.isArray(body.runs), 'Expected runs array');
    assert(body.runs.length > 0, 'Expected at least 1 run record');
  });

  await test('GET /internal/memory/compression-logs - 压缩日志', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/compression-logs`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(Array.isArray(body.logs), 'Expected logs array');
  });

  await test('GET /internal/memory/access-log - 访问日志', async () => {
    const { status, body } = await fetchJson(`${hermesUrl}/internal/memory/access-log?user_id=3e1b0f95-7387-6035-4f3f-2855f28e1f12`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(Array.isArray(body.logs), 'Expected logs array');
  });

  // ============================================================
  // Phase 2: 技能发现与管理端点测试
  // ============================================================
  console.log('\nPhase 2: Skill Discovery & Management Endpoints\n');

  await test('GET /internal/skills/org-registry - 组织技能库查询', async () => {
    const { status, body } = await fetchJson(`${skillUrl}/internal/skills/org-registry?org_id=${DEFAULT_ORG_ID}`);
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, `Expected ok=true, got ${JSON.stringify(body)}`);
    assert(Array.isArray(body.skills), 'Expected skills array');
  });

  await test('GET /internal/skills/org-registry - 缺少org_id返回400', async () => {
    const { status, body } = await fetchJson(`${skillUrl}/internal/skills/org-registry`);
    assert(status === 400, `Expected 400, got ${status}`);
    assert(body.error === 'missing_org_id', `Expected missing_org_id, got ${body.error}`);
  });

  await test('GET /internal/skills/audit-records - 审核记录查询', async () => {
    const { status, body } = await fetchJson(`${skillUrl}/internal/skills/audit-records?org_id=${DEFAULT_ORG_ID}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(Array.isArray(body.records), 'Expected records array');
  });

  await test('POST /internal/skills/audit - 单个技能审核', async () => {
    const { status, body } = await fetchJson(`${skillUrl}/internal/skills/audit`, {
      method: 'POST',
      body: JSON.stringify({ skill_id: '00000000-0000-0000-0000-000000000000', auditor_user_id: '3e1b0f95-7387-6035-4f3f-2855f28e1f12' }),
    });
    assert(status === 404, `Expected 404 for non-existent skill, got ${status}`);
    assert(body.error === 'skill_not_found', `Expected skill_not_found, got ${body.error}`);
  });

  await test('POST /internal/skills/audit/batch - 批量审核', async () => {
    const { status, body } = await fetchJson(`${skillUrl}/internal/skills/audit/batch`, {
      method: 'POST',
      body: JSON.stringify({ org_id: DREAM_TEST_ORG_ID }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(body.audited !== undefined, 'Expected audited count');
    assert(body.promoted_to_org !== undefined, 'Expected promoted_to_org count');
  });

  await test('GET /internal/skills/scene-assessments - 场景价值评估', async () => {
    const { status, body } = await fetchJson(`${skillUrl}/internal/skills/scene-assessments?org_id=${DEFAULT_ORG_ID}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.ok === true, 'Expected ok=true');
    assert(Array.isArray(body.assessments), 'Expected assessments array');
  });

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('梦境模式集成测试结果');
  console.log('='.repeat(60));
  console.log(`总计: ${RESULTS.length}  |  通过: ${passed}  |  失败: ${failed}`);
  console.log('-'.repeat(60));

  for (const r of RESULTS) {
    const icon = r.passed ? '\u2713' : '\u2717';
    console.log(`  ${icon} ${r.name} (${r.duration_ms}ms)`);
    if (!r.passed) console.log(`    Error: ${r.detail}`);
  }

  console.log('\n' + '='.repeat(60));
  if (failed > 0) {
    console.log(`\u274C ${failed} 项测试失败!`);
    process.exit(1);
  } else {
    console.log('\u2705 全部测试通过!');
  }
}

main().catch((err) => {
  console.error('测试套件启动失败:', err);
  process.exit(1);
});
