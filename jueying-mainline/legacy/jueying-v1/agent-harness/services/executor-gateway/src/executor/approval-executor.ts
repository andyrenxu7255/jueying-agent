import { createLogger } from '@agent-harness/shared';
import { auditWriter } from '@agent-harness/audit';
import type { ExecutionInput, ExecutionResult } from './generic-executor';

const logger = createLogger('approval-executor');

const MAX_APPROVERS = 20
const DEFAULT_APPROVAL_TIMEOUT_HOURS = 24;

export class ApprovalExecutor {
  private pendingApprovals: Map<string, {
    workflow_instance_id: string;
    workflow_stage_id: string;
    timeout_at: string;
    approver_user_ids: string[];
    timer: NodeJS.Timeout;
  }> = new Map();

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const { workflow_instance_id, workflow_stage_id, stage } = input;

    const approverUserIds = this.extractApproverUserIds(input);
    const timeoutHours = this.extractApprovalTimeoutHours(input);
    const timeoutAt = new Date(Date.now() + timeoutHours * 3600 * 1000).toISOString();

    logger.info('approval.started', 'Approval executor started', {
      workflow_instance_id,
      workflow_stage_id,
      stage_type: stage.stage_type,
      approver_count: approverUserIds.length,
      timeout_hours: timeoutHours,
      timeout_at: timeoutAt
    });

    const timer = setTimeout(() => {
      void this.handleApprovalTimeout(workflow_stage_id);
    }, timeoutHours * 3600 * 1000);
    timer.unref();

    this.pendingApprovals.set(workflow_stage_id, {
      workflow_instance_id,
      workflow_stage_id,
      timeout_at: timeoutAt,
      approver_user_ids: approverUserIds,
      timer
    });

    await auditWriter.write({
      user_id: 'system',
      action: 'workflow.state.changed',
      resource_type: 'workflow_stage',
      resource_ref: workflow_stage_id,
      resource_scope: 'system',
      result: 'success',
      detail_json: {
        workflow_instance_id,
        stage_type: stage.stage_type,
        action: 'approval_pending',
        approver_user_ids: approverUserIds,
        timeout_at: timeoutAt,
        timeout_hours: timeoutHours
      }
    });

    if (approverUserIds.length > 0) {
      for (const approverId of approverUserIds) {
        await auditWriter.write({
          user_id: approverId,
          action: 'workflow.state.changed',
          resource_type: 'workflow_stage',
          resource_ref: workflow_stage_id,
          resource_scope: `private:${approverId}`,
          result: 'success',
          detail_json: {
            workflow_instance_id,
            stage_type: stage.stage_type,
            action: 'approval_notification',
            approver_user_id: approverId,
            purpose: stage.purpose,
            timeout_at: timeoutAt
          }
        });
      }

      logger.info('approval.notified', 'Approval notifications sent to approvers', {
        workflow_instance_id,
        workflow_stage_id,
        approver_count: approverUserIds.length
      });
    }

    return {
      status: 'waiting_user',
      output: `Approval required for stage ${stage.stage_type}: ${stage.purpose}`,
      next_action: 'waiting_user',
      model_call_ok: true
    };
  }

  private async handleApprovalTimeout(workflowStageId: string): Promise<void> {
    const pending = this.pendingApprovals.get(workflowStageId);
    if (!pending) return;

    this.pendingApprovals.delete(workflowStageId);

    logger.warn('approval.timeout', 'Approval timed out', {
      workflow_instance_id: pending.workflow_instance_id,
      workflow_stage_id: pending.workflow_stage_id,
      timeout_at: pending.timeout_at,
      approver_count: pending.approver_user_ids.length
    });

    await auditWriter.write({
      user_id: 'system',
      action: 'workflow.state.changed',
      resource_type: 'workflow_stage',
      resource_ref: pending.workflow_stage_id,
      resource_scope: 'system',
      result: 'failure',
      detail_json: {
        workflow_instance_id: pending.workflow_instance_id,
        action: 'approval_timeout',
        timeout_at: pending.timeout_at,
        approver_user_ids: pending.approver_user_ids
      }
    });
  }

  private extractApproverUserIds(input: ExecutionInput): string[] {
    const contextApprovers = (input.context as Record<string, unknown>)?.approver_user_ids
    if (Array.isArray(contextApprovers) && contextApprovers.length > 0) {
      const filtered = contextApprovers.filter((id): id is string => typeof id === 'string')
      return filtered.slice(0, MAX_APPROVERS)
    }

    const refs = input.stage.inputs?.required_refs
    if (Array.isArray(refs)) {
      const approverRefs = refs.filter((ref): ref is string => typeof ref === 'string' && ref.startsWith('approver:'))
      if (approverRefs.length > 0) {
        return approverRefs.map(ref => ref.replace('approver:', '')).slice(0, MAX_APPROVERS)
      }
    }

    return []
  }

  private extractApprovalTimeoutHours(input: ExecutionInput): number {
    const contextTimeout = (input.context as Record<string, unknown>)?.approval_timeout_hours;
    if (typeof contextTimeout === 'number' && contextTimeout > 0 && contextTimeout <= 168) {
      return contextTimeout;
    }
    return DEFAULT_APPROVAL_TIMEOUT_HOURS;
  }

  cancelPendingApproval(workflowStageId: string): void {
    const pending = this.pendingApprovals.get(workflowStageId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingApprovals.delete(workflowStageId);
    }
  }

  getPendingApprovals(): Array<{
    workflow_instance_id: string;
    workflow_stage_id: string;
    timeout_at: string;
    approver_user_ids: string[];
  }> {
    return Array.from(this.pendingApprovals.values()).map(p => ({
      workflow_instance_id: p.workflow_instance_id,
      workflow_stage_id: p.workflow_stage_id,
      timeout_at: p.timeout_at,
      approver_user_ids: p.approver_user_ids,
    }));
  }
}

export const approvalExecutor = new ApprovalExecutor();
