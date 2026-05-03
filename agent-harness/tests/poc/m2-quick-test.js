#!/usr/bin/env node

const { Client } = require('pg');

const BASE_URL = 'http://localhost:3004';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://agent_harness:dev_password@localhost:5432/agent_harness';
const TEST_RESET_TOKEN = process.env.TEST_RESET_TOKEN || '';

async function postJson(path, payload, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(TEST_RESET_TOKEN ? { authorization: `Bearer ${TEST_RESET_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    clearTimeout(timer);
    return { ok: response.ok, status: response.status, body: JSON.parse(text) };
  } catch (error) {
    clearTimeout(timer);
    return { ok: false, status: 0, body: { error: String(error) } };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log('=== M2 快速 PoC ===');

  const reset = await postJson('/internal/test/reset', {});
  assert(reset.ok, `reset failed: ${reset.status}`);

  console.log('1. 建立三组文档数据...');
  const aliceDoc = await postJson('/internal/documents/index', {
    owner_user_id: 'u_alice',
    scope_type: 'private',
    title: 'Alpha Roadmap',
    content_text: 'Project alpha status is on track. Alpha milestone is green.',
  });
  const bobDoc = await postJson('/internal/documents/index', {
    owner_user_id: 'u_bob',
    scope_type: 'private',
    title: 'Beta Incident',
    content_text: 'Project beta incident is unresolved. Beta priority is critical.',
  });
  const publicDoc = await postJson('/internal/documents/index', {
    owner_user_id: 'u_admin',
    scope_type: 'public',
    title: 'Shared Handbook',
    content_text: 'Shared handbook covers onboarding and shared operating rules.',
  });

  assert(aliceDoc.ok && bobDoc.ok && publicDoc.ok, 'document indexing failed');

  console.log('2. 建立事实与冲突记录...');
  const factInsert = await postJson('/internal/facts/write', {
    owner_user_id: 'u_alice',
    scope_type: 'private',
    mode: 'insert',
    subject_ref: 'project:alpha',
    predicate: 'status',
    object_value: 'on_track',
    evidence_refs: [{ evidence_ref: aliceDoc.body.chunk_ids[0], evidence_type: 'document_chunk' }],
  });
  const factConflict = await postJson('/internal/facts/write', {
    owner_user_id: 'u_alice',
    scope_type: 'private',
    mode: 'conflict',
    target_fact_id: factInsert.body.fact_id,
    subject_ref: 'project:alpha',
    predicate: 'status',
    object_value: 'blocked',
    conflict_reason: 'new contradictory operator input',
  });

  assert(factInsert.ok && factConflict.ok, 'fact write failed');

  console.log('3. 执行权限过滤检索...');
  const aliceQuery = await postJson('/internal/retrieval/query', {
    owner_user_id: 'u_alice',
    query_text: 'alpha status roadmap',
    intent_type: 'dev-context',
    allowed_scopes: ['private:u_alice', 'public:workflow'],
  });
  const bobQuery = await postJson('/internal/retrieval/query', {
    owner_user_id: 'u_bob',
    query_text: 'beta incident critical',
    intent_type: 'evidence',
    allowed_scopes: ['private:u_bob', 'public:workflow'],
  });
  const publicQuery = await postJson('/internal/retrieval/query', {
    owner_user_id: 'u_alice',
    query_text: 'shared handbook onboarding',
    intent_type: 'evidence',
    allowed_scopes: ['private:u_alice', 'public:workflow'],
  });

  assert(aliceQuery.ok && bobQuery.ok && publicQuery.ok, 'retrieval query failed');
  assert(aliceQuery.body.evidence_pack.items.length > 0, 'alice retrieval returned no items');
  assert(bobQuery.body.evidence_pack.items.length > 0, 'bob retrieval returned no items');
  assert(publicQuery.body.evidence_pack.items.some((item) => publicDoc.body.chunk_ids.includes(item.item_ref)), 'public retrieval missing public chunk');

  const aliceItemRefs = aliceQuery.body.evidence_pack.items.map((item) => item.item_ref);
  const bobItemRefs = bobQuery.body.evidence_pack.items.map((item) => item.item_ref);
  assert(!aliceItemRefs.some((itemRef) => bobDoc.body.chunk_ids.includes(itemRef)), 'alice query leaked bob private chunk');
  assert(!bobItemRefs.some((itemRef) => aliceDoc.body.chunk_ids.includes(itemRef)), 'bob query leaked alice private chunk');
  assert(aliceQuery.body.evidence_pack.items.every((item) => item.evidence_ref && item.source_scope), 'evidence pack items are not traceable');

  console.log('4. 执行 artifact 存储验证...');
  const artifactWrite = await postJson('/internal/artifacts/write', {
    owner_user_id: 'u_alice',
    artifact_type: 'report',
    mime_type: 'text/plain',
    content_text: 'artifact body should live outside database',
  });
  const artifactRead = await postJson('/internal/artifacts/read', {
    owner_user_id: 'u_alice',
    artifact_id: artifactWrite.body.artifact_id,
    allowed_scopes: ['private:u_alice'],
  });

  assert(artifactWrite.ok && artifactRead.ok, 'artifact roundtrip failed');
  assert(artifactRead.body.content_text === 'artifact body should live outside database', 'artifact content mismatch');

  console.log('5. 数据库断言...');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const factStatus = await client.query('select status from fact where id = $1', [factInsert.body.fact_id]);
  const conflictRows = await client.query('select resolution_status from fact_conflict where existing_fact_id = $1', [factInsert.body.fact_id]);
  const retrievalCount = await client.query('select count(*)::int as count from retrieval_trace');
  const artifactMeta = await client.query('select storage_backend, storage_ref from artifact_object where id = $1', [artifactWrite.body.artifact_id]);
  await client.end();

  assert(factStatus.rows[0]?.status === 'active', 'original fact was overwritten unexpectedly');
  assert(conflictRows.rows[0]?.resolution_status === 'open', 'fact conflict record missing');
  assert(retrievalCount.rows[0]?.count >= 3, 'retrieval trace records missing');
  assert(['localfs', 'minio'].includes(artifactMeta.rows[0]?.storage_backend), 'artifact storage backend mismatch');

  console.log('✓ M2 快速 PoC 通过');
}

main().catch((error) => {
  console.error('✗ M2 快速 PoC 失败');
  console.error(error.message || error);
  process.exit(1);
});
