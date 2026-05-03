import { createLogger } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import type { ExecutionInput, ExecutionResult } from './generic-executor';

const logger = createLogger('retrieval-aware-executor');
const factRetrievalUrl = process.env.FACT_RETRIEVAL_URL || '';

function inferIntentType(input: ExecutionInput): 'object-status' | 'evidence' | 'relation' | 'similar-case' | 'dev-context' | 'memory-hint' {
  if (input.stage.stage_type === 'EvidenceRetrieval') {
    return 'evidence';
  }
  const text = input.user_goal.toLowerCase();
  if (text.includes('relation') || text.includes('connect') || text.includes('link')) {
    return 'relation';
  }
  if (text.includes('similar') || text.includes('case')) {
    return 'similar-case';
  }
  if (text.includes('context') || text.includes('code')) {
    return 'dev-context';
  }
  if (text.includes('memory') || text.includes('remember') || text.includes('recall')) {
    return 'memory-hint';
  }
  return 'object-status';
}

export class RetrievalAwareExecutor {
  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const ownerUserId = typeof input.context?.owner_user_id === 'string' ? input.context.owner_user_id : 'u_default';
    const allowedScopes = Array.isArray(input.context?.allowed_scopes)
      ? input.context.allowed_scopes.map((item) => String(item))
      : [`private:${ownerUserId}`, 'public:workflow', 'public:skill'];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(`${factRetrievalUrl}/internal/retrieval/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner_user_id: ownerUserId,
          query_text: input.user_goal,
          intent_type: inferIntentType(input),
          allowed_scopes: allowedScopes,
          workflow_instance_id: input.workflow_instance_id,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const body = await response.json() as {
        ok?: boolean;
        degraded?: boolean;
        degradation_reasons?: string[];
        evidence_pack?: {
          items?: Array<{ item_type: string; item_ref: string; score: number; source_scope: string }>;
          evidence_pack_hash?: string;
        };
        retrieval_trace_id?: string;
      };

      if (!response.ok || !body.ok || !body.evidence_pack) {
        const detailedError = !response.ok
          ? `retrieval_query_http_${response.status}`
          : body.degradation_reasons?.[0] || 'retrieval_query_failed';
        return {
          status: 'failed',
          output: '',
          error: detailedError,
          model_call_ok: false,
        };
      }

      const items = body.evidence_pack.items || [];
      const output = items.length === 0
        ? 'No retrieval evidence found within allowed scopes.'
        : items
          .slice(0, 5)
          .map((item, index) => `${index + 1}. ${item.item_type} ${item.item_ref} score=${item.score} scope=${item.source_scope}`)
          .join('\n');

      await auditWriter.write({
        user_id: ownerUserId,
        action: 'workflow.state.changed',
        resource_type: 'workflow_stage',
        resource_ref: input.workflow_stage_id,
        resource_scope: 'system',
        result: 'success',
        detail_json: {
          workflow_instance_id: input.workflow_instance_id,
          retrieval_trace_id: body.retrieval_trace_id,
          evidence_pack_hash: body.evidence_pack.evidence_pack_hash,
          item_count: items.length,
          degraded: body.degraded || false,
          degradation_reasons: body.degradation_reasons || [],
        },
      });

      logger.info('retrieval.execute.completed', 'Retrieval-aware execution completed', {
        workflow_instance_id: input.workflow_instance_id,
        workflow_stage_id: input.workflow_stage_id,
        item_count: items.length,
        degraded: body.degraded || false,
      });

      return {
        status: 'completed',
        output,
        next_action: 'next_stage',
        fact_refs: items.filter((item) => item.item_type === 'fact').map((item) => item.item_ref),
        retrieval_trace_id: body.retrieval_trace_id,
        evidence_pack_hash: body.evidence_pack.evidence_pack_hash,
        degraded: body.degraded || false,
        degradation_reasons: body.degradation_reasons || [],
        model_call_ok: true,
      };
    } catch (error) {
      logger.error('retrieval.execute.failed', 'Retrieval-aware execution failed', {
        workflow_instance_id: input.workflow_instance_id,
        workflow_stage_id: input.workflow_stage_id,
        error: String(error),
      });

      return {
        status: 'failed',
        output: '',
        error: String(error),
        model_call_ok: false,
      };
    }
  }
}

export const retrievalAwareExecutor = new RetrievalAwareExecutor();
