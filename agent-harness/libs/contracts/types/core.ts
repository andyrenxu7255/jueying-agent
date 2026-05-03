/**
 * Core Type Definitions
 * Reference: AH1-14, AH1-15, AH1-16, AH1-17
 */

// User Types
export interface User {
  id: string;
  org_id: string;
  username: string;
  display_name?: string;
  role: 'user' | 'admin';
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Channel Identity Types
export interface ChannelIdentity {
  id: string;
  user_id: string;
  channel_type: 'wecom' | 'feishu' | 'web_portal' | 'system';
  external_identity: string;
  binding_status: 'pending' | 'bound' | 'disabled' | 'conflicted';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Policy Snapshot Types
export interface PolicySnapshot {
  id: string;
  user_id: string;
  role: string;
  acting_subject: string;
  allowed_scopes: string[];
  resource_rules: Record<string, string[]>;
  constraints: {
    max_graph_hops: number;
    allow_cross_user_read: boolean;
    allow_public_publish: boolean;
  };
  snapshot_hash: string;
  created_at: string;
}

// Workflow Types
export type WorkflowStatus = 
  | 'draft' 
  | 'planned' 
  | 'running' 
  | 'verifying' 
  | 'repairing' 
  | 'reporting' 
  | 'waiting_user' 
  | 'blocked' 
  | 'paused' 
  | 'succeeded' 
  | 'failed' 
  | 'cancelled' 
  | 'archived';

export type StageType =
  | 'IntentClarification'
  | 'PlanGeneration'
  | 'EvidenceRetrieval'
  | 'MemoryRetrieval'
  | 'ObjectExtraction'
  | 'ArchitectureDesign'
  | 'SpecGeneration'
  | 'DecisionMaking'
  | 'Implementation'
  | 'Verification'
  | 'Repair'
  | 'Approval'
  | 'ResultReporting'
  | 'SkillExtraction'
  | 'DreamSummarization'
  | 'Archive';

export type ExecutorType =
  | 'generic-executor'
  | 'retrieval-aware-executor'
  | 'code-executor'
  | 'verification-executor'
  | 'repair-executor'
  | 'approval-executor'
  | 'human-gateway'
  | 'system';

// Checkpoint Types
export interface Checkpoint {
  id: string;
  workflow_instance_id: string;
  workflow_stage_id: string;
  checkpoint_type: 'stage-enter' | 'stage-exit' | 'waiting-user' | 'blocked' | 'paused' | 'repair';
  resume_token: string;
  state_hash: string;
  policy_snapshot_hash: string;
  status_snapshot: Record<string, unknown>;
  artifact_refs: string[];
  fact_write_refs: string[];
  verification_refs: string[];
  evidence_pack_hash: string;
  tool_call_refs: string[];
  next_action: string;
  created_at: string;
}

// Audit Event Types
export interface AuditEvent {
  id: string;
  user_id: string;
  workflow_instance_id?: string;
  action: string;
  resource_type: string;
  resource_ref: string;
  resource_scope: string;
  result: 'success' | 'failure';
  detail_json: Record<string, unknown>;
  occurred_at: string;
}
