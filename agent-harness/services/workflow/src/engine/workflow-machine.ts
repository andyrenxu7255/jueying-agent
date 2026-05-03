/**
 * Workflow State Machine
 *
 * 基于有限状态机的工作流生命周期管理。
 * 状态: draft → planned → running → verifying → reporting → succeeded → archived
 * 中间可进入 paused / blocked / waiting_user / repairing，失败可进入 failed / cancelled。
 *
 * @module workflow-machine
 */

export interface WorkflowContext {
  workflowId?: string
  currentStageId?: string
  lastError?: string
}

export type WorkflowEvent =
  | { type: 'PLAN' }
  | { type: 'START' }
  | { type: 'VERIFY' }
  | { type: 'REPAIR' }
  | { type: 'REPORT' }
  | { type: 'WAIT_USER' }
  | { type: 'BLOCK' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'FAIL'; error?: string }
  | { type: 'CANCEL' }
  | { type: 'ARCHIVE' }
  | { type: 'COMPLETE' }

export type WorkflowState = 'draft' | 'planned' | 'running' | 'verifying' | 'repairing' | 'reporting' | 'waiting_user' | 'blocked' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'archived'

const VALID_TRANSITIONS: Record<WorkflowState, Partial<Record<WorkflowEvent['type'], WorkflowState>>> = {
  draft: { PLAN: 'planned', FAIL: 'failed', CANCEL: 'cancelled' },
  planned: { START: 'running', CANCEL: 'cancelled', FAIL: 'failed' },
  running: { VERIFY: 'verifying', WAIT_USER: 'waiting_user', BLOCK: 'blocked', PAUSE: 'paused', FAIL: 'failed', CANCEL: 'cancelled' },
  verifying: { REPAIR: 'repairing', REPORT: 'reporting', FAIL: 'failed', PAUSE: 'paused' },
  repairing: { VERIFY: 'verifying', FAIL: 'failed', PAUSE: 'paused' },
  reporting: { START: 'running', COMPLETE: 'succeeded', FAIL: 'failed', PAUSE: 'paused' },
  waiting_user: { START: 'running', CANCEL: 'cancelled', FAIL: 'failed' },
  blocked: { START: 'running', CANCEL: 'cancelled', FAIL: 'failed' },
  paused: { RESUME: 'running', CANCEL: 'cancelled', FAIL: 'failed' },
  succeeded: { ARCHIVE: 'archived' },
  failed: { ARCHIVE: 'archived' },
  cancelled: { ARCHIVE: 'archived' },
  archived: {}
}

export class WorkflowStateMachine {
  private state: WorkflowState = 'draft'
  private context: WorkflowContext = {}

  constructor(workflowId?: string) {
    this.context = { workflowId }
  }

  getCurrentState(): WorkflowState {
    return this.state
  }

  getContext(): WorkflowContext {
    return this.context
  }

  send(event: WorkflowEvent): { changed: boolean; state: WorkflowState } {
    const transitions = VALID_TRANSITIONS[this.state]
    if (!transitions) return { changed: false, state: this.state }

    const nextState = transitions[event.type]
    if (!nextState) return { changed: false, state: this.state }

    const previousState = this.state
    this.state = nextState

    if (event.type === 'FAIL' && 'error' in event) {
      this.context.lastError = event.error
    }

    if (nextState === 'running' && previousState !== 'paused') {
      this.context.currentStageId = undefined
    }

    return { changed: previousState !== nextState, state: this.state }
  }

  canHandle(eventType: WorkflowEvent['type']): boolean {
    const transitions = VALID_TRANSITIONS[this.state]
    return !!transitions?.[eventType]
  }

  isFinal(): boolean {
    return this.state === 'archived'
  }
}

/**
 * 创建工作流状态机实例。
 *
 * @param workflowId - 可选的工作流 ID。
 * @returns 一个新的 WorkflowStateMachine 实例。
 */
export function createWorkflowMachine(workflowId?: string): WorkflowStateMachine {
  return new WorkflowStateMachine(workflowId)
}
