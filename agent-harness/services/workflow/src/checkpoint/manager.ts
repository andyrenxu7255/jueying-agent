import { createHash, randomBytes } from 'crypto';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { promises as fsp } from 'fs';
import { createLogger } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import type { Checkpoint } from '@agent-harness/contracts';
import { loadCheckpointByResumeToken, loadCheckpointRefsByResumeToken, loadRecentCheckpoints, persistCheckpointRecord } from '../persistence/db';

const logger = createLogger('checkpoint-manager');

export type CheckpointType = 'stage-enter' | 'stage-exit' | 'waiting-user' | 'blocked' | 'paused' | 'repair';

export interface CheckpointCreateInput {
  workflow_instance_id: string;
  workflow_stage_id: string;
  checkpoint_type: CheckpointType;
  policy_snapshot_hash: string;
  status_snapshot: Record<string, unknown>;
  artifact_refs?: string[];
  fact_write_refs?: string[];
  verification_refs?: string[];
  evidence_pack_hash?: string;
  tool_call_refs?: string[];
  notes?: string;
  next_action?: string;
}

export interface CheckpointResumeResult {
  ok: boolean;
  checkpoint: Checkpoint | null;
  error?: string;
  policy_hash_valid: boolean;
  state_hash_valid: boolean;
}

interface StoredCheckpoint extends Checkpoint {
  id: string;
  resume_token: string;
  state_hash: string;
  created_at: string;
}

export class CheckpointManager {
  private checkpoints: Map<string, StoredCheckpoint> = new Map();
  private resumeTokens: Map<string, string> = new Map();
  private readonly storePath = resolve(process.cwd(), '.runtime', 'checkpoint-store.json');
  private readonly MAX_CHECKPOINTS = 5000;

  constructor() {
    this.loadFromDisk();
    this.loadFromDatabase().catch(err => {
      logger.warn('checkpoint.db_load.failed', 'Failed to load checkpoints from database on startup', { error: String(err) });
    });
  }

  private evictOldCheckpoints(): void {
    if (this.checkpoints.size <= this.MAX_CHECKPOINTS) return;
    const entries = Array.from(this.checkpoints.entries())
      .sort((a, b) => a[1].created_at.localeCompare(b[1].created_at));
    const toEvict = entries.slice(0, this.checkpoints.size - this.MAX_CHECKPOINTS + 100);
    for (const [key, cp] of toEvict) {
      this.checkpoints.delete(key);
      this.resumeTokens.delete(cp.resume_token);
    }
  }

  async create(input: CheckpointCreateInput): Promise<Checkpoint> {
    const resumeToken = this.generateResumeToken();
    const stateHash = this.calculateStateHash(input);
    const checkpointId = `cp_${Date.now()}_${randomBytes(4).toString('hex')}`;

    const checkpoint: StoredCheckpoint = {
      id: checkpointId,
      workflow_instance_id: input.workflow_instance_id,
      workflow_stage_id: input.workflow_stage_id,
      checkpoint_type: input.checkpoint_type,
      resume_token: resumeToken,
      state_hash: stateHash,
      policy_snapshot_hash: input.policy_snapshot_hash,
      status_snapshot: input.status_snapshot,
      artifact_refs: input.artifact_refs || [],
      fact_write_refs: input.fact_write_refs || [],
      verification_refs: input.verification_refs || [],
      evidence_pack_hash: input.evidence_pack_hash || '',
      tool_call_refs: input.tool_call_refs || [],
      next_action: input.next_action || '',
      created_at: new Date().toISOString()
    };

    this.checkpoints.set(checkpointId, checkpoint);
    this.resumeTokens.set(resumeToken, checkpointId);
    this.evictOldCheckpoints();
    await this.persistToDisk();
    persistCheckpointRecord(checkpoint).catch(err => {
      logger.warn('checkpoint.db_persist.failed', 'Failed to persist checkpoint to database', {
        checkpoint_id: checkpointId,
        error: String(err)
      });
    });

    await auditWriter.write({
      user_id: 'system',
      action: 'checkpoint.resume',
      resource_type: 'checkpoint',
      resource_ref: checkpointId,
      resource_scope: 'system',
      result: 'success',
      detail_json: {
        workflow_instance_id: input.workflow_instance_id,
        checkpoint_type: input.checkpoint_type,
        resume_token: resumeToken
      }
    });

    logger.info('checkpoint.created', 'Checkpoint created', {
      checkpoint_id: checkpointId,
      workflow_instance_id: input.workflow_instance_id,
      checkpoint_type: input.checkpoint_type
    });

    return checkpoint;
  }

