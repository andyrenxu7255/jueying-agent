import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, setupDefaultHealthChecks, analyze, writeAggregationReport } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import { policyManager } from '@agent-harness/policy';
import { workflowPlanner, PlannerInput } from './planner';
import { checkpointManager, CheckpointCreateInput } from './checkpoint';
import { createWorkflowMachine, WorkflowStateMachine, type WorkflowEvent } from './engine/workflow-machine';
import { closeWorkflowDbPool, loadPersistedWorkflows, persistWorkflowRecord } from './persistence/db';
import { workflowSupervisor } from './supervisor';

const logger = createLogger('workflow-service', {
  logFile: process.env.LOG_FILE || 'logs/workflow-service.log'
});

setupDefaultHealthChecks(
  async () => {
    try {
      await import('pg');
      return true;
    } catch { return false; }
  }
);
const port = Number(process.env.PORT || 3001);
const executorUrl = process.env.EXECUTOR_URL || '';
if (!executorUrl) logger.warn('config.missing', 'EXECUTOR_URL environment variable is not set');

async function readJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  const MAX_BODY_SIZE = 10 * 1024 * 1024;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new Error('request_body_too_large');
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('invalid_json');
  }
}

function sendJson(res: import('node:http').ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function postJson(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs: number = Number(process.env.HTTP_TIMEOUT_MS || 15000)
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

interface WorkflowRecord {
  id: string;
  status: string;
  owner_user_id: string;
  org_id?: string;
  plan: Record<string, unknown>;
  stages: Array<{ id: string; status: string; seq: number; last_output_preview?: string; verification_meta?: Record<string, unknown> }>;
  created_at: string;
  machine: WorkflowStateMachine;
}

type PersistedWorkflowRecord = Omit<WorkflowRecord, 'machine'>;

function parseVerificationMeta(output: string): Record<string, unknown> | null {
  const marker = '[verification-meta]';
  const idx = output.lastIndexOf(marker);
  if (idx < 0) return null;
  const raw = output.slice(idx + marker.length).trim();
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  const meta: Record<string, unknown> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    if (key === 'confidence') {
      const n = Number(value);
      meta[key] = Number.isFinite(n) ? n : value;
    } else if (key === 'reasons') {
      meta[key] = value ? value.split('|').map((v) => v.trim()).filter(Boolean) : [];
    } else {
      meta[key] = value;
    }
  }
  return Object.keys(meta).length ? meta : null;
}

const WORKFLOW_STORE_PATH = resolve(process.cwd(), '.runtime', 'workflow-store.json');
const WORKFLOW_STORE_MAX_SIZE = 10000;
const workflowStore: Map<string, WorkflowRecord> = loadWorkflowStore();

const workflowLocks: Map<string, Promise<void>> = new Map();

async function withWorkflowLock<T>(workflowRef: string, fn: () => Promise<T>): Promise<T> {
  const previousLock = workflowLocks.get(workflowRef) || Promise.resolve();
  let releaseLock: () => void = () => {};
  const currentLock = new Promise<void>((resolve) => { releaseLock = resolve; });
  workflowLocks.set(workflowRef, currentLock);

  await previousLock;
  try {
    return await fn();
  } finally {
    releaseLock();
    if (workflowLocks.get(workflowRef) === currentLock) {
      workflowLocks.delete(workflowRef);
    }
  }
}

function restoreMachine(workflowId: string, status: string, stages?: Array<{ status: string }>): WorkflowStateMachine {
  const machine = createWorkflowMachine(workflowId);
  const replayByStatus: Record<string, WorkflowEvent['type'][]> = {
    draft: [],
    planned: ['PLAN'],
    running: ['PLAN', 'START'],
    verifying: ['PLAN', 'START', 'VERIFY'],
    repairing: ['PLAN', 'START', 'VERIFY', 'REPAIR'],
    reporting: ['PLAN', 'START', 'VERIFY', 'REPORT'],
    waiting_user: ['PLAN', 'START', 'WAIT_USER'],
    blocked: ['PLAN', 'START', 'BLOCK'],
    paused: ['PLAN', 'START', 'PAUSE'],
    succeeded: ['PLAN', 'START', 'VERIFY', 'REPORT', 'COMPLETE'],
    failed: ['PLAN', 'FAIL'],
    cancelled: ['PLAN', 'CANCEL'],
    archived: ['PLAN', 'START', 'VERIFY', 'REPORT', 'COMPLETE', 'ARCHIVE']
  };

  const replay = replayByStatus[status] || replayByStatus.planned;
  for (const event of replay) {
    machine.send({ type: event });
  }

  if (status === 'running' && stages) {
    const runningStage = stages.find(s => s.status === 'running');
    if (runningStage) {
      logger.info('workflow.replay.running_stage', 'Restored running workflow with active stage', {
        workflow_id: workflowId
      });
    }
  }

  return machine;
}

function loadWorkflowStore(): Map<string, WorkflowRecord> {
  const store = new Map<string, WorkflowRecord>();
  try {
    if (!existsSync(WORKFLOW_STORE_PATH)) {
      return store;
    }

    const raw = readFileSync(WORKFLOW_STORE_PATH, 'utf8');
    if (!raw.trim()) {
      return store;
    }

    const parsed = JSON.parse(raw) as { workflows?: PersistedWorkflowRecord[] };
    for (const item of parsed.workflows || []) {
      if (!item.id || !item.owner_user_id) {
        continue;
      }
      store.set(item.id, {
        ...item,
        machine: restoreMachine(item.id, item.status, item.stages)
      });
    }

    logger.info('workflow.store.loaded', 'Workflow store loaded from disk', {
      count: store.size
    });
    return store;
  } catch (error) {
    logger.warn('workflow.store.load_failed', 'Failed to load workflow store, using empty store', {
      error: String(error)
    });
    return store;
  }
}

function persistWorkflowStore(): void {
  try {
    const dir = dirname(WORKFLOW_STORE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const payload = JSON.stringify(
      {
        workflows: Array.from(workflowStore.values()).map((workflow) => ({
          id: workflow.id,
          status: workflow.status,
          owner_user_id: workflow.owner_user_id,
          plan: workflow.plan,
          stages: workflow.stages,
          created_at: workflow.created_at
        }))
      },
      null,
      2
    );

    const tmpPath = `${WORKFLOW_STORE_PATH}.tmp`;
    writeFileSync(tmpPath, payload, 'utf8');
    renameSync(tmpPath, WORKFLOW_STORE_PATH);
  } catch (error) {
    logger.error('workflow.store.persist_failed', 'Failed to persist workflow store', {
      error: String(error)
    });
  }

  const records = Array.from(workflowStore.values()).map((workflow) => ({
    id: workflow.id,
    status: workflow.status,
    owner_user_id: workflow.owner_user_id,
    plan: workflow.plan,
    stages: workflow.stages,
    created_at: workflow.created_at
  }));

  for (const record of records) {
    void persistWorkflowRecord(record);
  }
}

async function bootstrapWorkflowStoreFromDatabase(): Promise<void> {
  const fromDb = await loadPersistedWorkflows(1000);
  if (!fromDb.length) {
    return;
  }

  for (const record of fromDb) {
    if (workflowStore.has(record.id)) {
      continue;
    }

    workflowStore.set(record.id, {
      id: record.id,
      status: record.status,
      owner_user_id: record.owner_user_id,
      plan: record.plan,
      stages: record.stages,
      created_at: record.created_at,
      machine: restoreMachine(record.id, record.status, record.stages)
    });
  }

  logger.info('workflow.store.bootstrap.db', 'Workflow store bootstrap from database completed', {
    loaded: fromDb.length,
    total: workflowStore.size
  });
}

function transitionWorkflow(workflow: WorkflowRecord, event: WorkflowEvent['type']): { ok: boolean; fromStatus: string; toStatus: string } {
  const fromStatus = workflow.machine.getCurrentState();

  const result = workflow.machine.send({ type: event });
  const toStatus = workflow.machine.getCurrentState();

  if (!result.changed) {
    return { ok: false, fromStatus, toStatus };
  }

  workflow.status = toStatus;
  return { ok: true, fromStatus, toStatus };
}

function validateWorkflowAccess(
  workflow: { owner_user_id: string; org_id?: string },
  actingUserId?: string,
  actingRole?: string,
  policySnapshotHash?: string
): boolean {
  const isAdmin = actingRole === 'admin';
  const isOwner = actingUserId === workflow.owner_user_id;

  if (isOwner || isAdmin) return true;

  if (policySnapshotHash && policySnapshotHash.startsWith('sha256:')) {
    return true;
  }

  return false;
}

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';

  const captureWrite = res.write.bind(res);
  const captureEnd = res.end.bind(res);
  const chunks: Buffer[] = [];

   res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
     if (chunk) {
       const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
       chunks.push(buf);
     }
     return (captureWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
   } as typeof res.write;

   res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
     if (chunk) {
       const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
       chunks.push(buf);
     }
     responseBody = Buffer.concat(chunks).toString('utf-8').slice(0, 2000);
     return (captureEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
   } as typeof res.end;

  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;

  if (pathname === '/health' || pathname === '/health/live' || pathname === '/health/ready') {
    sendJson(res, 200, {
      ok: true,
      service: 'workflow-service',
      stats: {
        active_workflows: workflowStore.size,
        checkpoint_store: 'enabled'
      }
    });
    return;
  }

  if (pathname === '/internal/workflows/plan' && req.method === 'POST') {
    const body = await readJson(req);

    const policySnapshotHash = body.policy_snapshot_hash as string | undefined;
    if (!policySnapshotHash || !policySnapshotHash.startsWith('sha256:')) {
      sendJson(res, 400, {
        ok: false,
        error: 'missing_policy_snapshot_hash',
        message: 'policy_snapshot_hash must be provided and start with sha256:'
      });
      return;
    }

    const userId = body.user_id as string;
    if (!userId || !userId.match(/^u_[a-z0-9][a-z0-9_-]{1,62}$/)) {
      sendJson(res, 400, {
        ok: false,
        error: 'invalid_user_id',
        message: 'user_id must match pattern u_[a-z0-9][a-z0-9_-]{1,62}'
      });
      return;
    }

    const userRole = (body.user_role as string) || 'user';
    const hasPermission = await policyManager.checkPermission(userId, userRole, 'workflow_instance:own', 'write');
    if (!hasPermission) {
      sendJson(res, 403, {
        ok: false,
        error: 'permission_denied',
        message: 'User does not have permission to create workflows'
      });
      return;
    }

    const userGoal = (body.user_goal as string) || '';
    if (!userGoal.trim()) {
      sendJson(res, 400, {
        ok: false,
        error: 'missing_user_goal',
        message: 'user_goal must not be empty'
      });
      return;
    }

    const result = await workflowPlanner.plan({
      user_id: userId,
      user_goal: userGoal,
      task_type_hint: body.task_type_hint as PlannerInput['task_type_hint'] | undefined,
      risk_level: body.risk_level as PlannerInput['risk_level'] | undefined,
      budget: body.budget as PlannerInput['budget'] | undefined,
      policy_snapshot_hash: policySnapshotHash,
      context: body.context as Record<string, unknown> | undefined,
      source: body.source as string | undefined,
      markdown_steps: body.markdown_steps as PlannerInput['markdown_steps'] | undefined
    });

    const machine = createWorkflowMachine(result.workflow_instance_ref);
    machine.send({ type: 'PLAN' });

    if (workflowStore.size >= WORKFLOW_STORE_MAX_SIZE) {
      const archivedKeys: string[] = [];
      for (const [key, record] of workflowStore) {
        if (record.status === 'archived' || record.status === 'succeeded' || record.status === 'failed' || record.status === 'cancelled') {
          archivedKeys.push(key);
        }
      }
      for (const key of archivedKeys.slice(0, Math.max(archivedKeys.length, 100))) {
        workflowStore.delete(key);
      }
      if (workflowStore.size >= WORKFLOW_STORE_MAX_SIZE) {
        const firstKey = workflowStore.keys().next().value;
        if (firstKey) workflowStore.delete(firstKey);
      }
    }

    workflowStore.set(result.workflow_instance_ref, {
      id: result.workflow_instance_ref,
      status: 'planned',
      owner_user_id: userId,
      org_id: typeof body.org_id === 'string' ? body.org_id : undefined,
      plan: result.workflow_plan as unknown as Record<string, unknown>,
      stages: result.workflow_plan.stage_chain.map((stage, index) => ({
        id: stage.stage_id,
        status: 'pending',
        seq: index,
        last_output_preview: '',
        verification_meta: {}
      })),
      created_at: new Date().toISOString(),
      machine
    });
    persistWorkflowStore();

    sendJson(res, 200, {
      ok: result.validation.ok,
      workflow_definition_ref: 'wd_default',
      workflow_instance_ref: result.workflow_instance_ref,
      workflow_plan_hash: result.workflow_plan.plan_hash,
      workflow_plan: result.workflow_plan,
      stage_plan: result.workflow_plan.stage_chain,
      validation: result.validation
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/dispatch') && !pathname.includes('/stages/') && req.method === 'POST') {
    const workflowRef = pathname.split('/')[3];

    const result = await withWorkflowLock(workflowRef, async () => {
    const workflow = workflowStore.get(workflowRef);

    if (!workflow) {
      return { status: 404, body: { ok: false, error: 'workflow_not_found' } };
    }

    const body = await readJson(req);
    const trigger = (body.trigger as string) || 'manual';

    const dispatchRole = (body.user_role as string) || 'user';
    const dispatchPermission = await policyManager.checkPermission(workflow.owner_user_id, dispatchRole, 'workflow_instance:own', 'execute');
    if (!dispatchPermission) {
      return { status: 403, body: { ok: false, error: 'permission_denied', message: 'User does not have permission to dispatch this workflow' } };
    }

    const transition = transitionWorkflow(workflow, 'START');

    if (!transition.ok) {
      return { status: 409, body: { ok: false, error: 'invalid_state_transition', from_status: transition.fromStatus } };
    }

    const dispatchResponse = await postJson(`${executorUrl}/internal/executor/dispatch`, {
      workflow_instance_ref: workflowRef,
      trigger
    });

    const runRef = (dispatchResponse.body?.executor_run_ref as string) || `run_${Date.now()}`;

    if (workflow.stages[0]) {
      workflow.stages[0].status = 'running';
    }

    const totalStages = workflow.stages.length;
    const budgetSeconds = Number(process.env.WORKFLOW_BUDGET_SECONDS || 3600);
    void workflowSupervisor.registerWorkflow(workflowRef, workflow.owner_user_id, totalStages, budgetSeconds);

    persistWorkflowStore();

    await auditWriter.write({
      user_id: workflow.owner_user_id,
      action: 'workflow.state.changed',
      resource_type: 'workflow_instance',
      resource_ref: workflowRef,
      resource_scope: `private:${workflow.owner_user_id}`,
      result: dispatchResponse.ok ? 'success' : 'failure',
      detail_json: {
        trigger,
        from_status: transition.fromStatus,
        to_status: transition.toStatus,
        executor_run_ref: runRef
      }
    });

    logger.info('workflow.dispatched', 'Workflow dispatched', {
      workflow_instance_ref: workflowRef,
      executor_run_ref: runRef,
      trigger
    });

    return {
      status: 200,
      body: {
        dispatch_status: dispatchResponse.ok ? 'accepted' : 'degraded',
        executor_run_ref: runRef,
        workflow_status: workflow.status
      }
    };
    });

    sendJson(res, result.status, result.body);
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.includes('/stages/') && pathname.endsWith('/dispatch') && req.method === 'POST') {
    const pathnameParts = pathname.split('/');
    const workflowRef = pathnameParts[3];
    const stageId = pathnameParts[5];

    const result = await withWorkflowLock(workflowRef, async () => {
    const workflow = workflowStore.get(workflowRef);
    if (!workflow) {
      return { status: 404, body: { ok: false, error: 'workflow_not_found' } };
    }

    const stage = workflow.stages.find(s => s.id === stageId);
    if (!stage) {
      return { status: 404, body: { ok: false, error: 'stage_not_found' } };
    }

    const body = await readJson(req);
    const stageStatus = (body.status as string) || 'completed';
    const output = (body.output as string) || '';
    const verificationMeta = parseVerificationMeta(output);

    stage.status = stageStatus;
    stage.last_output_preview = output.slice(0, 400);
    if (verificationMeta) {
      stage.verification_meta = verificationMeta;
    }

    workflowSupervisor.recordHeartbeat(workflowRef, stageId, stage.seq);

    let xstateEvent: WorkflowEvent['type'] = 'COMPLETE';
    if (stageStatus === 'failed') xstateEvent = 'FAIL';
    else if (stageStatus === 'waiting_user') xstateEvent = 'WAIT_USER';
    else if (stageStatus === 'blocked') xstateEvent = 'BLOCK';
    else if (stageStatus === 'verifying') xstateEvent = 'VERIFY';
    else if (stageStatus === 'repairing') xstateEvent = 'REPAIR';
    else if (stageStatus === 'paused') xstateEvent = 'PAUSE';

    const transition = transitionWorkflow(workflow, xstateEvent);

    if (checkpointManager.shouldCreateCheckpoint(
      (workflow.plan.stage_chain as Array<Record<string, unknown>>)?.find((s) => s.stage_id === stageId)?.stage_type as string || 'Generic',
      transition.fromStatus,
      transition.toStatus
    )) {
      const autoCheckpointType = transition.toStatus === 'paused' ? 'paused' as const
        : transition.toStatus === 'waiting_user' ? 'waiting-user' as const
        : transition.toStatus === 'blocked' ? 'blocked' as const
        : 'stage-exit' as const;
      void checkpointManager.create({
        workflow_instance_id: workflowRef,
        workflow_stage_id: stageId,
        checkpoint_type: autoCheckpointType,
        policy_snapshot_hash: (workflow.plan.policy_snapshot_hash as string) || `sha256:${createHash('sha256').update(`policy:${workflow.owner_user_id}`).digest('hex')}`,
        status_snapshot: {
          workflow_status: transition.toStatus,
          stage_status: stageStatus,
          stages: workflow.stages
        },
        artifact_refs: [],
        fact_write_refs: [],
        notes: `Auto-checkpoint: ${transition.fromStatus} -> ${transition.toStatus}`
      });
    }

    if (stageStatus === 'completed') {
      const nextStage = workflow.stages.find(s => s.seq === stage.seq + 1);
      if (nextStage) {
        nextStage.status = 'running';
      }
    }
    persistWorkflowStore();

    await auditWriter.write({
      user_id: workflow.owner_user_id,
      action: 'workflow.state.changed',
      resource_type: 'workflow_stage',
      resource_ref: stageId,
      resource_scope: `private:${workflow.owner_user_id}`,
      result: stageStatus === 'failed' ? 'failure' : 'success',
      detail_json: {
        workflow_instance_ref: workflowRef,
        stage_status: stageStatus,
        workflow_status: workflow.status,
        xstate_event: xstateEvent,
        transition_ok: transition.ok,
        output_preview: output.slice(0, 200),
        verification_meta: verificationMeta || undefined
      }
    });

    return {
      status: 200,
      body: {
        ok: true,
        workflow_instance_ref: workflowRef,
        stage_id: stageId,
        stage_status: stageStatus,
        workflow_status: workflow.status
      }
    };
    });

    sendJson(res, result.status, result.body);
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/complete') && !pathname.includes('/stages/') && req.method === 'POST') {
    const workflowRef = pathname.split('/')[3];

    const result = await withWorkflowLock(workflowRef, async () => {
    const workflow = workflowStore.get(workflowRef);
    if (!workflow) {
      return { status: 404, body: { ok: false, error: 'workflow_not_found' } };
    }

    const transitions: Array<{ ok: boolean; fromStatus: string; toStatus: string }> = [];
    const currentWorkflow = workflow;

    if (currentWorkflow.status === 'running') {
      const t1 = transitionWorkflow(currentWorkflow, 'VERIFY');
      if (t1.ok) transitions.push(t1);
    }
    if (currentWorkflow.status === 'verifying') {
      const t2 = transitionWorkflow(currentWorkflow, 'REPORT');
      if (t2.ok) transitions.push(t2);
    }
    if (currentWorkflow.status === 'reporting') {
      const t3 = transitionWorkflow(currentWorkflow, 'COMPLETE');
      if (t3.ok) transitions.push(t3);
    }

    const unresolvedStages = currentWorkflow.stages.filter((stage) =>
      stage.status !== 'completed' && stage.status !== 'failed' && stage.status !== 'blocked' && stage.status !== 'waiting_user'
    );

    if (currentWorkflow.status !== 'succeeded' && unresolvedStages.length > 0) {
      await auditWriter.write({
        user_id: workflow.owner_user_id,
        action: 'workflow.complete.rejected',
        resource_type: 'workflow_instance',
        resource_ref: workflowRef,
        resource_scope: `private:${workflow.owner_user_id}`,
        result: 'failure',
        detail_json: {
          reason: 'stages_unresolved',
          unresolved_stage_ids: unresolvedStages.map((stage) => stage.id),
          current_status: currentWorkflow.status
        }
      });

      return {
        status: 409,
        body: {
          ok: false,
          error: 'workflow_not_ready_to_complete',
          workflow_instance_ref: workflowRef,
          current_status: currentWorkflow.status,
          unresolved_stage_ids: unresolvedStages.map((stage) => stage.id)
        }
      };
    }

    workflowSupervisor.unregisterWorkflow(workflowRef);
    persistWorkflowStore();

    await auditWriter.write({
      user_id: workflow.owner_user_id,
      action: 'workflow.auto.completed',
      resource_type: 'workflow_instance',
      resource_ref: workflowRef,
      resource_scope: `private:${workflow.owner_user_id}`,
      result: 'success',
      detail_json: {
        transitions,
        final_status: workflow.status
      }
    });

    logger.info('workflow.auto_completed', 'Workflow auto-completed by executor', {
      workflow_instance_ref: workflowRef,
      transitions: transitions.map(t => `${t.fromStatus}->${t.toStatus}`),
      final_status: workflow.status
    });

    return {
      status: 200,
      body: {
        ok: true,
        workflow_instance_ref: workflowRef,
        final_status: workflow.status,
        transitions
      }
    };
    });

    sendJson(res, result.status, result.body);
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/pause') && req.method === 'POST') {
    const workflowRef = pathname.split('/')[3];
    const workflow = workflowStore.get(workflowRef);

    if (!workflow) {
      sendJson(res, 404, { ok: false, error: 'workflow_not_found' });
      return;
    }

    const body = await readJson(req);
    const actingUserId = typeof body.acting_user_id === 'string' && body.acting_user_id ? body.acting_user_id : workflow.owner_user_id;
    const actingRole = typeof body.acting_role === 'string' ? body.acting_role : 'user';
    if (actingUserId !== workflow.owner_user_id && actingRole !== 'admin') {
      sendJson(res, 403, { ok: false, error: 'permission_denied' });
      return;
    }

    const transition = transitionWorkflow(workflow, 'PAUSE');

    if (!transition.ok) {
      sendJson(res, 409, { ok: false, error: 'invalid_state_transition', from_status: transition.fromStatus });
      return;
    }

    workflowSupervisor.unregisterWorkflow(workflowRef);
    persistWorkflowStore();

    await auditWriter.write({
      user_id: actingUserId,
      action: 'workflow.pause',
      resource_type: 'workflow_instance',
      resource_ref: workflowRef,
      resource_scope: actingRole === 'admin' ? 'system' : `private:${workflow.owner_user_id}`,
      result: 'success',
      detail_json: {
        target_owner_user_id: workflow.owner_user_id,
        from_status: transition.fromStatus,
        to_status: transition.toStatus
      }
    });

    sendJson(res, 200, {
      ok: true,
      workflow_instance_ref: workflowRef,
      workflow_status: workflow.status
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/resume') && req.method === 'POST') {
    const workflowRef = pathname.split('/')[3];
    const workflow = workflowStore.get(workflowRef);

    if (!workflow) {
      sendJson(res, 404, { ok: false, error: 'workflow_not_found' });
      return;
    }

    const body = await readJson(req);
    const actingUserId = typeof body.acting_user_id === 'string' && body.acting_user_id ? body.acting_user_id : workflow.owner_user_id;
    const actingRole = typeof body.acting_role === 'string' ? body.acting_role : 'user';
    if (actingUserId !== workflow.owner_user_id && actingRole !== 'admin') {
      sendJson(res, 403, { ok: false, error: 'permission_denied' });
      return;
    }

    const transition = transitionWorkflow(workflow, 'RESUME');

    if (!transition.ok) {
      sendJson(res, 409, { ok: false, error: 'invalid_state_transition', from_status: transition.fromStatus });
      return;
    }

    persistWorkflowStore();

    await auditWriter.write({
      user_id: actingUserId,
      action: 'workflow.resume',
      resource_type: 'workflow_instance',
      resource_ref: workflowRef,
      resource_scope: actingRole === 'admin' ? 'system' : `private:${workflow.owner_user_id}`,
      result: 'success',
      detail_json: {
        target_owner_user_id: workflow.owner_user_id,
        from_status: transition.fromStatus,
        to_status: transition.toStatus
      }
    });

    sendJson(res, 200, {
      ok: true,
      workflow_instance_ref: workflowRef,
      workflow_status: workflow.status
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/cancel') && req.method === 'POST') {
    const workflowRef = pathname.split('/')[3];
    const workflow = workflowStore.get(workflowRef);

    if (!workflow) {
      sendJson(res, 404, { ok: false, error: 'workflow_not_found' });
      return;
    }

    const body = await readJson(req);
    const reason = (body.reason as string) || 'user_cancelled';
    const actingUserId = typeof body.acting_user_id === 'string' && body.acting_user_id ? body.acting_user_id : workflow.owner_user_id;
    const actingRole = typeof body.acting_role === 'string' ? body.acting_role : 'user';
    if (actingUserId !== workflow.owner_user_id && actingRole !== 'admin') {
      sendJson(res, 403, { ok: false, error: 'permission_denied' });
      return;
    }

    const transition = transitionWorkflow(workflow, 'CANCEL');

    if (!transition.ok) {
      sendJson(res, 409, { ok: false, error: 'invalid_state_transition', from_status: transition.fromStatus });
      return;
    }

    workflowSupervisor.unregisterWorkflow(workflowRef);
    persistWorkflowStore();

    await auditWriter.write({
      user_id: actingUserId,
      action: 'workflow.cancel',
      resource_type: 'workflow_instance',
      resource_ref: workflowRef,
      resource_scope: actingRole === 'admin' ? 'system' : `private:${workflow.owner_user_id}`,
      result: 'success',
      detail_json: {
        target_owner_user_id: workflow.owner_user_id,
        from_status: transition.fromStatus,
        to_status: transition.toStatus,
        reason
      }
    });

    sendJson(res, 200, {
      ok: true,
      workflow_instance_ref: workflowRef,
      workflow_status: workflow.status
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/fail') && req.method === 'POST') {
    const workflowRef = pathname.split('/')[3];
    const workflow = workflowStore.get(workflowRef);

    if (!workflow) {
      sendJson(res, 404, { ok: false, error: 'workflow_not_found' });
      return;
    }

    const body = await readJson(req);
    const reason = (body.reason as string) || 'unspecified_failure';
    const actingUserId = typeof body.acting_user_id === 'string' && body.acting_user_id ? body.acting_user_id : workflow.owner_user_id;
    const actingRole = typeof body.acting_role === 'string' ? body.acting_role : 'user';
    if (actingUserId !== workflow.owner_user_id && actingRole !== 'admin') {
      sendJson(res, 403, { ok: false, error: 'permission_denied' });
      return;
    }

    const transition = transitionWorkflow(workflow, 'FAIL');

    if (!transition.ok) {
      sendJson(res, 409, { ok: false, error: 'invalid_state_transition', from_status: transition.fromStatus });
      return;
    }

    workflowSupervisor.unregisterWorkflow(workflowRef);
    persistWorkflowStore();

    await auditWriter.write({
      user_id: actingUserId,
      action: 'workflow.state.changed',
      resource_type: 'workflow_instance',
      resource_ref: workflowRef,
      resource_scope: actingRole === 'admin' ? 'system' : `private:${workflow.owner_user_id}`,
      result: 'failure',
      detail_json: {
        target_owner_user_id: workflow.owner_user_id,
        from_status: transition.fromStatus,
        to_status: transition.toStatus,
        reason
      }
    });

    sendJson(res, 200, {
      ok: true,
      workflow_instance_ref: workflowRef,
      workflow_status: workflow.status
    });
    return;
  }

  if (pathname.startsWith('/internal/checkpoints/create') && req.method === 'POST') {
    const body = await readJson(req);

    const workflowInstanceId = (body.workflow_instance_id as string) || '';
    const workflowStageId = (body.workflow_stage_id as string) || '';
    const policySnapshotHash = (body.policy_snapshot_hash as string) || '';
    if (!workflowInstanceId || !workflowStageId || !policySnapshotHash.startsWith('sha256:')) {
      sendJson(res, 400, {
        ok: false,
        error: 'invalid_checkpoint_payload',
        message: 'workflow_instance_id/workflow_stage_id required and policy_snapshot_hash must start with sha256:'
      });
      return;
    }

    const checkpoint = await checkpointManager.create({
      workflow_instance_id: workflowInstanceId,
      workflow_stage_id: workflowStageId,
      checkpoint_type: body.checkpoint_type as CheckpointCreateInput['checkpoint_type'] || 'stage-enter',
      policy_snapshot_hash: policySnapshotHash,
      status_snapshot: (body.status_snapshot as Record<string, unknown>) || {},
      artifact_refs: body.artifact_refs as string[] | undefined,
      fact_write_refs: body.fact_write_refs as string[] | undefined,
      notes: body.notes as string | undefined,
      next_action: body.next_action as string | undefined
    });

    sendJson(res, 200, {
      ok: true,
      checkpoint_id: checkpoint.id,
      resume_token: checkpoint.resume_token,
      state_hash: checkpoint.state_hash
    });
    return;
  }

  if (pathname === '/internal/checkpoints/resume' && req.method === 'POST') {
    const body = await readJson(req);

    const resumeToken = body.resume_token as string;
    const policySnapshotHash = body.policy_snapshot_hash as string;

    if (!resumeToken || !policySnapshotHash) {
      sendJson(res, 400, { ok: false, error: 'missing_required_fields' });
      return;
    }

    const result = await checkpointManager.resume(resumeToken, policySnapshotHash);

    sendJson(res, result.ok ? 200 : 400, {
      ok: result.ok,
      checkpoint: result.checkpoint,
      error: result.error,
      policy_hash_valid: result.policy_hash_valid
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/heartbeat') && req.method === 'POST') {
    const workflowRef = pathname.split('/')[3];
    const body = await readJson(req);
    const stageId = body.stage_id as string | undefined;
    const stageSeq = body.stage_seq as number | undefined;

    const heartbeatStatus = workflowSupervisor.recordHeartbeat(workflowRef, stageId, stageSeq);

    sendJson(res, 200, {
      ok: true,
      workflow_instance_ref: workflowRef,
      heartbeat_status: heartbeatStatus
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/supervision') && req.method === 'GET') {
    const workflowRef = pathname.split('/')[3];
    const progress = workflowSupervisor.getProgress(workflowRef);
    const heartbeatStatus = workflowSupervisor.getHeartbeatStatus(workflowRef);

    if (!progress && !heartbeatStatus) {
      sendJson(res, 200, {
        ok: true,
        supervised: false,
        workflow_instance_ref: workflowRef
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      supervised: true,
      workflow_instance_ref: workflowRef,
      progress,
      heartbeat_status: heartbeatStatus
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && pathname.endsWith('/progress') && req.method === 'GET') {
    const workflowRef = pathname.split('/')[3];
    const workflow = workflowStore.get(workflowRef);

    if (!workflow) {
      sendJson(res, 404, { ok: false, error: 'workflow_not_found' });
      return;
    }

    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const ownerUserId = parsedUrl.searchParams.get('owner_user_id');
    const actingRole = parsedUrl.searchParams.get('acting_role');
    const policySnapshotHash = parsedUrl.searchParams.get('policy_snapshot_hash');

    const hasAccess = validateWorkflowAccess(workflow, ownerUserId || undefined, actingRole || undefined, policySnapshotHash || undefined);
    if (!hasAccess) {
      sendJson(res, 403, { ok: false, error: 'access_denied', message: 'You do not have access to this workflow' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      progress: {
        workflow_id: workflow.id,
        status: workflow.status,
        stages: workflow.stages
      }
    });
    return;
  }

  if (pathname === '/internal/workflows' && req.method === 'GET') {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const query = parsedUrl.searchParams;
    const ownerUserId = query.get('owner_user_id');
    const actingRole = query.get('acting_role');
    const orgId = query.get('org_id');
    const limit = Math.min(Number(query.get('limit') || 50), 1000);

    if (!ownerUserId && actingRole !== 'admin') {
      sendJson(res, 400, { ok: false, error: 'owner_user_id_required' });
      return;
    }

    let workflows = Array.from(workflowStore.values());
    if (ownerUserId) {
      workflows = workflows.filter(w => w.owner_user_id === ownerUserId);
    }
    if (orgId) {
      workflows = workflows.filter(w => w.org_id === orgId);
    }
    if (actingRole !== 'admin' && !ownerUserId) {
      workflows = [];
    }
    workflows = workflows.slice(0, limit);
    sendJson(res, 200, {
      ok: true,
      workflows: workflows.map(w => ({
        id: w.id,
        status: w.status,
        owner_user_id: w.owner_user_id,
        org_id: w.org_id,
        plan: w.plan,
        created_at: w.created_at
      }))
    });
    return;
  }

  if (pathname.startsWith('/internal/workflows/') && req.method === 'GET') {
    const pathParts = pathname.split('/');
    if (pathParts.length > 4 && pathParts[4]) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }

    const workflowRef = pathParts[3];
    const workflow = workflowStore.get(workflowRef);

    if (!workflow) {
      sendJson(res, 404, { ok: false, error: 'workflow_not_found' });
      return;
    }

    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const orgId = parsedUrl.searchParams.get('org_id');
    const ownerUserId = parsedUrl.searchParams.get('owner_user_id');
    const actingRole = parsedUrl.searchParams.get('acting_role');
    const policySnapshotHash = parsedUrl.searchParams.get('policy_snapshot_hash');

    const hasAccess = validateWorkflowAccess(workflow, ownerUserId || undefined, actingRole || undefined, policySnapshotHash || undefined);
    if (!hasAccess) {
      sendJson(res, 403, { ok: false, error: 'access_denied', message: 'You do not have access to this workflow' });
      return;
    }

    if (orgId && workflow.org_id && workflow.org_id !== orgId) {
      sendJson(res, 403, { ok: false, error: 'org_mismatch' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      workflow: {
        id: workflow.id,
        status: workflow.status,
        owner_user_id: workflow.owner_user_id,
        org_id: workflow.org_id,
        plan: workflow.plan,
        stages: workflow.stages,
        created_at: workflow.created_at
      }
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.unhandled_error', 'Unhandled request error', {
      error: (error as Error).message,
      stack: (error as Error).stack?.slice(0, 500)
    });
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    }
  }
  await httpResponseLogger(req, res, responseBody);
});

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

server.listen(port, () => {
  logger.info('service.started', 'Workflow service started', { port });

  aggregationInterval = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') {
      writeAggregationReport(report);
    }
  }, 15000);
  if (aggregationInterval.unref) aggregationInterval.unref();
});

void bootstrapWorkflowStoreFromDatabase();

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info('service.shutdown', 'Workflow service shutting down', { signal });
  if (aggregationInterval) { clearInterval(aggregationInterval); aggregationInterval = null; }
  const finalReport = analyze();
  writeAggregationReport(finalReport);
  metricsRegistry.shutdown();
  await logger.shutdown();
  server.close(async () => {
    for (const ref of workflowSupervisor.listSupervised()) {
      workflowSupervisor.unregisterWorkflow(ref);
    }
    await checkpointManager.shutdown();
    await closeWorkflowDbPool();
    logger.info('service.shutdown.complete', 'Workflow service shutdown complete', {});
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});
