export interface SessionHint {
  conversation_id?: string
  thread_id?: string
  channel_type?: string
  channel_account_id?: string
  org_id?: string
}

export class SessionMapper {
  createSessionRef(channelIdentity: string, hint: SessionHint): string {
    const channelType = hint.channel_type || 'web_portal'
    const accountId = hint.channel_account_id || 'default'
    const orgPart = hint.org_id ? `:org:${hint.org_id}` : ''

    if (hint.conversation_id) {
      const thread = hint.thread_id ? `:thread:${hint.thread_id}` : ''
      return `${channelType}:${accountId}:conv:${hint.conversation_id}${thread}${orgPart}`
    }

    return `${channelType}:${accountId}:dm:${channelIdentity}${orgPart}`
  }
}

export const sessionMapper = new SessionMapper()
