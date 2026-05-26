import type { Pool } from 'pg';
import { createLogger } from '../logging/logger';

const logger = createLogger('attribution-ledger');

type AttributionPool = Pick<Pool, 'query'>;

export interface HookEventInput {
  orgId?: string | null;
  ownerUserId?: string | null;
  sessionId?: string | null;
  workflowInstanceId?: string | null;
  workflowStageId?: string | null;
  eventName: string;
  eventSource: string;
  eventPhase: 'pre' | 'post' | 'final' | 'async';
  resourceType?: string | null;
  resourceRef?: string | null;
  result?: 'observed' | 'allowed' | 'blocked' | 'success' | 'failure' | 'degraded';
  latencyMs?: number | null;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeRecallInput {
  orgId?: string | null;
  ownerUserId?: string | null;
  sessionId?: string | null;
  workflowInstanceId?: string | null;
  workflowStageId?: string | null;
  recallSource: 'memory' | 'fact' | 'document_chunk' | 'org_memory' | 'hermes_memory';
  itemRef: string;
  queryText?: string | null;
  retrievalTraceId?: string | null;
  evidencePackHash?: string | null;
  score?: number | null;
  injected?: boolean;
  injectionRef?: string | null;
  sourceScope?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SkillRecallInput {
  orgId?: string | null;
  ownerUserId?: string | null;
  sessionId?: string | null;
  workflowInstanceId?: string | null;
  workflowStageId?: string | null;
  skillId: string;
  versionId?: string | null;
  queryText?: string | null;
  recallReason?: string | null;
  score?: number | null;
  injected?: boolean;
  injectionRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface WorkflowOutcomeInput {
  workflowInstanceId: string;
  orgId?: string | null;
  ownerUserId?: string | null;
  outcomeStatus: 'succeeded' | 'failed' | 'cancelled' | 'partial';
  businessScore: number;
  userFeedbackScore?: number | null;
  durationMs?: number | null;
  successCriteria?: Record<string, unknown>;
  graderVersion?: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

function normalizeUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function metadataJson(metadata: Record<string, unknown> | undefined): string {
  return JSON.stringify(metadata || {});
}

function clampScore(value: number | null | undefined, min = 0, max = 100): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(min, Math.min(max, value));
}

export async function recordHookEvent(pool: AttributionPool | null | undefined, input: HookEventInput): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO hook_event_log (
        org_id, owner_user_id, session_id, workflow_instance_id, workflow_stage_id,
        event_name, event_source, event_phase, resource_type, resource_ref, result, latency_ms, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        normalizeUuid(input.orgId),
        normalizeUuid(input.ownerUserId),
        input.sessionId || null,
        normalizeUuid(input.workflowInstanceId),
        normalizeUuid(input.workflowStageId),
        input.eventName,
        input.eventSource,
        input.eventPhase,
        input.resourceType || null,
        input.resourceRef || null,
        input.result || 'observed',
        input.latencyMs ?? null,
        metadataJson(input.metadata)
      ]
    );
  } catch (error) {
    logger.warn('hook_event.write_failed', 'Failed to write hook event', { event_name: input.eventName, error: String(error) });
  }
}

export async function recordKnowledgeRecall(pool: AttributionPool | null | undefined, input: KnowledgeRecallInput): Promise<void> {
  if (!pool || !input.itemRef) return;
  try {
    await pool.query(
      `INSERT INTO knowledge_recall_event (
        org_id, owner_user_id, session_id, workflow_instance_id, workflow_stage_id,
        recall_source, item_ref, query_text, retrieval_trace_id, evidence_pack_hash,
        score, injected, injection_ref, source_scope, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [
        normalizeUuid(input.orgId),
        normalizeUuid(input.ownerUserId),
        input.sessionId || null,
        normalizeUuid(input.workflowInstanceId),
        normalizeUuid(input.workflowStageId),
        input.recallSource,
        input.itemRef,
        input.queryText || null,
        input.retrievalTraceId || null,
        input.evidencePackHash || null,
        clampScore(input.score, 0, 1),
        input.injected === true,
        input.injectionRef || null,
        input.sourceScope || null,
        metadataJson(input.metadata)
      ]
    );
  } catch (error) {
    logger.warn('knowledge_recall.write_failed', 'Failed to write knowledge recall event', { item_ref: input.itemRef, error: String(error) });
  }
}

export async function recordSkillRecall(pool: AttributionPool | null | undefined, input: SkillRecallInput): Promise<void> {
  if (!pool || !input.skillId) return;
  try {
    await pool.query(
      `INSERT INTO skill_recall_event (
        org_id, owner_user_id, session_id, workflow_instance_id, workflow_stage_id,
        skill_id, version_id, query_text, recall_reason, score, injected, injection_ref, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        normalizeUuid(input.orgId),
        normalizeUuid(input.ownerUserId),
        input.sessionId || null,
        normalizeUuid(input.workflowInstanceId),
        normalizeUuid(input.workflowStageId),
        normalizeUuid(input.skillId),
        normalizeUuid(input.versionId),
        input.queryText || null,
        input.recallReason || null,
        clampScore(input.score, 0, 1),
        input.injected === true,
        input.injectionRef || null,
        metadataJson(input.metadata)
      ]
    );
  } catch (error) {
    logger.warn('skill_recall.write_failed', 'Failed to write skill recall event', { skill_id: input.skillId, error: String(error) });
  }
}

