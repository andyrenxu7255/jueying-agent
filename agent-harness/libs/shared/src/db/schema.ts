import { customType, index, integer, jsonb, pgTable, text, timestamp, uuid, boolean, bigint, real, uniqueIndex } from 'drizzle-orm/pg-core';

const vector1536 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'vector(1536)';
  },
});

const tsvectorType = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'tsvector';
  },
});

export const channelIdentities = pgTable('channel_identity', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelType: text('channel_type').notNull(),
  externalIdentity: text('external_identity').notNull(),
  userId: uuid('user_id').notNull(),
  orgId: uuid('org_id'),
  bindingStatus: text('binding_status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  channelIdentityUnique: uniqueIndex('idx_channel_identity_unique').on(table.channelType, table.externalIdentity),
  orgIdx: index('idx_channel_identity_org').on(table.orgId),
}));

export const policySnapshots = pgTable('policy_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  orgId: uuid('org_id'),
  snapshotHash: text('snapshot_hash').notNull(),
  allowedScopes: jsonb('allowed_scopes').notNull(),
  resourceRules: jsonb('resource_rules').notNull(),
  constraints: jsonb('constraints').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hashUnique: uniqueIndex('idx_policy_snapshot_hash').on(table.snapshotHash),
  orgIdx: index('idx_policy_snapshot_org').on(table.orgId),
}));

export const workflowDefinitions = pgTable('workflow_definition', {
  id: uuid('id').primaryKey().defaultRandom(),
  scopeType: text('scope_type').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  name: text('name').notNull(),
  workflowType: text('workflow_type').notNull(),
  riskLevel: text('risk_level').notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull().default(1),
  definitionJson: jsonb('definition_json').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  scopeOwnerIdx: index('idx_workflow_definition_scope_owner').on(table.scopeType, table.ownerUserId),
  typeStatusIdx: index('idx_workflow_definition_type_status').on(table.workflowType, table.status),
  orgIdx: index('idx_workflow_definition_org').on(table.orgId),
}));

export const workflowInstances = pgTable('workflow_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowDefinitionId: uuid('workflow_definition_id'),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  status: text('status').notNull(),
  workflowPlanHash: text('workflow_plan_hash').notNull(),
  policySnapshotId: uuid('policy_snapshot_id').notNull(),
  budgetJson: jsonb('budget_json').notNull(),
  inputSummary: jsonb('input_summary').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerStatusIdx: index('idx_workflow_instance_owner_status').on(table.ownerUserId, table.status),
  scopeStatusIdx: index('idx_workflow_instance_scope_status').on(table.scopeType, table.status),
  orgIdx: index('idx_workflow_instance_org').on(table.orgId),
}));

export const workflowStages = pgTable('workflow_stage', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id').notNull(),
  stageKey: text('stage_key').notNull(),
  stageType: text('stage_type').notNull(),
  seq: integer('seq').notNull(),
  assignedExecutor: text('assigned_executor').notNull(),
  status: text('status').notNull(),
  inputRefs: jsonb('input_refs').notNull(),
  outputRefs: jsonb('output_refs').notNull(),
  stageInputHash: text('stage_input_hash'),
  stageOutputHash: text('stage_output_hash'),
  toolCallRefs: jsonb('tool_call_refs').notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull(),
  factWriteRefs: jsonb('fact_write_refs').notNull(),
  verificationRefs: jsonb('verification_refs').notNull(),
  acceptanceResult: jsonb('acceptance_result').notNull(),
  checkpointId: uuid('checkpoint_id'),
  nextAction: text('next_action'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  instanceStatusIdx: index('idx_workflow_stage_instance_status').on(table.workflowInstanceId, table.status),
  executorStatusIdx: index('idx_workflow_stage_executor_status').on(table.assignedExecutor, table.status),
}));

export const checkpoints = pgTable('checkpoint', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id').notNull(),
  workflowStageId: uuid('workflow_stage_id').notNull(),
  orgId: uuid('org_id'),
  checkpointType: text('checkpoint_type').notNull(),
  resumeToken: text('resume_token').notNull(),
  stateHash: text('state_hash').notNull(),
  policySnapshotHash: text('policy_snapshot_hash').notNull(),
  statusSnapshot: jsonb('status_snapshot').notNull(),
  artifactRefs: jsonb('artifact_refs').notNull(),
  factWriteRefs: jsonb('fact_write_refs').notNull(),
  verificationRefs: jsonb('verification_refs').notNull(),
  evidencePackHash: text('evidence_pack_hash'),
  toolCallRefs: jsonb('tool_call_refs').notNull(),
  notes: text('notes'),
  nextAction: text('next_action'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  resumeTokenUnique: uniqueIndex('idx_checkpoint_resume_token').on(table.resumeToken),
  workflowStageIdx: index('idx_checkpoint_workflow_stage').on(table.workflowInstanceId, table.workflowStageId),
  orgIdx: index('idx_checkpoint_org').on(table.orgId),
}));

