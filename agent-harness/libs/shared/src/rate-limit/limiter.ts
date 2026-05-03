/**
 * Rate Limiting
 * Reference: AH1-31 §31.7
 */

export interface RateLimitConfig {
  algorithm: 'token_bucket' | 'sliding_window' | 'leaky_bucket';
  requests_per_second: number;
  burst_size: number;
  key_extractor?: (context: RequestContext) => string;
}

export interface RequestContext {
  user_id?: string;
  workflow_id?: string;
  ip?: string;
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  global: {
    algorithm: 'token_bucket',
    requests_per_second: 100,
    burst_size: 200
  },
  per_user: {
    algorithm: 'sliding_window',
    requests_per_second: 10,
    burst_size: 20
  },
  per_workflow: {
    algorithm: 'token_bucket',
    requests_per_second: 5,
    burst_size: 10
  }
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset_at: Date;
  retry_after_ms?: number;
}

export class RateLimiter {
  private buckets: Map<string, { bucket: TokenBucket; last_access_ms: number }> = new Map();
  private readonly MAX_BUCKETS = 50000;
  private readonly IDLE_EVICT_MS = 15 * 60 * 1000;
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  check(key: string, config: RateLimitConfig): RateLimitResult {
    this.ensureCleanupTimer();
    const now = Date.now();
    const bucket = this.getBucket(key, config);
    
    const result = bucket.consume(1, now);
    
    return {
      allowed: result.allowed,
      limit: config.burst_size,
      remaining: result.remaining,
      reset_at: new Date(result.reset_at),
      retry_after_ms: result.retry_after_ms
    };
  }

  private getBucket(key: string, config: RateLimitConfig): TokenBucket {
    const existing = this.buckets.get(key);
    if (existing) {
      existing.last_access_ms = Date.now();
      return existing.bucket;
    }

    if (this.buckets.size >= this.MAX_BUCKETS) {
      this.evictOldest();
    }

    const bucket = new TokenBucket(config.requests_per_second, config.burst_size);
    this.buckets.set(key, { bucket, last_access_ms: Date.now() });
    return bucket;
  }

  private cleanup(now: number = Date.now()): void {
    for (const [key, value] of this.buckets.entries()) {
      if (now - value.last_access_ms >= this.IDLE_EVICT_MS) {
        this.buckets.delete(key);
      }
    }
  }

  private evictOldest(): void {
    const firstKey = this.buckets.keys().next().value;
    if (firstKey !== undefined) {
      this.buckets.delete(firstKey);
    }
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }
}

class TokenBucket {
  private tokens: number;
  private last_update: number;

  constructor(
    private rate: number,
    private capacity: number
  ) {
    this.tokens = capacity;
    this.last_update = Date.now();
  }

  consume(amount: number, now: number): { allowed: boolean; remaining: number; reset_at: number; retry_after_ms?: number } {
    // Add tokens based on time passed
    const timePassed = (now - this.last_update) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + timePassed * this.rate);
    this.last_update = now;

    if (this.tokens >= amount) {
      this.tokens -= amount;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        reset_at: now + ((this.capacity - this.tokens) / this.rate) * 1000
      };
    }

    // Calculate retry after
    const tokensNeeded = amount - this.tokens;
    const retry_after_ms = (tokensNeeded / this.rate) * 1000;

    return {
      allowed: false,
      remaining: 0,
      reset_at: now + ((this.capacity - this.tokens) / this.rate) * 1000,
      retry_after_ms
    };
  }
}

let _rateLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!_rateLimiter) {
    _rateLimiter = new RateLimiter();
  }
  return _rateLimiter;
}
