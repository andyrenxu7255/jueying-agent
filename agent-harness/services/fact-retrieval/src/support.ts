import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_PRIVATE_SCOPE_PREFIX = 'private:';

export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Buffer(buf: Buffer): string {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

export function sha256Prefixed(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

export function randomRef(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

export function userRefToDbId(userRef: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userRef)) {
    return userRef.toLowerCase();
  }

  const hex = sha256Hex(userRef).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function buildAllowedScopes(ownerUserId: string, allowedScopes?: string[]): string[] {
  if (allowedScopes && allowedScopes.length > 0) {
    return allowedScopes;
  }

  return [`${DEFAULT_PRIVATE_SCOPE_PREFIX}${ownerUserId}`, 'public:workflow', 'public:skill'];
}

export function splitIntoChunks(contentText: string, maxChunkChars = 800): string[] {
  const paragraphs = contentText
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [contentText.trim()].filter(Boolean);
  }

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if ((current.length + paragraph.length + 2) <= maxChunkChars) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    current = paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function tokenCount(value: string): number {
  return tokenize(value).length;
}

export function lexicalScore(query: string, candidate: string): number {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);

  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const matched = queryTokens.filter((token) => candidateSet.has(token)).length;
  const containmentBonus = candidate.toLowerCase().includes(query.toLowerCase()) ? 0.2 : 0;
  const score = Math.min(1, matched / queryTokens.length + containmentBonus);
  return Number(score.toFixed(4));
}

export function sourceScope(scopeType: string, ownerUserRef: string): string {
  return scopeType === 'public' ? 'public:workflow' : `${DEFAULT_PRIVATE_SCOPE_PREFIX}${ownerUserRef}`;
}
