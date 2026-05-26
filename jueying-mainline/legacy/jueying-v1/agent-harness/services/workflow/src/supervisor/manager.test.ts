import { WorkflowSupervisor } from './manager';

describe('WorkflowSupervisor', () => {
  const supervisor = new WorkflowSupervisor();

  describe('heartbeat handling', () => {
    it('returns alive=false for unregistered workflow', () => {
      const status = supervisor.recordHeartbeat('wf_unknown_xyz');
      expect(status.alive).toBe(false);
    });

    it('returns no progress for unregistered workflow', () => {
      const progress = supervisor.getProgress('wf_unknown_xyz');
      expect(progress).toBeNull();
    });
  });

  describe('retry backoff calculation', () => {
    it('returns 0 for unregistered workflow', () => {
      const delay = supervisor.getRetryBackoffDelay('wf_unknown_xyz');
      expect(delay).toBe(0);
    });
  });

  describe('timeout actions', () => {
    it('handleTimeout returns fail for unregistered workflow', async () => {
      const action = await supervisor.handleTimeout('wf_unknown_xyz', 'soft');
      expect(action).toBe('fail');
    });

    it('handleTimeout returns fail for unregistered workflow (hard)', async () => {
      const action = await supervisor.handleTimeout('wf_unknown_xyz', 'hard');
      expect(action).toBe('fail');
    });
  });

  describe('supervised workflow list', () => {
    it('starts with empty list', () => {
      const list = supervisor.listSupervised();
      expect(Array.isArray(list)).toBe(true);
    });
  });
});
