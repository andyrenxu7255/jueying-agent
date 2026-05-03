class GatewayState {
  dedupeCache = new Map<string, number>();
  readonly dedupeTtlMs = 10 * 60 * 1000;
  readonly dedupeMaxSize = 100000;
  readonly dedupeSweepIntervalMs = 30 * 1000;
  dedupeLastSweepAt = 0;

  feishuTokenCache: { token: string | null; expiresAtMs: number } = { token: null, expiresAtMs: 0 };
  wecomTokenCache: { token: string | null; expiresAtMs: number } = { token: null, expiresAtMs: 0 };

  sweepDedupeCache(): void {
    const now = Date.now();
    if (now - this.dedupeLastSweepAt < this.dedupeSweepIntervalMs) return;
    this.dedupeLastSweepAt = now;
    const cutoff = now - this.dedupeTtlMs;
    for (const [key, ts] of this.dedupeCache) {
      if (ts < cutoff) this.dedupeCache.delete(key);
    }
  }

  checkAndSetDedupe(key: string): boolean {
    this.sweepDedupeCache();
    const now = Date.now();
    const last = this.dedupeCache.get(key);
    if (last !== undefined) {
      if (now - last < this.dedupeTtlMs) return true;
    }
    if (this.dedupeCache.size >= this.dedupeMaxSize) {
      this.sweepDedupeCache();
    }
    this.dedupeCache.set(key, now);
    return false;
  }

  hasDedupe(key: string): boolean {
    const last = this.dedupeCache.get(key);
    return last !== undefined && Date.now() - last < this.dedupeTtlMs;
  }
}

export const gatewayState = new GatewayState();