export async function recordWorkflowOutcome(pool: AttributionPool | null | undefined, input: WorkflowOutcomeInput): Promise<string | null> {
  if (!pool) return null;
  const workflowUuid = normalizeUuid(input.workflowInstanceId);
  if (!workflowUuid) {
    logger.warn('workflow_outcome.invalid_workflow_id', 'Skipping workflow outcome with non-uuid workflow id', { workflow_instance_id: input.workflowInstanceId });
    return null;
  }
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO workflow_outcome_eval (
        workflow_instance_id, org_id, owner_user_id, outcome_status, business_score,
        user_feedback_score, duration_ms, success_criteria, grader_version, summary, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)
      ON CONFLICT (workflow_instance_id) DO UPDATE SET
        outcome_status = EXCLUDED.outcome_status,
        business_score = EXCLUDED.business_score,
        user_feedback_score = EXCLUDED.user_feedback_score,
        duration_ms = EXCLUDED.duration_ms,
        success_criteria = EXCLUDED.success_criteria,
        grader_version = EXCLUDED.grader_version,
        summary = EXCLUDED.summary,
        metadata = EXCLUDED.metadata
      RETURNING id`,
      [
        workflowUuid,
        normalizeUuid(input.orgId),
        normalizeUuid(input.ownerUserId),
        input.outcomeStatus,
        clampScore(input.businessScore) ?? 0,
        clampScore(input.userFeedbackScore, 0, 5),
        input.durationMs ?? null,
        metadataJson(input.successCriteria),
        input.graderVersion || 'heuristic.v1',
        input.summary || null,
        metadataJson(input.metadata)
      ]
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    logger.warn('workflow_outcome.write_failed', 'Failed to write workflow outcome', { workflow_instance_id: input.workflowInstanceId, error: String(error) });
    return null;
  }
}

export async function attributeWorkflowOutcome(pool: AttributionPool | null | undefined, workflowInstanceId: string, outcomeEvalId: string): Promise<void> {
  if (!pool || !outcomeEvalId) return;
  const workflowUuid = normalizeUuid(workflowInstanceId);
  if (!workflowUuid) return;

  try {
    await pool.query(
      `INSERT INTO recall_outcome_attribution (
        outcome_eval_id, workflow_instance_id, attribution_type, source_event_id,
        resource_type, resource_ref, contribution_score, contribution_reason, metadata
      )
      SELECT $2::uuid, workflow_instance_id, 'knowledge', id, recall_source, item_ref,
             CASE WHEN injected THEN 70 ELSE 40 END,
             CASE WHEN injected THEN 'recalled_and_injected_before_outcome' ELSE 'recalled_before_outcome' END,
             jsonb_build_object('score', score, 'retrieval_trace_id', retrieval_trace_id)
      FROM knowledge_recall_event
      WHERE workflow_instance_id = $1::uuid
      ON CONFLICT (outcome_eval_id, attribution_type, source_event_id) DO NOTHING`,
      [workflowUuid, outcomeEvalId]
    );

    await pool.query(
      `INSERT INTO recall_outcome_attribution (
        outcome_eval_id, workflow_instance_id, attribution_type, source_event_id,
        resource_type, resource_ref, contribution_score, contribution_reason, metadata
      )
      SELECT $2::uuid, workflow_instance_id, 'skill', id, 'skill', skill_id::text,
             CASE WHEN injected THEN 80 ELSE 45 END,
             CASE WHEN injected THEN 'skill_recalled_and_injected_before_outcome' ELSE 'skill_recalled_before_outcome' END,
             jsonb_build_object('score', score, 'version_id', version_id)
      FROM skill_recall_event
      WHERE workflow_instance_id = $1::uuid
      ON CONFLICT (outcome_eval_id, attribution_type, source_event_id) DO NOTHING`,
      [workflowUuid, outcomeEvalId]
    );
  } catch (error) {
    logger.warn('outcome_attribution.write_failed', 'Failed to attribute workflow outcome', { workflow_instance_id: workflowInstanceId, error: String(error) });
  }
}
