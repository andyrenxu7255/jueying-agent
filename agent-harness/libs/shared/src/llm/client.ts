import { TTLMap } from '../utils/ttl-map';

export interface LlmCallResult {
  content: string;
  ok: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface LlmCallOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: 'text' | 'json_object';
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
      timeoutMs = this.defaultTimeoutMs
    } = options;

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
        return { content: '', ok: false };
      }

      const body = await response.json() as LiteLLMResponse;
      const content = body.choices?.[0]?.message?.content || '';

      return {
        content,
        ok: content.length > 0,
        usage: body.usage ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens
        } : undefined
      };
    } catch {
      clearTimeout(timeoutId);
      return { content: '', ok: false };
    }
  }

  getModel(): string {
    return this.defaultModel;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const llmClient = new LlmClient();