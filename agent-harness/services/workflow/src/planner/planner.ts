/**
 * Workflow Planner — LLM 任务规划器
 *
 * 根据用户目标(user_goal)自动生成多阶段工作流计划(stage_chain)。
 * 规划策略优先级: Markdown 预定义步骤 > 匹配的预制 Skill > LLM 动态生成 > 默认阶段链。
 *
 * @module workflow-planner
 */

import { createHash, randomBytes } from 'crypto';
import { createLogger, withRetry, RetryError } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import { planValidator } from './plan-validator';
import type { WorkflowPlan, Stage } from '@agent-harness/contracts';

const logger = createLogger('workflow-planner');

const LITELLM_URL = process.env.LITELLM_URL || (process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL}/v1` : 'http://localhost:4000');
const LITELLM_MODEL = process.env.LITELLM_MODEL || process.env.OLLAMA_MODEL || 'qwen3:8b';
const LITELLM_API_KEY = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || process.env.OLLAMA_API_KEY || 'ollama';

interface MatchedSkill {
  skill_id: string;
  skill_name: string;
  skill_type: string;
  description: string;
  definition_json: Record<string, unknown>;
  match_score: number;
}

async function findMatchingSkills(userGoal: string, taskTypeHint?: string): Promise<MatchedSkill[]> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return [];

  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    try {
      const keywords = userGoal
        .replace(/[^\w\u4e00-\u9fff]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1)
        .slice(0, 8);

      if (keywords.length === 0) return [];

      const likeConditions = keywords.map((_, i) => `(s.skill_name ILIKE $${i + 1} OR s.description ILIKE $${i + 1})`).join(' OR ');
      const likeValues = keywords.map(w => `%${w}%`);

      let typeFilter = '';
      const typeValues: string[] = [];
      if (taskTypeHint) {
        typeFilter = ` AND s.metadata->>'task_type_hint' = $${keywords.length + 1}`;
        typeValues.push(taskTypeHint);
      }

      const query = `
        SELECT s.id, s.skill_name, s.skill_type, s.description,
               sv.definition_json,
               GREATEST(
                 ${keywords.map((_, i) => `CASE WHEN s.skill_name ILIKE $${i + 1} THEN 2 ELSE 0 END`).join(' + ')},
                 ${keywords.map((_, i) => `CASE WHEN s.description ILIKE $${i + 1} THEN 1 ELSE 0 END`).join(' + ')}
               ) as match_score
        FROM skill s
        JOIN LATERAL (
          SELECT definition_json FROM skill_version sv
          WHERE sv.skill_id = s.id ORDER BY version DESC LIMIT 1
        ) sv ON true
        WHERE s.status = 'active' AND s.scope_type = 'public'
          AND (${likeConditions})${typeFilter}
        ORDER BY match_score DESC
        LIMIT 3
      `;

      const result = await pool.query(query, [...likeValues, ...typeValues]);
      return result.rows.map(row => ({
        skill_id: row.id,
        skill_name: row.skill_name,
        skill_type: row.skill_type,
        description: row.description,
        definition_json: typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json,
        match_score: Number(row.match_score)
      })).filter(s => s.match_score > 0);
    } finally {
      await pool.end();
    }
  } catch (error) {
    logger.warn('skill.match.query_failed', 'Failed to query matching skills', {
      error: String(error)
    });
    return [];
  }
}

export interface PlannerInput {
  user_id: string;
  user_goal: string;
  task_type_hint?: 'development' | 'analysis' | 'knowledge' | 'sales' | 'implementation';
  risk_level?: 'low' | 'medium' | 'high';
  budget?: {
    time_sec?: number;
    retrieval?: number;
    execution?: number;
  };
  policy_snapshot_hash: string;
  context?: Record<string, unknown>;
  source?: string;
  markdown_steps?: Array<{ seq: number; name: string; description: string }>;
}

export interface PlannerOutput {
  workflow_instance_ref: string;
  workflow_plan: WorkflowPlan;
  validation: { ok: boolean; issues: Array<{ field: string; message: string }> };
}

interface LiteLLMPlanResponse {
  workflow_type?: string;
  stage_chain?: Array<{
    stage_type: string;
    purpose: string;
    assigned_executor: string;
    inputs?: { required_refs?: string[] };
    retrieval_plan?: { enabled?: boolean; intent_type?: string };
    timeouts?: { soft_timeout_sec?: number; hard_timeout_sec?: number };
  }>;
  risk_level?: string;
  retrieval_profile?: string;
}

async function callLiteLLMForPlan(systemPrompt: string, userPrompt: string): Promise<{ plan: LiteLLMPlanResponse | null; ok: boolean }> {
  const timeoutMs = Number(process.env.LITELLM_PLAN_TIMEOUT_MS || 60000);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
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
        temperature: 0.3,
        max_tokens: 16384,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('litellm.plan.failed', 'LiteLLM plan generation failed', { status: response.status });
      return { plan: null, ok: false };
    }

    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;

    if (!content) {
      logger.warn('litellm.plan.empty', 'LiteLLM returned empty plan content', {});
      return { plan: null, ok: false };
    }

    try {
      let jsonStr = content.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const plan = JSON.parse(jsonStr) as LiteLLMPlanResponse;
      logger.info('litellm.plan.success', 'LiteLLM plan generation succeeded', {
        workflow_type: plan.workflow_type,
        stage_count: plan.stage_chain?.length || 0
      });
      return { plan, ok: true };
    } catch {
      logger.warn('litellm.plan.parse_error', 'Failed to parse LiteLLM plan response', { content: content.slice(0, 200) });
      return { plan: null, ok: false };
    }
  } catch (error) {
    const errorMsg = String(error);
    if (errorMsg.includes('abort') || errorMsg.includes('AbortError')) {
      logger.warn('litellm.plan.timeout', 'LiteLLM plan generation timed out', { timeout_ms: timeoutMs });
    } else {
      logger.error('litellm.plan.error', 'LiteLLM plan generation error', { error: errorMsg });
    }
    return { plan: null, ok: false };
  }
}

export class WorkflowPlanner {
  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const workflowInstanceRef = `wf_${Date.now()}_${randomBytes(4).toString('hex')}`;

    logger.info('planner.started', 'Workflow planning started', {
      user_id: input.user_id,
      user_goal: input.user_goal.slice(0, 100),
      source: input.source || 'default'
    });

    if (input.markdown_steps && input.markdown_steps.length > 0) {
      logger.info('planner.markdown_steps', 'Building plan from markdown steps', {
        step_count: input.markdown_steps.length,
        source: input.source
      });

      const markdownPlan = this.buildPlanFromMarkdownSteps(input);
      const validation = planValidator.validate(markdownPlan);
      await auditWriter.write({
        user_id: input.user_id,
        action: 'workflow.create',
        resource_type: 'workflow_instance',
        resource_ref: workflowInstanceRef,
        resource_scope: `private:${input.user_id}`,
        result: validation.ok ? 'success' : 'failure',
        detail_json: {
          workflow_type: markdownPlan.workflow_type,
          stage_count: markdownPlan.stage_chain.length,
          source: 'markdown_task',
          markdown_steps_count: input.markdown_steps.length
        }
      });
      return { workflow_instance_ref: workflowInstanceRef, workflow_plan: markdownPlan, validation };
    }

    const skipLLM = process.env.SKIP_LLM_PLAN === 'true';
    const matchedSkills = await findMatchingSkills(input.user_goal, input.task_type_hint);

    if (matchedSkills.length > 0) {
      const bestSkill = matchedSkills[0];
      logger.info('planner.skill.matched', 'Matched pre-built skill, using as workflow template', {
        skill_name: bestSkill.skill_name,
        skill_type: bestSkill.skill_type,
        match_score: bestSkill.match_score
      });

      const skillPlan = this.buildPlanFromSkill(input, bestSkill);
      if (skillPlan) {
        const validation = planValidator.validate(skillPlan);
        await auditWriter.write({
          user_id: input.user_id,
          action: 'workflow.create',
          resource_type: 'workflow_instance',
          resource_ref: workflowInstanceRef,
          resource_scope: `private:${input.user_id}`,
          result: validation.ok ? 'success' : 'failure',
          detail_json: {
            workflow_type: skillPlan.workflow_type,
            stage_count: skillPlan.stage_chain.length,
            source: 'skill_match',
            skill_name: bestSkill.skill_name,
            skill_id: bestSkill.skill_id,
            match_score: bestSkill.match_score
          }
        });
        return { workflow_instance_ref: workflowInstanceRef, workflow_plan: skillPlan, validation };
      }
    }

    const llmPlan = skipLLM ? null : await this.generatePlanViaLLM(input, matchedSkills);

    const workflowPlan = this.buildWorkflowPlan(input, llmPlan);

    const validation = planValidator.validate(workflowPlan);

    if (!validation.ok) {
      logger.warn('planner.validation.failed', 'Workflow plan validation failed', {
        issues: validation.issues
      });
    }

    await auditWriter.write({
      user_id: input.user_id,
      action: 'workflow.create',
      resource_type: 'workflow_instance',
      resource_ref: workflowInstanceRef,
      resource_scope: `private:${input.user_id}`,
      result: validation.ok ? 'success' : 'failure',
      detail_json: {
        workflow_type: workflowPlan.workflow_type,
        stage_count: workflowPlan.stage_chain.length,
        validation_issues: validation.issues,
        llm_plan_ok: llmPlan !== null,
        matched_skills_count: matchedSkills.length,
        matched_skill_names: matchedSkills.map(s => s.skill_name)
      }
    });

    logger.info('planner.completed', 'Workflow planning completed', {
      workflow_instance_ref: workflowInstanceRef,
      workflow_type: workflowPlan.workflow_type,
      stage_count: workflowPlan.stage_chain.length,
      validation_ok: validation.ok
    });

    return {
      workflow_instance_ref: workflowInstanceRef,
      workflow_plan: workflowPlan,
      validation
    };
  }

  private async generatePlanViaLLM(input: PlannerInput, matchedSkills: MatchedSkill[] = []): Promise<LiteLLMPlanResponse | null> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input, matchedSkills);

    try {
      const result = await withRetry(
        async () => {
          const { plan, ok } = await callLiteLLMForPlan(systemPrompt, userPrompt);
          if (!ok || !plan) {
            const err = new Error('LLM plan generation failed, will retry');
            err.name = 'LLMPlanGenerationError';
            throw err;
          }
          return plan;
        },
        { max_retries: 2, initial_delay_ms: 2000, max_delay_ms: 15000, backoff_multiplier: 2, jitter: true, retryable_errors: ['LLMPlanGenerationError', 'fetch', 'abort', 'timeout'] },
        (error: Error) => {
          return error.name === 'LLMPlanGenerationError' ||
            error.message.includes('fetch') ||
            error.message.includes('abort') ||
            error.message.includes('timeout');
        }
      );
      return result;
    } catch (error) {
      if (error instanceof RetryError) {
        logger.warn('planner.llm.retry_exhausted', 'LLM plan generation failed after all retries', {
          attempts: error.attempts,
          last_error: error.lastError.message
        });
      } else {
        logger.warn('planner.llm.failed', 'LLM plan generation failed', { error: String(error) });
      }
      return null;
    }
  }

  private buildSystemPrompt(): string {
    return `You are a workflow planning assistant for Agent Harness. Generate a structured workflow plan as JSON.

