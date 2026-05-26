import { deterministicUuid } from './db';

describe('workflow persistence helpers', () => {
  it('generates stable deterministic uuid for same seed', () => {
    const seed = 'workflow:wf_abc';
    const first = deterministicUuid(seed);
    const second = deterministicUuid(seed);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates different uuid for different seeds', () => {
    const a = deterministicUuid('workflow:wf_a');
    const b = deterministicUuid('workflow:wf_b');

    expect(a).not.toBe(b);
  });
});