export const workflowEvents = pgTable('workflow_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id').notNull(),
  workflowStageId: uuid('workflow_stage_id'),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  eventPayload: jsonb('event_payload').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  instanceTimeIdx: index('idx_workflow_event_instance_time').on(table.workflowInstanceId, table.occurredAt),
}));

export const executionSessions = pgTable('execution_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id').notNull(),
  workflowStageId: uuid('workflow_stage_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  status: text('status').notNull(),
  repoRef: text('repo_ref'),
  branchRef: text('branch_ref'),
  worktreeRef: text('worktree_ref'),
  baseCommitHash: text('base_commit_hash'),
  stageGoal: text('stage_goal'),
  budgetJson: jsonb('budget_json').notNull(),
  acceptanceRules: jsonb('acceptance_rules').notNull(),
  backendType: text('backend_type').notNull(),
  policySnapshotHash: text('policy_snapshot_hash').notNull(),
  checkpointId: uuid('checkpoint_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  stageIdx: index('idx_execution_session_stage').on(table.workflowStageId),
  statusIdx: index('idx_execution_session_status').on(table.status),
}));

export const memoryItems = pgTable('memory_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  memoryType: text('memory_type').notNull(),
  contentText: text('content_text').notNull(),
  summary: text('summary'),
  embedding: vector1536('embedding'),
  embeddingModelVersion: text('embedding_model_version'),
  confidence: real('confidence').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerScopeIdx: index('idx_memory_item_owner_scope').on(table.ownerUserId, table.scopeType),
  typeStatusIdx: index('idx_memory_item_type_status').on(table.memoryType, table.status),
  orgIdx: index('idx_memory_item_org').on(table.orgId),
}));

export const memorySources = pgTable('memory_source', {
  id: uuid('id').primaryKey().defaultRandom(),
  memoryItemId: uuid('memory_item_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceRef: text('source_ref').notNull(),
  relevanceScore: real('relevance_score').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  itemIdx: index('idx_memory_source_item').on(table.memoryItemId),
}));

export const memoryUsageLogs = pgTable('memory_usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  memoryItemId: uuid('memory_item_id').notNull(),
  workflowInstanceId: uuid('workflow_instance_id'),
  usageType: text('usage_type').notNull(),
  relevanceScore: real('relevance_score'),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  itemIdx: index('idx_memory_usage_log_item').on(table.memoryItemId),
}));

export const skills = pgTable('skill', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  skillName: text('skill_name').notNull(),
  description: text('description'),
  skillType: text('skill_type').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerScopeIdx: index('idx_skill_owner_scope').on(table.ownerUserId, table.scopeType),
  typeStatusIdx: index('idx_skill_type_status').on(table.skillType, table.status),
  orgIdx: index('idx_skill_org').on(table.orgId),
}));

export const skillVersions = pgTable('skill_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  skillId: uuid('skill_id').notNull(),
  version: integer('version').notNull(),
  definitionJson: jsonb('definition_json').notNull(),
  contentHash: text('content_hash').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  skillVersionUnique: uniqueIndex('idx_skill_version_unique').on(table.skillId, table.version),
}));

export const skillSources = pgTable('skill_source', {
  id: uuid('id').primaryKey().defaultRandom(),
  skillVersionId: uuid('skill_version_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceUri: text('source_uri'),
  contentText: text('content_text'),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  versionIdx: index('idx_skill_source_version').on(table.skillVersionId),
}));

export const projectionEvents = pgTable('projection_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  graphName: text('graph_name').notNull(),
  vertexLabel: text('vertex_label'),
  edgeLabel: text('edge_label'),
  operation: text('operation').notNull(),
  entityRef: text('entity_ref'),
  payload: jsonb('payload').notNull(),
  applied: boolean('applied').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  graphIdx: index('idx_projection_event_graph').on(table.graphName, table.applied),
}));

export const organizations = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgName: text('org_name').notNull(),
  displayName: text('display_name'),
  status: text('status').notNull(),
  settings: jsonb('settings').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameIdx: index('idx_organization_name').on(table.orgName),
  statusIdx: index('idx_organization_status').on(table.status),
}));

export const users = pgTable('user', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  username: text('username').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => ({
  usernameIdx: uniqueIndex('idx_user_org_username_shared').on(table.orgId, table.username),
}));