Valid workflow_type values: development, analysis, knowledge, sales, implementation
Valid stage_type values: IntentClarification, PlanGeneration, EvidenceRetrieval, MemoryRetrieval, ObjectExtraction, ArchitectureDesign, SpecGeneration, DecisionMaking, Implementation, Verification, Repair, Approval, ResultReporting, SkillExtraction, DreamSummarization, Archive
Valid assigned_executor values: generic-executor, retrieval-aware-executor, code-executor, verification-executor, repair-executor

Executor-stage mapping rules:
- IntentClarification, PlanGeneration, DecisionMaking, ResultReporting, SkillExtraction, DreamSummarization, Archive -> generic-executor
- EvidenceRetrieval, MemoryRetrieval -> retrieval-aware-executor
- Implementation, Repair -> code-executor
- Verification -> verification-executor

Example workflows:

1. Development task ("Fix the login page bug"):
{"workflow_type":"development","risk_level":"medium","retrieval_profile":"balanced","stage_chain":[{"stage_type":"IntentClarification","purpose":"Clarify the bug details and reproduction steps","assigned_executor":"generic-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":60,"hard_timeout_sec":300}},{"stage_type":"EvidenceRetrieval","purpose":"Search codebase for related code and previous fixes","assigned_executor":"retrieval-aware-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":true,"intent_type":"code_search"},"timeouts":{"soft_timeout_sec":120,"hard_timeout_sec":600}},{"stage_type":"Implementation","purpose":"Implement the fix for the login bug","assigned_executor":"code-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":300,"hard_timeout_sec":900}},{"stage_type":"Verification","purpose":"Verify the fix works correctly","assigned_executor":"verification-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":120,"hard_timeout_sec":600}},{"stage_type":"ResultReporting","purpose":"Report the fix outcome","assigned_executor":"generic-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":60,"hard_timeout_sec":300}}]}

