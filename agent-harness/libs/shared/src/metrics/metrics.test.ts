import { MetricsRegistry } from './metrics'

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry

  beforeEach(() => {
    registry = new MetricsRegistry()
  })

  afterEach(() => {
    registry.shutdown()
  })

  describe('counters', () => {
    it('should start at 0 for unknown counter', () => {
      expect(registry.getCounter('unknown.counter')).toBe(0)
    })

    it('should increment counter from 0', () => {
      registry.increment('test.counter')
      expect(registry.getCounter('test.counter')).toBe(1)
    })

    it('should increment by custom value', () => {
      registry.increment('test.counter', 5)
      expect(registry.getCounter('test.counter')).toBe(5)
    })

    it('should accumulate increments', () => {
      registry.increment('test.counter')
      registry.increment('test.counter')
      registry.increment('test.counter', 3)
      expect(registry.getCounter('test.counter')).toBe(5)
    })

    it('should store labels with counter', () => {
      registry.increment('test.counter', 1, { env: 'test' })
      const snapshot = registry.snapshot()
      const counter = snapshot.find(c => c.name === 'test.counter')
      expect(counter?.labels).toEqual({ env: 'test' })
    })

    it('should include counter in snapshot', () => {
      registry.increment('snapshot.test', 10)
      const snapshot = registry.snapshot()
      const found = snapshot.find(c => c.name === 'snapshot.test')
      expect(found?.value).toBe(10)
    })
  })

  describe('histograms', () => {
    it('should observe values and update histogram', () => {
      registry.observe('request.duration', 150)
      const snapshot = registry.histogramSnapshot()
      const hist = snapshot.find(h => h.name === 'request.duration')
      expect(hist).toBeDefined()
      expect(hist!.count).toBe(1)
      expect(hist!.sum).toBe(150)
    })

    it('should aggregate multiple observations', () => {
      registry.observe('request.duration', 50)
      registry.observe('request.duration', 150)
      const snapshot = registry.histogramSnapshot()
      const hist = snapshot.find(h => h.name === 'request.duration')
      expect(hist!.count).toBe(2)
      expect(hist!.sum).toBe(200)
    })

    it('should place values in correct buckets', () => {
      registry.observe('latency', 8)
      const snapshot = registry.histogramSnapshot()
      const hist = snapshot.find(h => h.name === 'latency')
      const bucket5 = hist!.buckets.find(b => b.le === 5)
      const bucket10 = hist!.buckets.find(b => b.le === 10)
      expect(bucket5!.count).toBe(0)
      expect(bucket10!.count).toBe(1)
    })

    it('should store labels with histogram', () => {
      registry.observe('api.duration', 200, { method: 'GET' })
      const snapshot = registry.histogramSnapshot()
      const hist = snapshot.find(h => h.name === 'api.duration')
      expect(hist?.labels).toEqual({ method: 'GET' })
    })
  })

  describe('percentiles', () => {
    it('should return null for unknown histogram', () => {
      expect(registry.getPercentile('nonexistent', 0.5)).toBeNull()
    })

    it('should calculate approximate percentile', () => {
      registry.observe('duration', 100)
      registry.observe('duration', 200)
      const p50 = registry.getPercentile('duration', 0.5)
      expect(p50).not.toBeNull()
    })
  })

  describe('alerts', () => {
    it('should register alert thresholds without error', () => {
      expect(() => registry.registerAlert({
        metric: 'error.count',
        operator: 'gt',
        value: 100,
        severity: 'error',
        message: 'Too many errors'
      })).not.toThrow()
    })
  })

  describe('uptime', () => {
    it('should return positive uptime', () => {
      expect(registry.uptimeMs()).toBeGreaterThanOrEqual(0)
    })
  })
})