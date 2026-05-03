/**
 * Verification Executor — 验证执行器
 *
 * 使用 LLM 验证实现输出是否符合验收标准。
 * 解析 LLM 返回的 VERDICT (PASS/FAIL) 并输出结构化验证元信息。
 *
 * @module verification-executor
 */

import { createLogger } from '@agent-harness/shared';
import type { ExecutionInput, ExecutionResult } from './generic-executor';

const logger = createLogger('verification-executor');

const LITELLM_URL = process.env.LITELLM_URL || '';
const LITELLM_MODEL = process.env.LITELLM_MODEL || 'minimax-m2.7';
const LITELLM_API_KEY = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || 'litellm-dev-key';

async function callLiteLLM(systemPrompt: string, userPrompt: string, temperature: number = 0.1): Promise<{ content: string; ok: boolean }> {
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
        max_tokens: 2048
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
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

interface ParsedVerdict {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  confidence: number;
  reasons: string[];
}

function parseVerdict(content: string): ParsedVerdict {
  const upper = content.toUpperCase();
  const verdictLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[-*\s]*VERDICT\s*[:：]/i.test(line));

  const reasons: string[] = [];
  let verdict: ParsedVerdict['verdict'] = 'UNKNOWN';

  if (verdictLine) {
    if (/\bPASS\b/i.test(verdictLine)) verdict = 'PASS';
    if (/\bFAIL\b/i.test(verdictLine)) verdict = 'FAIL';
    reasons.push(`verdict_line=${verdictLine}`);
  }

  const passCount = (upper.match(/\bPASS\b/g) || []).length;
  const failCount = (upper.match(/\bFAIL\b/g) || []).length;
  if (verdict === 'UNKNOWN') {
    if (failCount > passCount) verdict = 'FAIL';
    else if (passCount > 0 && failCount === 0) verdict = 'PASS';
    reasons.push(`token_count(pass=${passCount},fail=${failCount})`);
  }

  const hasIssuesSection = /issues\s*found\s*[:：]/i.test(content);
  const hasCriticalIssue = /(critical|fatal|must fix|blocking|blocker|不通过|未通过|失败)/i.test(content);
  if (verdict === 'PASS' && hasIssuesSection && hasCriticalIssue) {
    verdict = 'FAIL';
    reasons.push('critical_issue_detected_in_issues_section');
  }

  const confidence = verdict === 'UNKNOWN' ? 0.2 : verdictLine ? 0.9 : 0.7;
  return { verdict, confidence, reasons };
}

export class VerificationExecutor {
  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const { stage, user_goal, context } = input;

    const acceptanceCriteria = stage.acceptance?.must_have || [];
    const passRules = stage.acceptance?.pass_rules || [];
    const failRules = stage.acceptance?.fail_rules || [];

    const systemPrompt = `You are a verification assistant. Your task is to:
1. Review the implementation output against the user goal
2. Check each acceptance criterion
3. Verify pass rules are satisfied
4. Verify fail rules are NOT triggered
5. Provide a clear verdict: PASS or FAIL

Output format:
- Verdict: PASS or FAIL
- Checked criteria: list each criterion with pass/fail status
- Issues found: list any issues (if FAIL)
- Recommendations: suggestions for improvement`;

    const userPrompt = `Goal: ${user_goal}

Stage: ${stage.stage_type} - ${stage.purpose}

Acceptance criteria: ${JSON.stringify(acceptanceCriteria)}
Pass rules: ${JSON.stringify(passRules)}
Fail rules: ${JSON.stringify(failRules)}

Implementation output to verify:
${context?.output || context?.implementation_output || 'No output provided'}

Verify whether the implementation meets the acceptance criteria.`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.1);

    if (!ok || !content) {
      return {
        status: 'failed',
        output: 'Verification failed - model call unsuccessful',
        error: 'model_call_failed',
        model_call_ok: false
      };
    }

    const parsed = parseVerdict(content);
    const verdict = parsed.verdict === 'PASS';

    return {
      status: verdict ? 'completed' : 'failed',
      output: `${content}\n\n[verification-meta] verdict=${parsed.verdict}; confidence=${parsed.confidence}; reasons=${parsed.reasons.join('|')}`,
      next_action: verdict ? 'next_stage' : 'repair',
      model_call_ok: true
    };
  }
}

export const verificationExecutor = new VerificationExecutor();
