#!/usr/bin/env node

const { Client } = require('pg');

const BASE_URL = process.env.FACT_RETRIEVAL_URL || 'http://localhost:3004';
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
    return {
      ok: response.ok,
      status: response.status,
      body: JSON.parse(text),
    };
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
  console.log('=== M2 P0-3 扩展验证 ===');

  const reset = await postJson('/internal/test/reset', {});
  assert(reset.ok, `reset failed: ${reset.status}`);

  const docs = await Promise.all([
    postJson('/internal/documents/index', {
      owner_user_id: 'u_p03a',
      scope_type: 'private',
      title: 'A private note',
      content_text: 'customer A private context with unique token A_ONLY_MARKER',
    }),
    postJson('/internal/documents/index', {
      owner_user_id: 'u_p03b',
      scope_type: 'private',
      title: 'B private note',
      content_text: 'customer B private context with unique token B_ONLY_MARKER',
    }),
    postJson('/internal/documents/index', {
      owner_user_id: 'u_p03admin',
      scope_type: 'public',
      title: 'public guide',
      content_text: 'public workflow guide with token PUBLIC_MARKER for all users',
    }),
  ]);

  assert(docs.every((item) => item.ok), 'seed documents failed');
  const [aDoc, bDoc, publicDoc] = docs;

  const queryA = await postJson('/internal/retrieval/query', {
    owner_user_id: 'u_p03a',
    query_text: 'A_ONLY_MARKER public marker',
    intent_type: 'evidence',
    allowed_scopes: ['private:u_p03a', 'public:workflow'],
  });

  const queryB = await postJson('/internal/retrieval/query', {
    owner_user_id: 'u_p03b',
    query_text: 'B_ONLY_MARKER public marker',
    intent_type: 'evidence',
    allowed_scopes: ['private:u_p03b', 'public:workflow'],
  });

  assert(queryA.ok && queryB.ok, 'retrieval queries failed');

  const aRefs = queryA.body.evidence_pack.items.map((item) => item.item_ref);
  const bRefs = queryB.body.evidence_pack.items.map((item) => item.item_ref);

  assert(aRefs.some((ref) => aDoc.body.chunk_ids.includes(ref)), 'A cannot retrieve A private chunk');
  assert(!aRefs.some((ref) => bDoc.body.chunk_ids.includes(ref)), 'A leaked B private chunk');
  assert(bRefs.some((ref) => bDoc.body.chunk_ids.includes(ref)), 'B cannot retrieve B private chunk');
  assert(!bRefs.some((ref) => aDoc.body.chunk_ids.includes(ref)), 'B leaked A private chunk');
  assert(aRefs.some((ref) => publicDoc.body.chunk_ids.includes(ref)), 'A missing public chunk');
  assert(bRefs.some((ref) => publicDoc.body.chunk_ids.includes(ref)), 'B missing public chunk');

  for (const item of queryA.body.evidence_pack.items.concat(queryB.body.evidence_pack.items)) {
    assert(Boolean(item.item_ref), 'missing item_ref');
    assert(Boolean(item.evidence_ref), 'missing evidence_ref');
    assert(Boolean(item.source_scope), 'missing source_scope');
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const traceRows = await client.query(
    `select id, intent_type, retrieval_plan, result_summary, duration_ms, degraded
     from retrieval_trace
     where id = any($1::uuid[])`,
    [[queryA.body.retrieval_trace_id, queryB.body.retrieval_trace_id]],
  );
  await client.end();

  assert(traceRows.rows.length === 2, 'retrieval_trace rows missing');
  for (const row of traceRows.rows) {
    assert(Boolean(row.intent_type), 'trace intent_type missing');
    assert(Boolean(row.retrieval_plan?.steps), 'trace retrieval_plan missing');
    assert(Boolean(row.result_summary?.item_count >= 0), 'trace result_summary missing');
    assert(Number(row.duration_ms) >= 0, 'trace duration_ms missing');
    assert(typeof row.degraded === 'boolean', 'trace degraded missing');
  }

  console.log('✓ M2 P0-3 扩展验证通过');
}

main().catch((error) => {
  console.error('✗ M2 P0-3 扩展验证失败');
  console.error(error.message || error);
  process.exit(1);
});
