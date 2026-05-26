import { createLogger } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';

const logger = createLogger('workflow-supervisor');

const PERSIST_DEBOUNCE_MS = 2000;

export interface SupervisionConfig {
  heartbeat_interval_sec: number;
  soft_timeout_sec: number;
  hard_timeout_sec: number;
  max_retries: number;
  retry_backoff_sec: number;
  max_retry_backoff_sec: number;
  progress_check_interval_sec: number;
}

export interface WorkflowProgress {
  workflow_instance_ref: string;
  current_stage_id: string;
  current_stage_seq: number;
  total_stages: number;
  status: 'running' | 'paused' | 'waiting_user' | 'blocked' | 'succeeded' | 'failed' | 'timeout';
  progress_percentage: number;
  elapsed_seconds: number;
  remaining_budget_seconds: number;
  retry_count: number;
  last_heartbeat_at: string;
  started_at: string;
  estimated_completion_at?: string;
}

export interface HeartbeatStatus {
  alive: boolean;
  last_heartbeat_at: string;
  missed_heartbeats: number;
  grace_periods_remaining: number;
}

export type TimeoutAction = 'retry' | 'checkpoint_and_pause' | 'fail' | 'escalate';
export type SupervisionEvent = 'heartbeat' | 'timeout_soft' | 'timeout_hard' | 'progress_update' | 'retry_triggered' | 'recovered';

interface SupervisedWorkflow {
  workflow_instance_ref: string;
  owner_user_id: string;
  config: SupervisionConfig;
  progress: WorkflowProgress;
  heartbeat_status: HeartbeatStatus;
  retry_history: Array<{ at: string; reason: string; success: boolean }>;
  last_progress_update_at: string;
  checkpoint_on_timeout: boolean;
}

const DEFAULT_CONFIG: SupervisionConfig = {
  heartbeat_interval_sec: 30,
  soft_timeout_sec: 600,
  hard_timeout_sec: 3600,
  max_retries: 3,
  retry_backoff_sec: 10,
  max_retry_backoff_sec: 60,
  progress_check_interval_sec: 15
};

export class WorkflowSupervisor {
  private supervisedWorkflows: Map<string, SupervisedWorkflow> = new Map();
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  private timeoutTimers: Map<string, NodeJS.Timeout> = new Map();
  private progressTimers: Map<string, NodeJS.Timeout> = new Map();
  private progressCallbacks: Map<string, (progress: WorkflowProgress) => void> = new Map();
  private persistTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingHeartbeats: Map<string, { stageId?: string; stageSeq?: number; attempts: number; maxAttempts: number; timer: NodeJS.Timeout }> = new Map();

  private static readonly HEARTBEAT_RETRY_MAX = 5;
  private static readonly HEARTBEAT_RETRY_DELAY_MS = 500;

  async registerWorkflow(
    workflowInstanceRef: string,
    ownerId: string,
    totalStages: number,
    budgetSeconds: number,
    customConfig?: Partial<SupervisionConfig>
  ): Promise<void> {
    const config = { ...DEFAULT_CONFIG, ...customConfig };
    const now = new Date().toISOString();

    const supervised: SupervisedWorkflow = {
      workflow_instance_ref: workflowInstanceRef,
      owner_user_id: ownerId,
      config,
      progress: {
        workflow_instance_ref: workflowInstanceRef,
        current_stage_id: '',
        current_stage_seq: 0,
        total_stages: totalStages,
        status: 'running',
        progress_percentage: 0,
        elapsed_seconds: 0,
        remaining_budget_seconds: budgetSeconds,
        retry_count: 0,
        last_heartbeat_at: now,
        started_at: now
      },
      heartbeat_status: {
        alive: true,
        last_heartbeat_at: now,
        missed_heartbeats: 0,
        grace_periods_remaining: 3
      },
      retry_history: [],
      last_progress_update_at: now,
      checkpoint_on_timeout: true
    };

    this.supervisedWorkflows.set(workflowInstanceRef, supervised);
    this.startSupervision(workflowInstanceRef);
    this.schedulePersist(workflowInstanceRef);
    this.flushPendingHeartbeats(workflowInstanceRef);

    logger.info('supervisor.registered', 'Workflow registered for supervision', {
      workflow_instance_ref: workflowInstanceRef,
      total_stages: totalStages,
      budget_seconds: budgetSeconds,
      heartbeat_interval: config.heartbeat_interval_sec
    });

    await auditWriter.write({
      user_id: ownerId,
      action: 'workflow.create',
      resource_type: 'workflow_supervision',
      resource_ref: workflowInstanceRef,
      resource_scope: `private:${ownerId}`,
      result: 'success',
      detail_json: {
        action: 'supervisor_register',
        config,
        total_stages: totalStages
      }
    });
  }

