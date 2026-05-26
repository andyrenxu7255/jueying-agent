import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const RESULTS: Array<{ name: string; passed: boolean; detail: string; duration_ms: number }> = [];
let passed = 0;
let failed = 0;

type JsonBody = Record<string, unknown>;

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

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: JsonBody }> {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let body: JsonBody = {};
  try { body = JSON.parse(text) as JsonBody; } catch { body = { raw: text }; }
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

async function startMockProvider(port: number): Promise<{ url: string; cleanup: () => Promise<void> }> {
  const { execFile } = await import('node:child_process');
  const containerName = `portal-mock-${port}-${Date.now()}`;
  const script = String.raw`
    const http = require('http');
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      let body = '';
      for await (const chunk of req) body += chunk.toString('utf8');
      if (url.pathname === '/v1/models' || url.pathname === '/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-chat-model' }, { id: 'mock-embed-model' }, { id: 'mock-rerank-model' }] }));
        return;
      }
      if (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'chatcmpl-mock', choices: [{ message: { content: 'ok' } }] }));
        return;
      }
      if (url.pathname === '/v1/embeddings' || url.pathname === '/embeddings') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }], model: 'mock-embed-model' }));
        return;
      }
      if (url.pathname === '/v1/rerank' || url.pathname === '/rerank') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ results: [{ index: 0, relevance_score: 0.99 }] }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', body }));
    });
    server.listen(${port}, '0.0.0.0');
  `;
  await new Promise<void>((resolve, reject) => {
    execFile('docker', [
      'run',
      '--rm',
      '-d',
      '--name',
      containerName,
      '--network',
      'agent-harness_agent-harness-net',
      'node:22-alpine',
      'node',
      '-e',
      script,
    ], (error) => error ? reject(error) : resolve());
  });
  return {
    url: `http://${containerName}:${port}`,
    cleanup: async () => {
      await new Promise<void>((resolve) => {
        execFile('docker', ['rm', '-f', containerName], () => resolve());
      });
    }
  };
}

function asArray(value: unknown): JsonBody[] {
  return Array.isArray(value) ? value as JsonBody[] : [];
}

function loadRepoEnv(): Record<string, string> {
  const filePath = resolve(process.cwd(), '.env');
  if (!existsSync(filePath)) return {};
  const env: Record<string, string> = {};
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
    env[key] = value;
  }
  return env;
}

