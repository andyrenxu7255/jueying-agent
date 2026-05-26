import { RerankAdapter } from './rerank';
import { configManager } from '../config/manager';

describe('RerankAdapter', () => {
  const originalEnv = process.env;
  const candidates = [
    { id: 'a', text: 'MEDDIC metrics and economic buyer', payload: { rank: 1 } },
    { id: 'b', text: 'unrelated deployment notes', payload: { rank: 2 } },
  ];

  beforeEach(() => {
    process.env = { ...originalEnv, RERANK_MODE: 'deterministic', EMBEDDING_MODE: 'deterministic' };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('reranks deterministically without external provider', async () => {
    const result = await new RerankAdapter().rerank('MEDDIC buyer', candidates);

    expect(result.provider).toBe('local-deterministic');
    expect(result.degraded).toBe(false);
    expect(result.items).toHaveLength(candidates.length);
    expect(['a', 'b']).toContain(result.items[0].id);
  });

  it('uses the default deterministic limit when none is provided', async () => {
    const result = await new RerankAdapter().rerank('MEDDIC buyer', candidates);

    expect(result.items).toHaveLength(candidates.length);
  });

  it('uses a provider rerank response when configured', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://rerank-provider';
    process.env.RERANK_PROVIDER_MODEL = 'rerank-demo';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }] }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 2);
    expect(result.provider).toBe('remote-provider');
    expect(result.degraded).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('falls back when provider payload is invalid', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://rerank-provider';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 2);
    expect(result.provider).toBe('local-deterministic');
    expect(result.degraded).toBe(true);
    expect(result.degradation_reason).toContain('provider_failed');
  });

  it('falls back when provider URL is missing', async () => {
    process.env.RERANK_MODE = 'provider';
    delete process.env.RERANK_PROVIDER_URL;

    const result = await new RerankAdapter().rerank('query', candidates, 2);

    expect(result.provider).toBe('local-deterministic');
    expect(result.degraded).toBe(true);
    expect(result.degradation_reason).toContain('rerank_provider_url_missing');
  });

  it('uses deterministic mode for unsupported mode values', async () => {
    process.env.RERANK_MODE = 'unsupported';

    const result = await new RerankAdapter().rerank('query', candidates, 1);

    expect(result.provider).toBe('local-deterministic');
    expect(result.degraded).toBe(false);
  });

  it('uses config defaults for remote rerank when environment values are omitted', async () => {
    delete process.env.RERANK_MODE;
    delete process.env.RERANK_PROVIDER_URL;
    delete process.env.RERANK_PROVIDER_TIMEOUT_MS;
    const getPathSpy = jest.spyOn(configManager, 'getPath').mockImplementation((path: string) => {
      const values: Record<string, unknown> = {
        'retrieval.rerank_mode': 'provider',
        'retrieval.rerank_provider_url': 'http://configured-rerank',
        'retrieval.rerank_provider_timeout_ms': 432,
        'retrieval.rerank_provider_model': 'configured-rerank-model',
      };
      return values[path] as never;
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0.7 }] }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 1);

    expect(result.provider).toBe('remote-provider');
    expect(fetchMock).toHaveBeenCalledWith('http://configured-rerank/rerank', expect.objectContaining({
      body: expect.any(String),
    }));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      query: 'query',
      model: 'configured-rerank-model',
      documents: candidates.map((candidate) => candidate.text),
      top_n: 1,
      return_documents: false,
    });
    expect(getPathSpy).toHaveBeenCalledWith('retrieval.rerank_mode');
  });

  it('falls back when provider returns an HTTP error', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://rerank-provider';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'temporarily unavailable',
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 2);

    expect(result.provider).toBe('local-deterministic');
    expect(result.degradation_reason).toContain('rerank_provider_http_503');
  });

  it('falls back when provider results do not match candidates', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://rerank-provider';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 99, relevance_score: 1 }] }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 2);

    expect(result.provider).toBe('local-deterministic');
    expect(result.degradation_reason).toContain('rerank_provider_no_matching_ids');
  });

  it('sends provider authorization and trims results to the requested limit', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://rerank-provider/';
    process.env.RERANK_PROVIDER_API_KEY = 'secret-key';
    process.env.RERANK_PROVIDER_MODEL = 'rerank-demo';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0.3 }, { index: 1, relevance_score: 0.9 }] }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 1);

    expect(result.items.map((item) => item.id)).toEqual(['b']);
    expect(fetchMock).toHaveBeenCalledWith('http://rerank-provider/rerank', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer secret-key' }),
      body: expect.any(String),
    }));
    const requestBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(requestBody).toEqual({
      query: 'query',
      model: 'rerank-demo',
      documents: candidates.map((candidate) => candidate.text),
      top_n: 1,
      return_documents: false,
    });
  });

  it('uses Ollama-style generation endpoint when provider URL points to Ollama', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://localhost:11434';
    process.env.RERANK_PROVIDER_MODEL = 'bge-reranker';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ response: '0.87' }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 1);
    expect(result.provider).toBe('ollama-reranker');
    expect(result.degraded).toBe(false);
    expect(result.items[0].score).toBeCloseTo(0.87);
  });

  it('normalizes Ollama percentage scores', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://localhost:11434/v1';
    process.env.RERANK_PROVIDER_MODEL = 'bge-reranker';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ response: '87' }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 1);

    expect(result.items[0].score).toBeCloseTo(0.87);
  });

  it('treats non-numeric Ollama responses as zero', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://localhost:11434';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 1);

    expect(result.items[0].score).toBe(0);
  });

  it('uses configured Ollama defaults when model and timeout are not provided', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://localhost:11434';
    delete process.env.RERANK_PROVIDER_MODEL;
    delete process.env.RERANK_PROVIDER_TIMEOUT_MS;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ response: '0.25' }),
    } as Response);

    await new RerankAdapter().rerank('query', candidates.slice(0, 1), 1);

    const requestBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(requestBody.model).toBe('');
  });

  it('uses config values for Ollama provider details when env values are omitted', async () => {
    process.env.RERANK_MODE = 'provider';
    delete process.env.RERANK_PROVIDER_URL;
    delete process.env.RERANK_PROVIDER_MODEL;
    delete process.env.RERANK_PROVIDER_TIMEOUT_MS;
    jest.spyOn(configManager, 'getPath').mockImplementation((path: string) => {
      const values: Record<string, unknown> = {
        'retrieval.rerank_provider_url': 'http://ollama:11434/v1',
        'retrieval.rerank_provider_model': 'configured-ollama',
        'retrieval.rerank_provider_timeout_ms': 654,
      };
      return values[path] as never;
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ response: '0.42' }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates.slice(0, 1), 1);

    expect(result.provider).toBe('ollama-reranker');
    expect(fetchMock).toHaveBeenCalledWith('http://ollama:11434/api/generate', expect.any(Object));
    const requestBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(requestBody.model).toBe('configured-ollama');
  });

  it('keeps explicit zero relevance scores from provider results', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://rerank-provider';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ index: 0, relevance_score: 0 }] }),
    } as Response);

    const result = await new RerankAdapter().rerank('query', candidates, 1);

    expect(result.provider).toBe('remote-provider');
    expect(result.items[0].score).toBe(0);
  });

  it('scores failed Ollama candidate calls as zero', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://ollama:11434';
    process.env.RERANK_PROVIDER_MODEL = 'bge-reranker';
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ response: '1' }),
      } as Response)
      .mockRejectedValueOnce(new Error('network'));

    const result = await new RerankAdapter().rerank('query', candidates, 2);

    expect(result.provider).toBe('ollama-reranker');
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.score === 0)).toBe(true);
  });

  it('limits concurrent Ollama calls while ranking all candidates', async () => {
    process.env.RERANK_MODE = 'provider';
    process.env.RERANK_PROVIDER_URL = 'http://localhost:11434';
    process.env.RERANK_PROVIDER_MODEL = 'bge-reranker';
    let active = 0;
    let maxActive = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        ok: true,
        json: async () => ({ response: '0.5' }),
      } as Response;
    });
    const manyCandidates = Array.from({ length: 7 }, (_, index) => ({
      id: `c${index}`,
      text: `candidate ${index}`,
      payload: { index },
    }));

    const result = await new RerankAdapter().rerank('query', manyCandidates, 7);

    expect(result.items).toHaveLength(7);
    expect(maxActive).toBeLessThanOrEqual(5);
  });
});
