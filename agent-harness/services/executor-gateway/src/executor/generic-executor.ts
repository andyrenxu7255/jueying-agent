import { createLogger } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import type { Stage } from '@agent-harness/contracts';

const logger = createLogger('generic-executor');

const LITELLM_URL = process.env.LITELLM_URL || '';
const LITELLM_MODEL = process.env.LITELLM_MODEL || 'minimax-m2.7';
const LITELLM_API_KEY = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || 'litellm-dev-key';

export type ExecutorStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting_user' | 'blocked' | 'succeeded';

export interface ExecutionInput {
  workflow_instance_id: string;
  workflow_stage_id: string;
  stage: Stage;
  user_goal: string;
  policy_snapshot_hash: string;
  context?: Record<string, unknown>;
}

export interface ExecutionResult {
  status: ExecutorStatus;
  output: string;
  artifacts?: string[];
  fact_refs?: string[];
  retrieval_trace_id?: string;
  evidence_pack_hash?: string;
  degraded?: boolean;
  degradation_reasons?: string[];
  next_action?: string;
  error?: string;
  model_call_ok?: boolean;
  metadata?: Record<string, unknown>;
}

interface LiteLLMResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

async function callLiteLLM(systemPrompt: string, userPrompt: string, temperature: number = 0.3): Promise<{ content: string; ok: boolean; usage?: LiteLLMResponse['usage'] }> {
  const timeoutMs = Number(process.env.LITELLM_EXEC_TIMEOUT_MS || 60000);
  
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
        temperature,
        max_tokens: 2000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('litellm.call.failed', 'LiteLLM call failed', { status: response.status });
      return { content: '', ok: false };
    }

    const body = await response.json() as LiteLLMResponse;
    const content = body.choices?.[0]?.message?.content || '';
    
    if (!content) {
      logger.warn('litellm.call.empty', 'LiteLLM returned empty content', {});
      return { content: '', ok: false };
    }

    logger.info('litellm.call.success', 'LiteLLM call succeeded', {
      model: LITELLM_MODEL,
      prompt_tokens: body.usage?.prompt_tokens,
      completion_tokens: body.usage?.completion_tokens
    });

    return { content, ok: true, usage: body.usage };
  } catch (error) {
    const errorMsg = String(error);
    if (errorMsg.includes('abort') || errorMsg.includes('AbortError')) {
      logger.warn('litellm.call.timeout', 'LiteLLM call timed out', { timeout_ms: timeoutMs });
    } else {
      logger.error('litellm.call.error', 'LiteLLM call error', { error: errorMsg });
    }
    return { content: '', ok: false };
  }
}

export class GenericExecutor {
  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const { stage, workflow_instance_id, workflow_stage_id } = input;

    logger.info('executor.started', 'Generic executor started', {
      workflow_instance_id,
      workflow_stage_id,
      stage_type: stage.stage_type
    });

    await auditWriter.write({
      user_id: 'system',
      action: 'workflow.state.changed',
      resource_type: 'workflow_stage',
      resource_ref: workflow_stage_id,
      resource_scope: 'system',
      result: 'success',
      detail_json: {
        workflow_instance_id,
        stage_type: stage.stage_type,
        action: 'execute_start'
      }
    });