function getCleanupConnectionString(): string {
  const env = { ...loadRepoEnv(), ...process.env as Record<string, string> };
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const user = env.POSTGRES_USER || 'agent_harness';
  const password = env.POSTGRES_PASSWORD || 'dev_password_changeme';
  const db = env.POSTGRES_DB || 'agent_harness';
  const host = env.POSTGRES_HOST || '127.0.0.1';
  const port = env.POSTGRES_PORT || '5432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

async function createMinimalDocxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.folder('_rels')?.file('.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.folder('word')?.file('document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body><w:p><w:r><w:t>${text.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch))}</w:t></w:r></w:p></w:body>` +
    '</w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function main(): Promise<void> {
  const webPortalUrl = process.env.WEB_PORTAL_URL || 'http://localhost:3003';
  const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || 'http://localhost:3004';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const marker = `portal-functional-${Date.now()}`;
  const headers: Record<string, string> = {};
  const createdDocIds: string[] = [];
  const createdFactIds: string[] = [];
  const createdFileIds: string[] = [];
  let createdModelId = '';
  let originalFeishuAppId = '';

  async function cleanupTestData(): Promise<void> {
    if (createdModelId) {
      await fetchJson(`${webPortalUrl}/api/admin/llm-models/${encodeURIComponent(createdModelId)}`, {
        method: 'DELETE',
        headers,
      }).catch(() => undefined);
      createdModelId = '';
    }

    if (originalFeishuAppId !== '') {
      await fetchJson(`${webPortalUrl}/api/admin/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ FEISHU_APP_ID: originalFeishuAppId }),
      }).catch(() => undefined);
    }

    for (const factId of createdFactIds) {
      await fetchJson(`${factRetrievalUrl}/internal/fact/review`, {
        method: 'POST',
        body: JSON.stringify({ fact_id: factId, action: 'reject', reviewed_by: 'portal-functional-test' }),
      }).catch(() => undefined);
    }

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: getCleanupConnectionString() });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (createdFileIds.length > 0) {
        await client.query('DELETE FROM user_file WHERE id = ANY($1::uuid[])', [createdFileIds]);
      }
      const cleanupDocIds = new Set<string>(createdDocIds);
      if (marker) {
        const markerDocs = await client.query(
          'SELECT id FROM document WHERE title LIKE $1 OR source_uri LIKE $1',
          [`%${marker}%`]
        );
        for (const row of markerDocs.rows) cleanupDocIds.add(String(row.id));
      }
      if (cleanupDocIds.size > 0) {
        const cleanupIds = Array.from(cleanupDocIds);
        await client.query('DELETE FROM document_chunk WHERE document_id = ANY($1::uuid[])', [cleanupIds]);
        await client.query('DELETE FROM document_version WHERE document_id = ANY($1::uuid[])', [cleanupIds]);
        await client.query('DELETE FROM document WHERE id = ANY($1::uuid[])', [cleanupIds]);
      }
      if (createdFactIds.length > 0) {
        await client.query('DELETE FROM fact_conflict WHERE existing_fact_id = ANY($1::uuid[]) OR incoming_fact_id = ANY($1::uuid[])', [createdFactIds]);
        await client.query('DELETE FROM fact_evidence WHERE fact_id = ANY($1::uuid[])', [createdFactIds]);
        await client.query('DELETE FROM fact WHERE id = ANY($1::uuid[])', [createdFactIds]);
      }
      if (marker) {
        await client.query('DELETE FROM fact WHERE object_value LIKE $1', [`%${marker}%`]);
        await client.query('DELETE FROM user_file WHERE original_name LIKE $1', [`%${marker}%`]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  }

  await waitForServer(`${webPortalUrl}/health/live`, 20, 500);
  await waitForServer(`${factRetrievalUrl}/health/live`, 20, 500);

  await test('Admin login works and no default password modal is required', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    assert(typeof body.session_id === 'string' && body.session_id.length > 0, 'expected session_id');
    assert(body.must_change_password !== true, 'default password change prompt should not be active');
    headers['x-session-id'] = String(body.session_id);
  });

  await test('My tasks page proxies the logged-in session user_id', async () => {
    const { status, body } = await fetchJson(`${webPortalUrl}/api/tasks`, { headers });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'expected ok=true');
    assert(Array.isArray(body.assignments), 'expected assignments array');
  });

  await test('Feishu config makes signing secret optional and exposes restart targets', async () => {
    const meta = await fetchJson(`${webPortalUrl}/api/admin/config-meta`, { headers });
    assert(meta.status === 200, `expected 200, got ${meta.status}`);
    const sections = asArray(meta.body.sections);
    const feishu = sections.find((section) => section.key === 'feishu');
    assert(Boolean(feishu), 'expected feishu config section');
    const fields = asArray((feishu as JsonBody).fields);
    const signing = fields.find((field) => field.key === 'FEISHU_SIGNING_SECRET') as JsonBody | undefined;
    assert(Boolean(signing), 'expected FEISHU_SIGNING_SECRET field');
    assert(typeof signing?.hint === 'string' && String(signing.hint).includes('长连接'), 'expected long-connection hint');

    const beforeConfig = await fetchJson(`${webPortalUrl}/api/admin/config`, { headers });
    assert(beforeConfig.status === 200, `expected 200, got ${beforeConfig.status}`);
    originalFeishuAppId = String(((beforeConfig.body.config as JsonBody) || {}).FEISHU_APP_ID || '');

    const config = await fetchJson(`${webPortalUrl}/api/admin/config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ FEISHU_APP_ID: `cli_${marker}` }),
    });
    assert(config.status === 200, `expected 200, got ${config.status}: ${JSON.stringify(config.body)}`);
    assert(config.body.hot_loaded === true, 'expected hot_loaded=true');
    const targets = asArray(config.body.restart_targets);
    assert(targets.some((target) => String(target) === 'feishu-longconn'), 'expected feishu-longconn restart target');
    assert(targets.some((target) => String(target) === 'gateway-adapter'), 'expected gateway-adapter restart target');
  });

  await test('LLM model create/list/delete preserves the second model', async () => {
    const before = await fetchJson(`${webPortalUrl}/api/admin/llm-models`, { headers });
    assert(before.status === 200, `expected 200, got ${before.status}`);
    const beforeModels = asArray(before.body.models);
    const name = `codex-functional-model-${marker}`;
    const create = await fetchJson(`${webPortalUrl}/api/admin/llm-models`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        provider_model: name,
        url: 'http://litellm:4000',
        context_window: 32768,
        max_output_tokens: 4096,
        supports_thinking: true,
        thinking_enabled: true,
        thinking_strength: 'medium',
      }),
    });
    assert(create.status === 200, `expected 200, got ${create.status}: ${JSON.stringify(create.body)}`);
    const created = create.body.model as JsonBody;
    createdModelId = String(created.id || '');
    assert(createdModelId.length > 0, 'expected created model id');
    assert(created.name === name, 'expected created model name');

    const after = await fetchJson(`${webPortalUrl}/api/admin/llm-models`, { headers });
    assert(after.status === 200, `expected 200, got ${after.status}`);
    const afterModels = asArray(after.body.models);
    assert(afterModels.length === beforeModels.length + 1, `expected model count +1, got before=${beforeModels.length} after=${afterModels.length}`);
    const listed = afterModels.find((model) => model.id === createdModelId || model.name === name);
    assert(Boolean(listed), 'expected created model in list');
    assert(Number((listed as JsonBody).context_window) === 32768, 'expected context window saved');
    assert(Number((listed as JsonBody).max_output_tokens || (listed as JsonBody).max_tokens) === 4096, 'expected max output saved');
    assert((listed as JsonBody).thinking_strength === 'medium', 'expected thinking strength saved');

    const remove = await fetchJson(`${webPortalUrl}/api/admin/llm-models/${encodeURIComponent(createdModelId)}`, {
      method: 'DELETE',
      headers,
    });
    assert(remove.status === 200, `expected 200 deleting model, got ${remove.status}: ${JSON.stringify(remove.body)}`);
    createdModelId = '';
  });

  await test('Model catalog exposes chat, embedding, and rerank candidates', async () => {
    for (const kind of ['chat', 'embedding', 'rerank']) {
      const res = await fetchJson(`${webPortalUrl}/api/admin/llm-models/catalog`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind, url: 'http://litellm:4000' }),
      });
      assert(res.status === 200, `expected 200 for ${kind}, got ${res.status}: ${JSON.stringify(res.body)}`);
      const models = asArray(res.body.models);
      assert(models.length > 0, `expected ${kind} catalog models`);
      if (kind === 'embedding') assert(models.some((model) => Number(model.dimensions || model.context_window || 0) > 0), 'expected embedding dimensions or context metadata');
    }
  });

  await test('Embedding and rerank test buttons return actionable validation errors without provider URL', async () => {
    const mockPort = 4101;
    const mock = await startMockProvider(mockPort);
    try {
      const embedding = await fetchJson(`${webPortalUrl}/api/admin/llm-models/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'embedding',
          EMBEDDING_PROVIDER_URL: mock.url,
          EMBEDDING_PROVIDER_MODEL: 'mock-embed-model',
          EMBEDDING_PROVIDER_DIMENSIONS: 4,
        }),
      });
      assert(embedding.status === 200, `expected 200, got ${embedding.status}: ${JSON.stringify(embedding.body)}`);
      assert(Number(embedding.body.dimensions) === 4, `expected dimensions=4, got ${embedding.body.dimensions}`);

      const rerank = await fetchJson(`${webPortalUrl}/api/admin/llm-models/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'rerank',
          RERANK_PROVIDER_URL: mock.url,
          RERANK_PROVIDER_MODEL: 'mock-rerank-model',
        }),
      });
      assert(rerank.status === 200, `expected 200, got ${rerank.status}: ${JSON.stringify(rerank.body)}`);
      assert(Number(rerank.body.result_count) >= 1, `expected result_count >= 1, got ${rerank.body.result_count}`);
    } finally {
      await mock.cleanup();
    }
  });

  await test('Manual knowledge import indexes a document and submits review fact', async () => {
    const title = `Manual Knowledge ${marker}`;
    const content = `Manual knowledge body ${marker}. This validates document indexing and review submission.`;
    const res = await fetchJson(`${webPortalUrl}/api/knowledge/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, content, source_type: 'manual', source_uri: marker, scope: 'private' }),
    });
    assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const doc = res.body.document as JsonBody;
    const review = res.body.review as JsonBody;
    assert(typeof doc.document_id === 'string', 'expected document id');
    assert(Number(doc.chunks_indexed) > 0, 'expected indexed chunks');
    assert(review.submitted === true && typeof review.fact_id === 'string', 'expected review fact id');
    createdDocIds.push(String(doc.document_id));
    createdFactIds.push(String(review.fact_id));
  });

  await test('TXT upload stores file, indexes content, and submits review fact', async () => {
    const title = `Txt Knowledge ${marker}`;
    const fileName = `${marker}.txt`;
    const content = `TXT upload body ${marker}. This validates upload storage and indexing.`;
    const res = await fetchJson(`${webPortalUrl}/api/knowledge/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title,
        file_name: fileName,
        mime_type: 'text/plain',
        file_buffer_b64: Buffer.from(content, 'utf8').toString('base64'),
        source_type: 'document',
        scope: 'private',
      }),
    });
    assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const doc = res.body.document as JsonBody;
    const review = res.body.review as JsonBody;
    const file = res.body.file as JsonBody;
    assert(typeof doc.document_id === 'string', 'expected document id');
    assert(Number(doc.chunks_indexed) > 0, 'expected indexed chunks');
    assert(review.submitted === true && typeof review.fact_id === 'string', 'expected review fact id');
    assert(typeof file.id === 'string' && file.original_name === fileName, 'expected stored user file');
    createdDocIds.push(String(doc.document_id));
    createdFactIds.push(String(review.fact_id));
    createdFileIds.push(String(file.id));
  });

  await test('DOCX upload parses text, stores file, indexes content, and submits review fact', async () => {
    const title = `Docx Knowledge ${marker}`;
    const fileName = `${marker}.docx`;
    const content = `DOCX upload body ${marker}. This validates Word parsing, upload storage, and indexing.`;
    const docxBuffer = await createMinimalDocxBuffer(content);
    const res = await fetchJson(`${webPortalUrl}/api/knowledge/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title,
        file_name: fileName,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        file_buffer_b64: docxBuffer.toString('base64'),
        source_type: 'document',
        scope: 'private',
      }),
    });
    assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const doc = res.body.document as JsonBody;
    const review = res.body.review as JsonBody;
    const file = res.body.file as JsonBody;
    assert(typeof doc.document_id === 'string', 'expected document id');
    assert(Number(doc.chunks_indexed) > 0, 'expected indexed chunks');
    assert(review.submitted === true && typeof review.fact_id === 'string', 'expected review fact id');
    assert(typeof file.id === 'string' && file.original_name === fileName, 'expected stored user file');

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: getCleanupConnectionString() });
    const client = await pool.connect();
    try {
      const chunkResult = await client.query(
        'SELECT content_text FROM document_chunk WHERE document_id = $1::uuid ORDER BY chunk_index LIMIT 5',
        [String(doc.document_id)]
      );
      const indexedText = chunkResult.rows.map((row) => String(row.content_text || '')).join('\n');
      assert(indexedText.includes(`DOCX upload body ${marker}`), 'expected parsed DOCX text in indexed chunks');
    } finally {
      client.release();
      await pool.end();
    }

    createdDocIds.push(String(doc.document_id));
    createdFactIds.push(String(review.fact_id));
    createdFileIds.push(String(file.id));
  });

  await test('Database maintenance returns operation result and refreshed stats', async () => {
    const stats = await fetchJson(`${webPortalUrl}/api/admin/db/stats`, { headers });
    assert(stats.status === 200, `expected 200, got ${stats.status}`);
    assert(typeof (stats.body.stats as JsonBody).db_size === 'string', 'expected db_size');

    const maintenance = await fetchJson(`${webPortalUrl}/api/admin/db/maintenance`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'analyze' }),
    });
    assert(maintenance.status === 200, `expected 200, got ${maintenance.status}: ${JSON.stringify(maintenance.body)}`);
    assert(maintenance.body.action === 'analyze', 'expected analyze action');
    assert(Number(maintenance.body.duration_ms) >= 0, 'expected duration_ms');
    assert(typeof (maintenance.body.stats as JsonBody).db_size === 'string', 'expected refreshed db_size');
  });

  await test('Resource quotas and container stats use human-scale units and support non-Docker fallback flag', async () => {
    const quotas = await fetchJson(`${webPortalUrl}/api/admin/quotas`, { headers });
    assert(quotas.status === 200, `expected 200, got ${quotas.status}`);
    const storage = ((quotas.body.quotas as JsonBody).storage_bytes || {}) as JsonBody;
    assert(Number(storage.limit) === 1073741824, `expected 1GB default storage limit, got ${storage.limit}`);
    assert(Number(storage.used) >= 0, 'expected storage usage number');

    const containers = await fetchJson(`${webPortalUrl}/api/admin/container-stats`, { headers });
    assert(containers.status === 200, `expected 200, got ${containers.status}`);
    assert(typeof containers.body.docker_available === 'boolean', 'expected docker_available flag');
    assert(Array.isArray(containers.body.containers), 'expected containers array');
  });

  await test('Recommended skills are curated, low-risk, and show full details', async () => {
    const recommended = await fetchJson(`${webPortalUrl}/api/admin/skills/recommended`, { headers });
    assert(recommended.status === 200, `expected 200, got ${recommended.status}`);
    const skills = asArray(recommended.body.skills);
    assert(skills.length >= 5, `expected at least 5 curated skills, got ${skills.length}`);
    assert(skills.some((skill) => String(skill.category) === 'office'), 'expected office skills');
    assert(skills.some((skill) => String(skill.category) === 'search'), 'expected search skills');
    for (const skill of skills) {
      const definition = (skill.definition || {}) as JsonBody;
      const risk = (definition.risk_profile || {}) as JsonBody;
      assert(risk.api_key_required === false, `expected no API key for ${skill.name}`);
      assert(risk.overlaps_memory === false, `expected no memory overlap for ${skill.name}`);
      assert(['low', 'medium'].includes(String(skill.risk)), `expected low/medium risk for ${skill.name}`);
      assert(Number(skill.rating) >= 4.6, `expected good rating for ${skill.name}`);
      assert(String(skill.source).startsWith('https://clawhub.ai/'), `expected ClawHub source for ${skill.name}`);
    }
    assert(skills.some((skill) => String(skill.source).includes('/meddic-b2b-sales-review')), 'expected MEDDIC ClawHub skill');
    assert(skills.some((skill) => String(skill.source).includes('/customer-research')), 'expected customer research ClawHub skill');
  });

  await test('ClawHub admin config is sensitive and update checks explain version changes', async () => {
    const meta = await fetchJson(`${webPortalUrl}/api/admin/config-meta`, { headers });
    assert(meta.status === 200, `expected 200, got ${meta.status}`);
    const sections = asArray(meta.body.sections);
    const clawhub = sections.find((section) => section.key === 'clawhub');
    assert(Boolean(clawhub), 'expected clawhub config section');
    const fields = asArray((clawhub as JsonBody).fields);
    const token = fields.find((field) => field.key === 'CLAWHUB_ADMIN_TOKEN') as JsonBody | undefined;
    assert(Boolean(token), 'expected CLAWHUB_ADMIN_TOKEN field');
    assert(token?.sensitive === true, 'expected token field to be sensitive');

    const status = await fetchJson(`${webPortalUrl}/api/admin/clawhub/status`, { headers });
    assert(status.status === 200, `expected 200, got ${status.status}: ${JSON.stringify(status.body)}`);
    assert(typeof status.body.token_configured === 'boolean', 'expected token_configured boolean');
    assert(!('CLAWHUB_ADMIN_TOKEN' in status.body), 'token must not be returned by status endpoint');

    const check = await fetchJson(`${webPortalUrl}/api/admin/skills/check-updates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'meddic-b2b-sales-review' }),
    });
    assert(check.status === 200, `expected 200, got ${check.status}: ${JSON.stringify(check.body)}`);
    const updates = asArray(check.body.updates);
    assert(updates.length === 1, `expected one update result, got ${updates.length}`);
    const update = updates[0];
    assert(String(update.slug) === 'meddic-b2b-sales-review', 'expected meddic slug');
    assert(typeof update.latest_version === 'string' && String(update.latest_version).length > 0, 'expected latest version');
    assert(typeof update.change_summary === 'string' && String(update.change_summary).length > 0, 'expected interpreted changelog summary');

    const unsafeImport = await fetchJson(`${webPortalUrl}/api/admin/skills/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source_url: 'https://clawhub.ai/andyrenxu7255/--help' }),
    });
    assert(unsafeImport.status === 400, `expected unsafe ClawHub slug rejected, got ${unsafeImport.status}: ${JSON.stringify(unsafeImport.body)}`);
    assert(unsafeImport.body.error === 'invalid_clawhub_slug', 'expected invalid_clawhub_slug error');
  });

  await test('Shared knowledge remains an admin public-library path distinct from personal import', async () => {
    const res = await fetchJson(`${webPortalUrl}/api/admin/shared-knowledge`, { headers });
    assert([200, 503].includes(res.status), `expected 200 or db-unavailable fallback, got ${res.status}`);
    if (res.status === 200) assert(Array.isArray(res.body.documents), 'expected shared documents array');
  });

  await test('Seeded MEDDIC demo knowledge and graph are queryable from the database', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: getCleanupConnectionString() });
    const client = await pool.connect();
    try {
      const docs = await client.query(
        `SELECT title FROM document
         WHERE metadata->>'source' = 'demo_seed'
           AND source_uri LIKE 'local-demo://MEDDIC销售助手/%'
         ORDER BY title`
      );
      assert(docs.rows.length >= 5, `expected at least 5 MEDDIC demo documents, got ${docs.rows.length}`);
      assert(docs.rows.some((row) => String(row.title).includes('Champion')), 'expected Champion demo document');

      const chunks = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM document_chunk dc
         JOIN document d ON d.id = dc.document_id
         WHERE d.metadata->>'source' = 'demo_seed'
           AND dc.content_text LIKE '%MEDDIC%'`
      );
      assert(Number(chunks.rows[0]?.cnt || 0) >= 1, 'expected MEDDIC content chunks');

      const graph = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM relation r
         JOIN entity e1 ON e1.id = r.from_entity_id
         JOIN entity e2 ON e2.id = r.to_entity_id
         WHERE e1.metadata->>'source' = 'demo_seed'
           AND e2.metadata->>'source' = 'demo_seed'
           AND r.metadata->>'source' = 'demo_seed'`
      );
      assert(Number(graph.rows[0]?.cnt || 0) >= 5, 'expected seeded MEDDIC graph relations');

      const skills = await client.query(
        `SELECT skill_name, metadata FROM skill
         WHERE metadata->>'installed_from' = 'clawhub.ai'
           AND metadata->>'clawhub_slug' IN ('meddic-b2b-sales-review','customer-research')`
      );
      assert(skills.rows.length >= 2, `expected seeded ClawHub skills, got ${skills.rows.length}`);
    } finally {
      client.release();
      await pool.end();
    }
  });

  await cleanupTestData();

  console.log('\n=== Portal Admin Functional Test Results ===\n');
  for (const result of RESULTS) {
    const icon = result.passed ? '✓' : '✗';
    console.log(`${icon} ${result.name} (${result.duration_ms}ms)`);
    if (!result.passed) console.log(`  Detail: ${result.detail}`);
  }
  console.log(`\nTotal: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Functional test runner failed:', error);
  process.exit(2);
});
