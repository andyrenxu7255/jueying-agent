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

  it('sweep is throttled by the sweep interval', () => {
    state.dedupeLastSweepAt = Date.now()
    state.dedupeCache.set('old_event', Date.now() - 20 * 60 * 1000)
    state.sweepDedupeCache()
    expect(state.dedupeCache.has('old_event')).toBe(true)
  })

  it('hasDedupe reflects TTL freshness', () => {
    state.dedupeCache.set('recent_event', Date.now())
    state.dedupeCache.set('old_event', Date.now() - 20 * 60 * 1000)
    expect(state.hasDedupe('recent_event')).toBe(true)
    expect(state.hasDedupe('old_event')).toBe(false)
    expect(state.hasDedupe('missing')).toBe(false)
  })

  it('keeps accepting keys after reaching max size and sweeping', () => {
    Object.defineProperty(state, 'dedupeMaxSize', { value: 1 })
    state.dedupeCache.set('old_event', Date.now() - 20 * 60 * 1000)
    expect(state.checkAndSetDedupe('new_event')).toBe(false)
    expect(state.dedupeCache.has('new_event')).toBe(true)
  })

  it('runs an extra sweep when the cache reaches max size', () => {
    const sweepSpy = jest.spyOn(state, 'sweepDedupeCache')
    Object.defineProperty(state, 'dedupeMaxSize', { value: 1 })
    state.dedupeCache.set('existing_event', Date.now())

    expect(state.checkAndSetDedupe('new_event')).toBe(false)

    expect(sweepSpy).toHaveBeenCalledTimes(2)
    expect(state.dedupeCache.has('new_event')).toBe(true)
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