2. Analysis task ("Analyze Q1 sales data and identify trends"):
{"workflow_type":"analysis","risk_level":"medium","retrieval_profile":"comprehensive","stage_chain":[{"stage_type":"IntentClarification","purpose":"Clarify analysis scope and key metrics","assigned_executor":"generic-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":60,"hard_timeout_sec":300}},{"stage_type":"EvidenceRetrieval","purpose":"Retrieve sales data and historical trends","assigned_executor":"retrieval-aware-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":true,"intent_type":"deep_analysis"},"timeouts":{"soft_timeout_sec":180,"hard_timeout_sec":600}},{"stage_type":"DecisionMaking","purpose":"Identify key trends and insights","assigned_executor":"generic-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":120,"hard_timeout_sec":600}},{"stage_type":"ResultReporting","purpose":"Present analysis findings","assigned_executor":"generic-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":60,"hard_timeout_sec":300}}]}

3. Knowledge task ("What is RAG and how does it work?"):
{"workflow_type":"knowledge","risk_level":"low","retrieval_profile":"precision-first","stage_chain":[{"stage_type":"IntentClarification","purpose":"Clarify the knowledge query scope","assigned_executor":"generic-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":30,"hard_timeout_sec":120}},{"stage_type":"EvidenceRetrieval","purpose":"Search knowledge base for RAG information","assigned_executor":"retrieval-aware-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":true,"intent_type":"factual_lookup"},"timeouts":{"soft_timeout_sec":60,"hard_timeout_sec":300}},{"stage_type":"ResultReporting","purpose":"Present the knowledge answer","assigned_executor":"generic-executor","inputs":{"required_refs":[]},"retrieval_plan":{"enabled":false},"timeouts":{"soft_timeout_sec":30,"hard_timeout_sec":120}}]}