  private validateStoredStateHash(checkpoint: StoredCheckpoint): boolean {
    const data = JSON.stringify({
      workflow_instance_id: checkpoint.workflow_instance_id,
      workflow_stage_id: checkpoint.workflow_stage_id,
      checkpoint_type: checkpoint.checkpoint_type,
      policy_snapshot_hash: checkpoint.policy_snapshot_hash,
      status_snapshot: checkpoint.status_snapshot,
      artifact_refs: (checkpoint.artifact_refs || []).sort(),
      fact_write_refs: (checkpoint.fact_write_refs || []).sort(),
      verification_refs: (checkpoint.verification_refs || []).sort()
    });
    const expectedHash = `sha256:${createHash('sha256').update(data).digest('hex')}`;
    return checkpoint.state_hash === expectedHash;
  }

  async resume(resumeToken: string, currentPolicySnapshotHash: string): Promise<CheckpointResumeResult> {
    let checkpointId = this.resumeTokens.get(resumeToken);
    if (!checkpointId) {
      await this.hydrateCheckpointFromDatabase(resumeToken);
      checkpointId = this.resumeTokens.get(resumeToken);
    }
    if (!checkpointId) {
      return {
        ok: false,
        checkpoint: null,
        error: 'invalid_resume_token',
        policy_hash_valid: false,
        state_hash_valid: false
      };
    }

    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return {
        ok: false,
        checkpoint: null,
        error: 'checkpoint_not_found',
        policy_hash_valid: false,
        state_hash_valid: false
      };
    }

    const stateHashValid = this.validateStoredStateHash(checkpoint);
    if (!stateHashValid) {
      await auditWriter.write({
        user_id: 'system',
        action: 'checkpoint.resume',
        resource_type: 'checkpoint',
        resource_ref: checkpointId,
        resource_scope: 'system',
        result: 'failure',
        detail_json: {
          workflow_instance_id: checkpoint.workflow_instance_id,
          error: 'state_hash_mismatch',
          stored_hash: checkpoint.state_hash
        }
      });

      logger.warn('checkpoint.resume.rejected', 'Checkpoint resume rejected due to state hash mismatch', {
        checkpoint_id: checkpointId,
        stored_hash: checkpoint.state_hash
      });

      return {
        ok: false,
        checkpoint: null,
        error: 'checkpoint_integrity_violation',
        policy_hash_valid: false,
        state_hash_valid: false
      };
    }

    const policyHashValid = checkpoint.policy_snapshot_hash === currentPolicySnapshotHash;
    if (!policyHashValid) {
      await auditWriter.write({
        user_id: 'system',
        action: 'checkpoint.resume',
        resource_type: 'checkpoint',
        resource_ref: checkpointId,
        resource_scope: 'system',
        result: 'failure',
        detail_json: {
          workflow_instance_id: checkpoint.workflow_instance_id,
          error: 'policy_snapshot_hash_mismatch',
          expected_hash: checkpoint.policy_snapshot_hash,
          provided_hash: currentPolicySnapshotHash
        }
      });

      logger.warn('checkpoint.resume.rejected', 'Checkpoint resume rejected due to policy hash mismatch', {
        checkpoint_id: checkpointId,
        expected_hash: checkpoint.policy_snapshot_hash,
        provided_hash: currentPolicySnapshotHash
      });

      return {
        ok: false,
        checkpoint: null,
        error: 'policy_snapshot_hash_mismatch',
        policy_hash_valid: false,
        state_hash_valid: true
      };
    }

