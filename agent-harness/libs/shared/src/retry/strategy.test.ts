import { withRetry, RetryError, DEFAULT_RETRY_POLICY, RETRY_POLICIES } from './strategy'

describe('retry/strategy', () => {
  describe('DEFAULT_RETRY_POLICY', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_RETRY_POLICY.max_retries).toBe(3)
      expect(DEFAULT_RETRY_POLICY.initial_delay_ms).toBe(100)
      expect(DEFAULT_RETRY_POLICY.max_delay_ms).toBe(30000)
      expect(DEFAULT_RETRY_POLICY.backoff_multiplier).toBe(2)
      expect(DEFAULT_RETRY_POLICY.jitter).toBe(true)
      expect(DEFAULT_RETRY_POLICY.retryable_errors.length).toBeGreaterThan(0)
    })
  })

  describe('RETRY_POLICIES', () => {
    it('should define llm policy', () => {
      expect(RETRY_POLICIES.llm.max_retries).toBe(3)
      expect(RETRY_POLICIES.llm.initial_delay_ms).toBe(1000)
    })

    it('should define embedding policy', () => {
      expect(RETRY_POLICIES.embedding.max_retries).toBe(3)
    })

    it('should define database policy', () => {
      expect(RETRY_POLICIES.database.max_retries).toBe(3)
    })

    it('should define redis policy', () => {
      expect(RETRY_POLICIES.redis.initial_delay_ms).toBe(50)
      expect(RETRY_POLICIES.redis.max_delay_ms).toBe(1000)
    })
  })

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const result = await withRetry(async () => 'success')
      expect(result).toBe('success')
    })

    it('should retry after failure and return on success', async () => {
      let attempts = 0
      const result = await withRetry(async () => {
        attempts++
        if (attempts < 2) throw new Error('RateLimitError: try again')
        return 'ok'
      }, { ...DEFAULT_RETRY_POLICY, initial_delay_ms: 1, jitter: false })

      expect(result).toBe('ok')
      expect(attempts).toBe(2)
    })

    it('should throw RetryError after max retries', async () => {
      let attempts = 0
      await expect(
        withRetry(async () => {
          attempts++
          throw new Error('RateLimitError: always fails')
        }, { ...DEFAULT_RETRY_POLICY, max_retries: 1, initial_delay_ms: 1, jitter: false })
      ).rejects.toThrow(RetryError)

      expect(attempts).toBe(2)
    })

    it('should throw immediately for non-retryable errors', async () => {
      const policy = { ...DEFAULT_RETRY_POLICY, max_retries: 2, initial_delay_ms: 1, jitter: false }
      let attempts = 0

      await expect(
        withRetry(async () => {
          attempts++
          throw new Error('NonRetryableFatalError')
        }, policy)
      ).rejects.toThrow(RetryError)

      expect(attempts).toBe(1)
    })

    it('should use custom errorClassifier', async () => {
      const policy = { ...DEFAULT_RETRY_POLICY, max_retries: 2, initial_delay_ms: 1, jitter: false }
      let attempts = 0

      const result = await withRetry(async () => {
        attempts++
        if (attempts < 2) throw new Error('CustomError')
        return 'ok'
      }, policy, (e: Error) => e.message === 'CustomError')

      expect(result).toBe('ok')
      expect(attempts).toBe(2)
    })

    it('should not retry when custom errorClassifier returns false', async () => {
      const policy = { ...DEFAULT_RETRY_POLICY, max_retries: 2, initial_delay_ms: 1, jitter: false }
      let attempts = 0

      await expect(
        withRetry(async () => {
          attempts++
          throw new Error('NonMatchingCustom')
        }, policy, (e: Error) => e.message === 'OnlyThis')
      ).rejects.toThrow(RetryError)

      expect(attempts).toBe(1)
    })

    it('should include attempt count in RetryError', async () => {
      try {
        await withRetry(async () => {
          throw new Error('fail')
        }, { ...DEFAULT_RETRY_POLICY, max_retries: 0, initial_delay_ms: 1, jitter: false })
      } catch (e) {
        const retryErr = e as RetryError
        expect(retryErr.attempts).toBe(1)
        expect(retryErr.lastError).toBeInstanceOf(Error)
      }
    })
  })
})