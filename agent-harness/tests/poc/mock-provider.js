#!/usr/bin/env node

const http = require('http');

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3901);

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function embed(text) {
  const tokens = tokenize(text);
  const vector = [0, 0, 0, 0];
  for (const token of tokens) {
    let sum = 0;
    for (let i = 0; i < token.length; i += 1) {
      sum += token.charCodeAt(i);
    }
    vector[sum % vector.length] += 1;
  }
  return vector;
}

function overlapScore(query, text) {
  const queryTokens = tokenize(query);
  const textSet = new Set(tokenize(text));
  if (queryTokens.length === 0) {
    return 0;
  }
  const matched = queryTokens.filter((token) => textSet.has(token)).length;
  return Number((matched / queryTokens.length).toFixed(4));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  if ((pathname === '/health/live' || pathname === '/health/ready') && req.method === 'GET') {
    sendJson(res, 200, { ok: true, service: 'mock-provider' });
    return;
  }

  if (pathname === '/embed' && req.method === 'POST') {
    const body = await readJson(req);
    sendJson(res, 200, {
      embedding: embed(body.input),
      model_version: 'mock-provider-embed-v1',
      provider: 'mock-provider',
    });
    return;
  }

  if (pathname === '/embeddings' && req.method === 'POST') {
    const body = await readJson(req);
    sendJson(res, 200, {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: embed(body.input) }],
      model: body.model || 'mock-provider-embed-v1',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });
    return;
  }

  if (pathname === '/rerank' && req.method === 'POST') {
    const body = await readJson(req);
    const items = Array.isArray(body.candidates)
      ? body.candidates
        .map((candidate) => ({
          id: candidate.id,
          score: overlapScore(body.query, candidate.text),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, Number(body.limit) || body.candidates.length)
      : [];
    sendJson(res, 200, { items });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, () => {
  process.stdout.write(`mock-provider listening on ${PORT}\n`);
});
