/**
 * 统一 LLM 客户端 - 消除 executor 中三处 callLiteLLM 的重复
 *
 * 原版问题：
 *   - generic-executor.ts (72-133行): 有 withRetry + usage tracking，最完整
 *   - verification-executor.ts (20-52行): 简化版，无重试
 *   - repair-executor.ts (11-43行): 简化版，无重试
 *
 * 优化后：统一入口，所有 executor 共享同一实现。
 *
 * @module llm-client
 */

export interface LlmCallOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: 'text' | 'json_object';
  enableRetry?: boolean;
}

export interface LlmCallResult {
  content: string;
  ok: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

interface LiteLLMResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class LlmClient {
  private baseUrl: string;
  private apiKey: string;
  private defaultModel: string;
  private defaultTimeoutMs: number;

  constructor(config?: {
    baseUrl?: string;
    apiKey?: string;
    defaultModel?: string;
    defaultTimeoutMs?: number;
  }) {
    this.baseUrl = config?.baseUrl || process.env.LITELLM_URL || '';
    this.apiKey = config?.apiKey || process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '';
    this.defaultModel = config?.defaultModel || process.env.LITELLM_MODEL || 'minimax-m2.7';
    this.defaultTimeoutMs = config?.defaultTimeoutMs || 60000;
  }

  async call(options: LlmCallOptions): Promise<LlmCallResult> {
    const {
      systemPrompt,
      userPrompt,
      temperature = 0.3,
      maxTokens = 2048,
      timeoutMs = this.defaultTimeoutMs,
      enableRetry = true
    } = options;

    const maxRetries = enableRetry ? 3 : 1;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: this.defaultModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature,
            max_tokens: maxTokens,
            ...(options.responseFormat ? { response_format: { type: options.responseFormat } } : {})
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (attempt >= maxRetries - 1) {
            return { content: '', ok: false };
          }
          const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 10000);
          await this.sleep(delay);
          continue;
        }

        const body = await response.json() as LiteLLMResponse;
        const content = body.choices?.[0]?.message?.content || '';

        if (!content) {
          return { content: '', ok: false };
        }

        return {
          content,
          ok: true,
          usage: body.usage ? {
            promptTokens: body.usage.prompt_tokens,
            completionTokens: body.usage.completion_tokens,
            totalTokens: body.usage.total_tokens
          } : undefined
        };
      } catch (error) {
        clearTimeout(timeoutId);
        const errorMsg = String(error);
        if (errorMsg.includes('abort') || errorMsg.includes('AbortError')) {
          if (attempt >= maxRetries - 1) {
            return { content: '', ok: false };
          }
          continue;
        }
        if (attempt >= maxRetries - 1) {
          return { content: '', ok: false };
        }
        const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 10000);
        await this.sleep(delay);
      }
    }

    return { content: '', ok: false };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const llmClient = new LlmClient();