import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const RESULTS: Array<{ name: string; passed: boolean; detail: string; duration_ms: number }> = [];
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const started = Date.now();
  try {
    await fn();
    RESULTS.push({ name, passed: true, detail: 'OK', duration_ms: Date.now() - started });
    passed += 1;
  } catch (error) {
    RESULTS.push({ name, passed: false, detail: String(error), duration_ms: Date.now() - started });
    failed += 1;
  }
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { raw: text }; }
  return { status: response.status, body };
}

async function waitForServer(url: string, maxRetries = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`server_not_ready: ${url}`);
}

function arr(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function loadRepoEnv(): Record<string, string> {
  const filePath = resolve(process.cwd(), '.env');
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function getDatabaseUrl(): string {
  const env = { ...loadRepoEnv(), ...process.env as Record<string, string> };
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = env.POSTGRES_USER || 'agent_harness';
  const password = env.POSTGRES_PASSWORD || 'change_me_123';
  const db = env.POSTGRES_DB || 'agent_harness';
  const host = env.POSTGRES_HOST || '127.0.0.1';
  const port = env.POSTGRES_PORT || '5432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

async function ensureFunctionalAdmin(username: string, password: string): Promise<void> {
  if (username === 'admin' || process.env.SKIP_TEST_ADMIN_BOOTSTRAP === '1') return;
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32, { N: 16384 }).toString('hex');
  const passwordHash = `scrypt:16384:${salt}:${derived}`;
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  try {
    await pool.query(
      `INSERT INTO "user" (org_id, username, display_name, role, status, metadata)
       VALUES ($1::uuid, $2, 'Proactive Functional Admin', 'admin', 'active', $3::jsonb)
       ON CONFLICT (org_id, username)
       DO UPDATE SET role = 'admin', status = 'active', metadata = $3::jsonb, updated_at = now()`,
      ['00000000-0000-0000-0000-000000000001', username, JSON.stringify({
        password_hash: passwordHash,
        source: 'proactive_functional_test',
        must_change_password: false,
      })]
    );
  } finally {
    await pool.end();
  }
}

async function archiveFunctionalTestRules(): Promise<void> {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  try {
    await pool.query(
      `UPDATE proactive_rule
          SET status = 'archived',
              metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
              updated_at = now()
        WHERE metadata->>'test_marker' = 'proactive-functional'
          AND status <> 'archived'`,
      [JSON.stringify({ archived_by: 'proactive_functional_test_cleanup' })]
    );
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const webPortalUrl = process.env.WEB_PORTAL_URL || 'http://localhost:3003';
  const proactiveUrl = process.env.PROACTIVE_ORCHESTRATOR_URL || 'http://localhost:3010';
  const adminUsername = process.env.ADMIN_USERNAME || 'proactive_admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ProactiveAdmin@12345';
  const headers: Record<string, string> = {};
  let createdRuleId = '';
  let createdInsightId = '';
  let createdMissionId = '';
  let createdReportId = '';
  let firstRuleInsightCount = 0;
  const createdRuleIds: string[] = [];

  await waitForServer(`${webPortalUrl}/health/live`, 20, 500);
  await waitForServer(`${proactiveUrl}/health/live`, 20, 500);
  await ensureFunctionalAdmin(adminUsername, adminPassword);
  await archiveFunctionalTestRules();

  await test('Admin login works for proactive portal APIs', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.session_id === 'string' && body.session_id.length > 0, 'expected session_id');
    headers['x-session-id'] = String(body.session_id);
  });

  await test('Dashboard exposes proactive metrics and seeded rule visibility', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/proactive/dashboard`, { headers });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    assert(typeof body.summary === 'object' && body.summary !== null, 'expected summary');
    assert(Array.isArray(body.rules), 'expected rules array');
  });

  await test('Create rule validates complete admin-maintained rule payload', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/proactive/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        rule_name: `功能测试 MEDDIC 主动跟进 ${Date.now()}`,
        description: '扫描 MEDDIC 销售知识和 ClawHub 销售技能，生成可审核洞察。',
        schedule_expression: '0 8 * * *',
        trigger_source: 'hybrid',
        target_scope: 'org',
        approval_mode: 'review_first',
        scan_window_hours: 168,
        priority: 88,
        evidence_policy: { require_evidence: true, min_confidence: 0.72 },
        routing_policy: { preferred_channels: ['org_task'], default_mission_type: 'user_task', escalation_role: 'admin' },
        metadata: { test_marker: 'proactive-functional' },
      }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    const rule = body.rule as Record<string, unknown>;
    createdRuleId = String(rule.id || '');
    createdRuleIds.push(createdRuleId);
    assert(createdRuleId.length > 0, 'expected rule id');
    assert(rule.approval_mode === 'review_first', 'expected review_first approval');
  });

  await test('Manual scan generates evidence-backed insights rather than smoke-only success', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/proactive/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rule_id: createdRuleId }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    const results = arr(body.results);
    assert(results.length >= 1, 'expected scan result');
    const first = results[0];
    const insights = arr(first.insights);
    assert(insights.length >= 1, 'expected generated insights');
    const meddic = insights.find((item) => String(item.insight_title || '').includes('MEDDIC')) || insights[0];
    createdInsightId = String(meddic.id || '');
    assert(createdInsightId.length > 0, 'expected insight id');
    assert(Number(meddic.confidence || 0) >= 0.7, 'expected meaningful confidence');
    assert(Array.isArray(meddic.evidence_refs), 'expected evidence refs');
    assert(String(meddic.review_status || '') === 'pending', 'review_first should keep insight pending');
    const pool = new Pool({ connectionString: getDatabaseUrl() });
    try {
      const count = await pool.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE rule_id = $1`, [createdRuleId]);
      firstRuleInsightCount = Number(count.rows[0]?.count || 0);
      assert(firstRuleInsightCount >= insights.length, 'expected stored insights for created rule');
    } finally {
      await pool.end();
    }
  });

  await test('Repeated scan updates duplicate observations without flooding admin review', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/proactive/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rule_id: createdRuleId }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    const pool = new Pool({ connectionString: getDatabaseUrl() });
    try {
      const count = await pool.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE rule_id = $1`, [createdRuleId]);
      assert(Number(count.rows[0]?.count || 0) === firstRuleInsightCount, 'expected no duplicate insight rows for repeated scan');
      const duplicate = await pool.query(
        `SELECT metadata->>'duplicate_scan' AS duplicate_scan
           FROM proactive_insight
          WHERE rule_id = $1
          ORDER BY updated_at DESC
          LIMIT 1`,
        [createdRuleId]
      );
      assert(duplicate.rows[0]?.duplicate_scan === 'true', 'expected duplicate scan metadata to be recorded');
    } finally {
      await pool.end();
    }
  });

  await test('Insight approval creates mission with validation context', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/proactive/insights/${encodeURIComponent(createdInsightId)}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'approve', review_note: '功能测试通过审核' }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    const insight = body.insight as Record<string, unknown>;
    assert(insight.review_status === 'approved', `expected approved, got ${insight.review_status}`);

    const missions = await fetchJson(`${webPortalUrl}/api/admin/proactive/missions`, { headers });
    assert(missions.status === 200, `expected 200, got ${missions.status}`);
    const mission = arr(missions.body.missions).find((item) => String(item.insight_id) === createdInsightId);
    assert(Boolean(mission), 'expected mission for approved insight');
    createdMissionId = String(mission?.id || '');
    assert(String(mission?.status || '') === 'queued', `expected queued, got ${mission?.status}`);
    assert(Number(mission?.priority || 0) >= 80, 'expected rule priority carried into mission');
  });

  await test('Mission dispatch reuses org_task assignment and keeps proactive linkage', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/proactive/missions/${encodeURIComponent(createdMissionId)}/dispatch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ force: true }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    const mission = body.mission as Record<string, unknown>;
    assert(mission.status === 'assigned', `expected assigned, got ${mission.status}`);
    assert(typeof mission.assignment_ref === 'string' && mission.assignment_ref.length > 0, 'expected assignment_ref');
    assert(typeof mission.workflow_ref === 'string' && mission.workflow_ref.length > 0, 'expected workflow_ref task id');
  });

  await test('Reports can be listed and published for admin review board', async () => {
    const listed = await fetchJson(`${webPortalUrl}/api/admin/proactive/reports`, { headers });
    assert(listed.status === 200, `expected 200, got ${listed.status}: ${JSON.stringify(listed.body)}`);
    const report = arr(listed.body.reports)[0];
    assert(Boolean(report), 'expected at least one report');
    createdReportId = String(report.id || '');
    const published = await fetchJson(`${webPortalUrl}/api/admin/proactive/reports/${encodeURIComponent(createdReportId)}/publish`, {
      method: 'POST',
      headers,
    });
    assert(published.status === 200, `expected 200, got ${published.status}: ${JSON.stringify(published.body)}`);
    assert((published.body.report as Record<string, unknown>).status === 'published', 'expected published report');
  });

  await test('Functional test archives created rules to keep demo state clean', async () => {
    for (const ruleId of createdRuleIds) {
      const { status, body } = await fetchJson(`${webPortalUrl}/api/admin/proactive/rules/${encodeURIComponent(ruleId)}/archive`, {
        method: 'POST',
        headers,
      });
      assert(status === 200, `expected archive 200, got ${status}: ${JSON.stringify(body)}`);
      assert((body.rule as Record<string, unknown>).status === 'archived', 'expected archived rule');
    }
    await archiveFunctionalTestRules();
  });

  console.log('\n=== Proactive Orchestration Functional Results ===');
  for (const result of RESULTS) {
    const mark = result.passed ? 'PASS' : 'FAIL';
    console.log(`${mark} ${result.name} (${result.duration_ms}ms) ${result.passed ? '' : result.detail}`);
  }
  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
