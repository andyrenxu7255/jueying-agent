import { desc, eq, and, gte, lte, sql } from 'drizzle-orm'
import {
  memoryAnalysisRuns,
  memoryCompressionLogs,
  memoryAccessLogs,
  orgMemorySummaries,
  memoryItems,
  facts,
} from '@agent-harness/shared'
import { db } from '../db'

export interface AnalysisRunRecord {
  id: string
  org_id: string | null
  run_type: string
  scope_user_id: string | null
  status: string
  items_scanned: number
  items_compressed: number
  items_extracted: number
  facts_generated: number
  result_summary: Record<string, unknown>
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface MemoryItemRow {
  id: string
  content_text: string
  summary: string | null
  memory_type: string
  char_count: number
  confidence: number
  status: string
}

export interface FactRow {
  id: string
  subject_ref: string
  predicate: string
  object_value: string | null
  confidence: number
  owner_user_id: string
  org_id: string | null
  metadata: Record<string, unknown>
}

export class MemoryAnalysisRepository {
  async getAnalysisRuns(limit: number = 50): Promise<AnalysisRunRecord[]> {
    if (!db) return []

    const results = await db
      .select({
        id: memoryAnalysisRuns.id,
        org_id: memoryAnalysisRuns.orgId,
        run_type: memoryAnalysisRuns.runType,
        scope_user_id: memoryAnalysisRuns.scopeUserId,
        status: memoryAnalysisRuns.status,
        items_scanned: memoryAnalysisRuns.itemsScanned,
        items_compressed: memoryAnalysisRuns.itemsCompressed,
        items_extracted: memoryAnalysisRuns.itemsExtracted,
        facts_generated: memoryAnalysisRuns.factsGenerated,
        result_summary: memoryAnalysisRuns.resultSummary,
        started_at: memoryAnalysisRuns.startedAt,
        finished_at: memoryAnalysisRuns.finishedAt,
        created_at: memoryAnalysisRuns.createdAt,
      })
      .from(memoryAnalysisRuns)
      .orderBy(desc(memoryAnalysisRuns.createdAt))
      .limit(limit)

    return results.map(row => ({
      id: row.id,
      org_id: row.org_id,
      run_type: row.run_type,
      scope_user_id: row.scope_user_id,
      status: row.status,
      items_scanned: row.items_scanned,
      items_compressed: row.items_compressed,
      items_extracted: row.items_extracted,
      facts_generated: row.facts_generated,
      result_summary: row.result_summary as Record<string, unknown>,
      started_at: row.started_at instanceof Date ? row.started_at.toISOString() : null,
      finished_at: row.finished_at instanceof Date ? row.finished_at.toISOString() : null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }))
  }

  async getCompressionLogs(limit: number = 50): Promise<Record<string, unknown>[]> {
    if (!db) return []

    const results = await db
      .select({
        id: memoryCompressionLogs.id,
        memory_item_id: memoryCompressionLogs.memoryItemId,
        owner_user_id: memoryCompressionLogs.ownerUserId,
        org_id: memoryCompressionLogs.orgId,
        compression_method: memoryCompressionLogs.compressionMethod,
        original_char_count: memoryCompressionLogs.originalCharCount,
        compressed_char_count: memoryCompressionLogs.compressedCharCount,
        created_at: memoryCompressionLogs.createdAt,
      })
      .from(memoryCompressionLogs)
      .orderBy(desc(memoryCompressionLogs.createdAt))
      .limit(limit)

    return results.map(row => ({
      id: row.id,
      memory_item_id: row.memory_item_id,
      owner_user_id: row.owner_user_id,
      org_id: row.org_id,
      compression_method: row.compression_method,
      original_char_count: row.original_char_count,
      compressed_char_count: row.compressed_char_count,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }))
  }

  async getAccessLogs(limit: number = 50): Promise<Record<string, unknown>[]> {
    if (!db) return []

    const results = await db
      .select({
        id: memoryAccessLogs.id,
        accessor_user_id: memoryAccessLogs.accessorUserId,
        target_memory_id: memoryAccessLogs.targetMemoryId,
        target_type: memoryAccessLogs.targetType,
        access_type: memoryAccessLogs.accessType,
        access_result: memoryAccessLogs.accessResult,
        deny_reason: memoryAccessLogs.denyReason,
        created_at: memoryAccessLogs.createdAt,
      })
      .from(memoryAccessLogs)
      .orderBy(desc(memoryAccessLogs.createdAt))
      .limit(limit)

    return results.map(row => ({
      id: row.id,
      accessor_user_id: row.accessor_user_id,
      target_memory_id: row.target_memory_id,
      target_type: row.target_type,
      access_type: row.access_type,
      access_result: row.access_result,
      deny_reason: row.deny_reason,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }))
  }