    await auditWriter.write({
      user_id: 'system',
      action: 'checkpoint.resume',
      resource_type: 'checkpoint',
      resource_ref: checkpointId,
      resource_scope: 'system',
      result: 'success',
      detail_json: {
        workflow_instance_id: checkpoint.workflow_instance_id,
        checkpoint_type: checkpoint.checkpoint_type
      }
    });

    logger.info('checkpoint.resumed', 'Checkpoint resumed successfully', {
      checkpoint_id: checkpointId,
      workflow_instance_id: checkpoint.workflow_instance_id
    });

    return {
      ok: true,
      checkpoint: checkpoint,
      policy_hash_valid: true,
      state_hash_valid: true
    };
  }

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    return this.checkpoints.get(checkpointId) || null;
  }

  async getCheckpointByResumeToken(resumeToken: string): Promise<Checkpoint | null> {
    const checkpointId = this.resumeTokens.get(resumeToken);
    if (!checkpointId) return null;
    return this.checkpoints.get(checkpointId) || null;
  }

  async listCheckpointsForWorkflow(workflowInstanceId: string): Promise<Checkpoint[]> {
    const results: Checkpoint[] = [];
    for (const checkpoint of this.checkpoints.values()) {
      if (checkpoint.workflow_instance_id === workflowInstanceId) {
        results.push(checkpoint);
      }
    }
    return results.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return false;

    this.checkpoints.delete(checkpointId);
    this.resumeTokens.delete(checkpoint.resume_token);
    await this.persistToDisk();

    logger.info('checkpoint.deleted', 'Checkpoint deleted', {
      checkpoint_id: checkpointId
    });

    return true;
  }

  async shutdown(): Promise<void> {
    await this.persistToDisk();
  }

  private generateResumeToken(): string {
    return `resume_${Date.now()}_${randomBytes(16).toString('hex')}`;
  }

  private calculateStateHash(input: CheckpointCreateInput): string {
    const data = JSON.stringify({
      workflow_instance_id: input.workflow_instance_id,
      workflow_stage_id: input.workflow_stage_id,
      checkpoint_type: input.checkpoint_type,
      policy_snapshot_hash: input.policy_snapshot_hash,
      status_snapshot: input.status_snapshot,
      artifact_refs: (input.artifact_refs || []).sort(),
      fact_write_refs: (input.fact_write_refs || []).sort(),
      verification_refs: (input.verification_refs || []).sort()
    });
    return `sha256:${createHash('sha256').update(data).digest('hex')}`;
  }

  shouldCreateCheckpoint(stageType: string, currentStatus: string, nextStatus: string): boolean {
    const mandatoryCreateScenarios = [
      { from: 'running', to: 'waiting_user' },
      { from: 'running', to: 'blocked' },
      { from: 'running', to: 'paused' },
      { from: 'verifying', to: 'paused' },
      { from: 'repairing', to: 'paused' },
      { from: 'reporting', to: 'paused' }
    ];

    if (mandatoryCreateScenarios.some(s => s.from === currentStatus && s.to === nextStatus)) {
      return true;
    }

    if (stageType === 'Implementation' && nextStatus === 'verifying') {
      return true;
    }

    return false;
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.storePath)) {
        return;
      }

      const raw = readFileSync(this.storePath, 'utf8');
      if (!raw.trim()) {
        return;
      }

      const parsed = JSON.parse(raw) as {
        checkpoints?: StoredCheckpoint[];
        resume_tokens?: Array<[string, string]>;
      };

      for (const checkpoint of parsed.checkpoints || []) {
        if (!checkpoint?.id || !checkpoint?.resume_token) {
          continue;
        }
        this.checkpoints.set(checkpoint.id, checkpoint);
      }

      for (const [token, checkpointId] of parsed.resume_tokens || []) {
        if (this.checkpoints.has(checkpointId)) {
          this.resumeTokens.set(token, checkpointId);
        }
      }

      if (this.resumeTokens.size === 0 && this.checkpoints.size > 0) {
        for (const checkpoint of this.checkpoints.values()) {
          this.resumeTokens.set(checkpoint.resume_token, checkpoint.id);
        }
      }

      logger.info('checkpoint.store.loaded', 'Checkpoint store loaded from disk', {
        checkpoints: this.checkpoints.size
      });
    } catch (error) {
      logger.warn('checkpoint.store.load_failed', 'Failed to load checkpoint store, continuing with empty state', {
        error: String(error)
      });
      this.checkpoints.clear();
      this.resumeTokens.clear();
    }
  }

  private async loadFromDatabase(): Promise<void> {
    const recent = await loadRecentCheckpoints(2000);
    for (const checkpointFromDb of recent) {
      if (this.resumeTokens.has(checkpointFromDb.resume_token)) {
        continue;
      }

      const checkpointId = checkpointFromDb.id;
      const hydrated: StoredCheckpoint = {
        id: checkpointId,
        workflow_instance_id: checkpointFromDb.workflow_instance_id || '',
        workflow_stage_id: checkpointFromDb.workflow_stage_id || '',
        checkpoint_type: checkpointFromDb.checkpoint_type as CheckpointType,
        resume_token: checkpointFromDb.resume_token,
        state_hash: checkpointFromDb.state_hash,
        policy_snapshot_hash: checkpointFromDb.policy_snapshot_hash,
        status_snapshot: checkpointFromDb.status_snapshot,
        artifact_refs: checkpointFromDb.artifact_refs,
        fact_write_refs: checkpointFromDb.fact_write_refs,
        verification_refs: checkpointFromDb.verification_refs,
        evidence_pack_hash: checkpointFromDb.evidence_pack_hash,
        tool_call_refs: checkpointFromDb.tool_call_refs,
        next_action: checkpointFromDb.next_action,
        created_at: checkpointFromDb.created_at
      };

      this.checkpoints.set(checkpointId, hydrated);
      this.resumeTokens.set(checkpointFromDb.resume_token, checkpointId);
    }

    if (recent.length > 0) {
      await this.persistToDisk();
    }
  }

  private async hydrateCheckpointFromDatabase(resumeToken: string): Promise<void> {
    const checkpointFromDb = await loadCheckpointByResumeToken(resumeToken);
    if (!checkpointFromDb) {
      return;
    }

    const refs = await loadCheckpointRefsByResumeToken(resumeToken);
    const checkpointId = this.resumeTokens.get(resumeToken) || checkpointFromDb.id;
    const hydrated: StoredCheckpoint = {
      id: checkpointId,
      workflow_instance_id: refs?.workflow_instance_id || '',
      workflow_stage_id: refs?.workflow_stage_id || '',
      checkpoint_type: checkpointFromDb.checkpoint_type as CheckpointType,
      resume_token: checkpointFromDb.resume_token,
      state_hash: checkpointFromDb.state_hash,
      policy_snapshot_hash: checkpointFromDb.policy_snapshot_hash,
      status_snapshot: checkpointFromDb.status_snapshot,
      artifact_refs: checkpointFromDb.artifact_refs,
      fact_write_refs: checkpointFromDb.fact_write_refs,
      verification_refs: checkpointFromDb.verification_refs,
      evidence_pack_hash: checkpointFromDb.evidence_pack_hash,
      tool_call_refs: checkpointFromDb.tool_call_refs,
      next_action: checkpointFromDb.next_action,
      created_at: checkpointFromDb.created_at
    };

    this.checkpoints.set(checkpointId, hydrated);
    this.resumeTokens.set(resumeToken, checkpointId);
  }

  private async persistToDisk(): Promise<void> {
    try {
      const dir = dirname(this.storePath);
      await fsp.mkdir(dir, { recursive: true });

      const payload = JSON.stringify(
        {
          checkpoints: Array.from(this.checkpoints.values()),
          resume_tokens: Array.from(this.resumeTokens.entries())
        },
        null,
        2
      );

      const tempPath = `${this.storePath}.tmp`;
      await fsp.writeFile(tempPath, payload, 'utf8');
      await fsp.rename(tempPath, this.storePath);
    } catch (error) {
      logger.error('checkpoint.store.persist_failed', 'Failed to persist checkpoint store', {
        error: String(error)
      });
    }
  }
}

export const checkpointManager = new CheckpointManager();
