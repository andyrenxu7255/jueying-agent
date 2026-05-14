import { createLogger, withRetry, RETRY_POLICIES } from '@agent-harness/shared';
import type { ExecutionInput, ExecutionResult } from './generic-executor';

const logger = createLogger('repair-executor');

const LITELLM_URL = process.env.LITELLM_URL || '';
const LITELLM_MODEL = process.env.LITELLM_MODEL || 'minimax-m2.7';
const LITELLM_API_KEY = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '';
if (!LITELLM_API_KEY) logger.warn('config.missing', 'LITELLM_MASTER_KEY or LITELLM_API_KEY environment variable is not set');

async function callLiteLLM(systemPrompt: string, userPrompt: string, temperature: number = 0.2): Promise<{ content: string; ok: boolean }> {
  const timeoutMs = Number(process.env.LITELLM_EXEC_TIMEOUT_MS || 60000);

  const attempt = async (): Promise<{ content: string; ok: boolean }> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${LITELLM_API_KEY}`
        },
        body: JSON.stringify({
          model: LITELLM_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature,
          max_tokens: 4096
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`LiteLLM returned ${response.status}`);
      }

      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content || '';

      if (!content) {
        logger.warn('litellm.call.empty', 'LiteLLM returned empty content', {});
        return { content: '', ok: false };
      }

      return { content, ok: true };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    return await withRetry(attempt, RETRY_POLICIES.llm);
  } catch (error) {
    const errorMsg = String(error);
    if (errorMsg.includes('abort') || errorMsg.includes('AbortError')) {
      logger.warn('litellm.call.timeout', 'Repair LiteLLM call timed out', { timeout_ms: timeoutMs });
    } else {
      logger.error('litellm.call.error', 'Repair LiteLLM call error after retries', { error: errorMsg.slice(0, 300) });
    }
    return { content: '', ok: false };
  }
}

export class RepairExecutor {
  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const { stage, user_goal, context } = input;

    const systemPrompt = `You are a repair assistant. Your task is to:
1. Analyze the verification failure or error
2. Identify the root cause of the issue
3. Generate a fix that addresses the root cause
4. Ensure the fix does not introduce new issues
5. Provide a clear explanation of the repair

Output format:
- Root cause analysis
- Repair description
- Modified code or content (if applicable)
- Verification suggestions for the repair`;

    const verificationOutput = context?.verification_output || context?.previous_output || '';
    const errorDetails = context?.error || '';

    const userPrompt = `Goal: ${user_goal}

Stage: ${stage.stage_type} - ${stage.purpose}

Verification failure output:
${verificationOutput}

Error details:
${errorDetails}

Original context:
${JSON.stringify(context?.original_context || {}, null, 2)}

Repair the issues identified in the verification output.`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.2);

    if (!ok || !content) {
      return {
        status: 'failed',
        output: 'Repair failed - model call unsuccessful',
        error: 'model_call_failed',
        next_action: 'repair',
        model_call_ok: false
      };
    }

    return {
      status: 'completed',
      output: content,
      next_action: 'next_stage',
      model_call_ok: true
    };
  }
}

export const repairExecutor = new RepairExecutor();
