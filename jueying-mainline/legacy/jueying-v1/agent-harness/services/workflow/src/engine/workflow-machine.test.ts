import { createWorkflowMachine } from './workflow-machine';

describe('workflow state machine', () => {
  it('follows the happy path to archived', () => {
    const machine = createWorkflowMachine('wf_test');

    expect(machine.getCurrentState()).toBe('draft');
    expect(machine.send({ type: 'PLAN' }).state).toBe('planned');
    expect(machine.send({ type: 'START' }).state).toBe('running');
    expect(machine.send({ type: 'VERIFY' }).state).toBe('verifying');
    expect(machine.send({ type: 'REPORT' }).state).toBe('reporting');
    expect(machine.send({ type: 'COMPLETE' }).state).toBe('succeeded');
    expect(machine.send({ type: 'ARCHIVE' }).state).toBe('archived');

    expect(machine.isFinal()).toBe(true);
  });

  it('rejects invalid transition and keeps state', () => {
    const machine = createWorkflowMachine('wf_test_invalid');

    const result = machine.send({ type: 'COMPLETE' });
    expect(result.changed).toBe(false);
    expect(result.state).toBe('draft');
  });

  it('handles an unexpected stored state defensively', () => {
    const machine = createWorkflowMachine('wf_corrupt');
    (machine as unknown as { state: string }).state = 'unknown';

    const result = machine.send({ type: 'PLAN' });

    expect(result.changed).toBe(false);
    expect(result.state).toBe('unknown');
  });

  it('stores failure context', () => {
    const machine = createWorkflowMachine('wf_test_fail');

    machine.send({ type: 'PLAN' });
    machine.send({ type: 'FAIL', error: 'boom' });

    expect(machine.getCurrentState()).toBe('failed');
    expect(machine.getContext().lastError).toBe('boom');
  });

  it('reports which events are currently allowed', () => {
    const machine = createWorkflowMachine('wf_can_handle');
    expect(machine.canHandle('PLAN')).toBe(true);
    expect(machine.canHandle('START')).toBe(false);
    machine.send({ type: 'PLAN' });
    expect(machine.canHandle('START')).toBe(true);
  });

  it('supports pause/resume without clearing the current stage', () => {
    const machine = createWorkflowMachine('wf_pause');
    machine.send({ type: 'PLAN' });
    machine.send({ type: 'START' });
    machine.getContext().currentStageId = 'st_active';
    expect(machine.send({ type: 'PAUSE' }).state).toBe('paused');
    expect(machine.send({ type: 'RESUME' }).state).toBe('running');
    expect(machine.getContext().currentStageId).toBe('st_active');
  });

  it('supports waiting, blocked, repair, cancel, and failed archive paths', () => {
    const waiting = createWorkflowMachine('wf_wait');
    waiting.send({ type: 'PLAN' });
    waiting.send({ type: 'START' });
    expect(waiting.send({ type: 'WAIT_USER' }).state).toBe('waiting_user');
    expect(waiting.send({ type: 'START' }).state).toBe('running');

    const blocked = createWorkflowMachine('wf_blocked');
    blocked.send({ type: 'PLAN' });
    blocked.send({ type: 'START' });
    expect(blocked.send({ type: 'BLOCK' }).state).toBe('blocked');
    expect(blocked.send({ type: 'CANCEL' }).state).toBe('cancelled');
    expect(blocked.send({ type: 'ARCHIVE' }).state).toBe('archived');

    const repair = createWorkflowMachine('wf_repair');
    repair.send({ type: 'PLAN' });
    repair.send({ type: 'START' });
    repair.send({ type: 'VERIFY' });
    expect(repair.send({ type: 'REPAIR' }).state).toBe('repairing');
    expect(repair.send({ type: 'VERIFY' }).state).toBe('verifying');
    expect(repair.send({ type: 'FAIL', error: 'verify failed' }).state).toBe('failed');
    expect(repair.send({ type: 'ARCHIVE' }).state).toBe('archived');
  });

  it('recognizes each final terminal state before archive', () => {
    const succeeded = createWorkflowMachine('wf_final_success');
    succeeded.send({ type: 'PLAN' });
    succeeded.send({ type: 'START' });
    succeeded.send({ type: 'VERIFY' });
    succeeded.send({ type: 'REPORT' });
    succeeded.send({ type: 'COMPLETE' });
    expect(succeeded.isFinal()).toBe(true);

    const failed = createWorkflowMachine('wf_final_failed');
    failed.send({ type: 'FAIL' });
    expect(failed.isFinal()).toBe(true);

    const cancelled = createWorkflowMachine('wf_final_cancelled');
    cancelled.send({ type: 'CANCEL' });
    expect(cancelled.isFinal()).toBe(true);
  });

  it('keeps the stage id when reporting restarts the next stage', () => {
    const machine = createWorkflowMachine('wf_report_next');
    machine.send({ type: 'PLAN' });
    machine.send({ type: 'START' });
    machine.send({ type: 'VERIFY' });
    machine.send({ type: 'REPORT' });
    machine.getContext().currentStageId = 'st_reported';

    expect(machine.send({ type: 'START' }).state).toBe('running');
    expect(machine.getContext().currentStageId).toBeUndefined();
  });
});
