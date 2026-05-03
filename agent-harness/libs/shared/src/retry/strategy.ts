/**
 * 重试策略 — 指数退避 + 抖动
 *
 * @module retry-strategy
 */

export interface RetryPolicy {
  max_retries: number;
  initial_delay_ms: number;
  max_delay_ms: number;
  backoff_multiplier: number;
  jitter: boolean;
  retryable_errors: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_retries: 3,
  initial_delay_ms: 100,
  max_delay_ms: 30000,
  backoff_multiplier: 2,
  jitter: true,
  retryable_errors: [
    'RateLimitError',
    'TimeoutError',
    'ConnectionError',
    'ServiceUnavailableError',
    'INTEGRATION_LLM_TIMEOUT',
    'INTEGRATION_HERMES_TIMEOUT'
  ]
};

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * 带指数退避和抖动的重试执行。
 *
 * @param fn - 异步操作函数。
 * @param policy - 重试策略配置（最大重试次数、初始/最大延迟、退避乘数、抖动开关）。
 * @param errorClassifier - 可选，自定义错误分类器，返回 true 表示可重试。
 * @throws {RetryError} 当所有重试次数耗尽后抛出。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  errorClassifier?: (error: Error) => boolean
): Promise<T> {
  let lastError: Error | undefined;
  let delay = policy.initial_delay_ms;

  for (let attempt = 0; attempt <= policy.max_retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      const isRetryable = errorClassifier 
        ? errorClassifier(lastError)
        : policy.retryable_errors.some(e => lastError!.name.includes(e) || lastError!.message.includes(e));

      if (!isRetryable || attempt === policy.max_retries) {
        throw new RetryError(
          `Failed after ${attempt + 1} attempts: ${lastError.message}`,
          attempt + 1,
          lastError
        );
      }

      // Calculate delay with jitter
      const jitter = policy.jitter ? Math.random() * 0.1 * delay : 0;
      await sleep(delay + jitter);
      
      // Exponential backoff
      delay = Math.min(delay * policy.backoff_multiplier, policy.max_delay_ms);
    }
  }

  throw new RetryError(
    `Failed after ${policy.max_retries + 1} attempts`,
    policy.max_retries + 1,
    lastError!
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Component-specific retry policies
export const RETRY_POLICIES = {
  llm: {
    ...DEFAULT_RETRY_POLICY,
    max_retries: 3,
    initial_delay_ms: 1000,
    max_delay_ms: 30000
  },
  embedding: {
    ...DEFAULT_RETRY_POLICY,
    max_retries: 3,
    initial_delay_ms: 100,
    max_delay_ms: 10000
  },
  rerank: {
    ...DEFAULT_RETRY_POLICY,
    max_retries: 2,
    initial_delay_ms: 100,
    max_delay_ms: 5000
  },
  database: {
    ...DEFAULT_RETRY_POLICY,
    max_retries: 3,
    initial_delay_ms: 100,
    max_delay_ms: 5000
  },
  redis: {
    ...DEFAULT_RETRY_POLICY,
    max_retries: 3,
    initial_delay_ms: 50,
    max_delay_ms: 1000
  },
  storage: {
    ...DEFAULT_RETRY_POLICY,
    max_retries: 3,
    initial_delay_ms: 100,
    max_delay_ms: 5000
  }
} as const;
