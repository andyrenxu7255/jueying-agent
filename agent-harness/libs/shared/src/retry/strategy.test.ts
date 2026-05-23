import { RetryError, withRetry } from './strategy';

describe('withRetry', () => {
  it('returns immediately when the operation succeeds', async () => {
    const fn = jest.fn(async () => 'ok');
    await expect(withRetry(fn, {
      max_retries: 2,
      initial_delay_ms: 1,
      max_delay_ms: 1,
      backoff_multiplier: 1,
      jitter: false,
      retryable_errors: ['RetryMe'],
    })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors and eventually succeeds', async () => {
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('RetryMe: temporary'))
      .mockResolvedValueOnce('recovered');

    await expect(withRetry(fn, {
      max_retries: 2,
      initial_delay_ms: 1,
      max_delay_ms: 2,
      backoff_multiplier: 2,
      jitter: false,
      retryable_errors: ['RetryMe'],
    })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = jest.fn(async () => {
      throw new Error('ValidationError');
    });

    await expect(withRetry(fn, {
      max_retries: 3,
      initial_delay_ms: 1,
      max_delay_ms: 1,
      backoff_multiplier: 1,
      jitter: false,
      retryable_errors: ['TimeoutError'],
    })).rejects.toMatchObject({ name: 'RetryError', attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('wraps the last error when retries are exhausted', async () => {
    const fn = jest.fn(async () => {
      const error = new Error('TimeoutError');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(withRetry(fn, {
      max_retries: 2,
      initial_delay_ms: 1,
      max_delay_ms: 1,
      backoff_multiplier: 1,
      jitter: false,
      retryable_errors: ['TimeoutError'],
    })).rejects.toBeInstanceOf(RetryError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses a custom classifier when provided', async () => {
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('custom'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(fn, {
      max_retries: 1,
      initial_delay_ms: 1,
      max_delay_ms: 1,
      backoff_multiplier: 1,
      jitter: false,
      retryable_errors: [],
    }, (error) => error.message === 'custom')).resolves.toBe('ok');
  });

  it('uses the default policy and jitter path for retryable default errors', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(Object.assign(new Error('temporary'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