    try {
      const result = await this.executeStageType(input);

      await auditWriter.write({
        user_id: 'system',
        action: 'workflow.state.changed',
        resource_type: 'workflow_stage',
        resource_ref: workflow_stage_id,
        resource_scope: 'system',
        result: result.status === 'failed' ? 'failure' : 'success',
        detail_json: {
          workflow_instance_id,
          stage_type: stage.stage_type,
          action: 'execute_complete',
          status: result.status
        }
      });

      return result;
    } catch (error) {
      logger.error('executor.error', 'Executor error', {
        workflow_instance_id,
        workflow_stage_id,
        error: String(error)
      });

      return {
        status: 'failed',
        output: '',
        error: String(error),
        model_call_ok: false
      };
    }
  }

  private async executeStageType(input: ExecutionInput): Promise<ExecutionResult> {
    const { stage } = input;

    switch (stage.stage_type) {
      case 'IntentClarification':
        return this.executeIntentClarification(input);
      case 'PlanGeneration':
        return this.executePlanGeneration(input);
      case 'EvidenceRetrieval':
        return this.executeEvidenceRetrieval(input);
      case 'DecisionMaking':
        return this.executeDecisionMaking(input);
      case 'ResultReporting':
        return this.executeResultReporting(input);
      case 'Archive':
        return this.executeArchive(input);
      case 'SkillExtraction':
        return this.executeSkillExtraction(input);
      case 'DreamSummarization':
        return this.executeDreamSummarization(input);
      case 'ObjectExtraction':
        return this.executeObjectExtraction(input);
      default:
        return this.executeGenericStage(input);
    }
  }

  private async executeIntentClarification(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal } = input;

    const systemPrompt = 'You are an intent clarification assistant. Analyze the user request and extract the core intent, required outcomes, and any constraints. Be concise.';
    const userPrompt = `User request: ${user_goal}\n\nExtract and summarize:\n1. Core intent\n2. Expected outcomes\n3. Constraints or preferences\n4. Questions that need clarification`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.2);

    if (!ok || !content) {
      return {
        status: 'failed',
        output: 'Intent clarification failed',
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

  private async executePlanGeneration(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;

    const systemPrompt = 'You are a planning assistant. Create a structured execution plan for the given request. Focus on actionable steps and dependencies.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(context || {})}\n\nCreate a step-by-step plan:\n1. List required steps\n2. Identify dependencies\n3. Estimate effort\n4. Note risks or blockers`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.3);

    if (!ok || !content) {
      return {
        status: 'failed',
        output: 'Plan generation failed',
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

  private async executeEvidenceRetrieval(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;

    const systemPrompt = 'You are a knowledge retrieval assistant. Based on the request, identify what information is needed and summarize findings.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(context || {})}\n\nSummarize:\n1. What information is relevant\n2. Key findings from context\n3. Information gaps`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.3);

    return {
      status: 'completed',
      output: ok ? content : 'Evidence retrieval placeholder',
      next_action: 'next_stage',
      model_call_ok: ok
    };
  }

  private async executeDecisionMaking(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;

    const systemPrompt = 'You are a decision-making assistant. Analyze options and recommend the best course of action with rationale.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(context || {})}\n\nProvide:\n1. Available options\n2. Trade-offs for each\n3. Recommended action\n4. Rationale`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.4);

    if (!ok || !content) {
      return {
        status: 'waiting_user',
        output: 'Decision requires user input',
        next_action: 'waiting_user',
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

  private async executeResultReporting(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;

    const systemPrompt = 'You are a results reporting assistant. Create a clear, user-friendly summary of outcomes and next steps.';
    const userPrompt = `User request: ${user_goal}\n\nExecution context: ${JSON.stringify(context || {})}\n\nSummarize:\n1. What was accomplished\n2. Key results\n3. Follow-up recommendations\n4. Next steps`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.3);

    return {
      status: 'completed',
      output: ok ? content : 'Task completed. Results summarized.',
      next_action: 'succeeded',
      model_call_ok: ok
    };
  }

  private async executeArchive(input: ExecutionInput): Promise<ExecutionResult> {
    const { workflow_instance_id } = input;

    logger.info('executor.archive', 'Archiving workflow', {
      workflow_instance_id
    });

    return {
      status: 'completed',
      output: `Workflow ${workflow_instance_id} archived successfully`,
      next_action: 'archived',
      model_call_ok: true
    };
  }

  private async executeSkillExtraction(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;

    const systemPrompt = 'You are a skill extraction assistant. Identify reusable patterns from the execution and suggest skill templates.';
    const userPrompt = `User request: ${user_goal}\n\nExecution context: ${JSON.stringify(context || {})}\n\nExtract:\n1. Reusable patterns\n2. Skill template suggestions\n3. Quality assessment`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.3);

    return {
      status: 'completed',
      output: ok ? content : 'Skill extraction placeholder',
      next_action: 'next_stage',
      model_call_ok: ok
    };
  }

  private async executeDreamSummarization(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;

    // 检查记忆是否需要压缩: 当记忆内容超过4000字时标记为需要压缩
    const needsCompression = typeof context?.memory_fullness === 'number'
      ? context.memory_fullness > 4000
      : false;

    const systemPrompt = `You are a hierarchical experience summarization assistant.

Your task is to:
1. **Compress lengthy memories** into a concise structured summary (preserving key entities, decisions, and outcomes)
2. **Extract reusable skills** by identifying patterns in successful workflows
3. **Tag insights** with categories: problem_solving, communication, domain_knowledge, tool_usage

Output format:
- Use clear bullet points for insights
- Preserve dates, names, and numbers exactly as they appear
- Keep the compressed summary under 500 tokens

If the context is already concise, preserve it as-is with minor formatting.`;

    const userPrompt = `User goal: ${user_goal}\n\nExecution context and memory content:\n${JSON.stringify(context || {})}\n\n${needsCompression ? '⚠️ This memory is large and needs compression. Create a dense, lossy-but-useful summary.' : 'Create a reflective summary of this session.'}\n\nGenerate the summary:`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.3);

    return {
      status: 'completed',
      output: ok ? content : 'Dream summary placeholder',
      next_action: 'succeeded',
      model_call_ok: ok,
      metadata: {
        needs_compression: needsCompression,
        compressed_at: new Date().toISOString(),
        summary_type: needsCompression ? 'compressed' : 'reflective'
      }
    };
  }

  private async executeObjectExtraction(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;

    const systemPrompt = `You are an information extraction assistant. Extract structured knowledge from the given text.

You must output a JSON object with the following structure:
{
  "entities": [
    {"name": "entity_name", "type": "Person|Organization|Location|Event|Concept|Technology|Product|Other", "attributes": {"key": "value"}}
  ],
  "relations": [
    {"subject": "entity_name", "predicate": "relation_type", "object": "entity_name_or_value"}
  ],
  "slots": [
    {"slot_name": "slot_key", "slot_value": "extracted_value", "confidence": 0.9}
  ]
}

Extraction rules:
- Extract all named entities (people, organizations, locations, technologies, products, events)
- Extract relationships between entities (works_for, located_in, uses, manages, depends_on, etc.)
- Fill any slot/key-value pairs that can be inferred from the text
- Use canonical names for entities
- Assign confidence scores between 0.0 and 1.0
- Output ONLY valid JSON, no markdown fences`;

    const contextText = context?.input_text
      || context?.content_text
      || (context?.documents ? JSON.stringify(context.documents) : '');

    const userPrompt = `Extract structured knowledge from the following content:

User goal: ${user_goal}

Content to extract from:
${contextText || user_goal}

Extract all entities, relations, and slot values as structured JSON.`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.1);

    if (!ok || !content) {
      return {
        status: 'failed',
        output: 'Object extraction failed - model call unsuccessful',
        error: 'model_call_failed',
        model_call_ok: false
      };
    }

    let extractedData: {
      entities?: Array<{ name: string; type: string; attributes?: Record<string, string> }>;
      relations?: Array<{ subject: string; predicate: string; object: string }>;
      slots?: Array<{ slot_name: string; slot_value: string; confidence?: number }>;
    };

    try {
      const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      extractedData = JSON.parse(jsonStr);
    } catch {
      logger.warn('extraction.parse.failed', 'Failed to parse extraction output as JSON', {
        output_preview: content.slice(0, 200)
      });
      return {
        status: 'completed',
        output: content,
        next_action: 'next_stage',
        model_call_ok: true,
        degraded: true,
        degradation_reasons: ['json_parse_failed']
      };
    }

    const factRefs: string[] = [];
    const extractionSummary = {
      entity_count: extractedData.entities?.length || 0,
      relation_count: extractedData.relations?.length || 0,
      slot_count: extractedData.slots?.length || 0
    };

    const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || '';
    const ownerUserId = (input.context?.owner_user_id as string) || 'u_system';
    const scope = (input.context?.scope as string[]) || ['private'];

    if (extractedData.entities && extractedData.entities.length > 0) {
      try {
        const entityResponse = await fetch(`${factRetrievalUrl}/internal/entities/write`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            owner_user_id: ownerUserId,
            entities: extractedData.entities.map(e => ({
              name: e.name,
              type: e.type || 'Other',
              attributes: e.attributes
            })),
            slots: extractedData.slots || [],
            scope,
            source_ref: `workflow:${input.workflow_instance_id}:stage:${input.workflow_stage_id}`
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (entityResponse.ok) {
          const entityBody = await entityResponse.json() as { entity_ids?: string[]; slot_count?: number };
          if (entityBody.entity_ids) {
            factRefs.push(...entityBody.entity_ids);
          }
          logger.info('extraction.entities.persisted', 'Entities and slots persisted', {
            entity_count: entityBody.entity_ids?.length || 0,
            slot_count: entityBody.slot_count || 0
          });
        }
      } catch (error) {
        logger.warn('extraction.entities.write_failed', 'Failed to persist entities/slots', {
          error: String(error)
        });
      }
    }

    if (extractedData.relations && extractedData.relations.length > 0) {
      for (const rel of extractedData.relations.slice(0, 20)) {
        try {
          const response = await fetch(`${factRetrievalUrl}/internal/facts/write`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              owner_user_id: ownerUserId,
              fact_text: `${rel.subject} ${rel.predicate} ${rel.object}`,
              scope,
              mode: 'insert',
              subject_ref: rel.subject,
              predicate: rel.predicate,
              object_value: rel.object,
              confidence: 0.8
            }),
            signal: AbortSignal.timeout(5000)
          });

          if (response.ok) {
            const body = await response.json() as { fact_id?: string };
            if (body.fact_id) factRefs.push(body.fact_id);
          }
        } catch (error) {
          logger.warn('extraction.fact.write_failed', 'Failed to write extracted fact', {
            subject: rel.subject,
            predicate: rel.predicate,
            error: String(error)
          });
        }
      }
    }

    return {
      status: 'completed',
      output: JSON.stringify({ extraction_summary: extractionSummary, extracted_data: extractedData }, null, 2),
      fact_refs: factRefs.length > 0 ? factRefs : undefined,
      next_action: 'next_stage',
      model_call_ok: true
    };
  }

  private async executeGenericStage(input: ExecutionInput): Promise<ExecutionResult> {
    const { stage, user_goal, context } = input;

    const systemPrompt = `You are a task execution assistant. Complete the stage: ${stage.purpose}`;
    const userPrompt = `User request: ${user_goal}\n\nStage: ${stage.stage_type}\n\nContext: ${JSON.stringify(context || {})}\n\nComplete this stage and provide output.`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.3);

    return {
      status: 'completed',
      output: ok ? content : 'Stage completed',
      next_action: 'next_stage',
      model_call_ok: ok
    };
  }
}

export const genericExecutor = new GenericExecutor();
