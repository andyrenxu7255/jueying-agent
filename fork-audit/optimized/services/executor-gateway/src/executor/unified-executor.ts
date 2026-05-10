/**
 * Unified Executor - 合并 3 个独立的 callLiteLLM 实现
 *
 * 原版问题：
 *   - generic-executor.ts    (72-133): callLiteLLM + retry + usage tracking
 *   - verification-executor.ts (20-52): callLiteLLM 简化版，无 retry
 *   - repair-executor.ts      (11-43): callLiteLLM 简化版，无 retry
 *   → 3 处重复，generic 版本最完整
 *
 * 优化后：统一使用 LlmClient，所有 executor 共享。
 *
 * @module unified-executor
 */

import { llmClient } from '../../../../libs/shared/src/llm/client';
import type { LlmCallResult } from '../../../../libs/shared/src/llm/client';

export interface ExecutorInput {
  goal: string;
  context?: string;
  artifacts?: Record<string, unknown>;
  checkpointData?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  runRef?: string;
}

export interface ExecutorOutput {
  ok: boolean;
  mode: ExecutorMode;
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

export type ExecutorMode = 'execute' | 'verify' | 'repair' | 'code' | 'retrieval' | 'approval';

type StageHandler = (input: ExecutorInput) => Promise<LlmCallResult>;

/** 模式到 stage handler 的映射 */
const STAGES: Record<ExecutorMode, StageHandler> = {
  execute: async (input) => {
    return llmClient.call({
      systemPrompt: buildExecuteSystem(input),
      userPrompt: input.goal || '执行',
      temperature: 0.3,
      maxTokens: 4096,
      timeoutMs: 120000
    });
  },

  verify: async (input) => {
    return llmClient.call({
      systemPrompt: '你是一个严格的输出验证器。验证以下内容是否符合预期标准。',
      userPrompt: `验证目标: ${input.goal}\n上下文: ${input.context || ''}\n上一步输出: ${JSON.stringify(input.artifacts?._previous_output || {})}`,
      temperature: 0.1,
      maxTokens: 1024,
      responseFormat: 'json_object',
      timeoutMs: 60000
    });
  },

  repair: async (input) => {
    return llmClient.call({
      systemPrompt: '你是一个专业的输出修复器。基于验证反馈修复以下输出。',
      userPrompt: `修复目标: ${input.goal}\n原输出: ${JSON.stringify(input.artifacts?._original_output || {})}\n问题: ${input.artifacts?._verification_result || ''}`,
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 120000
    });
  },

  code: async (input) => {
    return llmClient.call({
      systemPrompt: buildCodeSystem(input),
      userPrompt: input.goal || '执行代码',
      temperature: 0.1,
      maxTokens: 8192,
      timeoutMs: 180000
    });
  },

  retrieval: async (input) => {
    return llmClient.call({
      systemPrompt: '你是一个知识检索编排器。基于用户目标检索相关知识并组织输出。',
      userPrompt: `检索目标: ${input.goal}\n上下文: ${input.context || ''}`,
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 90000
    });
  },

  approval: async (_input) => {
    // 审批模式不需要LLM调用
    return { content: 'pending_approval', ok: true };
  }
};

function buildExecuteSystem(input: ExecutorInput): string {
  const base = '你是一个企业级AI执行引擎。根据用户目标生成高质量的执行结果。';

  if (!input.checkpointData) return base;

  const checkpoint = input.checkpointData;
  const parts: string[] = [];

  if (checkpoint.compressed_memory) {
    parts.push(`\n【压缩记忆】\n${checkpoint.compressed_memory}`);
  }
  if (checkpoint.active_artifacts) {
    parts.push(`\n【活跃产物】\n${JSON.stringify(checkpoint.active_artifacts)}`);
  }
  if (checkpoint.persona && typeof checkpoint.persona === 'object') {
    const p = checkpoint.persona as Record<string, unknown>;
    parts.push(`\n【用户画像】\nsoul: ${p.soul || 'N/A'}\nidentity: ${p.identity || 'N/A'}`);
  }
  if (checkpoint.workspace_stats && typeof checkpoint.workspace_stats === 'object') {
    const w = checkpoint.workspace_stats as Record<string, unknown>;
    parts.push(`\n【工作区】\n文档: ${w.docCount || 0} | 事实: ${w.factCount || 0} | 记忆: ${w.memoryCount || 0}`);
  }

  return base + parts.join('');
}

function buildCodeSystem(input: ExecutorInput): string {
  let system = `你是一个安全代码执行引擎。标准环境: Node.js 22 + Bun 1.2。

安全约束：
- 禁止访问外部网络（除npm registry）
- 禁止访问文件系统
- 禁止使用 eval() / Function() 动态执行
- 单次运行时间上限: 30秒
- 最大内存: 512MB`;

  if (input.checkpointData?.workspace_stats) {
    const w = input.checkpointData.workspace_stats as Record<string, unknown>;
    system += `\n\n工作区环境: Node.js 22 + Bun 1.2\n文档数: ${w.docCount || 0}\n事实数: ${w.factCount || 0}\n记忆数: ${w.memoryCount || 0}`;
  }

  return system;
}

/**
 * 统一执行入口。
 *
 * @param input - 执行器输入
 * @param mode  - 执行模式（execute/verify/repair/code/retrieval/approval）
 */
export async function execute(input: ExecutorInput, mode: ExecutorMode = 'execute'): Promise<ExecutorOutput> {
  const handler = STAGES[mode];
  if (!handler) {
    return { ok: false, mode: 'execute', content: 'unknown executor mode', metadata: { error: `unknown_mode:${mode}` } };
  }

  try {
    const result = await handler(input);

    if (!result.ok || !result.content) {
      return { ok: false, mode, content: result.content || 'execution_failed' };
    }

    return {
      ok: true,
      mode,
      content: result.content,
      usage: result.usage,
      metadata: {
        run_ref: input.runRef,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      content: `execution_error: ${String(error).slice(0, 200)}`,
      metadata: { error: String(error).slice(0, 500) }
    };
  }
}