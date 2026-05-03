import { z } from 'zod';

/**
 * Request/Response/Event Envelope Schemas
 * Reference: AH1-15 §15.2
 */

// Request Envelope
export const RequestEnvelopeSchema = z.object({
  request_id: z.string().regex(/^req_[a-z0-9]+$/),
  trace_id: z.string().regex(/^tr_[a-z0-9]+$/),
  actor: z.object({
    actor_type: z.enum(['user', 'system']),
    actor_id: z.string(),
    channel_type: z.enum(['wecom', 'feishu', 'web_portal']).optional()
  }),
  workflow_instance_id: z.string().regex(/^wf_[a-z0-9]+$/).optional(),
  workflow_stage_id: z.string().regex(/^st_[a-z0-9]+$/).optional(),
  policy_snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  idempotency_key: z.string().regex(/^idem_[a-z0-9]+$/),
  payload: z.record(z.unknown())
});

// Response Envelope
export const ResponseEnvelopeSchema = z.object({
  request_id: z.string().regex(/^req_[a-z0-9]+$/),
  trace_id: z.string().regex(/^tr_[a-z0-9]+$/),
  ok: z.boolean(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    detail: z.record(z.unknown()).optional()
  }).nullable(),
  payload: z.record(z.unknown()),
  meta: z.object({
    duration_ms: z.number().int(),
    provider: z.string().optional()
  })
});

// Event Envelope
export const EventEnvelopeSchema = z.object({
  event_id: z.string().regex(/^evt_[a-z0-9]+$/),
  trace_id: z.string().regex(/^tr_[a-z0-9]+$/),
  event_type: z.string(),
  aggregate_type: z.string(),
  aggregate_id: z.string(),
  workflow_instance_id: z.string().regex(/^wf_[a-z0-9]+$/).optional(),
  workflow_stage_id: z.string().regex(/^st_[a-z0-9]+$/).optional(),
  occurred_at: z.string().datetime(),
  payload: z.record(z.unknown())
});

export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