Respond with JSON containing:
{
  "workflow_type": "<type>",
  "risk_level": "low|medium|high",
  "retrieval_profile": "precision-first|balanced|comprehensive",
  "stage_chain": [
    {
      "stage_type": "<type>",
      "purpose": "<description>",
      "assigned_executor": "<executor>",
      "inputs": {"required_refs": []},
      "retrieval_plan": {"enabled": false},
      "timeouts": {"soft_timeout_sec": 120, "hard_timeout_sec": 600}
    }
  ]
}

IMPORTANT: Respond with ONLY valid JSON. Do NOT wrap the JSON in markdown code blocks (no \`\`\`json). Do NOT include any explanatory text before or after the JSON. The entire response must be a single JSON object parseable by JSON.parse().`;
  }

  private buildUserPrompt(input: PlannerInput, matchedSkills: MatchedSkill[] = []): string {
    let skillContext = '';
    if (matchedSkills.length > 0) {
      skillContext = '\n\nAvailable skills that match this request (consider incorporating their stage definitions):\n';
      for (const skill of matchedSkills) {
        skillContext += `\n--- Skill: ${skill.skill_name} (id: ${skill.skill_id}, type: ${skill.skill_type}, match_score: ${skill.match_score}) ---\n`;
        skillContext += `Description: ${skill.description}\n`;
        if (skill.definition_json && Object.keys(skill.definition_json).length > 0) {
          skillContext += `Definition: ${JSON.stringify(skill.definition_json, null, 2)}\n`;
        }
      }
      skillContext += '\nIf a matched skill is relevant, reference its skill_id in the stage_chain by adding "skill_ref" field.\n';
    }

    return `Create a workflow plan for the following request:

User: ${input.user_id}
Task Type Hint: ${input.task_type_hint || 'knowledge'}
Goal: ${input.user_goal}
Risk Level: ${input.risk_level || 'medium'}
Budget: ${JSON.stringify(input.budget || { time_sec: 1800, retrieval: 20, execution: 120 })}
Context: ${JSON.stringify(input.context || {})}${skillContext}

Generate an appropriate workflow with 2-5 stages. Ensure stage_chain follows logical progression.`;
  }

  private buildPlanFromSkill(input: PlannerInput, skill: MatchedSkill): WorkflowPlan | null {
    const def = skill.definition_json;
    const stageChainDef = def.stage_chain as Array<Record<string, unknown>> | undefined;
    if (!stageChainDef || stageChainDef.length === 0) return null;

    const stageChain: Stage[] = stageChainDef.map((s, idx) => ({
      stage_id: `st_${Date.now()}_${idx}`,
      stage_key: String(s.stage_type || 'Generic').toLowerCase().replace(/[^a-z0-9]/g, '_'),
      stage_type: String(s.stage_type || 'Generic') as Stage['stage_type'],
      purpose: String(s.purpose || skill.description),
      assigned_executor: String(s.assigned_executor || 'generic-executor') as Stage['assigned_executor'],
      seq: idx + 1,
      acceptance: { must_have: [], pass_rules: [], fail_rules: [] },
      retry_policy: { max_retries: 0, max_repairs: 0 },
      checkpoint_policy: { on_enter: false, on_progress: false, on_exit: false },
      on_success: idx < stageChainDef.length - 1 ? 'next_stage' as const : 'succeeded' as const,
      on_failure: 'repair_or_fail' as const,
      inputs: { required_refs: [], optional_refs: [] },
      retrieval_plan: { enabled: false },
      timeouts: {
        soft_timeout_sec: Number((s.timeouts as Record<string, unknown>)?.soft_timeout_sec || 120),
        hard_timeout_sec: Number((s.timeouts as Record<string, unknown>)?.hard_timeout_sec || 600)
      }
    }));

    const taskType = input.task_type_hint || (def.task_type_hint as string) || 'knowledge';
    const planHash = this.calculatePlanHash(input, stageChain);

    return {
      workflow_type: taskType as WorkflowPlan['workflow_type'],
      plan_version: 'v1',
      owner_user_id: input.user_id,
      scope_type: 'private',
      goal: {
        user_goal: input.user_goal,
        success_definition: ['Task completed successfully', 'Output delivered to user']
      },
      risk_level: input.risk_level || 'medium',
      policy_snapshot_hash: input.policy_snapshot_hash,
      retrieval_profile: 'balanced',
      budgets: { time_budget_sec: input.budget?.time_sec || 3600, retrieval_budget: input.budget?.retrieval || 50, execution_budget: input.budget?.execution || 300, repair_budget: 5 },
      stage_chain: stageChain,
      report_policy: { on_stage_complete: false, on_waiting_user: true, on_final: true },
      archive_policy: { archive_evidence: true, archive_artifacts: true, retention_days: 90 },
      plan_hash: planHash
    };
  }

  private buildPlanFromMarkdownSteps(input: PlannerInput): WorkflowPlan {
    const timestamp = Date.now();
    const stageChain: Stage[] = (input.markdown_steps || []).map((step, idx) => {
      const stageType = this.inferStageTypeFromStepName(step.name);
      const executor = this.inferExecutorFromStageType(stageType);
      return this.createStage(
        `st_${timestamp}_${idx}`,
        idx,
        stageType,
        step.description || step.name,
        executor
      );
    });

    if (stageChain.length === 0) {
      stageChain.push(
        this.createStage(`st_${timestamp}_0`, 0, 'IntentClarification', input.user_goal, 'generic-executor'),
        this.createStage(`st_${timestamp}_1`, 1, 'ResultReporting', 'Report results', 'generic-executor')
      );
    }

    const planHash = this.calculatePlanHash(input, stageChain);
    const taskType = input.task_type_hint || 'knowledge';

    return {
      workflow_type: taskType as WorkflowPlan['workflow_type'],
      plan_version: 'v1',
      owner_user_id: input.user_id,
      scope_type: 'private',
      goal: {
        user_goal: input.user_goal,
        success_definition: ['All markdown steps completed', 'Output delivered to user']
      },
      risk_level: input.risk_level || 'medium',
      policy_snapshot_hash: input.policy_snapshot_hash,
      retrieval_profile: 'balanced',
      budgets: { time_budget_sec: input.budget?.time_sec || 1800, retrieval_budget: input.budget?.retrieval || 20, execution_budget: input.budget?.execution || 120, repair_budget: 3 },
      stage_chain: stageChain,
      report_policy: { on_stage_complete: true, on_waiting_user: true, on_blocked: true, on_final: true },
      archive_policy: { archive_evidence: true, archive_artifacts: true, archive_checkpoints: true, retention_days: 90 },
      plan_hash: planHash
    };
  }

  private inferStageTypeFromStepName(stepName: string): Stage['stage_type'] {
    const lower = stepName.toLowerCase();
    if (lower.includes('clarif') || lower.includes('intent') || lower.includes('明确') || lower.includes('澄清')) return 'IntentClarification';
    if (lower.includes('retriev') || lower.includes('search') || lower.includes('检索') || lower.includes('查找')) return 'EvidenceRetrieval';
    if (lower.includes('memory') || lower.includes('recall') || lower.includes('回忆') || lower.includes('记忆')) return 'MemoryRetrieval';
    if (lower.includes('extract') || lower.includes('抽取') || lower.includes('提取')) return 'ObjectExtraction';
    if (lower.includes('plan') || lower.includes('规划') || lower.includes('计划')) return 'PlanGeneration';
    if (lower.includes('architect') || lower.includes('design') || lower.includes('架构') || lower.includes('设计')) return 'ArchitectureDesign';
    if (lower.includes('spec') || lower.includes('规格') || lower.includes('规范')) return 'SpecGeneration';
    if (lower.includes('decide') || lower.includes('decision') || lower.includes('决策') || lower.includes('决定')) return 'DecisionMaking';
    if (lower.includes('implement') || lower.includes('develop') || lower.includes('实现') || lower.includes('开发')) return 'Implementation';
    if (lower.includes('verif') || lower.includes('test') || lower.includes('验证') || lower.includes('测试')) return 'Verification';
    if (lower.includes('repair') || lower.includes('fix') || lower.includes('修复')) return 'Repair';
    if (lower.includes('approv') || lower.includes('审批') || lower.includes('批准')) return 'Approval';
    if (lower.includes('report') || lower.includes('result') || lower.includes('报告') || lower.includes('结果')) return 'ResultReporting';
    if (lower.includes('skill') || lower.includes('技能')) return 'SkillExtraction';
    if (lower.includes('summar') || lower.includes('dream') || lower.includes('总结') || lower.includes('摘要')) return 'DreamSummarization';
    if (lower.includes('archive') || lower.includes('归档') || lower.includes('存档')) return 'Archive';
    return 'DecisionMaking';
  }

  private inferExecutorFromStageType(stageType: Stage['stage_type']): Stage['assigned_executor'] {
    switch (stageType) {
      case 'EvidenceRetrieval':
      case 'MemoryRetrieval':
        return 'retrieval-aware-executor';
      case 'Implementation':
      case 'Repair':
        return 'code-executor';
      case 'Verification':
        return 'verification-executor';
      case 'Approval':
        return 'approval-executor';
      default:
        return 'generic-executor';
    }
  }

  private buildWorkflowPlan(input: PlannerInput, llmPlan: LiteLLMPlanResponse | null): WorkflowPlan {
    const taskType = input.task_type_hint || 'knowledge';
    const defaultStages = this.getDefaultStageChain(taskType, input.user_goal);

    let stageChain: Stage[];
    if (llmPlan?.stage_chain?.length) {
      stageChain = this.convertLLMStages(llmPlan.stage_chain, input);
    } else {
      stageChain = defaultStages;
    }

    const planHash = this.calculatePlanHash(input, stageChain);

    const workflowType = this.validateWorkflowType(llmPlan?.workflow_type) || taskType;
    const riskLevel = this.validateRiskLevel(llmPlan?.risk_level) || input.risk_level || 'medium';
    const retrievalProfile = this.validateRetrievalProfile(llmPlan?.retrieval_profile) || 'balanced';

    return {
      workflow_type: workflowType,
      plan_version: 'v1',
      owner_user_id: input.user_id,
      scope_type: 'private',
      risk_level: riskLevel,
      policy_snapshot_hash: input.policy_snapshot_hash,
      goal: {
        user_goal: input.user_goal,
        success_definition: ['Task completed successfully', 'Output delivered to user']
      },
      budgets: {
        time_budget_sec: input.budget?.time_sec || 3600,
        retrieval_budget: input.budget?.retrieval || 50,
        execution_budget: input.budget?.execution || 300,
        repair_budget: 5
      },
      retrieval_profile: retrievalProfile,
      stage_chain: stageChain,
      report_policy: {
        on_stage_complete: false,
        on_waiting_user: true,
        on_blocked: true,
        on_final: true
      },
      archive_policy: {
        archive_evidence: true,
        archive_artifacts: true,
        archive_checkpoints: false,
        retention_days: 90
      },
      plan_hash: planHash
    };
  }

  private getDefaultStageChain(taskType: string, userGoal: string): Stage[] {
    const sanitizedGoal = userGoal.slice(0, 120) || 'user request';
    const timestamp = Date.now();

    switch (taskType) {
      case 'development':
        return [
          this.createStage(`st_${timestamp}a`, 0, 'IntentClarification', `Clarify development intent: ${sanitizedGoal}`, 'generic-executor'),
          this.createStage(`st_${timestamp}b`, 1, 'PlanGeneration', 'Generate implementation plan', 'generic-executor'),
          this.createStage(`st_${timestamp}c`, 2, 'Implementation', 'Implement the solution', 'code-executor'),
          this.createStage(`st_${timestamp}d`, 3, 'Verification', 'Verify implementation', 'verification-executor'),
          this.createStage(`st_${timestamp}e`, 4, 'Approval', 'Approve implementation results', 'approval-executor'),
          this.createStage(`st_${timestamp}f`, 5, 'ResultReporting', 'Report results', 'generic-executor')
        ];
      case 'analysis':
        return [
          this.createStage(`st_${timestamp}a`, 0, 'IntentClarification', `Clarify analysis intent: ${sanitizedGoal}`, 'generic-executor'),
          this.createStage(`st_${timestamp}b`, 1, 'EvidenceRetrieval', 'Retrieve relevant data', 'retrieval-aware-executor'),
          this.createStage(`st_${timestamp}c`, 2, 'DecisionMaking', 'Analyze and decide', 'generic-executor'),
          this.createStage(`st_${timestamp}d`, 3, 'Approval', 'Approve analysis results', 'approval-executor'),
          this.createStage(`st_${timestamp}e`, 4, 'ResultReporting', 'Report analysis results', 'generic-executor')
        ];
      case 'sales':
        return [
          this.createStage(`st_${timestamp}a`, 0, 'IntentClarification', `Clarify sales request: ${sanitizedGoal}`, 'generic-executor'),
          this.createStage(`st_${timestamp}b`, 1, 'EvidenceRetrieval', 'Retrieve customer and market data', 'retrieval-aware-executor'),
          this.createStage(`st_${timestamp}c`, 2, 'DecisionMaking', 'Evaluate sales strategy', 'generic-executor'),
          this.createStage(`st_${timestamp}d`, 3, 'Approval', 'Approve sales proposal', 'approval-executor'),
          this.createStage(`st_${timestamp}e`, 4, 'ResultReporting', 'Deliver sales recommendation', 'generic-executor')
        ];
      case 'knowledge':
      default:
        return [
          this.createStage(`st_${timestamp}a`, 0, 'IntentClarification', `Clarify request: ${sanitizedGoal}`, 'generic-executor'),
          this.createStage(`st_${timestamp}b`, 1, 'Approval', 'Approve response', 'approval-executor'),
          this.createStage(`st_${timestamp}c`, 2, 'ResultReporting', 'Provide knowledge response', 'generic-executor')
        ];
    }
  }

  private createStage(stageId: string, seq: number, stageType: Stage['stage_type'], purpose: string, executor: Stage['assigned_executor']): Stage {
    return {
      stage_id: stageId,
      seq,
      stage_key: stageType.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      stage_type: stageType,
      assigned_executor: executor,
      purpose,
      inputs: { required_refs: [], optional_refs: [] },
      retrieval_plan: {
        enabled: stageType === 'EvidenceRetrieval' || stageType === 'MemoryRetrieval',
        intent_type: stageType === 'EvidenceRetrieval' ? 'evidence' : undefined,
        profiles: ['structured', 'fulltext'],
        max_candidates: 50,
        allow_graph: false,
        max_graph_hops: 0
      },
      acceptance: {
        must_have: ['non-empty output'],
        pass_rules: [],
        fail_rules: []
      },
      timeouts: {
        soft_timeout_sec: 180,
        hard_timeout_sec: 900
      },
      retry_policy: {
        max_retries: 1,
        max_repairs: stageType === 'Implementation' ? 5 : 0,
        retryable_errors: []
      },
      checkpoint_policy: {
        on_enter: true,
        on_progress: false,
        on_exit: true
      },
      on_success: seq < 4 ? 'next_stage' : 'succeeded',
      on_failure: 'repair_or_fail'
    };
  }

  private convertLLMStages(llmStages: LiteLLMPlanResponse['stage_chain'] | undefined, input: PlannerInput): Stage[] {
    if (!llmStages || llmStages.length === 0) {
      return [];
    }
    const stagesCount = llmStages.length;
    return llmStages.map((stage, index) => {
      const stageId = `st_${Date.now()}_${index}`;
      return {
        stage_id: stageId,
        seq: index,
        stage_key: (stage.stage_type || 'Generic').toLowerCase().replace(/[^a-z0-9]/g, '_'),
        stage_type: stage.stage_type as Stage['stage_type'] || 'IntentClarification',
        assigned_executor: stage.assigned_executor as Stage['assigned_executor'] || 'generic-executor',
        purpose: stage.purpose || input.user_goal.slice(0, 100),
        inputs: {
          required_refs: stage.inputs?.required_refs || [],
          optional_refs: []
        },
        retrieval_plan: {
          enabled: stage.retrieval_plan?.enabled || false,
          intent_type: stage.retrieval_plan?.intent_type as Stage['retrieval_plan']['intent_type'] || undefined,
          profiles: ['structured'],
          max_candidates: 50,
          allow_graph: false,
          max_graph_hops: 0
        },
        acceptance: {
          must_have: ['non-empty output'],
          pass_rules: [],
          fail_rules: []
        },
        timeouts: {
          soft_timeout_sec: stage.timeouts?.soft_timeout_sec || 180,
          hard_timeout_sec: stage.timeouts?.hard_timeout_sec || 900
        },
        retry_policy: {
          max_retries: 1,
          max_repairs: 0,
          retryable_errors: []
        },
        checkpoint_policy: {
          on_enter: true,
          on_progress: false,
          on_exit: true
        },
        on_success: index < stagesCount - 1 ? 'next_stage' : 'succeeded',
        on_failure: 'repair_or_fail'
      };
    });
  }

  private calculatePlanHash(input: PlannerInput, stages: Stage[]): string {
    const normalizedPlan = {
      owner_user_id: input.user_id,
      user_goal: input.user_goal,
      workflow_type: input.task_type_hint || 'knowledge',
      scope_type: 'private',
      risk_level: input.risk_level || 'medium',
      policy_snapshot_hash: input.policy_snapshot_hash,
      budgets: {
        time_budget_sec: input.budget?.time_sec || 3600,
        retrieval_budget: input.budget?.retrieval || 50,
        execution_budget: input.budget?.execution || 300,
      },
      stage_chain: stages.map(s => ({
        stage_type: s.stage_type,
        assigned_executor: s.assigned_executor,
        seq: s.seq,
      })),
    };
    const data = JSON.stringify(normalizedPlan);
    return `sha256:${createHash('sha256').update(data).digest('hex')}`;
  }

  private validateWorkflowType(type: string | undefined): WorkflowPlan['workflow_type'] | undefined {
    const validTypes: WorkflowPlan['workflow_type'][] = ['development', 'analysis', 'knowledge', 'sales', 'implementation'];
    if (type && validTypes.includes(type as WorkflowPlan['workflow_type'])) {
      return type as WorkflowPlan['workflow_type'];
    }
    return undefined;
  }

  private validateRiskLevel(level: string | undefined): WorkflowPlan['risk_level'] | undefined {
    const validLevels: WorkflowPlan['risk_level'][] = ['low', 'medium', 'high'];
    if (level && validLevels.includes(level as WorkflowPlan['risk_level'])) {
      return level as WorkflowPlan['risk_level'];
    }
    return undefined;
  }

  private validateRetrievalProfile(profile: string | undefined): WorkflowPlan['retrieval_profile'] | undefined {
    const validProfiles: WorkflowPlan['retrieval_profile'][] = ['precision-first', 'balanced', 'comprehensive'];
    if (profile && validProfiles.includes(profile as WorkflowPlan['retrieval_profile'])) {
      return profile as WorkflowPlan['retrieval_profile'];
    }
    return undefined;
  }
}

export const workflowPlanner = new WorkflowPlanner();