// user_profile: 用户画像与智能体人设表
// 存储个人化配置: 技能标签、工作偏好、语气风格、行为边界等
// 人设分三层: 系统基座人设(org_settings) → 组织人设(org_persona) → 用户人设(user_profile)
export const userProfiles = pgTable('user_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  orgId: uuid('org_id').notNull(),
  personaTier: text('persona_tier').notNull(),
  soul: text('soul'),
  identity: text('identity'),
  toneStyle: text('tone_style'),
  behaviorBoundary: text('behavior_boundary'),
  skillTags: jsonb('skill_tags').notNull(),
  currentFocus: text('current_focus'),
  workPreference: text('work_preference'),
  evolvedHistory: jsonb('evolved_history').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userUnique: uniqueIndex('idx_user_profile_user').on(table.userId),
  orgIdx: index('idx_user_profile_org').on(table.orgId),
}));

export const documents = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  title: text('title').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceUri: text('source_uri'),
  status: text('status').notNull(),
  contentHash: text('content_hash'),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerScopeIdx: index('idx_document_owner_scope').on(table.ownerUserId, table.scopeType),
  orgIdx: index('idx_document_org').on(table.orgId),
}));

export const documentVersions = pgTable('document_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull(),
  versionNo: integer('version_no').notNull(),
  status: text('status').notNull(),
  contentHash: text('content_hash').notNull(),
  storageRef: text('storage_ref'),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  versionUnique: uniqueIndex('idx_document_version_unique').on(table.documentId, table.versionNo),
}));

export const documentChunks = pgTable('document_chunk', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull(),
  documentVersionId: uuid('document_version_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  contentText: text('content_text').notNull(),
  tokenCount: integer('token_count').notNull(),
  embedding: vector1536('embedding'),
  embeddingModelVersion: text('embedding_model_version'),
  searchTsv: tsvectorType('search_tsv'),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chunkUnique: uniqueIndex('idx_document_chunk_unique').on(table.documentVersionId, table.chunkIndex),
  ownerScopeIdx: index('idx_document_chunk_owner_scope').on(table.ownerUserId, table.scopeType),
  orgIdx: index('idx_document_chunk_org').on(table.orgId),
  searchTsvIdx: index('idx_document_chunk_search_tsv').on(table.searchTsv),
}));

export const entities = pgTable('entity', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  entityType: text('entity_type').notNull(),
  canonicalName: text('canonical_name').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerScopeIdx: index('idx_entity_owner_scope').on(table.ownerUserId, table.scopeType),
  canonicalNameIdx: index('idx_entity_canonical_name').on(table.canonicalName),
  orgIdx: index('idx_entity_org').on(table.orgId),
}));

export const entityAttributes = pgTable('entity_attribute', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull(),
  attrKey: text('attr_key').notNull(),
  attrValue: text('attr_value'),
  valueJson: jsonb('value_json').notNull(),
  confidence: real('confidence').notNull(),
  sourceRef: text('source_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  entityIdx: index('idx_entity_attribute_entity').on(table.entityId),
}));

export const relations = pgTable('relation', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  fromEntityId: uuid('from_entity_id').notNull(),
  relationType: text('relation_type').notNull(),
  toEntityId: uuid('to_entity_id').notNull(),
  status: text('status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerScopeIdx: index('idx_relation_owner_scope').on(table.ownerUserId, table.scopeType),
  orgIdx: index('idx_relation_org').on(table.orgId),
}));

export const facts = pgTable('fact', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  subjectRef: text('subject_ref').notNull(),
  predicate: text('predicate').notNull(),
  objectValue: text('object_value'),
  objectJson: jsonb('object_json').notNull(),
  status: text('status').notNull(),
  confidence: real('confidence').notNull(),
  supersedesFactId: uuid('supersedes_fact_id'),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerScopeIdx: index('idx_fact_owner_scope').on(table.ownerUserId, table.scopeType),
  predicateStatusIdx: index('idx_fact_predicate_status').on(table.predicate, table.status),
  orgIdx: index('idx_fact_org').on(table.orgId),
}));

export const factEvidence = pgTable('fact_evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  factId: uuid('fact_id').notNull(),
  evidenceRef: text('evidence_ref').notNull(),
  evidenceType: text('evidence_type').notNull(),
  excerpt: text('excerpt'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factIdx: index('idx_fact_evidence_fact').on(table.factId),
}));

export const factConflicts = pgTable('fact_conflict', {
  id: uuid('id').primaryKey().defaultRandom(),
  existingFactId: uuid('existing_fact_id').notNull(),
  incomingFactId: uuid('incoming_fact_id').notNull(),
  conflictReason: text('conflict_reason').notNull(),
  resolutionStatus: text('resolution_status').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => ({
  existingFactIdx: index('idx_fact_conflict_existing').on(table.existingFactId),
  incomingFactIdx: index('idx_fact_conflict_incoming').on(table.incomingFactId),
}));

export const artifactObjects = pgTable('artifact_object', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  scopeType: text('scope_type').notNull(),
  artifactType: text('artifact_type').notNull(),
  contentHash: text('content_hash').notNull(),
  storageBackend: text('storage_backend').notNull(),
  storageRef: text('storage_ref').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  inlineThresholdExceeded: boolean('inline_threshold_exceeded').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerScopeIdx: index('idx_artifact_owner_scope').on(table.ownerUserId, table.scopeType),
  contentHashIdx: index('idx_artifact_content_hash').on(table.contentHash),
  orgIdx: index('idx_artifact_object_org').on(table.orgId),
}));

