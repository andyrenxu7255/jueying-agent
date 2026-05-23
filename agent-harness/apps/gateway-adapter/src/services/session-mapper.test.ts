import { SessionMapper } from './session-mapper';

describe('SessionMapper', () => {
  const mapper = new SessionMapper();

  it('creates conversation-scoped session refs with optional thread and org', () => {
    expect(mapper.createSessionRef('user-1', {
      channel_type: 'feishu',
      channel_account_id: 'tenant-a',
      conversation_id: 'conv-1',
      thread_id: 'thread-1',
      org_id: 'org_123',
    })).toBe('feishu:tenant-a:conv:conv-1:thread:thread-1:org:org_123');
  });

  it('falls back to direct-message refs and defaults missing hint fields', () => {
    expect(mapper.createSessionRef('external-user', {})).toBe('web_portal:default:dm:external-user');
  });

  it('truncates long channel identities used in direct-message refs', () => {
    const ref = mapper.createSessionRef('x'.repeat(200), {
      channel_type: 'web_portal',
      channel_account_id: 'default',
    });
    expect(ref).toHaveLength('web_portal:default:dm:'.length + 128);
  });

  it('rejects invalid channel identities before creating refs', () => {
    expect(mapper.createSessionRef('', {})).toBe('invalid:session_ref');
    expect(mapper.createSessionRef('x'.repeat(513), {})).toBe('invalid:session_ref');
  });

  it('drops unsafe or overlong hint fields instead of leaking them into refs', () => {
    const ref = mapper.createSessionRef('user-1', {
      channel_type: 'x'.repeat(33),
      channel_account_id: 'a'.repeat(65),
      conversation_id: 'c'.repeat(129),
      org_id: 'org:bad',
    });
    expect(ref).toBe('web_portal:default:dm:user-1');
  });

  it('omits overlong thread ids while keeping a valid conversation scope', () => {
    const ref = mapper.createSessionRef('user-1', {
      channel_type: 'feishu',
      channel_account_id: 'tenant-a',
      conversation_id: 'conv-1',
      thread_id: 't'.repeat(129),
    });

    expect(ref).toBe('feishu:tenant-a:conv:conv-1');
  });
});
