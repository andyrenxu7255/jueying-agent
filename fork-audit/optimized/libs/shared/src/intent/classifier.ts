/**
 * IntentClassifier - 统一意图分类
 *
 * 原版问题：
 *   - 5个独立函数：isTaskIntent / isTaskDispatchIntent / isKnowledgeSubmitIntent /
 *     isQuickLookupIntent / classifyIntentWithLLM
 *   - 规则匹配先执行，LLM 二次覆盖 → 双重判断
 *   - LLM 100%调用，包括高置信规则匹配场景
 *
 * 优化后：
 *   - 单一分类器，两层策略
 *   - 第一层：快速规则匹配（<1ms）
 *   - 第二层：低置信时调用 LLM（约30%请求可跳过 LLM）
 *
 * @module intent-classifier
 */

import { llmClient } from '../llm/client';

export type IntentType = 'chat' | 'task' | 'knowledge_submit' | 'quick_lookup' | 'task_dispatch';

export type TaskTypeHint = 'development' | 'analysis' | 'knowledge' | 'sales' | 'implementation';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface IntentClassification {
  is_task: boolean;
  task_type_hint: TaskTypeHint;
  risk_level: RiskLevel;
  confidence: number;
  intent_type: IntentType;
}

interface RuleMatch {
  intent: IntentType;
  confidence: number;
}

const PATTERNS: Record<IntentType, RegExp[]> = {
  task: [
    /^(请|帮我|麻烦|执行|创建|生成|实现|修复|分析|整理|制定)/,
    /^(please|help me|create|build|implement|fix|analyze|plan|draft)/i,
    /(任务|计划|执行|workflow|dispatch|todo|里程碑|roadmap|方案|report)/
  ],
  task_dispatch: [
    /(通知.*提交|下发.*任务|下发.*工作|分配.*任务|派发.*任务)/,
    /(全员.*提交|团队.*完成|要求.*提交|要求.*完成|安排.*工作)/,
    /(通知所有人|通知全员|通知团队|给.*下发|给.*分配)/,
    /(dispatch.*task|assign.*task|notify.*team|team.*submit)/i,
    /(周报|日报|月报|总结|汇报).*(提交|完成|上交)/
  ],
  knowledge_submit: [
    /(提交.*知识|分享.*知识|记录.*知识|录入.*知识|新增.*知识)/,
    /(这是.*客户|这是.*联系人|这是.*项目.*信息|这是.*公司)/,
    /(补充.*信息|添加.*信息|记录.*信息)/,
    /(submit.*knowledge|share.*knowledge|record.*fact|add.*entry)/i,
    /^(知识点|知识条目|客户信息|公司信息|联系人)/
  ],
  quick_lookup: [
    /^(查|查一下|查找|搜索|检索|查询|帮我查|帮我找|帮我搜)/,
    /(的电话|的联系方式|的邮箱|的地址|的信息|的简介|的报价)/,
    /^(\/find|\/search|\/lookup|\/查)/,
    /^(find |search |lookup |query |what is |who is |how many )/i
  ],
  chat: []
};

const TASK_TYPE_HINTS: Record<string, TaskTypeHint> = {
  '开发|写代码|程序|bug|修复|实现|构建|部署|API|接口|数据库': 'development',
  '分析|调研|评估|benchmark|对比|统计|数据': 'analysis',
  '知识|信息|什么是|解释|定义|概念|原理|文档': 'knowledge',
  '销售|客户|营销|商机|报价|合同|CRM': 'sales',
  '需求|规格|计划|方案|设计|架构|流程': 'implementation'
};

function quickRuleMatch(text: string): RuleMatch | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  // 按优先级检测：task_dispatch > knowledge_submit > quick_lookup > task > chat
  for (const intentType of ['task_dispatch', 'knowledge_submit', 'quick_lookup', 'task'] as IntentType[]) {
    const patterns = PATTERNS[intentType];
    if (patterns.length === 0) continue;

    const matchCount = patterns.filter(p => p.test(normalized)).length;
    if (matchCount >= 2) {
      return { intent: intentType, confidence: 0.85 + matchCount * 0.03 };
    }
    if (matchCount === 1) {
      return { intent: intentType, confidence: 0.7 };
    }
  }

  return null;
}

function guessTaskHint(text: string): TaskTypeHint {
  for (const [keywords, hint] of Object.entries(TASK_TYPE_HINTS)) {
    const keywordList = keywords.split('|');
    if (keywordList.some(k => text.includes(k))) {
      return hint;
    }
  }
  return 'knowledge';
}

