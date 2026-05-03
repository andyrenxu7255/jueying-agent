/**
 * Event Type Definitions
 * Reference: AH1-23 §23.4
 */

export const EventTypes = {
  // Identity Events
  IDENTITY_BOUND: 'identity.bound',
  IDENTITY_CONFLICT: 'identity.conflict',
  
  // Policy Events
  POLICY_SNAPSHOT_CREATED: 'policy.snapshot.created',
  POLICY_DENIED: 'policy.denied',
  
  // Workflow Events
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_PLANNED: 'workflow.planned',
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_STATE_CHANGED: 'workflow.state.changed',
  WORKFLOW_PAUSED: 'workflow.paused',
  WORKFLOW_RESUMED: 'workflow.resumed',
  WORKFLOW_CANCELLED: 'workflow.cancelled',
  WORKFLOW_SUCCEEDED: 'workflow.succeeded',
  WORKFLOW_FAILED: 'workflow.failed',
  WORKFLOW_ARCHIVED: 'workflow.archived',
  
  // Stage Events
  WORKFLOW_STAGE_STARTED: 'workflow.stage.started',
  WORKFLOW_STAGE_COMPLETED: 'workflow.stage.completed',
  WORKFLOW_STAGE_FAILED: 'workflow.stage.failed',
  
  // Checkpoint Events
  CHECKPOINT_CREATED: 'checkpoint.created',
  CHECKPOINT_RESUMED: 'checkpoint.resumed',
  CHECKPOINT_HASH_MISMATCH: 'checkpoint.hash.mismatch',
  
  // Retrieval Events
  RETRIEVAL_EXECUTED: 'retrieval.executed',
  RETRIEVAL_DEGRADED: 'retrieval.degraded',
  
  // Fact Events
  FACT_WRITTEN: 'fact.written',
  FACT_CONFLICT_DETECTED: 'fact.conflict.detected',
  
  // Artifact Events
  ARTIFACT_CREATED: 'artifact.created',
  
  // Code Executor Events
  CODE_SESSION_CREATED: 'code.session.created',
  CODE_VERIFICATION_COMPLETED: 'code.verification.completed',
  
  // Replay Events
  REPLAY_STARTED: 'replay.start',
  
  // Public Events
  PUBLIC_PUBLISH: 'public.publish',
  
  // Admin Events
  ADMIN_CROSS_USER_READ: 'admin.cross_user_read'
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];

export interface EventMetadata {
  event_id: string;
  trace_id: string;
  event_type: EventType;
  aggregate_type: string;
  aggregate_id: string;
  workflow_instance_id?: string;
  workflow_stage_id?: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}
