/**
 * Embedding Adapter — 文本向量化适配器
 *
 * 双模式: deterministic (本地确定性哈希) / provider (远程 API 调用)
 * - deterministic: SHA256 哈希 → 维度分桶 → L2 归一化 (1536维)
 * - provider: 远程 HTTP API (/embeddings) 调用，失败自动降级到 deterministic
 * - 内置 LRU 缓存 (5000条 / 1小时 TTL)
 * - 支持余弦相似度计算
 *
 * @module embedding-adapter
 */

import { createHash } from 'node:crypto';
import { configManager } from '../config/manager';

const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingResult {
  embedding: number[];
  model_version: string;
  provider: 'local-deterministic' | 'remote-provider';
  degraded?: boolean;
  degradation_reason?: string;
}

type EmbeddingMode = 'deterministic' | 'provider';

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function normalize(vector: number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (length === 0) {
    return vector;
  }
  return vector.map((value) => value / length);
}

function deterministicEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const hash = createHash('sha256').update(token).digest();
    const bucket = hash.readUInt16BE(0) % EMBEDDING_DIMENSIONS;
    const direction = hash[2] % 2 === 0 ? 1 : -1;
    vector[bucket] += direction;
  }
  return normalize(vector);
}

function resolveEmbeddingMode(): EmbeddingMode {
  const configured = process.env.EMBEDDING_MODE
    || configManager.getPath<string>('retrieval.embedding_mode')
    || 'deterministic';
  return configured === 'provider' ? 'provider' : 'deterministic';
}

async function postWithTimeout(url: string, body: Record<string, unknown>, timeoutMs: number, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(headers || {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const size = Math.min(left.length, right.length);
  if (size === 0) {
    return 0;
  }
  let dot = 0;
  for (let index = 0; index < size; index += 1) {
    dot += left[index] * right[index];
  }
  return Number(Math.max(0, Math.min(1, (dot + 1) / 2)).toFixed(4));
}

export class EmbeddingAdapter {
  private cache = new Map<string, { result: EmbeddingResult; expiresAt: number }>();
  private cacheMaxSize = 5000;

  private cacheKey(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private checkCache(key: string): EmbeddingResult | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (cached) this.cache.delete(key);
    return null;
  }

  private setCache(key: string, result: EmbeddingResult): void {
    const ttlMs = Number(process.env.EMBEDDING_CACHE_TTL_MS || 3600000);
    this.cache.set(key, { result, expiresAt: Date.now() + ttlMs });
    if (this.cache.size > this.cacheMaxSize) {
      const now = Date.now();
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) this.cache.delete(k);
      }
    }
  }

  async embedText(text: string): Promise<EmbeddingResult> {
    const key = this.cacheKey(text);
    const cached = this.checkCache(key);
    if (cached) return cached;

    const mode = resolveEmbeddingMode();
    let result: EmbeddingResult;
    if (mode === 'provider') {
      try {
        result = await this.embedViaProvider(text);
      } catch (error) {
        result = {
          embedding: deterministicEmbedding(text),
          model_version: 'local-deterministic-1536-v1',
          provider: 'local-deterministic',
          degraded: true,
          degradation_reason: `provider_failed:${String(error)}`,
        };
      }
    } else {
      result = {
        embedding: deterministicEmbedding(text),
        model_version: 'local-deterministic-1536-v1',
        provider: 'local-deterministic',
        degraded: true,
      };
    }

    this.setCache(key, result);
    return result;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map((text) => this.embedText(text)));
  }

  private async embedViaProvider(text: string): Promise<EmbeddingResult> {
    const providerUrl = process.env.EMBEDDING_PROVIDER_URL || configManager.getPath<string>('retrieval.embedding_provider_url');
    if (!providerUrl) {
      throw new Error('embedding_provider_url_missing');
    }

    const timeoutMs = Number(process.env.EMBEDDING_PROVIDER_TIMEOUT_MS || configManager.getPath<number>('retrieval.embedding_provider_timeout_ms') || 5000);
    const apiKey = process.env.EMBEDDING_PROVIDER_API_KEY || configManager.getPath<string>('retrieval.embedding_provider_api_key');
    const model = process.env.EMBEDDING_PROVIDER_MODEL || configManager.getPath<string>('retrieval.embedding_provider_model');

    const response = await postWithTimeout(
      `${providerUrl.replace(/\/$/, '')}/embeddings`,
      { input: text, model },
      timeoutMs,
      apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    );
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`embedding_provider_http_${response.status}:${errorBody.slice(0, 200)}`);
    }

    const body = await response.json() as { data?: Array<{ embedding?: number[] }>; model?: string };
    const embedding = body.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('embedding_provider_invalid_payload');
    }

    return {
      embedding: normalize(embedding.map((value) => Number(value) || 0)),
      model_version: body.model || 'provider-unknown',
      provider: 'remote-provider',
      degraded: false,
    };
  }
}

export const embeddingAdapter = new EmbeddingAdapter();

export function detectDegrade(results: EmbeddingResult[]): boolean {
  return results.some(r => r.degraded);
}
