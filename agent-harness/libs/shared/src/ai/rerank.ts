import { cosineSimilarity, embeddingAdapter } from './embedding';
import { configManager } from '../config/manager';

export interface RerankCandidate<TPayload> {
  id: string;
  text: string;
  payload: TPayload;
}

export interface RerankResult<TPayload> {
  id: string;
  score: number;
  payload: TPayload;
}

export interface RerankResponse<TPayload> {
  items: RerankResult<TPayload>[];
  degraded: boolean;
  degradation_reason?: string;
  provider: 'local-deterministic' | 'ollama-reranker' | 'remote-provider';
}

type RerankMode = 'deterministic' | 'provider';

interface RerankApiResponse {
  results?: Array<{ index: number; relevance_score: number }>;
  id?: string;
}

function resolveRerankMode(): RerankMode {
  const configured = process.env.RERANK_MODE
    || configManager.getPath<string>('retrieval.rerank_mode')
    || 'provider';
  return configured === 'provider' ? 'provider' : 'deterministic';
}

function isOllamaProvider(): boolean {
  const url = process.env.RERANK_PROVIDER_URL || configManager.getPath<string>('retrieval.rerank_provider_url') || '';
  return url.includes('localhost:11434') || url.includes('ollama:11434');
}

function deterministicRerank<TPayload>(query: string, candidates: RerankCandidate<TPayload>[], limit = candidates.length): Promise<RerankResult<TPayload>[]> {
  return Promise.resolve().then(async () => {
    const queryEmbedding = await embeddingAdapter.embedText(query);
    const candidateEmbeddings = await embeddingAdapter.embedBatch(candidates.map((candidate) => candidate.text));

    return candidates
      .map((candidate, index) => ({
        id: candidate.id,
        score: cosineSimilarity(queryEmbedding.embedding, candidateEmbeddings[index].embedding),
        payload: candidate.payload,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  });
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

function parseRelevanceScore(raw: string): number {
  const trimmed = raw.trim();
  const match = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  let score = parseFloat(match[1]);
  if (score > 1 && score <= 100) {
    score = score / 100;
  }
  return Math.min(Math.max(score, 0), 1);
}

async function ollamaRerank<TPayload>(query: string, candidates: RerankCandidate<TPayload>[], limit: number): Promise<RerankResult<TPayload>[]> {
  const ollamaUrl = (process.env.RERANK_PROVIDER_URL || configManager.getPath<string>('retrieval.rerank_provider_url') || '').replace(/\/v1$/, '').replace(/\/$/, '');
  const model = process.env.RERANK_PROVIDER_MODEL || configManager.getPath<string>('retrieval.rerank_provider_model') || '';
  const timeoutMs = Number(process.env.RERANK_PROVIDER_TIMEOUT_MS || configManager.getPath<number>('retrieval.rerank_provider_timeout_ms') || 15000);

  const concurrencyLimit = 5;
  const semaphore: { current: number; queue: Array<() => void> } = { current: 0, queue: [] };

  async function acquire(): Promise<void> {
    if (semaphore.current < concurrencyLimit) {
      semaphore.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      semaphore.queue.push(() => {
        semaphore.current++;
        resolve();
      });
    });
  }

  function release(): void {
    semaphore.current--;
    if (semaphore.queue.length > 0) {
      const next = semaphore.queue.shift();
      if (next) next();
    }
  }

  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      await acquire();
      try {
        const prompt = `<|im_start|>user\nEvaluate the relevance of the following document to the given query. Output ONLY a single number between 0 and 1 representing the relevance score (e.g., 0.85). Do not output anything else.\n\nQuery: ${query}\n\nDocument: ${candidate.text}\n\nRelevance score:<|im_end|>\n<|im_start|>assistant\n`;

        const response = await postWithTimeout(`${ollamaUrl}/api/generate`, {
          model,
          prompt,
          stream: false,
          options: { temperature: 0 },
        }, timeoutMs);

        if (!response.ok) {
          return { id: candidate.id, score: 0, payload: candidate.payload };
        }

        const body = await response.json() as { response?: string };
        const score = parseRelevanceScore(body.response || '');
        return { id: candidate.id, score, payload: candidate.payload };
      } catch {
        return { id: candidate.id, score: 0, payload: candidate.payload };
      } finally {
        release();
      }
    })
  );

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export class RerankAdapter {
  async rerank<TPayload>(query: string, candidates: RerankCandidate<TPayload>[], limit = candidates.length): Promise<RerankResponse<TPayload>> {
    const mode = resolveRerankMode();
    if (mode === 'provider') {
      if (isOllamaProvider()) {
        try {
          const items = await ollamaRerank(query, candidates, limit);
          return { items, degraded: false, provider: 'ollama-reranker' };
        } catch (error) {
          const fallback = await deterministicRerank(query, candidates, limit);
          return { items: fallback, degraded: true, degradation_reason: `ollama_reranker_failed:${String(error)}`, provider: 'local-deterministic' };
        }
      }
      try {
        const items = await this.rerankViaProvider(query, candidates, limit);
        return { items, degraded: false, provider: 'remote-provider' };
      } catch (error) {
        const fallback = await deterministicRerank(query, candidates, limit);
        return { items: fallback, degraded: true, degradation_reason: `provider_failed:${String(error)}`, provider: 'local-deterministic' };
      }
    }

    const deterministic = await deterministicRerank(query, candidates, limit);
    return { items: deterministic, degraded: false, provider: 'local-deterministic' };
  }

  private async rerankViaProvider<TPayload>(query: string, candidates: RerankCandidate<TPayload>[], limit: number): Promise<RerankResult<TPayload>[]> {
    const providerUrl = process.env.RERANK_PROVIDER_URL || configManager.getPath<string>('retrieval.rerank_provider_url');
    if (!providerUrl) {
      throw new Error('rerank_provider_url_missing');
    }

    const timeoutMs = Number(process.env.RERANK_PROVIDER_TIMEOUT_MS || configManager.getPath<number>('retrieval.rerank_provider_timeout_ms') || 15000);
    const apiKey = process.env.RERANK_PROVIDER_API_KEY || configManager.getPath<string>('retrieval.rerank_provider_api_key');
    const model = process.env.RERANK_PROVIDER_MODEL || configManager.getPath<string>('retrieval.rerank_provider_model');

    const response = await postWithTimeout(`${providerUrl.replace(/\/$/, '')}/rerank`, {
      model,
      query,
      documents: candidates.map((candidate) => candidate.text),
      top_n: Math.min(limit, candidates.length),
      return_documents: false,
    }, timeoutMs, apiKey ? { authorization: `Bearer ${apiKey}` } : undefined);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`rerank_provider_http_${response.status}:${errorBody.slice(0, 200)}`);
    }

    const body = await response.json() as RerankApiResponse;
    if (!Array.isArray(body.results) || body.results.length === 0) {
      throw new Error('rerank_provider_invalid_payload');
    }

    const ranked = body.results
      .map((result) => {
        const candidate = candidates[result.index];
        if (!candidate) return null;
        return {
          id: candidate.id,
          score: Number(result.relevance_score) || 0,
          payload: candidate.payload,
        };
      })
      .filter((item): item is RerankResult<TPayload> => Boolean(item))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    if (ranked.length === 0) {
      throw new Error('rerank_provider_no_matching_ids');
    }

    return ranked;
  }
}

export const rerankAdapter = new RerankAdapter();
