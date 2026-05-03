import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { configManager, createLogger, getDatabaseSslConfig } from '@agent-harness/shared';

const logger = createLogger('workflow-persistence-db');

let pool: Pool | null = null;

export interface PersistedWorkflowRecord {
  id: string;
  status: string;
  owner_user_id: string;
  plan: Record<string, unknown>;
  stages: Array<{ id: string; status: string; seq: number }>;
  created_at: string;
}

export function deterministicUuid(seed: string): string {
  const hash = createHash('sha1').update(seed).digest('hex').slice(0, 32).split('');
  hash[12] = '5';
  const variantNibble = parseInt(hash[16], 16);
  hash[16] = ((variantNibble & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8).join('')}-${hash.slice(8, 12).join('')}-${hash.slice(12, 16).join('')}-${hash.slice(16, 20).join('')}-${hash.slice(20, 32).join('')}`;
}

export async function getWorkflowDbPool(): Promise<Pool | null> {
  if (pool) {
    return pool;
  }

  const databaseUrl = process.env.DATABASE_URL || configManager.getPath<string>('database.url');
  if (!databaseUrl) {
    return null;
  }

  const pg = await import('pg');
  pool = new pg.Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    ssl: getDatabaseSslConfig(configManager.get())
  });

  return pool;
}

function mapStageType(type: string | undefined): string {
  const allowed = new Set([
    'IntentClarification',
    'PlanGeneration',
    'EvidenceRetrieval',
    'MemoryRetrieval',
    'ObjectExtraction',
    'ArchitectureDesign',
    'SpecGeneration',
    'Analysis',
    'DecisionMaking',
    'Implementation',
    'Execution',
    'Verification',
    'Repair',
    'ReVerification',
    'Approval',
    'ResultReporting',
    'Reporting',
    'SkillExtraction',
    'DreamSummarization',
    'Archive',
    'Archiving',
    'Generic',
    'WaitUser',
    'Block',
    'Pause',
    'Custom'
  ]);

  if (type && allowed.has(type)) {
    return type;
  }

  return 'Generic';
}

function mapExecutor(executor: string | undefined): string {
  const allowed = new Set([
    'generic-executor',
    'retrieval-aware-executor',
    'code-executor',
    'verification-executor',
    'repair-executor',
    'approval-executor',
    'human-gateway',
    'system'
  ]);
  if (executor && allowed.has(executor)) {
    return executor;
  }
  return 'generic-executor';
}

function mapStageStatus(status: string | undefined): string {
  const allowed = new Set(['pending', 'running', 'completed', 'failed', 'waiting_user', 'blocked', 'verifying', 'repairing', 're_verifying', 'paused', 'skipped']);
  if (status && allowed.has(status)) {
    return status;
  }
  return 'pending';
}

async function ensureUser(username: string): Promise<string> {
  const db = await getWorkflowDbPool();
  if (!db) {
    throw new Error('database_unavailable');
  }

  const existing = await db.query<{ id: string }>('select id from "user" where username = $1 limit 1', [username]);
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const userId = deterministicUuid(`user:${username}`);
  const orgId = deterministicUuid(`org:default`);

  await db.query(
    `insert into "user" (id, org_id, username, display_name, role, status, metadata)
     values ($1, $2, $3, $4, 'user', 'active', '{}'::jsonb)
     on conflict (id) do nothing`,
    [userId, orgId, username, username]
  );

  return userId;
}

async function ensurePolicySnapshot(userId: string, userRef: string, snapshotHash: string): Promise<string> {
  const db = await getWorkflowDbPool();
  if (!db) {
    throw new Error('database_unavailable');
  }

  const existing = await db.query<{ id: string }>('select id from policy_snapshot where snapshot_hash = $1 limit 1', [snapshotHash]);
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const snapshotId = deterministicUuid(`policy:${snapshotHash}`);
  await db.query(
    `insert into policy_snapshot (id, user_id, role, acting_subject, allowed_scopes, resource_rules, constraints, snapshot_hash)
     values ($1, $2, 'user', $3, $4::jsonb, '{}'::jsonb, '{"max_graph_hops":2,"allow_cross_user_read":false,"allow_public_publish":false}'::jsonb, $5)
     on conflict (snapshot_hash) do nothing`,
    [snapshotId, userId, userRef, JSON.stringify([`private:${userRef}`, 'public:workflow', 'public:skill']), snapshotHash]
  );

  const recheck = await db.query<{ id: string }>('select id from policy_snapshot where snapshot_hash = $1 limit 1', [snapshotHash]);
  return recheck.rows[0]?.id || snapshotId;
}

export async function persistWorkflowRecord(record: PersistedWorkflowRecord): Promise<void> {
  const db = await getWorkflowDbPool();
  if (!db) {
    return;
  }

  const plan = record.plan || {};
  const planHash = typeof plan.plan_hash === 'string' ? plan.plan_hash : `sha256:${createHash('sha256').update(JSON.stringify(plan)).digest('hex')}`;
  const policySnapshotHash = typeof plan.policy_snapshot_hash === 'string'
    ? plan.policy_snapshot_hash
    : `sha256:${createHash('sha256').update(`policy:${record.owner_user_id}`).digest('hex')}`;

  try {
    const userId = await ensureUser(record.owner_user_id);
    const policyId = await ensurePolicySnapshot(userId, record.owner_user_id, policySnapshotHash);
    const workflowUuid = deterministicUuid(`workflow:${record.id}`);

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `insert into workflow_instance (id, workflow_definition_id, owner_user_id, scope_type, status, workflow_plan_hash, policy_snapshot_id, budget_json, input_summary, started_at, finished_at)
         values ($1, null, $2, 'private', $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, $9::timestamptz)
         on conflict (id) do update set
           status = excluded.status,
           workflow_plan_hash = excluded.workflow_plan_hash,
           budget_json = excluded.budget_json,
           input_summary = excluded.input_summary,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           updated_at = now()`,
        [
          workflowUuid,
          userId,
          record.status,
          planHash,
          policyId,
          JSON.stringify((plan.budgets as Record<string, unknown>) || {}),
          JSON.stringify({
            external_workflow_ref: record.id,
            owner_user_ref: record.owner_user_id,
            plan,
            created_at: record.created_at
          }),
          record.status === 'running' ? new Date().toISOString() : null,
          ['succeeded', 'failed', 'cancelled', 'archived'].includes(record.status) ? new Date().toISOString() : null
        ]
      );

      const stageChain = Array.isArray(plan.stage_chain) ? (plan.stage_chain as Array<Record<string, unknown>>) : [];

      for (const stage of record.stages) {
        const stageFromPlan = stageChain.find((s) => s.stage_id === stage.id) || {};
        const originalStageType = typeof stageFromPlan.stage_type === 'string' ? stageFromPlan.stage_type : 'Generic';
        const originalExecutor = typeof stageFromPlan.assigned_executor === 'string' ? stageFromPlan.assigned_executor : 'generic-executor';
        const stageUuid = deterministicUuid(`workflow:${record.id}:stage:${stage.id}`);

        await client.query(
          `insert into workflow_stage (
            id, workflow_instance_id, stage_key, stage_type, seq, assigned_executor, status,
            input_refs, output_refs, tool_call_refs, evidence_refs, fact_write_refs, verification_refs,
            acceptance_result, metadata
          )
           values (
            $1, $2, $3, $4, $5, $6, $7,
            '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
            '{}'::jsonb, $8::jsonb
           )
           on conflict (id) do update set
            seq = excluded.seq,
            assigned_executor = excluded.assigned_executor,
            status = excluded.status,
            metadata = excluded.metadata,
            updated_at = now()`,
          [
            stageUuid,
            workflowUuid,
            String(stage.id).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64) || `stage_${stage.seq}`,
            mapStageType(originalStageType),
            stage.seq,
            mapExecutor(originalExecutor),
            mapStageStatus(stage.status),
            JSON.stringify({
            external_stage_ref: stage.id,
            original_stage_type: originalStageType,
            original_executor: originalExecutor
          })
        ]
      );
    }

      await client.query('COMMIT');
    } catch (txError) {
      try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.warn('workflow.persist.db_failed', 'Failed to persist workflow to database', {
      workflow_ref: record.id,
      error: String(error)
    });
  }
}

export async function loadPersistedWorkflows(limit = 500): Promise<PersistedWorkflowRecord[]> {
  const db = await getWorkflowDbPool();
  if (!db) {
    return [];
  }

  try {
    const workflowsResult = await db.query<{
      id: string;
      status: string;
      input_summary: Record<string, unknown>;
      created_at: Date;
    }>(
      `select id, status, input_summary, created_at
       from workflow_instance
       where input_summary ? 'external_workflow_ref'
       order by created_at desc
       limit $1`,
      [limit]
    );

    const records: PersistedWorkflowRecord[] = [];
    for (const row of workflowsResult.rows) {
      const summary = (row.input_summary || {}) as Record<string, unknown>;
      const externalRef = summary.external_workflow_ref;
      const ownerUserRef = summary.owner_user_ref;
      if (typeof externalRef !== 'string' || typeof ownerUserRef !== 'string') {
        continue;
      }

      const stagesResult = await db.query<{
        seq: number;
        status: string;
        metadata: Record<string, unknown>;
      }>(
        `select seq, status, metadata
         from workflow_stage
         where workflow_instance_id = $1
         order by seq asc`,
        [row.id]
      );

      records.push({
        id: externalRef,
        status: row.status,
        owner_user_id: ownerUserRef,
        plan: (summary.plan as Record<string, unknown>) || {},
        stages: stagesResult.rows.map((stage) => ({
          id: typeof stage.metadata?.external_stage_ref === 'string' ? String(stage.metadata.external_stage_ref) : `stage_${stage.seq}`,
          status: stage.status,
          seq: stage.seq
        })),
        created_at: new Date(row.created_at).toISOString()
      });
    }

    return records;
  } catch (error) {
    logger.warn('workflow.load.db_failed', 'Failed to load workflows from database', {
      error: String(error)
    });
    return [];
  }
}

export async function loadCheckpointRefsByResumeToken(resumeToken: string): Promise<{ workflow_instance_id?: string; workflow_stage_id?: string } | null> {
  const db = await getWorkflowDbPool();
  if (!db) {
    return null;
  }

  const result = await db.query<{
    workflow_ref: string | null;
    stage_ref: string | null;
  }>(
    `select
      (wi.input_summary ->> 'external_workflow_ref') as workflow_ref,
      (ws.metadata ->> 'external_stage_ref') as stage_ref
     from checkpoint c
     left join workflow_instance wi on wi.id = c.workflow_instance_id
     left join workflow_stage ws on ws.id = c.workflow_stage_id
     where c.resume_token = $1
     limit 1`,
    [resumeToken]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    workflow_instance_id: row.workflow_ref || undefined,
    workflow_stage_id: row.stage_ref || undefined
  };
}

export async function persistCheckpointRecord(checkpoint: {
  id: string;
  workflow_instance_id: string;
  workflow_stage_id: string;
  checkpoint_type: string;
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
}): Promise<void> {
  const db = await getWorkflowDbPool();
  if (!db) {
    return;
  }

  try {
    await db.query(
      `insert into checkpoint (
        id, workflow_instance_id, workflow_stage_id, checkpoint_type, resume_token, state_hash,
        policy_snapshot_hash, status_snapshot, artifact_refs, fact_write_refs, verification_refs,
        evidence_pack_hash, tool_call_refs, notes, next_action, created_at
      ) values (
        $1, $2, $3, $4, $5, $6,
        $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
        $12, $13::jsonb, null, $14, $15::timestamptz
      ) on conflict (resume_token) do update set
        state_hash = excluded.state_hash,
        status_snapshot = excluded.status_snapshot,
        artifact_refs = excluded.artifact_refs,
        fact_write_refs = excluded.fact_write_refs,
        verification_refs = excluded.verification_refs,
        evidence_pack_hash = excluded.evidence_pack_hash,
        tool_call_refs = excluded.tool_call_refs,
        next_action = excluded.next_action`,
      [
        deterministicUuid(`checkpoint:${checkpoint.id}`),
        deterministicUuid(`workflow:${checkpoint.workflow_instance_id}`),
        deterministicUuid(`workflow:${checkpoint.workflow_instance_id}:stage:${checkpoint.workflow_stage_id}`),
        checkpoint.checkpoint_type,
        checkpoint.resume_token,
        checkpoint.state_hash,
        checkpoint.policy_snapshot_hash,
        JSON.stringify(checkpoint.status_snapshot || {}),
        JSON.stringify(checkpoint.artifact_refs || []),
        JSON.stringify(checkpoint.fact_write_refs || []),
        JSON.stringify(checkpoint.verification_refs || []),
        checkpoint.evidence_pack_hash || null,
        JSON.stringify(checkpoint.tool_call_refs || []),
        checkpoint.next_action || null,
        checkpoint.created_at
      ]
    );
  } catch (error) {
    logger.warn('checkpoint.persist.db_failed', 'Failed to persist checkpoint to database', {
      checkpoint_id: checkpoint.id,
      error: String(error)
    });
  }
}

export async function loadCheckpointByResumeToken(resumeToken: string): Promise<null | {
  id: string;
  resume_token: string;
  checkpoint_type: string;
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
}> {
  const db = await getWorkflowDbPool();
  if (!db) {
    return null;
  }

  const result = await db.query<{
    id: string;
    resume_token: string;
    checkpoint_type: string;
    state_hash: string;
    policy_snapshot_hash: string;
    status_snapshot: Record<string, unknown>;
    artifact_refs: string[];
    fact_write_refs: string[];
    verification_refs: string[];
    evidence_pack_hash: string | null;
    tool_call_refs: string[];
    next_action: string | null;
    created_at: Date;
  }>(
    `select id, resume_token, checkpoint_type, state_hash, policy_snapshot_hash,
            status_snapshot, artifact_refs, fact_write_refs, verification_refs,
            evidence_pack_hash, tool_call_refs, next_action, created_at
     from checkpoint
     where resume_token = $1
     limit 1`,
    [resumeToken]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    resume_token: row.resume_token,
    checkpoint_type: row.checkpoint_type,
    state_hash: row.state_hash,
    policy_snapshot_hash: row.policy_snapshot_hash,
    status_snapshot: row.status_snapshot || {},
    artifact_refs: row.artifact_refs || [],
    fact_write_refs: row.fact_write_refs || [],
    verification_refs: row.verification_refs || [],
    evidence_pack_hash: row.evidence_pack_hash || '',
    tool_call_refs: row.tool_call_refs || [],
    next_action: row.next_action || '',
    created_at: new Date(row.created_at).toISOString()
  };
}

export async function loadRecentCheckpoints(limit = 2000): Promise<Array<{
  id: string;
  resume_token: string;
  checkpoint_type: string;
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
  workflow_instance_id?: string;
  workflow_stage_id?: string;
}>> {
  const db = await getWorkflowDbPool();
  if (!db) {
    return [];
  }

  const result = await db.query<{
    id: string;
    resume_token: string;
    checkpoint_type: string;
    state_hash: string;
    policy_snapshot_hash: string;
    status_snapshot: Record<string, unknown>;
    artifact_refs: string[];
    fact_write_refs: string[];
    verification_refs: string[];
    evidence_pack_hash: string | null;
    tool_call_refs: string[];
    next_action: string | null;
    created_at: Date;
    workflow_ref: string | null;
    stage_ref: string | null;
  }>(
    `select c.id, c.resume_token, c.checkpoint_type, c.state_hash, c.policy_snapshot_hash,
            c.status_snapshot, c.artifact_refs, c.fact_write_refs, c.verification_refs,
            c.evidence_pack_hash, c.tool_call_refs, c.next_action, c.created_at,
            (wi.input_summary ->> 'external_workflow_ref') as workflow_ref,
            (ws.metadata ->> 'external_stage_ref') as stage_ref
     from checkpoint c
     left join workflow_instance wi on wi.id = c.workflow_instance_id
     left join workflow_stage ws on ws.id = c.workflow_stage_id
     order by c.created_at desc
     limit $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    resume_token: row.resume_token,
    checkpoint_type: row.checkpoint_type,
    state_hash: row.state_hash,
    policy_snapshot_hash: row.policy_snapshot_hash,
    status_snapshot: row.status_snapshot || {},
    artifact_refs: row.artifact_refs || [],
    fact_write_refs: row.fact_write_refs || [],
    verification_refs: row.verification_refs || [],
    evidence_pack_hash: row.evidence_pack_hash || '',
    tool_call_refs: row.tool_call_refs || [],
    next_action: row.next_action || '',
    created_at: new Date(row.created_at).toISOString(),
    workflow_instance_id: row.workflow_ref || undefined,
    workflow_stage_id: row.stage_ref || undefined
  }));
}

export async function closeWorkflowDbPool(): Promise<void> {
  if (!pool) {
    return;
  }
  try {
    await pool.end();
  } catch {
    // noop
  } finally {
    pool = null;
  }
}

export function createFallbackPolicyHash(userRef: string): string {
  return `sha256:${createHash('sha256').update(`policy:${userRef}:${randomUUID()}`).digest('hex')}`;
}
