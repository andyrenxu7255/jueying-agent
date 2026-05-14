import { RateLimiter, getRateLimiter, RATE_LIMITS } from './limiter'

describe('RateLimiter', () => {
  describe('RATE_LIMITS config', () => {
    it('should have global config', () => {
      expect(RATE_LIMITS.global.requests_per_second).toBe(100)
      expect(RATE_LIMITS.global.burst_size).toBe(200)
    })

    it('should have per_user config', () => {
      expect(RATE_LIMITS.per_user.requests_per_second).toBe(10)
      expect(RATE_LIMITS.per_user.burst_size).toBe(20)
    })

    it('should have per_workflow config', () => {
      expect(RATE_LIMITS.per_workflow.requests_per_second).toBe(5)
    })
  })

  describe('check', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      limiter = new RateLimiter()
    })

    afterEach(() => {
      limiter.shutdown()
    })

    it('should allow request within rate limit', () => {
      const config = { algorithm: 'token_bucket' as const, requests_per_second: 100, burst_size: 200 }
      const result = limiter.check('test_key', config)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBeGreaterThanOrEqual(0)
    })

    it('should block request when tokens exhausted', () => {
      const config = { algorithm: 'token_bucket' as const, requests_per_second: 100, burst_size: 1 }
      limiter.check('exhaust_key', config)
      const result = limiter.check('exhaust_key', config)
      expect(result.allowed).toBe(false)
      expect(result.retry_after_ms).toBeGreaterThan(0)
    })

    it('should return reset_at in future', () => {
      const config = { algorithm: 'token_bucket' as const, requests_per_second: 100, burst_size: 200 }
      const result = limiter.check('reset_key', config)
      expect(result.reset_at.getTime()).toBeGreaterThan(Date.now() - 100)
    })

    it('should track different keys independently', () => {
      const config = { algorithm: 'token_bucket' as const, requests_per_second: 100, burst_size: 1 }
      limiter.check('key_a', config)
      const resultA = limiter.check('key_a', config)
      expect(resultA.allowed).toBe(false)

      const resultB = limiter.check('key_b', config)
      expect(resultB.allowed).toBe(true)
    })

    it('should include limit in result', () => {
      const config = { algorithm: 'token_bucket' as const, requests_per_second: 50, burst_size: 100 }
      const result = limiter.check('limit_key', config)
      expect(result.limit).toBe(100)
    })
  })

  describe('getRateLimiter singleton', () => {
    it('should return same instance', () => {
      const a = getRateLimiter()
      const b = getRateLimiter()
      expect(a).toBe(b)
    })
  })
})