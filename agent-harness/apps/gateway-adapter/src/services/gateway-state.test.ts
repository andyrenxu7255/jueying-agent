import { GatewayState } from './gateway-state'

describe('GatewayState deduplication', () => {
  let state: GatewayState

  beforeEach(() => {
    state = new GatewayState()
  })

  it('returns false for first encounter of a key', () => {
    expect(state.checkAndSetDedupe('event_001')).toBe(false)
  })

  it('returns true for duplicate key within TTL', () => {
    state.checkAndSetDedupe('event_001')
    expect(state.checkAndSetDedupe('event_001')).toBe(true)
  })

  it('returns false for different keys', () => {
    state.checkAndSetDedupe('event_001')
    expect(state.checkAndSetDedupe('event_002')).toBe(false)
  })

  it('stores keys in dedupe cache', () => {
    state.checkAndSetDedupe('event_001')
    expect(state.dedupeCache.has('event_001')).toBe(true)
    expect(state.dedupeCache.get('event_001')).toBeGreaterThan(0)
  })

  it('sweep clears expired entries', () => {
    state.dedupeCache.set('old_event', Date.now() - 20 * 60 * 1000)
    state.sweepDedupeCache()
    expect(state.dedupeCache.has('old_event')).toBe(false)
  })

  it('sweep keeps recent entries', () => {
    state.dedupeCache.set('recent_event', Date.now())
    state.sweepDedupeCache()
    expect(state.dedupeCache.has('recent_event')).toBe(true)
  })

  it('has correct default config values', () => {
    expect(state.dedupeTtlMs).toBe(10 * 60 * 1000)
    expect(state.dedupeMaxSize).toBe(100000)
  })

  it('initializes empty token caches', () => {
    expect(state.feishuTokenCache.token).toBeNull()
    expect(state.wecomTokenCache.token).toBeNull()
  })
})
