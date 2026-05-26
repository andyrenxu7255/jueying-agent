import { getRateLimiter, RateLimiter, type RateLimitConfig } from './limiter';

describe('RateLimiter', () => {
  const config: RateLimitConfig = {
    algorithm: 'token_bucket',
    requests_per_second: 1,
    burst_size: 2,
  };

  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    limiter.shutdown();
  });

  it('allows requests within burst size and tracks remaining tokens', () => {
    const first = limiter.check('user:1', config);
    const second = limiter.check('user:1', config);

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
  });

  it('rejects requests after the bucket is empty', () => {
    limiter.check('user:1', config);
    limiter.check('user:1', config);
    const third = limiter.check('user:1', config);

    expect(third.allowed).toBe(false);
    expect(third.retry_after_ms).toBeGreaterThan(0);
  });

  it('keeps separate buckets per key', () => {
    limiter.check('user:1', config);
    limiter.check('user:1', config);

    expect(limiter.check('user:2', config).allowed).toBe(true);
  });

  it('clears buckets on shutdown', () => {
    limiter.check('user:1', config);
    limiter.shutdown();

    expect(limiter.check('user:1', config).allowed).toBe(true);
  });

  it('refreshes tokens over elapsed time', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    limiter.check('user:refill', config);
    limiter.check('user:refill', config);
    nowSpy.mockReturnValue(2_100);
    const refilled = limiter.check('user:refill', config);

    expect(refilled.allowed).toBe(true);
    expect(refilled.remaining).toBe(0);
  });

  it('evicts idle buckets during cleanup', () => {
    limiter.check('active', config);
    limiter.check('idle', config);

    const internals = limiter as unknown as {
      buckets: Map<string, { last_access_ms: number }>;
      cleanup: (now?: number) => void;
    };
    internals.buckets.get('active')!.last_access_ms = 10_000;
    internals.buckets.get('idle')!.last_access_ms = 0;

    internals.cleanup(15 * 60 * 1000);

    expect(internals.buckets.has('active')).toBe(true);
    expect(internals.buckets.has('idle')).toBe(false);
  });

  it('uses the current clock when cleanup runs without an explicit timestamp', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    limiter.check('idle-default-now', config);

    const internals = limiter as unknown as {
      buckets: Map<string, { last_access_ms: number }>;
      cleanup: () => void;
    };
    internals.buckets.get('idle-default-now')!.last_access_ms = 0;

    internals.cleanup();

    expect(internals.buckets.has('idle-default-now')).toBe(false);
  });

  it('evicts the oldest bucket when bucket capacity is reached', () => {
    const internals = limiter as unknown as {
      MAX_BUCKETS: number;
      buckets: Map<string, { last_access_ms: number }>;
    };
    Object.defineProperty(limiter, 'MAX_BUCKETS', { value: 2 });

    limiter.check('oldest', config);
    limiter.check('newer', config);
    internals.buckets.get('oldest')!.last_access_ms = 1;
    internals.buckets.get('newer')!.last_access_ms = 2;
    limiter.check('latest', config);

    expect(internals.buckets.has('oldest')).toBe(false);
    expect(internals.buckets.has('newer')).toBe(true);
    expect(internals.buckets.has('latest')).toBe(true);
  });

  it('exposes a reusable singleton limiter', () => {
    const first = getRateLimiter();
    const second = getRateLimiter();

    expect(second).toBe(first);
    first.shutdown();
  });
});
