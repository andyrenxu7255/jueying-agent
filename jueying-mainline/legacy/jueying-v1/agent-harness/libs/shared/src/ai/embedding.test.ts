import { EmbeddingAdapter, cosineSimilarity, detectDegrade } from './embedding';
import { configManager } from '../config/manager';

describe('EmbeddingAdapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, EMBEDDING_MODE: 'deterministic' };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('creates deterministic normalized embeddings', async () => {
    const adapter = new EmbeddingAdapter();
    const result = await adapter.embedText('MEDDIC sales qualification');

    expect(result.provider).toBe('local-deterministic');
    expect(result.embedding).toHaveLength(1536);
    expect(result.degraded).toBe(true);
    const norm = Math.sqrt(result.embedding.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('handles empty deterministic text without producing NaN values', async () => {
    const result = await new EmbeddingAdapter().embedText('');

    expect(result.embedding).toHaveLength(1536);
    expect(result.embedding.every((value) => value === 0)).toBe(true);
  });

  it('reuses cached embeddings for the same text', async () => {
    const adapter = new EmbeddingAdapter();
    const first = await adapter.embedText('same text');
    const second = await adapter.embedText('same text');
    expect(second).toBe(first);
  });

  it('expires stale cached embeddings', async () => {
    process.env.EMBEDDING_CACHE_TTL_MS = '-1';
    const adapter = new EmbeddingAdapter();

    const first = await adapter.embedText('expires');
    const second = await adapter.embedText('expires');

    expect(second).not.toBe(first);
  });

  it('removes expired cache entries when cache size exceeds the limit', async () => {
    process.env.EMBEDDING_CACHE_TTL_MS = '-1';
    const adapter = new EmbeddingAdapter();
    Object.defineProperty(adapter, 'cacheMaxSize', { value: 1 });

    await adapter.embedText('first stale entry');
    await adapter.embedText('second stale entry');

    const internals = adapter as unknown as {
      cache: Map<string, { expiresAt: number }>;
    };
    expect(internals.cache.size).toBe(0);
  });

  it('uses provider embeddings when provider mode succeeds', async () => {
    process.env.EMBEDDING_MODE = 'provider';
    process.env.EMBEDDING_PROVIDER_URL = 'http://embedding-provider';
    process.env.EMBEDDING_PROVIDER_MODEL = 'embedding-demo';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'embedding-demo', data: [{ embedding: [3, 4] }] }),
    } as Response);

    const result = await new EmbeddingAdapter().embedText('remote text');
    expect(result.provider).toBe('remote-provider');
    expect(result.model_version).toBe('embedding-demo');
    expect(result.embedding[0]).toBeCloseTo(0.6);
    expect(result.embedding[1]).toBeCloseTo(0.8);
  });

  it('sends provider dimensions and authorization when configured', async () => {
    process.env.EMBEDDING_MODE = 'provider';
    process.env.EMBEDDING_PROVIDER_URL = 'http://embedding-provider/';
    process.env.EMBEDDING_PROVIDER_API_KEY = 'secret-key';
    process.env.EMBEDDING_PROVIDER_MODEL = 'embedding-demo';
    process.env.EMBEDDING_PROVIDER_DIMENSIONS = '64';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0] }] }),
    } as Response);

    await new EmbeddingAdapter().embedText('remote with dimensions');

    expect(fetchMock).toHaveBeenCalledWith('http://embedding-provider/embeddings', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer secret-key' }),
      body: JSON.stringify({ input: 'remote with dimensions', model: 'embedding-demo', dimensions: 64 }),
    }));
  });

  it('falls back to deterministic embeddings when provider fails', async () => {
    process.env.EMBEDDING_MODE = 'provider';
    process.env.EMBEDDING_PROVIDER_URL = 'http://embedding-provider';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response);

    const result = await new EmbeddingAdapter().embedText('fallback text');
    expect(result.provider).toBe('local-deterministic');
    expect(result.degraded).toBe(true);
    expect(result.degradation_reason).toContain('provider_failed');
  });

  it('falls back when provider URL is missing', async () => {
    process.env.EMBEDDING_MODE = 'provider';
    delete process.env.EMBEDDING_PROVIDER_URL;

    const result = await new EmbeddingAdapter().embedText('missing provider url');

    expect(result.provider).toBe('local-deterministic');
    expect(result.degradation_reason).toContain('embedding_provider_url_missing');
  });

  it('uses deterministic mode for unsupported mode values', async () => {
    process.env.EMBEDDING_MODE = 'unsupported';

    const result = await new EmbeddingAdapter().embedText('unsupported mode');

    expect(result.provider).toBe('local-deterministic');
    expect(result.degraded).toBe(true);
  });

  it('uses config defaults when embedding environment values are omitted', async () => {
    delete process.env.EMBEDDING_MODE;
    delete process.env.EMBEDDING_PROVIDER_URL;
    delete process.env.EMBEDDING_PROVIDER_TIMEOUT_MS;
    const getPathSpy = jest.spyOn(configManager, 'getPath').mockImplementation((path: string) => {
      const values: Record<string, unknown> = {
        'retrieval.embedding_mode': 'provider',
        'retrieval.embedding_provider_url': 'http://configured-embedding',
        'retrieval.embedding_provider_timeout_ms': 321,
        'retrieval.embedding_provider_model': 'configured-embedding-model',
        'retrieval.embedding_provider_dimensions': 3,
      };
      return values[path] as never;
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0, 0, 0] }] }),
    } as Response);

    const result = await new EmbeddingAdapter().embedText('configured provider');

    expect(result.provider).toBe('remote-provider');
    expect(fetchMock).toHaveBeenCalledWith('http://configured-embedding/embeddings', expect.objectContaining({
      body: JSON.stringify({ input: 'configured provider', model: 'configured-embedding-model', dimensions: 3 }),
    }));
    expect(getPathSpy).toHaveBeenCalledWith('retrieval.embedding_mode');
  });

  it('uses the default provider timeout when neither env nor config provides one', async () => {
    process.env.EMBEDDING_MODE = 'provider';
    process.env.EMBEDDING_PROVIDER_URL = 'http://embedding-provider';
    delete process.env.EMBEDDING_PROVIDER_TIMEOUT_MS;
    jest.spyOn(configManager, 'getPath').mockImplementation((path: string) => {
      if (path === 'retrieval.embedding_provider_timeout_ms') {
        return undefined as never;
      }
      return undefined as never;
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0] }] }),
    } as Response);

    await new EmbeddingAdapter().embedText('default timeout');

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back when provider returns an invalid payload', async () => {
    process.env.EMBEDDING_MODE = 'provider';
    process.env.EMBEDDING_PROVIDER_URL = 'http://embedding-provider';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [] }] }),
    } as Response);

    const result = await new EmbeddingAdapter().embedText('invalid provider payload');

    expect(result.provider).toBe('local-deterministic');
    expect(result.degradation_reason).toContain('embedding_provider_invalid_payload');
  });

  it('computes bounded cosine similarity and degradation flags', async () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(detectDegrade([{ embedding: [], model_version: 'x', provider: 'local-deterministic', degraded: true }])).toBe(true);
  });
});