  unregisterWorkflow(workflowInstanceRef: string): void {
    this.stopSupervision(workflowInstanceRef);
    this.supervisedWorkflows.delete(workflowInstanceRef);
    this.progressCallbacks.delete(workflowInstanceRef);

    logger.info('supervisor.unregistered', 'Workflow supervision stopped', {
      workflow_instance_ref: workflowInstanceRef
    });
  }

  recordHeartbeat(workflowInstanceRef: string, stageId?: string, stageSeq?: number): HeartbeatStatus {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) {
      this.queueHeartbeatRetry(workflowInstanceRef, stageId, stageSeq);
      return { alive: false, last_heartbeat_at: '', missed_heartbeats: 0, grace_periods_remaining: 0 };
    }

    const now = new Date().toISOString();
    supervised.heartbeat_status = {
      alive: true,
      last_heartbeat_at: now,
      missed_heartbeats: 0,
      grace_periods_remaining: supervised.config.max_retries
    };

    if (stageId) {
      supervised.progress.current_stage_id = stageId;
      if (stageSeq !== undefined) {
        supervised.progress.current_stage_seq = stageSeq;
        supervised.progress.progress_percentage = Math.round((stageSeq / supervised.progress.total_stages) * 100);
      }
    }

    supervised.progress.last_heartbeat_at = now;
    supervised.progress.elapsed_seconds = Math.round(
      (Date.now() - new Date(supervised.progress.started_at).getTime()) / 1000
    );

    this.resetTimeoutTimers(workflowInstanceRef);

    logger.info('supervisor.heartbeat.recorded', 'Heartbeat recorded', {
      workflow_instance_ref: workflowInstanceRef,
      stage_id: stageId,
      progress: supervised.progress.progress_percentage
    });

