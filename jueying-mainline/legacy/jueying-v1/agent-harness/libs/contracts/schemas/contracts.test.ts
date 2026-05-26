import { ErrorCodes } from '../errors/codes';
import { EventTypes } from '../events/types';
import { EventEnvelopeSchema, RequestEnvelopeSchema, ResponseEnvelopeSchema } from './envelope';
import { EvidencePackSchema } from './evidence';
import { StageSchema, WorkflowPlanSchema } from './workflow';
import { createDefaultStage } from '../src/stage-defaults';

const hash = `sha256:${'a'.repeat(64)}`;

describe('contract schemas', () => {
  it('validates request, response, and event envelopes', () => {
    expect(RequestEnvelopeSchema.parse({
      request_id: 'req_abc123',
      trace_id: 'tr_abc123',
      actor: { actor_type: 'user', actor_id: 'u_demo', channel_type: 'web_portal' },
      policy_snapshot_hash: hash,
      idempotency_key: 'idem_abc123',
      payload: { text: 'hello' },
    }).request_id).toBe('req_abc123');

    expect(ResponseEnvelopeSchema.parse({
      request_id: 'req_abc123',
      trace_id: 'tr_abc123',
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'bad', retryable: false },
      payload: {},
      meta: { duration_ms: 10, provider: 'test' },
    }).error?.retryable).toBe(false);

    expect(EventEnvelopeSchema.parse({
      event_id: 'evt_abc123',
      trace_id: 'tr_abc123',
      event_type: 'workflow.created',
      aggregate_type: 'workflow',
      aggregate_id: 'wf_abc123',
      occurred_at: new Date().toISOString(),
      payload: {},
    }).aggregate_type).toBe('workflow');
  });

  it('rejects malformed IDs and invalid workflow stages', () => {
    expect(() => RequestEnvelopeSchema.parse({
      request_id: 'bad',
      trace_id: 'tr_abc123',
      actor: { actor_type: 'user', actor_id: 'u_demo' },
      policy_snapshot_hash: null,
      idempotency_key: 'idem_abc123',
      payload: {},
    })).toThrow();

    expect(() => StageSchema.parse({ stage_id: 'bad' })).toThrow();
  });

  it('validates workflow plans and evidence packs', () => {
    const stage = createDefaultStage('st_demo_stage', 'Write a report');
    const plan = {
      workflow_type: 'analysis',
      plan_version: 'v1',
      owner_user_id: 'u_demo',
      scope_type: 'private',
      risk_level: 'medium',
      policy_snapshot_hash: hash,
      goal: { user_goal: 'Write a report', success_definition: ['Report delivered'] },
      budgets: { time_budget_sec: 600, retrieval_budget: 5, execution_budget: 5, repair_budget: 1 },
      retrieval_profile: 'balanced',
      stage_chain: [stage],
      report_policy: { on_stage_complete: true, on_waiting_user: true, on_final: true },
      archive_policy: { archive_evidence: true, archive_artifacts: true, retention_days: 30 },
      plan_hash: hash,
    };
    expect(WorkflowPlanSchema.parse(plan).stage_chain[0].on_success).toBe('next_stage');

    expect(EvidencePackSchema.parse({
      evidence_pack_id: 'ep_demo',
      query_text: 'MEDDIC',
      intent_type: 'evidence',
      scope_summary: { user_id: 'u_demo', allowed_scopes: ['private:u_demo'] },
      retrieval_steps: [{ type: 'wide_candidate', ref: 'trace-1', candidates_count: 1, duration_ms: 3 }],
      items: [],
      clip_summary: 'none',
      evidence_pack_hash: hash,
    }).items).toEqual([]);
  });

  it('exports canonical error and event names', () => {
    expect(ErrorCodes.POLICY_DENIED).toBeDefined();
    expect(EventTypes.WORKFLOW_CREATED).toBe('workflow.created');
  });
});
