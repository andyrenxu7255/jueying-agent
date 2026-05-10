import { llmClient } from '../llm/client';
import { createLogger } from '../logging/logger';

const logger = createLogger('intent-classifier');

export interface IntentClassification {
  is_task: boolean;
  task_type_hint: 'development' | 'analysis' | 'knowledge' | 'sales' | 'implementation';
  risk_level: 'low' | 'medium' | 'high';
  confidence: number;
  intent_type: 'chat' | 'task' | 'knowledge_submit' | 'quick_lookup' | 'task_dispatch';
}

function isTaskIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /^(请|帮我|麻烦|执行|创建|生成|实现|修复|分析|整理|制定)/,
    /^(please|help me|create|build|implement|fix|analyze|plan|draft)/,
    /(任务|计划|执行|workflow|dispatch|todo|里程碑|roadmap|方案|report)/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isTaskDispatchIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /(通知.*提交|下发.*任务|下发.*工作|分配.*任务|派发.*任务)/,
    /(全员.*提交|团队.*完成|要求.*提交|要求.*完成|安排.*工作)/,
    /(通知所有人|通知全员|通知团队|给.*下发|给.*分配)/,
    /(dispatch.*task|assign.*task|notify.*team|team.*submit)/,
    /(周报|日报|月报|总结|汇报).*(提交|完成|上交)/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isKnowledgeSubmitIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /(提交.*知识|分享.*知识|记录.*知识|录入.*知识|新增.*知识)/,
    /(这是.*客户|这是.*联系人|这是.*项目.*信息|这是.*公司)/,
    /(补充.*信息|添加.*信息|记录.*信息)/,
    /(submit.*knowledge|share.*knowledge|record.*fact|add.*entry)/,
    /^(知识点|知识条目|客户信息|公司信息|联系人)/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isQuickLookupIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (isTaskIntent(text)) return false;
  const patterns = [
    /^(查|查一下|查找|搜索|检索|查询|帮我查|帮我找|帮我搜)/,
    /(的电话|的联系方式|的邮箱|的地址|的信息|的简介|的报价)/,
    /^(\/find|\/search|\/lookup|\/查)/,
    /^(find |search |lookup |query |what is |who is |how many )/i
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function ruleBasedClassify(text: string): IntentClassification | null {
  const isEmpty = !text.trim();
  if (isEmpty) return null;

  if (isTaskDispatchIntent(text)) {
    return {
      is_task: true,
      task_type_hint: 'implementation',
      risk_level: 'low',
      confidence: 0.9,
      intent_type: 'task_dispatch'
    };
  }

  if (isKnowledgeSubmitIntent(text)) {
    return {
      is_task: false,
      task_type_hint: 'knowledge',
      risk_level: 'low',
      confidence: 0.9,
      intent_type: 'knowledge_submit'
    };
  }

  if (isQuickLookupIntent(text)) {
    return {
      is_task: false,
      task_type_hint: 'knowledge',
      risk_level: 'low',
      confidence: 0.85,
      intent_type: 'quick_lookup'
    };
  }

  return null;
}

const CLASSIFY_SYSTEM_PROMPT = `Classify the user message. Output JSON with:
- "is_task": boolean - true if the user wants to execute a workflow or dispatch a task to others, false for chat or knowledge submission
- "task_type_hint": one of "development", "analysis", "knowledge", "sales", "implementation"
- "risk_level": one of "low", "medium", "high"
- "confidence": 0.0-1.0
- "intent_type": one of "chat" (casual conversation), "task" (execute workflow), "knowledge_submit" (user is sharing a piece of knowledge), "quick_lookup" (simple fact lookup), "task_dispatch" (admin dispatching/assigning a task to team members)

KEY DISTINCTION:
- "task_dispatch": admin/manager is ASSIGNING a task to team members (e.g. "通知所有人提交周报", "给团队下发任务：完成Q3总结", "下发工作要求：每日拜访总结")
- "task": user wants the AI to EXECUTE a workflow for them (e.g. "帮我分析销售数据")
- "knowledge_submit": user is PROVIDING information (e.g. "这是客户张三的信息", "A公司的联系方式是...", "我想提交一条知识")
- "knowledge" task_type_hint: user is ASKING for information (e.g. "什么是RAG?", "查一下销售数据")

Examples:
"帮我分析一下销售数据" -> {"is_task":true,"task_type_hint":"analysis","risk_level":"medium","confidence":0.9,"intent_type":"task"}
"修复登录页面的bug" -> {"is_task":true,"task_type_hint":"development","risk_level":"medium","confidence":0.85,"intent_type":"task"}
"今天天气怎么样" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.95,"intent_type":"chat"}
"请制定Q2营销方案" -> {"is_task":true,"task_type_hint":"sales","risk_level":"high","confidence":0.8,"intent_type":"task"}
"张三是A公司的技术总监，电话138xxxx" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.9,"intent_type":"knowledge_submit"}
"我想提交一条知识：B公司最近融资了5000万" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.95,"intent_type":"knowledge_submit"}
"什么是RAG?" -> {"is_task":true,"task_type_hint":"knowledge","risk_level":"low","confidence":0.7,"intent_type":"task"}
"查一下A公司的联系电话" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.95,"intent_type":"quick_lookup"}
"张三的邮箱是多少？" -> {"is_task":false,"task_type_hint":"knowledge","risk_level":"low","confidence":0.9,"intent_type":"quick_lookup"}
"通知全员提交周报" -> {"is_task":true,"task_type_hint":"implementation","risk_level":"low","confidence":0.9,"intent_type":"task_dispatch"}
"给销售团队下发任务：本周五前提交客户拜访报告" -> {"is_task":true,"task_type_hint":"sales","risk_level":"low","confidence":0.95,"intent_type":"task_dispatch"}
"下发工作要求：每天20点提交当日总结" -> {"is_task":true,"task_type_hint":"implementation","risk_level":"low","confidence":0.95,"intent_type":"task_dispatch"}`;

function buildFallback(text: string): IntentClassification {
  const isTask = isTaskIntent(text);
  const isDispatch = isTaskDispatchIntent(text);
  const isKnowledgeSubmit = isKnowledgeSubmitIntent(text);
  const isQuickLookup = isQuickLookupIntent(text);

  return {
    is_task: isTask || isDispatch,
    task_type_hint: 'knowledge',
    risk_level: 'medium',
    confidence: 0.0,
    intent_type: isDispatch ? 'task_dispatch'
      : isKnowledgeSubmit ? 'knowledge_submit'
      : isQuickLookup ? 'quick_lookup'
      : isTask ? 'task'
      : 'chat'
  };
}

function parseClassificationContent(content: string, fallback: IntentClassification): IntentClassification {
  let jsonContent = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    jsonContent = fenceMatch[1].trim();
  }
  const parsed = JSON.parse(jsonContent) as Partial<IntentClassification>;
  return {
    is_task: typeof parsed.is_task === 'boolean' ? parsed.is_task : fallback.is_task,
    task_type_hint: ['development', 'analysis', 'knowledge', 'sales', 'implementation'].includes(parsed.task_type_hint as string)
      ? parsed.task_type_hint as IntentClassification['task_type_hint'] : fallback.task_type_hint,
    risk_level: ['low', 'medium', 'high'].includes(parsed.risk_level as string)
      ? parsed.risk_level as IntentClassification['risk_level'] : fallback.risk_level,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    intent_type: ['chat', 'task', 'knowledge_submit', 'quick_lookup', 'task_dispatch'].includes(parsed.intent_type as string)
      ? parsed.intent_type as IntentClassification['intent_type'] : fallback.intent_type
  };
}

export async function classifyIntent(text: string): Promise<IntentClassification> {
  const ruleResult = ruleBasedClassify(text);
  if (ruleResult && ruleResult.confidence >= 0.85) {
    return ruleResult;
  }

  const fallback = buildFallback(text);

  try {
    const result = await llmClient.call({
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userPrompt: text,
      temperature: 0.1,
      maxTokens: 200,
      timeoutMs: 60000,
      responseFormat: 'json_object'
    });

    if (!result.ok || !result.content) {
      logger.warn('intent.classify_failed', 'LLM intent classification failed, using fallback');
      return fallback;
    }

    return parseClassificationContent(result.content, fallback);
  } catch (error) {
    logger.warn('intent.classify_exception', 'LLM intent classification exception', {
      error: String(error)
    });
    return fallback;
  }
}