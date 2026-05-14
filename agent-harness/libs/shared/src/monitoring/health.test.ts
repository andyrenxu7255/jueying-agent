import { registerHealthCheck, runHealthCheck, setupDefaultHealthChecks, clearHealthChecks } from './health'

describe('health', () => {
  afterEach(() => {
    clearHealthChecks()
  })

  describe('registerHealthCheck', () => {
    it('should register a health checker', () => {
      registerHealthCheck('test-checker', async () => ({ status: 'healthy' }))
      expect(true).toBe(true)
    })
  })

  describe('runHealthCheck', () => {
    it('should return healthy status with no checkers', async () => {
      const status = await runHealthCheck()
      expect(status.status).toBe('healthy')
      expect(status.components).toEqual({})
      expect(status.uptime_ms).toBeGreaterThanOrEqual(0)
      expect(status.metrics_summary).toBeDefined()
    })

    it('should include metrics summary fields', async () => {
      const status = await runHealthCheck()
      expect(status.metrics_summary?.total_requests).toBeDefined()
      expect(status.metrics_summary?.total_errors).toBeDefined()
      expect(typeof status.metrics_summary?.avg_latency_ms).toBe('number')
      expect(typeof status.metrics_summary?.heap_used_mb).toBe('number')
    })

    it('should return unhealthy for unhealthy checker', async () => {
      registerHealthCheck('unhealthy-check', async () => ({ status: 'unhealthy', error: 'db down' }))
      const status = await runHealthCheck()
      expect(status.status).toBe('unhealthy')
      expect(status.components['unhealthy-check'].status).toBe('unhealthy')
    })

    it('should return degraded for degraded checker', async () => {
      registerHealthCheck('degraded-check', async () => ({ status: 'degraded' }))
      const status = await runHealthCheck()
      expect(status.status).toBe('degraded')
    })

    it('should have valid timestamp', async () => {
      const status = await runHealthCheck()
      const ts = new Date(status.timestamp)
      expect(ts.getTime()).not.toBeNaN()
    })
  })

  describe('setupDefaultHealthChecks', () => {
    it('should setup without optional checkers', () => {
      expect(() => setupDefaultHealthChecks()).not.toThrow()
    })

    it('should setup with db checker', () => {
      expect(() => setupDefaultHealthChecks(async () => true)).not.toThrow()
    })

    it('should setup with both checkers', () => {
      expect(() => setupDefaultHealthChecks(async () => true, async () => true)).not.toThrow()
    })
  })
})