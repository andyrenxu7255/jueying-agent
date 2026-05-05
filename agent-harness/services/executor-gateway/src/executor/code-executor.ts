import { createLogger } from '@agent-harness/shared';
import type { ExecutionInput, ExecutionResult } from './generic-executor';

const logger = createLogger('code-executor');

const LITELLM_URL = process.env.LITELLM_URL || '';
const LITELLM_MODEL = process.env.LITELLM_CODE_MODEL || process.env.LITELLM_MODEL || 'minimax-m2.7';
const LITELLM_API_KEY = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '';
if (!LITELLM_API_KEY) logger.warn('config.missing', 'LITELLM_MASTER_KEY or LITELLM_API_KEY environment variable is not set');

async function callLiteLLM(systemPrompt: string, userPrompt: string, temperature: number = 0.2): Promise<{ content: string; ok: boolean }> {
  const timeoutMs = Number(process.env.LITELLM_EXEC_TIMEOUT_MS || 60000);
  try {
    const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${LITELLM_API_KEY}`
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
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      logger.warn('litellm.call_failed', 'LiteLLM call failed', { status: response.status });
      return { content: '', ok: false };
    }

    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content || '';
    return { content, ok: true };
  } catch (error) {
    logger.warn('litellm.call_error', 'LiteLLM call error', { error: String(error) });
    return { content: '', ok: false };
  }
}

export class CodeExecutor {
  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const { stage, user_goal, context } = input;

    const systemPrompt = `You are a code execution assistant. Your task is to:
1. Analyze the code requirements from the user goal
2. Generate or modify code to meet the requirements
3. Ensure the code is syntactically correct and follows best practices
4. Provide a summary of changes made

Output format:
- List the files that need to be created or modified
- Provide the code for each file
- Summarize the changes and their purpose`;

    const userPrompt = `Goal: ${user_goal}

Stage: ${stage.stage_type} - ${stage.purpose}

Context: ${JSON.stringify(context || {})}

Generate the code changes needed to accomplish this goal.`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.2);

    if (!ok || !content) {
      return {
        status: 'failed',
        output: 'Code execution failed - model call unsuccessful',
        error: 'model_call_failed',
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

export const codeExecutor = new CodeExecutor();
