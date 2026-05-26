export interface SessionHint {
  conversation_id?: string
  thread_id?: string
  channel_type?: string
  channel_account_id?: string
  org_id?: string
}

export class SessionMapper {
  createSessionRef(channelIdentity: string, hint: SessionHint): string {
    if (!channelIdentity || typeof channelIdentity !== 'string' || channelIdentity.length > 512) {
      return 'invalid:session_ref';
    }

    const safeIdentity = channelIdentity.slice(0, 128);
    const channelType = (hint?.channel_type && typeof hint.channel_type === 'string' && hint.channel_type.length <= 32)
      ? hint.channel_type : 'web_portal';
    const accountId = (hint?.channel_account_id && typeof hint.channel_account_id === 'string' && hint.channel_account_id.length <= 64)
      ? hint.channel_account_id : 'default';
    const orgPart = (hint?.org_id && typeof hint.org_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(hint.org_id))
      ? `:org:${hint.org_id}` : '';

    if (hint.conversation_id && typeof hint.conversation_id === 'string' && hint.conversation_id.length <= 128) {
      const thread = (hint.thread_id && typeof hint.thread_id === 'string' && hint.thread_id.length <= 128)
        ? `:thread:${hint.thread_id}` : '';
      return `${channelType}:${accountId}:conv:${hint.conversation_id}${thread}${orgPart}`;
    }

    return `${channelType}:${accountId}:dm:${safeIdentity}${orgPart}`;
  }
}

export const sessionMapper = new SessionMapper()
