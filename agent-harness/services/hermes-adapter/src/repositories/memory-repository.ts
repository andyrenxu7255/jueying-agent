import { eq, and, desc } from 'drizzle-orm'
import { hermesMemories } from '@agent-harness/shared'
import { db } from '../db'

export interface MemoryEntry {
  id: string
  owner_user_id: string
  org_id: string | null
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  token_count: number
  metadata: Record<string, unknown>
  created_at: string
}

export class MemoryRepository {
  async saveMemory(entry: MemoryEntry): Promise<void> {
    if (!db) return

    await db.insert(hermesMemories).values({
      ownerUserId: entry.owner_user_id,
      orgId: entry.org_id,
      sessionId: entry.session_id,
      role: entry.role,
      content: entry.content,
      tokenCount: entry.token_count,
      metadata: entry.metadata,
      createdAt: new Date(entry.created_at),
    }).onConflictDoNothing()
  }

  async saveMemories(entries: MemoryEntry[]): Promise<void> {
    if (!db || entries.length === 0) return

    await db.insert(hermesMemories).values(
      entries.map(entry => ({
        ownerUserId: entry.owner_user_id,
        orgId: entry.org_id,
        sessionId: entry.session_id,
        role: entry.role,
        content: entry.content,
        tokenCount: entry.token_count,
        metadata: entry.metadata,
        createdAt: new Date(entry.created_at),
      }))
    ).onConflictDoNothing()
  }

  async recallMemories(
    ownerUserId: string,
    sessionId: string,
    limit: number,
    orgId?: string
  ): Promise<MemoryEntry[]> {
    if (!db) return []

    const conditions = [
      eq(hermesMemories.ownerUserId, ownerUserId),
      eq(hermesMemories.sessionId, sessionId),
    ]
    if (orgId) {
      conditions.push(eq(hermesMemories.orgId, orgId))
    }

    const results = await db
      .select()
      .from(hermesMemories)
      .where(and(...conditions))
      .orderBy(desc(hermesMemories.createdAt))
      .limit(limit)

    return results.map(row => ({
      id: row.id,
      owner_user_id: row.ownerUserId,
      org_id: row.orgId,
      session_id: row.sessionId,
      role: row.role as MemoryEntry['role'],
      content: row.content,
      token_count: row.tokenCount,
      metadata: row.metadata as Record<string, unknown>,
      created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    })).reverse()
  }

  async clearSessionMemories(ownerUserId: string, sessionId: string): Promise<number> {
    if (!db) return 0

    const result = await db
      .delete(hermesMemories)
      .where(and(
        eq(hermesMemories.ownerUserId, ownerUserId),
        eq(hermesMemories.sessionId, sessionId),
      ))

    return result.rowCount ?? 0
  }

  async clearAllMemories(ownerUserId: string): Promise<number> {
    if (!db) return 0

    const result = await db
      .delete(hermesMemories)
      .where(eq(hermesMemories.ownerUserId, ownerUserId))

    return result.rowCount ?? 0
  }
}