    this.emitProgress(workflowInstanceRef);
    this.schedulePersist(workflowInstanceRef);
    return supervised.heartbeat_status;
  }

  async updateProgress(
    workflowInstanceRef: string,
    stageId: string,
    stageSeq: number,
    status: WorkflowProgress['status'],
    outputPreview?: string
  ): Promise<WorkflowProgress> {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) {
      throw new Error(`Workflow ${workflowInstanceRef} not registered for supervision`);
    }

    const now = new Date().toISOString();
    supervised.progress.current_stage_id = stageId;
    supervised.progress.current_stage_seq = stageSeq;
    supervised.progress.status = status;
    supervised.progress.progress_percentage = Math.round((stageSeq / supervised.progress.total_stages) * 100);
    supervised.progress.elapsed_seconds = Math.round(
      (Date.now() - new Date(supervised.progress.started_at).getTime()) / 1000
    );
    supervised.progress.last_heartbeat_at = now;
    supervised.last_progress_update_at = now;

    if (status === 'succeeded' || status === 'failed') {
      supervised.progress.estimated_completion_at = now;
      this.unregisterWorkflow(workflowInstanceRef);
      void this.removePersistedState(workflowInstanceRef);
    } else {
      this.schedulePersist(workflowInstanceRef);
    }

    logger.info('supervisor.progress.updated', 'Progress updated', {
      workflow_instance_ref: workflowInstanceRef,
      stage_id: stageId,
      stage_seq: stageSeq,
      status,
      progress_percentage: supervised.progress.progress_percentage
    });

    await auditWriter.write({
      user_id: supervised.owner_user_id,
      action: 'workflow.state.changed',
      resource_type: 'workflow_progress',
      resource_ref: workflowInstanceRef,
      resource_scope: `private:${supervised.owner_user_id}`,
      result: status === 'failed' ? 'failure' : 'success',
      detail_json: {
        stage_id: stageId,
        stage_seq: stageSeq,
        status,
        progress_percentage: supervised.progress.progress_percentage,
        output_preview: outputPreview?.slice(0, 200)
      }
    });

    this.emitProgress(workflowInstanceRef);
    return supervised.progress;
  }

  getProgress(workflowInstanceRef: string): WorkflowProgress | null {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    return supervised?.progress || null;
  }

  getHeartbeatStatus(workflowInstanceRef: string): HeartbeatStatus | null {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    return supervised?.heartbeat_status || null;
  }

  setProgressCallback(workflowInstanceRef: string, callback: (progress: WorkflowProgress) => void): void {
    this.progressCallbacks.set(workflowInstanceRef, callback);
  }

  async handleTimeout(workflowInstanceRef: string, timeoutType: 'soft' | 'hard'): Promise<TimeoutAction> {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) {
      return 'fail';
    }

    const action: TimeoutAction = timeoutType === 'soft' && supervised.progress.retry_count < supervised.config.max_retries
      ? 'retry'
      : supervised.checkpoint_on_timeout
        ? 'checkpoint_and_pause'
        : 'fail';

    logger.warn('supervisor.timeout.detected', `${timeoutType} timeout detected`, {
      workflow_instance_ref: workflowInstanceRef,
      action,
      retry_count: supervised.progress.retry_count,
      max_retries: supervised.config.max_retries
    });

    await auditWriter.write({
      user_id: supervised.owner_user_id,
      action: 'workflow.state.changed',
      resource_type: 'workflow_timeout',
      resource_ref: workflowInstanceRef,
      resource_scope: `private:${supervised.owner_user_id}`,
      result: 'failure',
      detail_json: {
        timeout_type: timeoutType,
        action,
        elapsed_seconds: supervised.progress.elapsed_seconds,
        retry_count: supervised.progress.retry_count
      }
    });

    if (action === 'retry') {
      supervised.progress.retry_count += 1;
      supervised.progress.status = 'running';
      supervised.retry_history.push({
        at: new Date().toISOString(),
        reason: `${timeoutType}_timeout`,
        success: false
      });
      this.emitProgress(workflowInstanceRef);
      return 'retry';
    }

    supervised.progress.status = 'timeout';
    this.emitProgress(workflowInstanceRef);
    this.unregisterWorkflow(workflowInstanceRef);
    return action;
  }

  private startSupervision(workflowInstanceRef: string): void {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) return;

    this.stopSupervision(workflowInstanceRef);

    const heartbeatTimer = setInterval(() => {
      this.checkHeartbeat(workflowInstanceRef);
    }, supervised.config.heartbeat_interval_sec * 1000);
    heartbeatTimer.unref();
    this.heartbeatTimers.set(workflowInstanceRef, heartbeatTimer);

    const progressTimer = setInterval(() => {
      this.checkProgress(workflowInstanceRef);
    }, supervised.config.progress_check_interval_sec * 1000);
    progressTimer.unref();
    this.progressTimers.set(workflowInstanceRef, progressTimer);

    const softTimeoutTimer = setTimeout(() => {
      void this.handleTimeout(workflowInstanceRef, 'soft');
    }, supervised.config.soft_timeout_sec * 1000);
    softTimeoutTimer.unref();
    this.timeoutTimers.set(workflowInstanceRef + '_soft', softTimeoutTimer);

    const hardTimeoutTimer = setTimeout(() => {
      void this.handleTimeout(workflowInstanceRef, 'hard');
    }, supervised.config.hard_timeout_sec * 1000);
    hardTimeoutTimer.unref();
    this.timeoutTimers.set(workflowInstanceRef + '_hard', hardTimeoutTimer);
  }

  private stopSupervision(workflowInstanceRef: string): void {
    const heartbeatTimer = this.heartbeatTimers.get(workflowInstanceRef);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      this.heartbeatTimers.delete(workflowInstanceRef);
    }

    const progressTimer = this.progressTimers.get(workflowInstanceRef);
    if (progressTimer) {
      clearInterval(progressTimer);
      this.progressTimers.delete(workflowInstanceRef);
    }

    const softTimer = this.timeoutTimers.get(workflowInstanceRef + '_soft');
    if (softTimer) {
      clearTimeout(softTimer);
      this.timeoutTimers.delete(workflowInstanceRef + '_soft');
    }

    const hardTimer = this.timeoutTimers.get(workflowInstanceRef + '_hard');
    if (hardTimer) {
      clearTimeout(hardTimer);
      this.timeoutTimers.delete(workflowInstanceRef + '_hard');
    }
  }

  private resetTimeoutTimers(workflowInstanceRef: string): void {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) return;

    const softTimer = this.timeoutTimers.get(workflowInstanceRef + '_soft');
    if (softTimer) clearTimeout(softTimer);

    const hardTimer = this.timeoutTimers.get(workflowInstanceRef + '_hard');
    if (hardTimer) clearTimeout(hardTimer);

    const newSoftTimer = setTimeout(() => {
      void this.handleTimeout(workflowInstanceRef, 'soft');
    }, supervised.config.soft_timeout_sec * 1000);
    newSoftTimer.unref();
    this.timeoutTimers.set(workflowInstanceRef + '_soft', newSoftTimer);

    const newHardTimer = setTimeout(() => {
      void this.handleTimeout(workflowInstanceRef, 'hard');
    }, supervised.config.hard_timeout_sec * 1000);
    newHardTimer.unref();
    this.timeoutTimers.set(workflowInstanceRef + '_hard', newHardTimer);
  }

  private checkHeartbeat(workflowInstanceRef: string): void {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) return;

    if (supervised.progress.status === 'paused' || supervised.progress.status === 'waiting_user') {
      return;
    }

    const lastHeartbeatMs = new Date(supervised.heartbeat_status.last_heartbeat_at).getTime();
    const elapsedSinceLastHeartbeat = (Date.now() - lastHeartbeatMs) / 1000;
    const missedHeartbeats = Math.floor(elapsedSinceLastHeartbeat / supervised.config.heartbeat_interval_sec);

    if (missedHeartbeats > 0) {
      supervised.heartbeat_status.missed_heartbeats = missedHeartbeats;
      supervised.heartbeat_status.grace_periods_remaining = Math.max(
        0,
        supervised.config.max_retries - missedHeartbeats
      );
      supervised.heartbeat_status.alive = supervised.heartbeat_status.grace_periods_remaining > 0;

      logger.warn('supervisor.heartbeat.missed', 'Heartbeat missed', {
        workflow_instance_ref: workflowInstanceRef,
        missed_heartbeats: missedHeartbeats,
        grace_periods_remaining: supervised.heartbeat_status.grace_periods_remaining,
        alive: supervised.heartbeat_status.alive
      });

      if (!supervised.heartbeat_status.alive) {
        void this.handleTimeout(workflowInstanceRef, 'soft');
      }
    }
  }

  private checkProgress(workflowInstanceRef: string): void {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) return;

    const elapsedSinceProgressUpdate = (Date.now() - new Date(supervised.last_progress_update_at).getTime()) / 1000;
    if (elapsedSinceProgressUpdate > supervised.config.soft_timeout_sec) {
      logger.warn('supervisor.progress.stalled', 'Progress stalled', {
        workflow_instance_ref: workflowInstanceRef,
        elapsed_since_progress: elapsedSinceProgressUpdate,
        current_stage: supervised.progress.current_stage_id
      });
    }
  }

  private emitProgress(workflowInstanceRef: string): void {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    const callback = this.progressCallbacks.get(workflowInstanceRef);
    if (supervised && callback) {
      callback(supervised.progress);
    }
  }

  listSupervised(): string[] {
    return Array.from(this.supervisedWorkflows.keys());
  }

  getRetryBackoffDelay(workflowInstanceRef: string): number {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) return 0;

    const backoffMultiplier = Math.pow(2, supervised.progress.retry_count - 1);
    const delay = supervised.config.retry_backoff_sec * backoffMultiplier;
    return Math.min(delay, supervised.config.max_retry_backoff_sec);
  }

  private schedulePersist(workflowInstanceRef: string): void {
    const existing = this.persistTimers.get(workflowInstanceRef);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.persistToDb(workflowInstanceRef);
    }, PERSIST_DEBOUNCE_MS);
    timer.unref();
    this.persistTimers.set(workflowInstanceRef, timer);
  }

  private queueHeartbeatRetry(workflowInstanceRef: string, stageId?: string, stageSeq?: number): void {
    const existing = this.pendingHeartbeats.get(workflowInstanceRef);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const attempts = (existing?.attempts ?? 0) + 1;
    if (attempts > WorkflowSupervisor.HEARTBEAT_RETRY_MAX) {
      logger.warn('supervisor.heartbeat.unknown', 'Heartbeat for unknown workflow after retries', {
        workflow_instance_ref: workflowInstanceRef,
        attempts
      });
      this.pendingHeartbeats.delete(workflowInstanceRef);
      return;
    }

    const timer = setTimeout(() => {
      this.pendingHeartbeats.delete(workflowInstanceRef);
      this.recordHeartbeat(workflowInstanceRef, stageId, stageSeq);
    }, WorkflowSupervisor.HEARTBEAT_RETRY_DELAY_MS);
    timer.unref();

    this.pendingHeartbeats.set(workflowInstanceRef, {
      stageId,
      stageSeq,
      attempts,
      maxAttempts: WorkflowSupervisor.HEARTBEAT_RETRY_MAX,
      timer
    });
  }

  private flushPendingHeartbeats(workflowInstanceRef: string): void {
    const pending = this.pendingHeartbeats.get(workflowInstanceRef);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingHeartbeats.delete(workflowInstanceRef);

    logger.info('supervisor.heartbeat.flushed', 'Flushed pending heartbeat after registration', {
      workflow_instance_ref: workflowInstanceRef,
      pending_attempts: pending.attempts
    });

    this.recordHeartbeat(workflowInstanceRef, pending.stageId, pending.stageSeq);
  }

  private async persistToDb(workflowInstanceRef: string): Promise<void> {
    const supervised = this.supervisedWorkflows.get(workflowInstanceRef);
    if (!supervised) return;

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;

    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: databaseUrl, max: 2 });
      try {
        await pool.query(
          `INSERT INTO supervision_state (workflow_instance_ref, owner_user_id, state_json, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (workflow_instance_ref) DO UPDATE SET state_json = $3, updated_at = now()`,
          [
            workflowInstanceRef,
            supervised.owner_user_id,
            JSON.stringify({
              config: supervised.config,
              progress: supervised.progress,
              heartbeat_status: supervised.heartbeat_status,
              retry_history: supervised.retry_history,
              last_progress_update_at: supervised.last_progress_update_at,
              checkpoint_on_timeout: supervised.checkpoint_on_timeout
            })
          ]
        );
      } finally {
        await pool.end();
      }
    } catch (error) {
      logger.warn('supervisor.persist.failed', 'Failed to persist supervision state', {
        workflow_instance_ref: workflowInstanceRef,
        error: String(error)
      });
    }
  }

  async restoreFromDb(): Promise<number> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return 0;

    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: databaseUrl, max: 2 });
      try {
        const result = await pool.query(
          `SELECT workflow_instance_ref, owner_user_id, state_json FROM supervision_state WHERE updated_at > now() - interval '1 hour'`
        );

        let restored = 0;
        for (const row of result.rows) {
          try {
            const state = JSON.parse(row.state_json);
            if (state.progress?.status === 'running') {
              const supervised: SupervisedWorkflow = {
                workflow_instance_ref: row.workflow_instance_ref,
                owner_user_id: row.owner_user_id,
                config: state.config || DEFAULT_CONFIG,
                progress: state.progress,
                heartbeat_status: state.heartbeat_status || { alive: true, last_heartbeat_at: new Date().toISOString(), missed_heartbeats: 0, grace_periods_remaining: 3 },
                retry_history: state.retry_history || [],
                last_progress_update_at: state.last_progress_update_at || new Date().toISOString(),
                checkpoint_on_timeout: state.checkpoint_on_timeout ?? true
              };

              this.supervisedWorkflows.set(row.workflow_instance_ref, supervised);
              this.startSupervision(row.workflow_instance_ref);
              restored++;
            }
          } catch {
            // skip invalid state
          }
        }

        if (restored > 0) {
          logger.info('supervisor.restored', 'Restored supervision states from DB', { restored });
        }
        return restored;
      } finally {
        await pool.end();
      }
    } catch (error) {
      logger.warn('supervisor.restore.failed', 'Failed to restore supervision states', {
        error: String(error)
      });
      return 0;
    }
  }

  async removePersistedState(workflowInstanceRef: string): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;

    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: databaseUrl, max: 2 });
      try {
        await pool.query(
          `DELETE FROM supervision_state WHERE workflow_instance_ref = $1`,
          [workflowInstanceRef]
        );
      } finally {
        await pool.end();
      }
    } catch {
      // best effort
    }
  }
}

export const workflowSupervisor = new WorkflowSupervisor();
