import { SessionMapper } from './session-mapper'

describe('SessionMapper', () => {
  let mapper: SessionMapper

  beforeEach(() => {
    mapper = new SessionMapper()
  })

  describe('createSessionRef', () => {
    it('should return invalid ref for empty channel identity', () => {
      expect(mapper.createSessionRef('', {})).toBe('invalid:session_ref')
    })

    it('should return invalid ref for non-string channel identity', () => {
      expect(mapper.createSessionRef(null as unknown as string, {})).toBe('invalid:session_ref')
    })

    it('should return invalid ref for overly long channel identity', () => {
      const long = 'x'.repeat(600)
      expect(mapper.createSessionRef(long, {})).toBe('invalid:session_ref')
    })

    it('should generate DM session ref for basic identity', () => {
      const ref = mapper.createSessionRef('user123', {})
      expect(ref).toContain(':dm:')
      expect(ref).toContain('web_portal')
      expect(ref).toContain('default')
      expect(ref).toContain('user123')
    })

    it('should generate conversation session ref with conversation_id', () => {
      const ref = mapper.createSessionRef('user123', { conversation_id: 'conv_abc' })
      expect(ref).toContain(':conv:conv_abc')
    })

    it('should generate conversation ref with thread_id', () => {
      const ref = mapper.createSessionRef('user123', { conversation_id: 'conv_abc', thread_id: 'thread_xyz' })
      expect(ref).toContain(':conv:conv_abc')
      expect(ref).toContain(':thread:thread_xyz')
    })

    it('should use custom channel_type in ref', () => {
      const ref = mapper.createSessionRef('user123', { channel_type: 'feishu' })
      expect(ref).toContain('feishu:')
    })

    it('should use custom channel_account_id in ref', () => {
      const ref = mapper.createSessionRef('user123', { channel_account_id: 'acc_456' })
      expect(ref).toContain('acc_456')
    })

    it('should validate channel_type length and default to web_portal if too long', () => {
      const ref = mapper.createSessionRef('user123', { channel_type: 'x'.repeat(50) })
      expect(ref).toContain('web_portal:')
    })

    it('should validate channel_account_id length and default if too long', () => {
      const ref = mapper.createSessionRef('user123', { channel_account_id: 'x'.repeat(100) })
      expect(ref).toContain('default:')
    })

    it('should validate conversation_id length', () => {
      const ref = mapper.createSessionRef('user123', { conversation_id: 'x'.repeat(200) })
      expect(ref).toContain(':dm:')
      expect(ref).not.toContain(':conv:')
    })

    it('should include org_id in ref when provided', () => {
      const ref = mapper.createSessionRef('user123', { org_id: 'org-acme-123' })
      expect(ref).toContain(':org:org-acme-123')
    })

    it('should reject invalid org_id format', () => {
      const ref = mapper.createSessionRef('user123', { org_id: 'org with spaces!' })
      expect(ref).not.toContain(':org:')
    })

    it('should truncate channel identity to 128 chars', () => {
      const longId = 'x'.repeat(200)
      const ref = mapper.createSessionRef(longId, {})
      expect(ref.length).toBeLessThan(300)
      const idPart = ref.split(':dm:')[1]?.split(':org:')[0]
      expect(idPart?.length).toBeLessThanOrEqual(128)
    })

    it('should include all parts in complex ref', () => {
      const ref = mapper.createSessionRef('user123', {
        channel_type: 'feishu',
        channel_account_id: 'tenant_abc',
        conversation_id: 'chat_def',
        thread_id: 'thread_ghi',
        org_id: 'org-jkl-456'
      })
      expect(ref).toBe('feishu:tenant_abc:conv:chat_def:thread:thread_ghi:org:org-jkl-456')
    })
  })
})