  async getOrgMemorySummaries(
    orgId?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Record<string, unknown>[]> {
    if (!db) return []

    const conditions = [sql`${orgMemorySummaries.status} IN ('active', 'candidate')`]
    if (orgId) {
      conditions.push(eq(orgMemorySummaries.orgId, orgId))
    }

    const results = await db
      .select({
        id: orgMemorySummaries.id,
        org_id: orgMemorySummaries.orgId,
        title: orgMemorySummaries.title,
        summary: orgMemorySummaries.summary,
        category: orgMemorySummaries.category,
        confidence: orgMemorySummaries.confidence,
        relevance_score: orgMemorySummaries.relevanceScore,
        status: orgMemorySummaries.status,
        created_at: orgMemorySummaries.createdAt,
        updated_at: orgMemorySummaries.updatedAt,
      })
      .from(orgMemorySummaries)
      .where(and(...conditions))
      .orderBy(desc(orgMemorySummaries.updatedAt))
      .limit(limit)
      .offset(offset)

    return results.map(row => ({
      id: row.id,
      org_id: row.org_id,
      title: row.title,
      summary: row.summary,
      category: row.category,
      confidence: row.confidence,
      relevance_score: row.relevance_score,
      status: row.status,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }))
  }

  async getMemoryItemsForAnalysis(
    ownerUserId: string,
    dateStr: string,
    limit: number = 500
  ): Promise<MemoryItemRow[]> {
    if (!db) return []

    const dayStart = new Date(`${dateStr}T00:00:00Z`)
    const dayEnd = new Date(`${dateStr}T23:59:59Z`)

    const results = await db
      .select({
        id: memoryItems.id,
        content_text: memoryItems.contentText,
        summary: memoryItems.summary,
        memory_type: memoryItems.memoryType,
        char_count: sql<number>`char_length(${memoryItems.contentText})`.mapWith(Number),
        confidence: memoryItems.confidence,
        status: memoryItems.status,
      })
      .from(memoryItems)
      .where(and(
        eq(memoryItems.ownerUserId, ownerUserId),
        gte(memoryItems.createdAt, dayStart),
        lte(memoryItems.createdAt, dayEnd),
        eq(memoryItems.status, 'active'),
      ))
      .orderBy(desc(memoryItems.createdAt))
      .limit(limit)

    return results.map(row => ({
      id: row.id,
      content_text: row.content_text,
      summary: row.summary,
      memory_type: row.memory_type,
      char_count: row.char_count,
      confidence: row.confidence,
      status: row.status,
    }))
  }

  async insertAnalysisRun(data: {
    orgId?: string | null
    runType: string
    scopeUserId?: string | null
    status: string
    itemsScanned?: number
    itemsCompressed?: number
    itemsExtracted?: number
    factsGenerated?: number
    resultSummary?: Record<string, unknown>
  }): Promise<string | null> {
    if (!db) return null

    const result = await db.insert(memoryAnalysisRuns).values({
      orgId: data.orgId ?? null,
      runType: data.runType,
      scopeUserId: data.scopeUserId ?? null,
      status: data.status,
      startedAt: new Date(),
      finishedAt: new Date(),
      itemsScanned: data.itemsScanned ?? 0,
      itemsCompressed: data.itemsCompressed ?? 0,
      itemsExtracted: data.itemsExtracted ?? 0,
      factsGenerated: data.factsGenerated ?? 0,
      resultSummary: (data.resultSummary ?? {}) as Record<string, unknown>,
    }).returning()

    return result[0]?.id ?? null
  }

  async getDreamFacts(): Promise<FactRow[]> {
    if (!db) return []

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)

    const results = await db
      .select({
        id: facts.id,
        subject_ref: facts.subjectRef,
        predicate: facts.predicate,
        object_value: facts.objectValue,
        confidence: facts.confidence,
        owner_user_id: facts.ownerUserId,
        org_id: facts.orgId,
        metadata: facts.metadata,
      })
      .from(facts)
      .where(and(
        sql`${facts.metadata}->>'source' = 'dream_extraction'`,
        eq(facts.status, 'unconfirmed'),
        gte(facts.createdAt, twoDaysAgo),
      ))
      .limit(200)

    return results.map(row => ({
      id: row.id,
      subject_ref: row.subject_ref,
      predicate: row.predicate,
      object_value: row.object_value,
      confidence: row.confidence,
      owner_user_id: row.owner_user_id,
      org_id: row.org_id,
      metadata: row.metadata as Record<string, unknown>,
    }))
  }
}