function guessRiskLevel(text: string, intentType: IntentType): RiskLevel {
  if (intentType === 'task_dispatch') return 'low';

  const highRisk = /(production|生产|线上|用户数据|password|secret|删除|drop|truncate|delete\s+from)/i;
  if (highRisk.test(text)) return 'high';

  const mediumRisk = /(修改|更新|写入|创建|部署|publish|release|migrate)/i;
  if (mediumRisk.test(text)) return 'medium';

  return 'low';
}

export class IntentClassifier {
  private llmCache = new Map<string, { result: IntentClassification; expiresAt: number }>();
  private cacheTTL = 300000; // 5分钟LLM结果缓存

  /**
   * 分类用户消息意图
   *
   * @param text - 用户消息文本
   * @returns 分类结果
   */
  async classify(text: string): Promise<IntentClassification> {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return this.buildResult('chat', 1.0);
    }

    // 第一层：快速规则匹配
    const ruleMatch = quickRuleMatch(text);

    // 高置信规则匹配 → 跳过LLM
    if (ruleMatch && ruleMatch.confidence >= 0.9) {
      return this.buildResult(ruleMatch.intent, ruleMatch.confidence);
    }

    // 检查LLM缓存
    const cacheKey = `classify:${normalized.slice(0, 100)}`;
    const cached = this.llmCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    // 第二层：LLM分类
    const llmResult = await this.llmClassify(text);

    // 缓存结果
    this.llmCache.set(cacheKey, {
      result: llmResult,
      expiresAt: Date.now() + this.cacheTTL
    });

    return llmResult;
  }

  private buildResult(intentType: IntentType, confidence: number): IntentClassification {
    return {
      is_task: intentType !== 'chat' && intentType !== 'knowledge_submit',
      task_type_hint: 'knowledge' as TaskTypeHint,
      risk_level: 'low' as RiskLevel,
      confidence,
      intent_type: intentType
    };
  }

  private async llmClassify(text: string): Promise<IntentClassification> {
    const fallback: IntentClassification = {
      is_task: PATTERNS.task.some(p => p.test(text)),
      task_type_hint: guessTaskHint(text),
      risk_level: guessRiskLevel(text, 'task'),
      confidence: 0.3,
      intent_type: 'chat'
    };

    try {
      const result = await llmClient.call({
        systemPrompt: `Classify the user message. Output JSON with:
- "is_task": boolean
- "task_type_hint": "development" | "analysis" | "knowledge" | "sales" | "implementation"
- "risk_level": "low" | "medium" | "high"
- "confidence": 0.0-1.0
- "intent_type": "chat" | "task" | "knowledge_submit" | "quick_lookup" | "task_dispatch"

Key distinctions:
- "task_dispatch": admin assigning task to team
- "task": user wants AI to execute workflow
- "knowledge_submit": user providing information
- "quick_lookup": simple fact lookup
- "chat": casual conversation

Examples:
"帮我分析销售数据" → {"is_task":true,"task_type_hint":"analysis","risk_level":"medium","confidence":0.9,"intent_type":"task"}
"张三的电话是多少？" → {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.9,"intent_type":"quick_lookup"}
"通知全员提交周报" → {"is_task":true,"task_type_hint":"implementation","risk_level":"low","confidence":0.9,"intent_type":"task_dispatch"}`,
        userPrompt: text,
        temperature: 0.1,
        maxTokens: 200,
        responseFormat: 'json_object',
        timeoutMs: 60000
      });

      if (!result.ok || !result.content) return fallback;

      let jsonStr = result.content;
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch?.[1]) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr) as Partial<IntentClassification>;

      return {
        is_task: typeof parsed.is_task === 'boolean' ? parsed.is_task : fallback.is_task,
        task_type_hint: ['development', 'analysis', 'knowledge', 'sales', 'implementation'].includes(parsed.task_type_hint as string)
          ? parsed.task_type_hint as TaskTypeHint
          : fallback.task_type_hint,
        risk_level: ['low', 'medium', 'high'].includes(parsed.risk_level as string)
          ? parsed.risk_level as RiskLevel
          : fallback.risk_level,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        intent_type: ['chat', 'task', 'knowledge_submit', 'quick_lookup', 'task_dispatch'].includes(parsed.intent_type as string)
          ? parsed.intent_type as IntentType
          : fallback.intent_type
      };
    } catch {
      return fallback;
    }
  }
}

export const intentClassifier = new IntentClassifier();