export const retrievalTraces = pgTable('retrieval_trace', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowInstanceId: uuid('workflow_instance_id'),
  ownerUserId: uuid('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  queryText: text('query_text').notNull(),
  intentType: text('intent_type').notNull(),
  scopeSummary: jsonb('scope_summary').notNull(),
  retrievalPlan: jsonb('retrieval_plan').notNull(),
  resultSummary: jsonb('result_summary').notNull(),
  durationMs: integer('duration_ms').notNull(),
  degraded: boolean('degraded').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIntentIdx: index('idx_retrieval_trace_owner_intent').on(table.ownerUserId, table.intentType),
  orgIdx: index('idx_retrieval_trace_org').on(table.orgId),
}));

export const auditEvents = pgTable('audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  orgId: uuid('org_id'),
  workflowInstanceId: uuid('workflow_instance_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceRef: text('resource_ref').notNull(),
  resourceScope: text('resource_scope').notNull(),
  result: text('result').notNull(),
  detailJson: jsonb('detail_json').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  actionIdx: index('idx_audit_event_action').on(table.action),
  workflowIdx: index('idx_audit_event_workflow').on(table.workflowInstanceId),
  orgIdx: index('idx_audit_event_org').on(table.orgId),
  userIdx: index('idx_audit_event_user_id').on(table.userId),
  occurredAtIdx: index('idx_audit_event_occurred_at').on(table.occurredAt),
}));

export const orgTasks = pgTable('org_task', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id'),
  createdBy: uuid('created_by').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  taskType: text('task_type').notNull(),
  scheduleType: text('schedule_type').notNull(),
  cronExpression: text('cron_expression'),
  status: text('status').notNull(),
  promptMessage: text('prompt_message').notNull(),
  requiredFields: jsonb('required_fields').notNull(),
  targetChannels: text('target_channels').array(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgStatusIdx: index('idx_org_task_org_status').on(table.orgId, table.status),
  scheduleIdx: index('idx_org_task_schedule').on(table.scheduleType, table.status),
  createdByIdx: index('idx_org_task_created_by').on(table.createdBy),
}));

export const orgTaskAssignments = pgTable('org_task_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull(),
  userId: uuid('user_id').notNull(),
  orgId: uuid('org_id'),
  status: text('status').notNull(),
  workflowRef: text('workflow_ref'),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  responseData: jsonb('response_data').notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  taskStatusIdx: index('idx_org_task_assignment_task').on(table.taskId, table.status),
  userStatusIdx: index('idx_org_task_assignment_user').on(table.userId, table.status),
  orgStatusIdx: index('idx_org_task_assignment_org').on(table.orgId, table.status),
  workflowIdx: index('idx_org_task_assignment_workflow').on(table.workflowRef),
}));

export const hermesMemories = pgTable('hermes_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull(),
  orgId: uuid('org_id'),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count').notNull().default(0),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerSessionIdx: index('idx_hermes_memory_owner_session').on(table.ownerUserId, table.sessionId),
  createdIdx: index('idx_hermes_memory_created').on(table.createdAt),
}));

export const userFiles = pgTable('user_file', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  orgId: uuid('org_id'),
  storageBackend: text('storage_backend').notNull(),
  storagePath: text('storage_path').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type'),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
  contentHash: text('content_hash'),
  fileCategory: text('file_category').notNull().default('upload'),
  scope: text('scope').notNull().default('private'),
  source: text('source').notNull().default('user_upload'),
  sourceRef: text('source_ref'),
  status: text('status').notNull().default('active'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_user_file_user').on(table.userId, table.status, table.createdAt),
  orgIdIdx: index('idx_user_file_org').on(table.orgId, table.status),
  categoryIdx: index('idx_user_file_category').on(table.userId, table.fileCategory),
  scopeIdx: index('idx_user_file_scope').on(table.userId, table.scope),
  hashIdx: index('idx_user_file_hash').on(table.contentHash),
}));

export type DbUser = typeof users.$inferSelect;
export type DbDocument = typeof documents.$inferSelect;
export type DbDocumentChunk = typeof documentChunks.$inferSelect;
export type DbFact = typeof facts.$inferSelect;
export type DbArtifactObject = typeof artifactObjects.$inferSelect;
