import { createLogger, llmClient } from '@agent-harness/shared';
import type { ExecutionInput, ExecutionResult } from './generic-executor';

const logger = createLogger('repair-executor');

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

    const { content, ok } = await llmClient.call({ systemPrompt, userPrompt, temperature: 0.2, maxTokens: 4096 });

    if (!ok || !content) {
      return {
        status: 'failed',
        output: 'Repair failed - model call unsuccessful',
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

export const repairExecutor = new RepairExecutor();
