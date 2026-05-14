import { createLogger } from '@agent-harness/shared'
import type { MemoryEntry } from '../repositories/memory-repository'
import { MemoryRepository } from '../repositories/memory-repository'

const logger = createLogger('memory-service')

const FACT_RETRIEVAL_URL = process.env.FACT_RETRIEVAL_URL || 'http://fact-retrieval:3000'

export class MemoryService {
  constructor(private memoryRepository: MemoryRepository) {}

  async persistToDb(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return

    try {
      await this.memoryRepository.saveMemories(entries)
    } catch (error) {
      logger.warn('memory.persist_db_error', 'Failed to persist memory to DB', { error: String(error) })
    }
  }

  async persistToFactRetrieval(
    ownerUserId: string,
    orgId: string | null,
    sessionId: string,
    entries: MemoryEntry[]
  ): Promise<void> {
    if (entries.length === 0) return

    try {
      const summaryText = entries.slice(-5).map(e => `${e.role}: ${e.content}`).join('\n')
      const res = await fetch(`${FACT_RETRIEVAL_URL}/internal/facts/write`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner_user_id: ownerUserId,
          org_id: orgId,
          fact_text: `[session:${sessionId}] ${summaryText}`,
          scope: ['private'],
          mode: 'insert',
          subject_ref: `session:${sessionId}`,
          predicate: 'has_context',
          object_value: summaryText,
          confidence: 0.7,
        }),
      })
      if (!res.ok) {
        logger.warn('memory.persist_error', 'Fact-retrieval rejected memory persistence', { status: res.status })
      }
    } catch (error) {
      logger.warn('memory.persist_error', 'Failed to persist memory to fact-retrieval', { error: String(error) })
    }
  }

  async persistSingleToDb(entry: MemoryEntry): Promise<void> {
    try {
      await this.memoryRepository.saveMemory(entry)
    } catch (error) {
      logger.warn('memory.persist_db_error', 'Failed to persist single memory to DB', { error: String(error) })
    }
  }

  async recallFromDb(
    ownerUserId: string,
    sessionId: string,
    limit: number,
    orgId?: string
  ): Promise<MemoryEntry[]> {
    try {
      const entries = await this.memoryRepository.recallMemories(ownerUserId, sessionId, limit, orgId)
      return entries
    } catch (error) {
      logger.warn('memory.recall_db_error', 'Failed to recall memory from DB', { error: String(error) })
      return []
    }
  }

  async clearSessionFromDb(ownerUserId: string, sessionId: string): Promise<number> {
    try {
      return await this.memoryRepository.clearSessionMemories(ownerUserId, sessionId)
    } catch (error) {
      logger.warn('memory.clear_db_error', 'Failed to clear session from DB', { error: String(error) })
      return 0
    }
  }

  async clearAllFromDb(ownerUserId: string): Promise<number> {
    try {
      return await this.memoryRepository.clearAllMemories(ownerUserId)
    } catch (error) {
      logger.warn('memory.clear_db_error', 'Failed to clear all memories from DB', { error: String(error) })
      return 0
    }
  }
}