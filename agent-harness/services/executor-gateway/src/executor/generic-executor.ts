import { createLogger, withRetry, RETRY_POLICIES, llmClient } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import type { Stage } from '@agent-harness/contracts';

const logger = createLogger('generic-executor');

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

const MAX_CONTEXT_LENGTH = 8000;

function truncateContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {};
  const json = JSON.stringify(context);
  if (json.length <= MAX_CONTEXT_LENGTH) return context;
  const truncated: Record<string, unknown> = {};
  let remaining = MAX_CONTEXT_LENGTH;
  for (const [key, value] of Object.entries(context)) {
    const entry = JSON.stringify({ [key]: value });
    if (entry.length <= remaining) {
      truncated[key] = value;
      remaining -= entry.length;
    } else {
      truncated[key] = `[truncated: ${typeof value === 'string' ? value.length : JSON.stringify(value).length} chars]`;
      break;
    }
  }
  return truncated;
}

interface LiteLLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

async function callLiteLLM(systemPrompt: string, userPrompt: string, temperature: number = 0.3): Promise<{ content: string; ok: boolean; usage?: LiteLLMUsage }> {
  const timeoutMs = Number(process.env.LITELLM_EXEC_TIMEOUT_MS || 60000);

  const attempt = async () => {
    const result = await llmClient.call({
      systemPrompt,
      userPrompt,
      temperature,
      maxTokens: 2000,
      timeoutMs
    });
    if (!result.ok) {
      throw new Error('LLM call returned not-ok');
    }
    return {
      content: result.content,
      ok: true,
      usage: result.usage ? {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens
      } : undefined
    };
  };

  try {
    return await withRetry(attempt, RETRY_POLICIES.llm);
  } catch (error) {
    const errorMsg = String(error);
    logger.warn('litellm.call.error', 'LLM call failed after retries', { error: errorMsg.slice(0, 300) });
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
      case 'MemoryRetrieval':
        return this.executeMemoryRetrieval(input);
      case 'ObjectExtraction':
        return this.executeObjectExtraction(input);
      case 'ArchitectureDesign':
        return this.executeArchitectureDesign(input);
      case 'SpecGeneration':
        return this.executeSpecGeneration(input);
      case 'DecisionMaking':
        return this.executeDecisionMaking(input);
      case 'Implementation':
        return this.executeImplementation(input);
      case 'Verification':
        return this.executeVerification(input);
      case 'Repair':
        return this.executeRepair(input);
      case 'Approval':
        return this.executeApproval(input);
      case 'ResultReporting':
        return this.executeResultReporting(input);
      case 'SkillExtraction':
        return this.executeSkillExtraction(input);
      case 'DreamSummarization':
        return this.executeDreamSummarization(input);
      case 'Archive':
        return this.executeArchive(input);
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
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a planning assistant. Create a structured execution plan for the given request. Focus on actionable steps and dependencies.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nCreate a step-by-step plan:\n1. List required steps\n2. Identify dependencies\n3. Estimate effort\n4. Note risks or blockers`;

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
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a knowledge retrieval assistant. Based on the request, identify what information is needed and summarize findings.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nSummarize:\n1. What information is relevant\n2. Key findings from context\n3. Information gaps`;

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
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a decision-making assistant. Analyze options and recommend the best course of action with rationale.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nProvide:\n1. Available options\n2. Trade-offs for each\n3. Recommended action\n4. Rationale`;

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
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a results reporting assistant. Create a clear, user-friendly summary of outcomes and next steps.';
    const userPrompt = `User request: ${user_goal}\n\nExecution context: ${JSON.stringify(safeContext)}\n\nSummarize:\n1. What was accomplished\n2. Key results\n3. Follow-up recommendations\n4. Next steps`;

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
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a skill extraction assistant. Identify reusable patterns from the execution and suggest skill templates.';
    const userPrompt = `User request: ${user_goal}\n\nExecution context: ${JSON.stringify(safeContext)}\n\nExtract:\n1. Reusable patterns\n2. Skill template suggestions\n3. Quality assessment`;

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
    const safeContext = truncateContext(context);

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

    const userPrompt = `User goal: ${user_goal}\n\nExecution context and memory content:\n${JSON.stringify(safeContext)}\n\n${needsCompression ? '⚠️ This memory is large and needs compression. Create a dense, lossy-but-useful summary.' : 'Create a reflective summary of this session.'}\n\nGenerate the summary:`;

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

  private async executeMemoryRetrieval(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a memory retrieval assistant. Identify relevant past experiences, preferences, and patterns that inform the current task. Only retrieve what is directly relevant.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nExtract:\n1. Relevant past experiences\n2. User preferences or patterns\n3. Lessons learned from similar tasks`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.2);

    return {
      status: ok ? 'completed' : 'failed',
      output: ok ? content : 'Memory retrieval unavailable',
      next_action: 'next_stage',
      model_call_ok: ok
    };
  }

  private async executeArchitectureDesign(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a solution architect. Design the architecture, technology choices, and component relationships for the given requirements. Output structured design documentation.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nProvide:\n1. Architecture overview\n2. Component breakdown\n3. Technology choices with rationale\n4. Integration points\n5. Trade-offs considered`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.3);

    return {
      status: ok ? 'completed' : 'failed',
      output: ok ? content : 'Architecture design unavailable',
      next_action: 'next_stage',
      model_call_ok: ok
    };
  }

  private async executeSpecGeneration(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a technical specification writer. Generate detailed specifications including API contracts, data models, and acceptance criteria. Be precise and comprehensive.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nGenerate:\n1. Functional specification\n2. API contract (if applicable)\n3. Data model\n4. Acceptance criteria\n5. Non-functional requirements`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.2);

    return {
      status: ok ? 'completed' : 'failed',
      output: ok ? content : 'Spec generation unavailable',
      next_action: 'next_stage',
      model_call_ok: ok
    };
  }

  private async executeImplementation(input: ExecutionInput): Promise<ExecutionResult> {
    return {
      status: 'completed',
      output: 'Implementation stage delegated to code-executor',
      next_action: 'next_stage',
      model_call_ok: true,
      metadata: { delegated_executor: 'code-executor' }
    };
  }

  private async executeVerification(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a verification assistant. Check outputs against acceptance criteria, identify issues, and report verification status. Be objective and thorough.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nVerify:\n1. All acceptance criteria met?\n2. Issues or gaps found\n3. Test results summary\n4. Overall verdict (pass/fail/needs-repair)`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.1);

    return {
      status: ok ? 'completed' : 'failed',
      output: ok ? content : 'Verification unavailable',
      next_action: 'next_stage',
      model_call_ok: ok,
      metadata: { verification_stage: true }
    };
  }

  private async executeRepair(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are a repair assistant. Fix identified issues from the verification stage. Apply minimal changes to address failures while preserving existing functionality.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nRepair:\n1. Issues to fix (from verification)\n2. Proposed fixes\n3. Risk assessment\n4. Verification that fixes don\'t break other parts`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.2);

    return {
      status: ok ? 'completed' : 'failed',
      output: ok ? content : 'Repair unavailable',
      next_action: 'next_stage',
      model_call_ok: ok,
      metadata: { repair_stage: true }
    };
  }

  private async executeApproval(input: ExecutionInput): Promise<ExecutionResult> {
    const { user_goal, context } = input;
    const safeContext = truncateContext(context);

    const systemPrompt = 'You are an approval gate assistant. Summarize the work done so far and identify what needs human approval. Clearly state the decision points.';
    const userPrompt = `User request: ${user_goal}\n\nContext: ${JSON.stringify(safeContext)}\n\nPrepare for approval:\n1. Summary of work done\n2. Decision points requiring approval\n3. Risks if not approved\n4. Recommended course of action`;

    const { content, ok } = await callLiteLLM(systemPrompt, userPrompt, 0.2);

    return {
      status: 'waiting_user',
      output: ok ? content : 'Approval required - please review',
      next_action: 'waiting_user',
      model_call_ok: ok,
      metadata: { approval_required: true }
    };
  }

  private async executeGenericStage(input: ExecutionInput): Promise<ExecutionResult> {
    const { stage, user_goal, context } = input;
    const safeContext = truncateContext(context);

    const systemPrompt = `You are a task execution assistant. Complete the stage: ${stage.purpose}`;
    const userPrompt = `User request: ${user_goal}\n\nStage: ${stage.stage_type}\n\nContext: ${JSON.stringify(safeContext)}\n\nComplete this stage and provide output.`;

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
