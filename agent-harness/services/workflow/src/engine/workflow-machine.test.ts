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

  it('stores failure context', () => {
    const machine = createWorkflowMachine('wf_test_fail');

    machine.send({ type: 'PLAN' });
    machine.send({ type: 'FAIL', error: 'boom' });

    expect(machine.getCurrentState()).toBe('failed');
    expect(machine.getContext().lastError).toBe('boom');
  });
});
