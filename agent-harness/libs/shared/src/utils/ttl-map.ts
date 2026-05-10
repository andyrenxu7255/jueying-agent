export class TTLMap<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private defaultTTL: number) {
    this.startCleanup();
  }

  set(key: K, value: V, ttl?: number): this {
    const expiresAt = Date.now() + (ttl ?? this.defaultTTL);
    this.store.set(key, { value, expiresAt });
    return this;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    let count = 0;
    const now = Date.now();
    for (const [, entry] of this.store) {
      if (now <= entry.expiresAt) count++;
    }
    return count;
  }

  keys(): IterableIterator<K> {
    return this.store.keys();
  }

  forEach(callback: (value: V, key: K) => void): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now <= entry.expiresAt) {
        callback(entry.value, key);
      }
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now > entry.expiresAt) {
          this.store.delete(key);
        }
      }
    }, Math.min(this.defaultTTL, 60000));
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}