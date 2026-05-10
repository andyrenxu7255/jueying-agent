/**
 * TTLMap - 带过期时间的内存键值存储
 *
 * 解决原版中 hermes-adapter.memoryStore / mobile-app.deviceStore 无 TTL 导致的内存泄漏。
 * 同时可用于 gateway-adapter 的去重缓存和 token 缓存。
 *
 * @module ttl-map
 */

export class TTLMap<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private defaultTTL: number,
    private cleanupIntervalMs: number = 60000
  ) {
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

  getWithExpiry(key: K): { value: V; remainingMs: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return undefined;
    }
    return { value: entry.value, remainingMs };
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
    return this.store.size;
  }

  keys(): IterableIterator<K> {
    return this.store.keys();
  }

  values(): IterableIterator<V> {
    const self = this;
    return (function* () {
      for (const [key] of self.store) {
        const val = self.get(key);
        if (val !== undefined) yield val;
      }
    })();
  }

  entries(): IterableIterator<[K, V]> {
    const self = this;
    return (function* () {
      for (const [key] of self.store) {
        const val = self.get(key);
        if (val !== undefined) yield [key, val];
      }
    })();
  }

  /**
   * 启动定期清理过期条目
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now > entry.expiresAt) {
          this.store.delete(key);
        }
      }
    }, this.cleanupIntervalMs);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * 停止清理定时器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}