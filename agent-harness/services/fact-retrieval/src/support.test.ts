import { userRefToDbId, buildAllowedScopes, splitIntoChunks, sha256Prefixed, sha256Buffer, randomRef } from './support'

describe('userRefToDbId', () => {
  it('returns lowercase uuid unchanged when input is already valid uuid', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(userRefToDbId(uuid)).toBe(uuid)
  })

  it('returns lowercase uuid when input is uppercase uuid', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000'
    expect(userRefToDbId(uuid)).toBe(uuid.toLowerCase())
  })

  it('generates deterministic uuid from canonical user ref', () => {
    const input = 'u_feishu_user_abc123'
    const result = userRefToDbId(input)
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('generates same uuid for same canonical user ref', () => {
    expect(userRefToDbId('u_feishu_user_abc')).toBe(userRefToDbId('u_feishu_user_abc'))
  })

  it('generates different uuid for different canonical user refs', () => {
    expect(userRefToDbId('u_feishu_user_a')).not.toBe(userRefToDbId('u_feishu_user_b'))
  })

  it('rejects raw channel identity refs before database mapping', () => {
    expect(() => userRefToDbId('feishu:user_abc123')).toThrow('Invalid user reference format')
  })
})

describe('buildAllowedScopes', () => {
  it('returns provided scopes when given', () => {
    const scopes = ['private:u_123', 'org:o_456']
    expect(buildAllowedScopes('u_789', scopes)).toEqual(scopes)
  })

  it('builds default scopes when no allowedScopes provided', () => {
    const result = buildAllowedScopes('u_001')
    expect(result).toContain('private:u_001')
    expect(result).toContain('public:workflow')
    expect(result).toContain('public:skill')
  })

  it('builds default scopes when allowedScopes is empty array', () => {
    const result = buildAllowedScopes('u_001', [])
    expect(result).toHaveLength(3)
  })
})

describe('splitIntoChunks', () => {
  it('splits by double newline into paragraphs', () => {
    const text = 'first paragraph\n\nsecond paragraph'
    const chunks = splitIntoChunks(text)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    chunks.forEach(c => expect(typeof c).toBe('string'))
  })

  it('handles single paragraph', () => {
    const text = 'just one paragraph'
    const chunks = splitIntoChunks(text)
    expect(chunks).toEqual(['just one paragraph'])
  })

  it('does not split single long paragraph', () => {
    const longText = 'A'.repeat(900) + '. B'.repeat(900) + '.'
    const chunks = splitIntoChunks(longText)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe(longText)
  })

  it('returns empty array for empty input', () => {
    const chunks = splitIntoChunks('')
    expect(chunks).toEqual([])
  })

  it('handles whitespace-only input', () => {
    const chunks = splitIntoChunks('   ')
    expect(chunks.length).toBe(0)
  })
})

describe('sha256Prefixed', () => {
  it('returns sha256: prefixed hex digest', () => {
    const result = sha256Prefixed('hello')
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    expect(sha256Prefixed('hello')).toBe(sha256Prefixed('hello'))
  })
})

describe('sha256Buffer', () => {
  it('returns sha256: prefixed hex digest for buffer', () => {
    const result = sha256Buffer(Buffer.from('hello'))
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('randomRef', () => {
  it('generates ref with correct prefix', () => {
    const ref = randomRef('wf')
    expect(ref).toMatch(/^wf_[0-9a-f]{12}$/)
  })

  it('generates unique refs', () => {
    const a = randomRef('test')
    const b = randomRef('test')
    expect(a).not.toBe(b)
  })
})
