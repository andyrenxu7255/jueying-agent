import { createLogger } from '@agent-harness/shared';
import { eq, sql, and, or, type SQL } from 'drizzle-orm';
import { artifactObjects, auditEvents, documentChunks, documents, documentVersions, embeddingAdapter, entities, entityAttributes, factConflicts, factEvidence, facts, projectionEvents, relations, retrievalTraces, rerankAdapter, userFiles, users } from '@agent-harness/shared';
import { db, pool } from './db';

function requireDb(): NonNullable<typeof db> {
  if (!db) throw new Error('Database not available — service is running in degraded mode');
  return db;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 2, delayMs: number = 500): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        logger.warn('db.operation.retry', 'DB operation failed, retrying', {
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message
        });
        await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError!;
}
import { DEFAULT_ORG_ID, lexicalScore, randomRef, sha256Buffer, sha256Prefixed, sourceScope, splitIntoChunks, tokenCount, userRefToDbId } from './support';
import { artifactStorage } from './artifact-storage';

const logger = createLogger('fact-retrieval');

export interface DocumentIndexInput {
  owner_user_id: string;
  title: string;
  content_text: string;
  source_type: string;
  source_uri: string;
  scope: string[];
}

export interface RetrievalQueryInput {
  owner_user_id: string;
  org_id?: string;
  query_text: string;
  intent_type: string;
  allowed_scopes: string[];
  max_results?: number;
}

export interface FactWriteInput {
  owner_user_id: string;
  org_id?: string;
  fact_text: string;
  scope: string[];
  mode: 'insert' | 'supersede' | 'conflict' | 'attach-evidence';
  target_fact_id?: string;
  subject_ref?: string;
  predicate?: string;
  object_value?: string;
  evidence_refs?: Array<{ evidence_pack_id: string; evidence_pack_hash: string }>;
  confidence?: number;
}

export interface ArtifactWriteInput {
  owner_user_id: string;
  org_id?: string;
  artifact_type: string;
  content_text: string;
  scope: string[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactReadInput {
  owner_user_id: string;
  artifact_id: string;
  scope: string[];
}

export interface EntityWriteInput {
  owner_user_id: string;
  org_id?: string;
  entities: Array<{
    name: string;
    type: string;
    attributes?: Record<string, string>;
  }>;
  slots?: Array<{
    slot_name: string;
    slot_value: string;
    confidence?: number;
  }>;
  scope: string[];
  source_ref?: string;
}

const ALLOWED_VERTEX_LABELS = new Set(['Entity', 'Person', 'Organization', 'Location', 'Event', 'Concept', 'Technology', 'Product', 'Client', 'Contact', 'Opportunity', 'Project']);
const ALLOWED_EDGE_LABELS = new Set(['RELATED', 'works_for', 'located_in', 'uses', 'manages', 'depends_on', 'co_occurs_with', 'has_slot_value', 'BELONGS_TO', 'EMPLOYES', 'INVOLVED_IN', 'INTERACTS_WITH', 'REPORTS_TO', 'PARTNERS_WITH', 'COMPETES_WITH', 'SUPPLIES_TO']);
const DOLLAR_QUOTE_TAG = 'tag';

function sanitizeCypherLabel(value: string, allowedSet: Set<string>, fallback: string): string {
  const trimmed = value.trim();
  if (allowedSet.has(trimmed)) return trimmed;
  return fallback;
}

function sanitizeCypherLiteral(value: string): string {
  const cleaned = String(value || '');
  return cleaned
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\$/g, '')
    .replace(/[\n\r]/g, ' ')
    .slice(0, 4096);
}

function sanitizeCypherString(value: string): string {
  const cleaned = String(value || '');
  const sanitized = cleaned
    .replace(/['"\\`]/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '')
    .replace(/;/g, '')
    .replace(/[$]/g, '')
    .replace(/[{}]/g, '')
    .replace(/\/\//g, '')
    .replace(/[\n\r]/g, ' ')
    .slice(0, 4096);
  return sanitized;
}

class FactRetrievalService {
  private redisCacheInitialized = false;

  private async ensureRedisCache(): Promise<void> {
    if (this.redisCacheInitialized) return;
    this.redisCacheInitialized = true;
    await this.initRedisCache();
  }

  private async ensureUser(userRef: string): Promise<string> {
    const userId = userRefToDbId(userRef);

    await requireDb().insert(users).values({
      id: userId,
      orgId: DEFAULT_ORG_ID,
      username: userRef.replace(/^u_/, ''),
      displayName: userRef.replace(/^u_/, ''),
      role: 'user',
      status: 'active',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    }).onConflictDoNothing();

    return userId;
  }

  private async backfillEmbeddings(chunks: Array<{ id: string; contentText: string }>): Promise<void> {
    const batchSize = 5;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      try {
        const embeddingResults = await embeddingAdapter.embedBatch(batch.map(c => c.contentText));
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embeddingResult = embeddingResults[j];
          if (embeddingResult?.embedding) {
            if (!pool) throw new Error('Pool not available');
            await pool.query(
              'UPDATE document_chunk SET embedding = $1::vector, embedding_model_version = $2 WHERE id = $3',
              [JSON.stringify(embeddingResult.embedding), embeddingResult.provider || 'unknown', chunk.id]
            );
          }
        }
        logger.info('embedding.backfill.batch', 'Embedding backfill batch completed', {
          batch_start: i,
          batch_size: batch.length
        });
      } catch (error) {
        logger.warn('embedding.backfill.batch_failed', 'Embedding backfill batch failed', {
          batch_start: i,
          error: String(error)
        });
      }
    }
  }

  async backfillAllPendingEmbeddings(limit: number = 100): Promise<{ processed: number; failed: number }> {
    const pendingChunks = await requireDb().execute(sql`
      SELECT id, content_text
      FROM document_chunk
      WHERE embedding IS NULL
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);

    const chunks = (pendingChunks.rows || []) as Array<{ id: string; content_text: string }>;
    if (chunks.length === 0) return { processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;

    const batchSize = 5;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      try {
        const embeddingResults = await embeddingAdapter.embedBatch(batch.map(c => c.content_text));
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embeddingResult = embeddingResults[j];
          if (embeddingResult?.embedding) {
            if (!pool) throw new Error('Pool not available');
            await pool.query(
              'UPDATE document_chunk SET embedding = $1::vector, embedding_model_version = $2 WHERE id = $3',
              [JSON.stringify(embeddingResult.embedding), embeddingResult.provider || 'unknown', chunk.id]
            );
            processed++;
          } else {
            failed++;
          }
        }
      } catch (error) {
        failed += batch.length;
        logger.warn('embedding.backfill.batch_failed', 'Embedding backfill batch failed', {
          batch_start: i,
          error: String(error)
        });
      }
    }

    logger.info('embedding.backfill.completed', 'Embedding backfill completed', {
      processed,
      failed,
      total: chunks.length
    });

    return { processed, failed };
  }

  async resetAllData(): Promise<void> {
    const tableNames = ['retrieval_trace', 'fact_conflict', 'fact_evidence', 'fact', 'document_chunk', 'document_version', 'document'] as const;
    for (const tableName of tableNames) {
      let deleted = 0;
      do {
        const result = await requireDb().execute(sql`DELETE FROM ${sql.raw(tableName)} WHERE id IN (SELECT id FROM ${sql.raw(tableName)} LIMIT 1000)`);
        deleted = Number((result as unknown as { rowCount?: number }).rowCount ?? 0);
      } while (deleted > 0);
    }
    logger.info('data.reset', 'All fact-retrieval data reset (batch delete)');
  }

  async indexDocument(input: DocumentIndexInput): Promise<{ document_id: string; version_id: string; chunks_indexed: number; chunk_ids: string[] }> {
    const userId = await withRetry(() => this.ensureUser(input.owner_user_id));

    const [document] = await withRetry(() => requireDb().insert(documents).values({
      ownerUserId: userId,
      scopeType: input.scope[0] || 'private',
      title: input.title,
      sourceKind: input.source_type,
      sourceUri: input.source_uri,
      status: 'active',
      metadata: {}
    }).returning());

    const [version] = await withRetry(() => requireDb().insert(documentVersions).values({
      documentId: document.id,
      versionNo: 1,
      status: 'active',
      contentHash: sha256Prefixed(input.content_text),
      metadata: {}
    }).returning());

    const chunks = splitIntoChunks(input.content_text, 512);
    let insertedChunks: typeof documentChunks.$inferSelect[] = [];

    if (chunks.length > 0) {
      insertedChunks = await withRetry(() => requireDb().insert(documentChunks).values(chunks.map((chunk, index) => ({
        documentId: document.id,
        documentVersionId: version.id,
        ownerUserId: userId,
        scopeType: input.scope[0] || 'private',
        chunkIndex: index,
        contentText: chunk,
        tokenCount: tokenCount(chunk),
        embedding: null,
        metadata: {}
      }))).returning());
    }

    logger.info('document.indexed', 'Document indexed', {
      document_id: document.id,
      version_id: version.id,
      chunks_count: insertedChunks.length
    });

    if (insertedChunks.length > 0) {
      void this.backfillEmbeddings(insertedChunks.map(chunk => ({ id: chunk.id, contentText: chunk.contentText })));
    }

    return {
      document_id: document.id,
      version_id: version.id,
      chunks_indexed: insertedChunks.length,
      chunk_ids: insertedChunks.map(chunk => chunk.id)
    };
  }

  async query(input: RetrievalQueryInput): Promise<{
    evidence_pack_id: string;
    evidence_pack_hash: string;
    retrieval_trace_id: string;
    retrieval_steps: Array<{ step_type: string; ref: string; items_count: number; degraded: boolean }>;
    items: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }>;
    degraded: boolean;
    degradation_reasons: string[];
  }> {
    const maxResults = input.max_results || 10;
    const plan = this.buildPlan(input.intent_type);

    const cacheKey = `retrieval:${input.owner_user_id}:${input.org_id || ''}:${input.intent_type}:${input.query_text.slice(0, 200)}:${input.allowed_scopes.join(',')}`;
    const cachedResult = await this.checkCache(cacheKey);
    if (cachedResult) {
      return { ...cachedResult, items: cachedResult.items.slice(0, maxResults) };
    }

    const allItems: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }> = [];
    const retrievalSteps: Array<{ step_type: string; ref: string; items_count: number; degraded: boolean }> = [];
    let degraded = false;
    const degradationReasons: string[] = [];
    const startTime = Date.now();

    const orgId = input.org_id || null;

    for (const step of plan) {
      try {
        let items: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }> = [];

        if (step === 'structured') {
          const structuredItems = await this.runStructuredQuery(input.query_text, input.allowed_scopes, input.owner_user_id, orgId);
          items = structuredItems;
        } else if (step === 'vector') {
          const embeddingResult = await embeddingAdapter.embedText(input.query_text);
          if (embeddingResult.degraded) {
            degraded = true;
            degradationReasons.push(embeddingResult.degradation_reason || 'embedding_degraded');
          }
          if (embeddingResult.embedding) {
            const vectorItems = await this.runVectorQuery(input.query_text, input.allowed_scopes, input.owner_user_id, embeddingResult.embedding, orgId);
            items = vectorItems;
          } else {
            degraded = true;
            degradationReasons.push('embedding_unavailable');
          }
        } else if (step === 'fulltext') {
          const fulltextItems = await this.runChunkQuery(input.query_text, input.allowed_scopes, input.owner_user_id, orgId);
          items = fulltextItems;
        } else if (step === 'graph') {
          const graphItems = await this.runGraphQuery(input.query_text, input.allowed_scopes, input.owner_user_id, orgId);
          items = graphItems;
        }

        const stepRef = randomRef(`rt_${step}`);
        retrievalSteps.push({
          step_type: step,
          ref: stepRef,
          items_count: items.length,
          degraded: false
        });

        allItems.push(...items);
      } catch (error) {
        degraded = true;
        degradationReasons.push(`${step}_failed: ${(error as Error).message}`);
        retrievalSteps.push({
          step_type: step,
          ref: randomRef(`rt_${step}`),
          items_count: 0,
          degraded: true
        });
      }
    }

    const dedupedItems = this.deduplicateItems(allItems);
    let scoredItems = dedupedItems.sort((a, b) => b.score - a.score).slice(0, maxResults * 3);

    const enableRerank = process.env.ENABLE_RERANK !== 'false'
      && (process.env.ENABLE_RERANK === 'true'
        || (dedupedItems.length > 1));

    if (enableRerank && scoredItems.length > 1) {
      try {
        const rerankCandidates = scoredItems.map((item, index) => ({
          id: item.fact_id || item.chunk_id || `item_${index}`,
          text: item.content,
          payload: item
        }));

        const rerankResult = await rerankAdapter.rerank(input.query_text, rerankCandidates, maxResults);

        if (rerankResult.degraded) {
          degraded = true;
          degradationReasons.push(rerankResult.degradation_reason || 'rerank_degraded');
        }

        scoredItems = rerankResult.items.map(item => item.payload);
        retrievalSteps.push({
          step_type: 'rerank',
          ref: randomRef('rt_rerank'),
          items_count: rerankResult.items.length,
          degraded: rerankResult.degraded
        });
      } catch (error) {
        degraded = true;
        degradationReasons.push(`rerank_failed: ${(error as Error).message}`);
        scoredItems = scoredItems.slice(0, maxResults);
      }
    } else {
      scoredItems = scoredItems.slice(0, maxResults);
    }

    const evidencePackId = randomRef('ep');
    const evidencePackHash = sha256Prefixed(JSON.stringify(scoredItems));

    const [traceRow] = await withRetry(() => requireDb().insert(retrievalTraces).values({
      ownerUserId: userRefToDbId(input.owner_user_id),
      queryText: input.query_text,
      intentType: input.intent_type,
      scopeSummary: { user_id: input.owner_user_id, allowed_scopes: input.allowed_scopes },
      retrievalPlan: { steps: plan },
      resultSummary: { item_count: scoredItems.length, evidence_pack_id: evidencePackId, steps: retrievalSteps, degradation_reasons: degradationReasons },
      durationMs: Date.now() - startTime,
      degraded
    }).returning());

    const retrievalTraceId = traceRow?.id || evidencePackId;

    logger.info('retrieval.completed', 'Retrieval query completed', {
      evidence_pack_id: evidencePackId,
      items_count: scoredItems.length,
      degraded,
      degradation_reasons: degradationReasons
    });

    const result = {
      evidence_pack_id: evidencePackId,
      evidence_pack_hash: evidencePackHash,
      retrieval_trace_id: retrievalTraceId,
      retrieval_steps: retrievalSteps,
      items: scoredItems,
      degraded,
      degradation_reasons: degradationReasons
    };

    void this.setCache(cacheKey, result);

    return result;
  }

  async writeFact(input: FactWriteInput): Promise<{ fact_id: string; mode: string }> {
    const userId = await withRetry(() => this.ensureUser(input.owner_user_id));

    if (input.mode === 'supersede' && input.target_fact_id) {
      const targetId = input.target_fact_id;
      await withRetry(() => requireDb().update(facts).set({ status: 'superseded', updatedAt: new Date() }).where(eq(facts.id, targetId)));
    }

    const [newFact] = await withRetry(() => requireDb().insert(facts).values({
      ownerUserId: userId,
      scopeType: input.scope[0] || 'private',
      subjectRef: input.subject_ref || input.owner_user_id,
      predicate: input.predicate || 'states',
      objectValue: input.object_value || input.fact_text,
      objectJson: {},
      status: 'active',
      confidence: input.confidence || 1.0,
      metadata: {}
    }).returning());

    if (input.mode === 'conflict' && input.target_fact_id) {
      await withRetry(() => requireDb().insert(factConflicts).values({
        existingFactId: input.target_fact_id!,
        incomingFactId: newFact.id,
        conflictReason: 'contradiction',
        resolutionStatus: 'open',
        metadata: {}
      }));
    }

    if (input.evidence_refs && input.evidence_refs.length > 0) {
      await withRetry(() => requireDb().insert(factEvidence).values(input.evidence_refs!.map((evidence) => ({
        factId: newFact.id,
        evidenceRef: evidence.evidence_pack_id,
        evidenceType: 'document_chunk'
      }))));
    }

    logger.info('fact.written', 'Fact written', {
      fact_id: newFact.id,
      mode: input.mode
    });

    void this.projectEntityFromFact(input, newFact.id);

    return { fact_id: newFact.id, mode: input.mode };
  }

  private async projectEntityFromFact(input: FactWriteInput, factId: string): Promise<void> {
    try {
      if (input.subject_ref) {
        await requireDb().insert(projectionEvents).values({
          graphName: 'knowledge_graph',
          vertexLabel: 'entity',
          operation: 'create',
          entityRef: input.subject_ref,
          payload: {
            fact_id: factId,
            entity_name: input.subject_ref,
            predicate: input.predicate,
            object_value: input.object_value,
            owner_user_id: input.owner_user_id,
            scope: input.scope
          },
          applied: false
        }).onConflictDoNothing();
      }

      if (input.subject_ref && input.predicate && input.object_value) {
        await requireDb().insert(projectionEvents).values({
          graphName: 'knowledge_graph',
          edgeLabel: input.predicate,
          operation: 'create',
          entityRef: input.subject_ref,
          payload: {
            fact_id: factId,
            from_entity: input.subject_ref,
            relation_type: input.predicate,
            to_entity: input.object_value,
            owner_user_id: input.owner_user_id,
            scope: input.scope
          },
          applied: false
        }).onConflictDoNothing();
      }
    } catch (error) {
      logger.warn('projection.event.failed', 'Failed to create projection event', {
        fact_id: factId,
        error: String(error)
      });
    }
  }

  async writeArtifact(input: ArtifactWriteInput): Promise<{ artifact_id: string; artifact_hash: string; storage_backend: string; degraded: boolean }> {
    const userId = await this.ensureUser(input.owner_user_id);
    const artifactId = randomRef('art');
    const artifactHash = sha256Prefixed(input.content_text);

    let writeResult: { backend: 'localfs' | 'minio'; storage_ref: string };
    let degraded = false;
    let degradationReason = '';
    const preferredBackend = artifactStorage.preferredBackend();

    try {
      writeResult = await artifactStorage.writeText(preferredBackend, artifactId, input.content_text, input.org_id);
    } catch (error) {
      if (preferredBackend !== 'minio') {
        throw error;
      }

      degraded = true;
      degradationReason = String(error);
      writeResult = await artifactStorage.writeText('localfs', artifactId, input.content_text, input.org_id);

      await withRetry(() => requireDb().insert(auditEvents).values({
        userId: input.owner_user_id,
        workflowInstanceId: null,
        action: 'artifact.storage.degraded',
        resourceType: 'artifact',
        resourceRef: artifactId,
        resourceScope: input.scope[0] || 'private',
        result: 'success',
        detailJson: {
          preferred_backend: preferredBackend,
          fallback_backend: writeResult.backend,
          reason: degradationReason,
        },
        occurredAt: new Date(),
      }));
    }

    const [artifact] = await withRetry(() => requireDb().insert(artifactObjects).values({
      ownerUserId: userId,
      scopeType: input.scope[0] || 'private',
      artifactType: input.artifact_type,
      contentHash: artifactHash,
      storageBackend: writeResult.backend,
      storageRef: writeResult.storage_ref,
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(input.content_text, 'utf8'),
      inlineThresholdExceeded: true,
      metadata: input.metadata || {}
    }).returning());

    logger.info('artifact.create', 'Artifact created', {
      artifact_id: artifact.id,
      artifact_type: input.artifact_type,
      storage_backend: writeResult.backend
    });

    return { artifact_id: artifact.id, artifact_hash: artifactHash, storage_backend: writeResult.backend, degraded };
  }

  async readArtifact(input: ArtifactReadInput): Promise<{ artifact_id: string; content_text: string; scope: string[] } | null> {
    const ownerDbId = userRefToDbId(input.owner_user_id);
    const conditions = [eq(artifactObjects.id, input.artifact_id)];
    conditions.push(
      or(
        eq(artifactObjects.ownerUserId, ownerDbId),
        eq(artifactObjects.scopeType, 'public'),
        eq(artifactObjects.scopeType, 'shared')
      )!
    );

    const [artifact] = await requireDb().select().from(artifactObjects)
      .where(and(...conditions))
      .limit(1);

    if (!artifact) return null;

    const content = await artifactStorage.readText(artifact.storageBackend, artifact.storageRef);

    return {
      artifact_id: artifact.id,
      content_text: content || '',
      scope: [artifact.scopeType]
    };
  }

  async writeEntities(input: EntityWriteInput): Promise<{ entity_ids: string[]; slot_count: number; relation_count: number }> {
    const userId = await withRetry(() => this.ensureUser(input.owner_user_id));
    const scopeType = input.scope[0] || 'private';
    const entityIds: string[] = [];
    let slotCount = 0;
    let relationCount = 0;
    const entityNameToId = new Map<string, string>();

    for (const entityInput of input.entities) {
      try {
        const [existing] = await withRetry(() => requireDb().select({ id: entities.id })
          .from(entities)
          .where(and(eq(entities.ownerUserId, userId), eq(entities.canonicalName, entityInput.name), eq(entities.status, 'active')))
          .limit(1));

        if (existing) {
          entityNameToId.set(entityInput.name, existing.id);
          entityIds.push(existing.id);
          continue;
        }

        const [newEntity] = await withRetry(() => requireDb().insert(entities).values({
          ownerUserId: userId,
          scopeType,
          entityType: entityInput.type || 'Other',
          canonicalName: entityInput.name,
          status: 'active',
          metadata: { source_ref: input.source_ref || 'extraction' }
        }).returning());

        entityNameToId.set(entityInput.name, newEntity.id);
        entityIds.push(newEntity.id);

        if (entityInput.attributes) {
          for (const [key, value] of Object.entries(entityInput.attributes)) {
            await withRetry(() => requireDb().insert(entityAttributes).values({
              entityId: newEntity.id,
              attrKey: key,
              attrValue: value,
              valueJson: {},
              confidence: 0.8,
              sourceRef: input.source_ref || 'extraction'
            }));
            slotCount++;
          }
        }
      } catch (error) {
        logger.warn('entity.write.failed', 'Failed to write entity', {
          entity_name: entityInput.name,
          error: String(error)
        });
      }
    }

    if (input.slots && input.slots.length > 0) {
      for (const slot of input.slots) {
        try {
          await withRetry(() => requireDb().insert(facts).values({
            ownerUserId: userId,
            scopeType,
            subjectRef: slot.slot_name,
            predicate: 'has_slot_value',
            objectValue: slot.slot_value,
            objectJson: {},
            status: 'active',
            confidence: slot.confidence || 0.8,
            metadata: { slot_name: slot.slot_name, source_ref: input.source_ref || 'extraction' }
          }).returning());
          slotCount++;
        } catch (error) {
          logger.warn('slot.write.failed', 'Failed to write slot', {
            slot_name: slot.slot_name,
            error: String(error)
          });
        }
      }
    }

    for (const [name, fromId] of entityNameToId) {
      for (const otherName of entityNameToId.keys()) {
        if (otherName === name) continue;
        const toId = entityNameToId.get(otherName)!;
        try {
          await withRetry(() => requireDb().insert(relations).values({
            ownerUserId: userId,
            scopeType,
            fromEntityId: fromId,
            relationType: 'co_occurs_with',
            toEntityId: toId,
            status: 'active',
            metadata: { source_ref: input.source_ref || 'extraction' }
          }).onConflictDoNothing());
          relationCount++;
        } catch {
          logger.warn('fact-extract.relation.duplicate', 'Skipping duplicate relation', { fromEntityId: fromId, toEntityId: toId });
        }
      }
    }

    logger.info('entities.written', 'Entities and slots written', {
      entity_count: entityIds.length,
      slot_count: slotCount,
      relation_count: relationCount
    });

    return { entity_ids: entityIds, slot_count: slotCount, relation_count: relationCount };
  }

  private retrievalCache = new Map<string, { value: unknown; expiresAt: number }>();
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  private redisCacheClient: { get(key: string): Promise<string | null>; set(key: string, value: string, options?: { EX?: number }): Promise<string | null>; del(key: string): Promise<number> } | null = null;

  private async initRedisCache(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;
    try {
      const redis = await import('redis');
      const client = redis.createClient({ url: redisUrl });
      (client as unknown as { on: (event: string, handler: (err: unknown) => void) => void }).on('error', (err: unknown) => {
        logger.warn('retrieval.cache.redis_error', 'Redis client error', { error: String(err) });
      });
      await client.connect();
      this.redisCacheClient = client;
      logger.info('retrieval.cache.redis', 'Redis retrieval cache connected');
    } catch (error) {
      logger.warn('retrieval.cache.redis_failed', 'Redis cache unavailable, using memory', { error: String(error) });
      this.redisCacheClient = null;
    }
  }

  private async checkCache(key: string): Promise<{
    evidence_pack_id: string;
    evidence_pack_hash: string;
    retrieval_trace_id: string;
    retrieval_steps: Array<{ step_type: string; ref: string; items_count: number; degraded: boolean }>;
    items: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }>;
    degraded: boolean;
    degradation_reasons: string[];
  } | null> {
    if (process.env.RETRIEVAL_CACHE_ENABLED !== 'true') return null;

    try {
      await this.ensureRedisCache();
      if (this.redisCacheClient) {
        const raw = await this.redisCacheClient.get(`ah:retrieval:${key}`);
        if (raw) {
          logger.info('retrieval.cache.redis.hit', 'Redis retrieval cache hit', { key: key.slice(0, 80) });
          return JSON.parse(raw);
        }
      }
      const cached = this.retrievalCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        logger.info('retrieval.cache.hit', 'Retrieval cache hit', { key: key.slice(0, 80) });
        return cached.value as typeof cached.value & { evidence_pack_id: string; evidence_pack_hash: string; retrieval_trace_id: string; retrieval_steps: Array<{ step_type: string; ref: string; items_count: number; degraded: boolean }>; items: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }>; degraded: boolean; degradation_reasons: string[] };
      }
      if (cached) {
        this.retrievalCache.delete(key);
      }
      return null;
    } catch (err) {
      logger.warn('retrieval.cache.read_failed', 'Cache read failed', { error: String(err) });
      return null;
    }
  }

  private async setCache(key: string, value: unknown): Promise<void> {
    if (process.env.RETRIEVAL_CACHE_ENABLED !== 'true') return;

    try {
      await this.ensureRedisCache();
      const ttl = Number(process.env.RETRIEVAL_CACHE_TTL_SEC || 300);
      if (this.redisCacheClient) {
        await this.redisCacheClient.set(`ah:retrieval:${key}`, JSON.stringify(value), { EX: ttl });
      }
      this.retrievalCache.set(key, { value, expiresAt: Date.now() + ttl * 1000 });

      if (this.retrievalCache.size > 1000) {
        const now = Date.now();
        for (const [k, v] of this.retrievalCache) {
          if (v.expiresAt <= now) this.retrievalCache.delete(k);
        }
      }

      if (!this.cacheCleanupInterval) {
        this.cacheCleanupInterval = setInterval(() => {
          const now = Date.now();
          for (const [k, v] of this.retrievalCache) {
            if (v.expiresAt <= now) this.retrievalCache.delete(k);
          }
        }, 60000);
        this.cacheCleanupInterval.unref();
      }
    } catch (err) {
      logger.warn('retrieval.cache.write_failed', 'Cache write failed', { error: String(err) });
    }
  }

  private buildPlan(intentType: string): string[] {
    const enableGraph = process.env.ENABLE_GRAPH !== 'false';
    switch (intentType) {
      case 'factual_lookup':
        return enableGraph ? ['structured', 'fulltext', 'graph'] : ['structured', 'fulltext'];
      case 'deep_analysis':
        return enableGraph ? ['structured', 'vector', 'fulltext', 'graph'] : ['structured', 'vector', 'fulltext'];
      case 'code_search':
        return ['fulltext', 'vector'];
      case 'relationship_query':
        return ['graph', 'structured'];
      default:
        return enableGraph ? ['structured', 'vector', 'fulltext', 'graph'] : ['structured', 'vector', 'fulltext'];
    }
  }

  async applyPendingProjectionEvents(): Promise<{ applied: number; failed: number }> {
    const ageReady = await this.checkAgeAvailable();
    if (!ageReady) return { applied: 0, failed: 0 };

    const pending = await requireDb().select().from(projectionEvents)
      .where(eq(projectionEvents.applied, false))
      .limit(50);

    const vertexEvents = pending.filter(e => e.vertexLabel);
    const edgeEvents = pending.filter(e => e.edgeLabel && !e.vertexLabel);
    const ordered = [...vertexEvents, ...edgeEvents];

    let applied = 0;
    let failed = 0;
    let graphRecovered = false;

    for (const event of ordered) {
      try {
        const payload = (event.payload || {}) as Record<string, unknown>;
        const graphName = event.graphName || 'knowledge_graph';

        if (!pool) throw new Error('Pool not available');
        const client = await pool.connect();
        try {
          await client.query('SET search_path = ag_catalog, public');

          const applyCypher = async (cypherSql: string): Promise<void> => {
            try {
              await client.query(cypherSql);
            } catch (cypherErr: unknown) {
              const msg = String((cypherErr as { message?: string })?.message || '');
              if (!graphRecovered && msg.includes('unhandled cypher')) {
                graphRecovered = true;
                logger.warn('graph.recovering', 'Recreating corrupted AGE graph', { graphName });
                await client.query(`SELECT drop_graph('${graphName}', true)`);
                await client.query(`SELECT create_graph('${graphName}')`);
                await client.query(cypherSql);
              } else {
                throw cypherErr;
              }
            }
          };

          if (event.operation === 'create' && event.vertexLabel) {
            const safeVertexLabel = sanitizeCypherLabel(String(event.vertexLabel), ALLOWED_VERTEX_LABELS, 'Entity');
            const entityName = sanitizeCypherLiteral(String(payload.from_entity || event.entityRef || ''));
            const entityType = sanitizeCypherLiteral(String(event.vertexLabel));
            const ownerUserId = sanitizeCypherLiteral(String(payload.owner_user_id || ''));
            const scopeType = sanitizeCypherLiteral(String((payload.scope as string[])?.[0] || 'private'));
            const cypher = `CREATE (n:${safeVertexLabel} {canonical_name: '${entityName}', entity_type: '${entityType}', status: 'active', owner_user_id: '${ownerUserId}', scope_type: '${scopeType}'}) RETURN n`;
            await applyCypher(`SELECT * FROM cypher('${graphName}', $tag$ ${cypher} $tag$) AS (v ag_catalog.agtype)`);
          }

          if (event.operation === 'create' && event.edgeLabel) {
            const safeVertexLabel2 = sanitizeCypherLabel(String(event.vertexLabel || 'Entity'), ALLOWED_VERTEX_LABELS, 'Entity');
            const safeEdgeLabel = sanitizeCypherLabel(String(event.edgeLabel), ALLOWED_EDGE_LABELS, 'RELATED');
            const fromEntity = sanitizeCypherLiteral(String(payload.from_entity || ''));
            const toEntity = sanitizeCypherLiteral(String(payload.to_entity || ''));
            const relType = sanitizeCypherLiteral(String(event.edgeLabel));
            if (fromEntity && toEntity) {
              const cypher = `MATCH (a:${safeVertexLabel2} {canonical_name: '${fromEntity}'}), (b:Entity {canonical_name: '${toEntity}'}) CREATE (a)-[r:${safeEdgeLabel} {relation_type: '${relType}'}]->(b) RETURN r`;
              await applyCypher(`SELECT * FROM cypher('${graphName}', $tag$ ${cypher} $tag$) AS (e ag_catalog.agtype)`);
            }
          }
        } finally {
          client.release();
        }

        await requireDb().update(projectionEvents)
          .set({ applied: true, appliedAt: new Date() })
          .where(eq(projectionEvents.id, event.id));

        applied++;
      } catch (error) {
        logger.warn('projection.apply_failed', 'Failed to apply projection event', {
          event_id: event.id,
          error: String(error)
        });
        failed++;
      }
    }

    if (applied > 0) {
      logger.info('projection.applied', 'Applied pending projection events to AGE graph', { applied, failed });
    }

    return { applied, failed };
  }

  // submitUserFact: 接收用户通过消息通道主动提交的知识片段
  // 将用户原文写入 fact 表，状态设为 unconfirmed 等待管理员审核
  // 参数:
  //   input.source_text - 用户原始消息文本
  //   input.owner_user_id - 提交者ID
  //   input.org_id - 所属组织
  //   input.source - 来源标识 (user_submitted/manual 等)
  // 返回:
  //   fact_id - 新创建的知识条目ID
  async submitUserFact(input: { source_text: string; owner_user_id: string; org_id?: string; source: string }): Promise<{ fact_id: string }> {
    const factId = randomRef('fact');
    // 尝试从文本中抽取主体和关系作为结构化字段
    const extracted = this.tryExtractSubjectPredicate(input.source_text);

    await withRetry(() => requireDb().insert(facts).values({
      id: factId,
      ownerUserId: userRefToDbId(input.owner_user_id),
      orgId: input.org_id || null,
      scopeType: 'private',
      subjectRef: extracted.subject || 'unknown',
      predicate: extracted.predicate || 'unknown',
      objectValue: input.source_text,
      objectJson: {},
      status: 'unconfirmed',
      confidence: 0.5,
      metadata: {
        source: input.source,
        submitted_at: new Date().toISOString(),
        submitted_by: input.owner_user_id
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    // 异步投影实体到图空间（不阻塞响应）
    if (extracted.subject) {
      void this.projectEntityFromFact({
        owner_user_id: input.owner_user_id,
        org_id: input.org_id,
        fact_text: input.source_text,
        scope: [input.org_id ? 'org' : 'private'],
        mode: 'insert',
        subject_ref: extracted.subject,
        predicate: extracted.predicate,
        object_value: input.source_text
      }, factId);
    }

    logger.info('fact.user_submitted', 'User submitted fact to review pool', {
      fact_id: factId,
      owner_user_id: input.owner_user_id
    });

    return { fact_id: factId };
  }

  // tryExtractSubjectPredicate: 简单启发式地从文本中提取主体和关系
  // 识别常见模式: "XXX是YYY" "XXX的联系方式" "XXX负责YYY"
  private tryExtractSubjectPredicate(text: string): { subject: string; predicate: string } {
    // 模式1: "XXX是YYY公司的ZZZ"
    const isPattern = text.match(/(.+?)是(.+?)的(.+)/);
    if (isPattern) {
      return { subject: isPattern[1].trim(), predicate: 'position' };
    }
    // 模式2: "XXX的联系方式是YYY" / "XXX的电话"
    const contactPattern = text.match(/(.+?)的(电话|联系方式|邮箱|地址|手机)/);
    if (contactPattern) {
      return { subject: contactPattern[1].trim(), predicate: 'contact' };
    }
    // 模式3: "XXX负责YYY" / "XXX主管YYY"
    const chargePattern = text.match(/(.+?)(负责|主管|管理|分管)(.+)/);
    if (chargePattern) {
      return { subject: chargePattern[1].trim(), predicate: 'responsible' };
    }
    // 模式4: "XXX公司在YYY" / "XXX位于YYY"
    const locationPattern = text.match(/(.+?)(位于|在|设|总部在)(.+)/);
    if (locationPattern) {
      return { subject: locationPattern[1].trim(), predicate: 'location' };
    }
    return { subject: '', predicate: '' };
  }

  // listFactsForReview: 列出待审核的知识条目集合
  // 按 org_id + status 过滤，支持分页
  async listFactsForReview(input: { org_id?: string; status: string; limit: number; offset: number }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const conditions: SQL[] = [eq(facts.status, input.status)];
    if (input.org_id) {
      conditions.push(eq(facts.orgId, input.org_id));
    } else {
      conditions.push(sql`f.org_id IS NOT NULL`);
    }

    const totalResult = await requireDb().select({ count: sql<number>`count(*)` }).from(facts)
      .where(and(...conditions));
    const total = Number(totalResult[0]?.count || 0);

    const rows = await requireDb().select().from(facts)
      .where(and(...conditions))
      .orderBy(sql`created_at DESC`)
      .limit(input.limit)
      .offset(input.offset);

    const items = rows.map(row => {
      const meta = (row.metadata || {}) as Record<string, unknown>;
      return {
        fact_id: row.id,
        subject: row.subjectRef,
        predicate: row.predicate,
        object_value: row.objectValue,
        status: row.status,
        source: meta.source || 'unknown',
        confidence: row.confidence,
        created_at: row.createdAt?.toISOString(),
        owner_user_id: row.ownerUserId,
        org_id: row.orgId,
        metadata: row.metadata
      };
    });

    return { items, total };
  }

  // reviewFact: 管理员审核知识条目
  // 支持 approve(批准→active), approve_shared(批准→active+scope=shared), approve_org(批准→active+scope=public), reject(拒绝), return(退回)
  async reviewFact(input: { fact_id: string; action: 'approve' | 'approve_shared' | 'approve_org' | 'reject' | 'return'; reviewer_id: string; review_note: string }): Promise<{ success: boolean; new_status: string }> {
    const statusMap: Record<string, { status: string; scope?: string }> = {
      approve: { status: 'active' },
      approve_shared: { status: 'active', scope: 'shared' },
      approve_org: { status: 'active', scope: 'public' },
      reject: { status: 'rejected' },
      return: { status: 'unconfirmed' }
    };

    const mapping = statusMap[input.action];
    if (!mapping) {
      return { success: false, new_status: '' };
    }

    const updateData: Record<string, unknown> = {
      status: mapping.status,
      updatedAt: new Date()
    };

    if (mapping.scope) {
      updateData['scope_type'] = mapping.scope;
    }

    // 附加审核元数据
    const existing = await requireDb().select().from(facts).where(eq(facts.id, input.fact_id)).limit(1);
    if (existing.length === 0) {
      return { success: false, new_status: '' };
    }
    const currentMetadata = (existing[0].metadata || {}) as Record<string, unknown>;
    updateData['metadata'] = {
      ...currentMetadata,
      reviewed_at: new Date().toISOString(),
      reviewed_by: input.reviewer_id,
      review_note: input.review_note,
      review_action: input.action
    };

    await requireDb().update(facts).set(updateData).where(eq(facts.id, input.fact_id));

    logger.info('fact.reviewed', 'Fact reviewed by admin', {
      fact_id: input.fact_id,
      action: input.action,
      new_status: mapping.status
    });

    return { success: true, new_status: mapping.status };
  }

  private async runStructuredQuery(queryText: string, allowedScopes: string[], ownerUserId: string, orgId?: string | null): Promise<Array<{ fact_id: string; content: string; score: number; source_scope: string }>> {
    const ownerDbId = userRefToDbId(ownerUserId);
    const includePublic = allowedScopes.some(s => s.startsWith('public'));
    const includeShared = allowedScopes.some(s => s === 'shared');
    const conditions = [eq(facts.status, 'active')];
    const scopeOrs: SQL[] = [eq(facts.ownerUserId, ownerDbId)];
    if (includePublic) {
      if (orgId) {
        scopeOrs.push(and(eq(facts.scopeType, 'public'), sql`f.owner_user_id IN (SELECT u.id FROM "user" u WHERE u.org_id = ${orgId})`)!);
      } else {
        scopeOrs.push(eq(facts.scopeType, 'public'));
      }
    }
    if (includeShared) {
      scopeOrs.push(eq(facts.scopeType, 'shared'));
    }
    conditions.push(or(...scopeOrs)!);
    const rows = await requireDb().select().from(facts)
      .where(and(...conditions))
      .limit(20);

    return rows.map(row => ({
      fact_id: row.id,
      content: row.objectValue || '',
      score: lexicalScore(queryText, row.objectValue || ''),
      source_scope: sourceScope(row.scopeType, ownerUserId)
    }));
  }

  private async runVectorQuery(queryText: string, allowedScopes: string[], ownerUserId: string, embedding: number[], orgId?: string | null): Promise<Array<{ chunk_id: string; content: string; score: number; source_scope: string }>> {
    const includePublic = allowedScopes.some(s => s.startsWith('public'));
    const includeShared = allowedScopes.some(s => s === 'shared');
    const ownerDbId = userRefToDbId(ownerUserId);

    const conditions: SQL[] = [sql`dc.owner_user_id = ${ownerDbId}`];
    if (includePublic) {
      if (orgId) {
        conditions.push(sql`(dc.scope_type = 'public' AND dc.owner_user_id IN (SELECT u.id FROM "user" u WHERE u.org_id = ${orgId}))`);
      } else {
        conditions.push(sql`dc.scope_type = 'public'`);
      }
    }
    if (includeShared) {
      conditions.push(sql`dc.scope_type = 'shared'`);
    }

    const scopeFilter = sql.join(conditions, sql` OR `);

    const vectorRows = await requireDb().execute(sql`
      SELECT dc.id, dc.content_text, dc.scope_type,
             1 - (dc.embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
      FROM document_chunk dc
      WHERE dc.embedding IS NOT NULL AND (${scopeFilter})
      ORDER BY dc.embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT 20
    `);

    return (vectorRows.rows || []).map((row: Record<string, unknown>) => ({
      chunk_id: row.id as string,
      content: row.content_text as string,
      score: Number(row.similarity),
      source_scope: sourceScope(row.scope_type as string, ownerUserId)
    }));
  }

  private async runChunkQuery(queryText: string, allowedScopes: string[], ownerUserId: string, orgId?: string | null): Promise<Array<{ chunk_id: string; content: string; score: number; source_scope: string }>> {
    const ownerDbId = userRefToDbId(ownerUserId);
    const includePublic = allowedScopes.some(s => s.startsWith('public'));
    const includeShared = allowedScopes.some(s => s === 'shared');
    const scopeOrs: SQL[] = [eq(documentChunks.ownerUserId, ownerDbId)];
    if (includePublic) {
      if (orgId) {
        scopeOrs.push(and(eq(documentChunks.scopeType, 'public'), sql`document_chunk.owner_user_id IN (SELECT u.id FROM "user" u WHERE u.org_id = ${orgId})`)!);
      } else {
        scopeOrs.push(eq(documentChunks.scopeType, 'public'));
      }
    }
    if (includeShared) {
      scopeOrs.push(eq(documentChunks.scopeType, 'shared'));
    }
    const condition = or(...scopeOrs)!;

    const rows = await requireDb().select().from(documentChunks)
      .where(condition)
      .limit(20);

    return rows.map(row => ({
      chunk_id: row.id,
      content: row.contentText,
      score: lexicalScore(queryText, row.contentText),
      source_scope: sourceScope(row.scopeType, ownerUserId)
    }));
  }

  private ageAvailable: boolean | null = null;

  private async checkAgeAvailable(): Promise<boolean> {
    if (this.ageAvailable !== null) return this.ageAvailable;
    try {
      const result = await requireDb().execute(sql`SELECT count(*) FROM pg_extension WHERE extname = 'age'`);
      this.ageAvailable = Number((result.rows?.[0] as Record<string, unknown>)?.count || 0) > 0;
      if (this.ageAvailable) {
        logger.info('graph.age_detected', 'Apache AGE extension detected, Cypher queries enabled');
      } else {
        logger.info('graph.age_not_available', 'Apache AGE not available, using SQL graph traversal');
      }
    } catch {
      this.ageAvailable = false;
    }
    return this.ageAvailable;
  }

  private async runGraphQuery(queryText: string, allowedScopes: string[], ownerUserId: string, orgId?: string | null): Promise<Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }>> {
    const ageReady = await this.checkAgeAvailable();
    if (ageReady) {
      try {
        const cypherResults = await this.runAgeCypherQuery(queryText, allowedScopes, ownerUserId);
        if (cypherResults.length > 0) return cypherResults;
      } catch (error) {
        logger.warn('graph.cypher_failed', 'AGE Cypher query failed, falling back to SQL', { error: String(error) });
      }
    }
    return this.runSqlGraphQuery(queryText, allowedScopes, ownerUserId, orgId);
  }

  private async runAgeCypherQuery(queryText: string, allowedScopes: string[], ownerUserId: string): Promise<Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }>> {
    const ownerDbId = userRefToDbId(ownerUserId);
    const maxHops = Number(process.env.MAX_GRAPH_HOPS || 2);
    const searchTerms = queryText
      .replace(/[^\w\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 0)
      .slice(0, 5);

    if (searchTerms.length === 0) return [];

    const searchTerm = sanitizeCypherLiteral(searchTerms[0].replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, ''));
    if (!searchTerm) return [];

    const includePublic = allowedScopes.some(s => s.startsWith('public'));
    const includeShared = allowedScopes.some(s => s === 'shared');

    const graphName = 'knowledge_graph';

    const safePattern = `(?i).*${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
    const scopeFilterParts = [`e.owner_user_id = '${sanitizeCypherLiteral(ownerDbId)}'`];
    if (includePublic) scopeFilterParts.push(`e.scope_type = 'public'`);
    if (includeShared) scopeFilterParts.push(`e.scope_type = 'shared'`);
    const scopeFilter = scopeFilterParts.join(' OR ');

    const cypher = `MATCH (e:Entity)-[r*1..${Math.min(maxHops, 3)}]-(connected:Entity) WHERE e.canonical_name =~ '${safePattern}' AND e.status = 'active' AND (${scopeFilter}) RETURN e.canonical_name AS seed_name, e.entity_type AS seed_type, connected.canonical_name AS connected_name, connected.entity_type AS connected_type, connected.scope_type AS scope_type, length(r) AS hop_distance LIMIT 50`;

    if (!pool) return [];

    const client = await pool.connect();
    let cypherResult;
    try {
      await client.query('SET search_path = ag_catalog, public');
      cypherResult = await client.query(
        `SELECT * FROM cypher('${graphName}', $tag$ ${cypher} $tag$) AS (seed_name text, seed_type text, connected_name text, connected_type text, scope_type text, hop_distance integer)`
      );
    } finally {
      client.release();
    }

    const entityNames = new Set<string>();
    const results: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }> = [];

    for (const row of (cypherResult.rows || []) as Record<string, unknown>[]) {
      const seedName = String(row.seed_name || '');
      const connectedName = String(row.connected_name || '');
      const hopDistance = Number(row.hop_distance || 1);

      if (seedName) entityNames.add(seedName);
      if (connectedName) entityNames.add(connectedName);

      if (seedName && connectedName) {
        const content = `${seedName} -> ${connectedName} (${hopDistance} hop${hopDistance > 1 ? 's' : ''})`;
        results.push({
          content,
          score: Math.max(0.1, 1.0 / hopDistance) * lexicalScore(queryText, content),
          source_scope: sourceScope(String(row.scope_type || 'private'), ownerUserId)
        });
      }
    }

    if (entityNames.size > 0) {
      const nameList = [...entityNames].slice(0, 30);
      const namePlaceholders = sql.join(nameList.map(n => sql`${n}`), sql`, `);

      const connectedFacts = await requireDb().execute(sql`
        SELECT f.id, f.subject_ref, f.predicate, f.object_value, f.scope_type, f.confidence
        FROM fact f
        WHERE f.status = 'active'
          AND (f.owner_user_id = ${ownerDbId} OR (f.scope_type = 'public' AND ${includePublic ? sql`true` : sql`false`}) OR (f.scope_type = 'shared' AND ${includeShared ? sql`true` : sql`false`}))
          AND f.subject_ref IN (${namePlaceholders})
        LIMIT 20
      `);

      for (const row of (connectedFacts.rows || []) as Record<string, unknown>[]) {
        const content = [row.subject_ref, row.predicate, row.object_value].filter(Boolean).join(' ');
        results.push({
          fact_id: row.id as string,
          content,
          score: Number(row.confidence || 0.5) * lexicalScore(queryText, content),
          source_scope: sourceScope(row.scope_type as string, ownerUserId)
        });
      }
    }

    return results;
  }

  private async runSqlGraphQuery(queryText: string, allowedScopes: string[], ownerUserId: string, orgId?: string | null): Promise<Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }>> {
    const ownerDbId = userRefToDbId(ownerUserId);
    const includePublic = allowedScopes.some(s => s.startsWith('public'));
    const includeShared = allowedScopes.some(s => s === 'shared');
    const maxHops = Number(process.env.MAX_GRAPH_HOPS || 2);

    let scopeCondition = sql`e.owner_user_id = ${ownerDbId}`;
    if (includePublic || includeShared) {
      const parts = [sql`e.owner_user_id = ${ownerDbId}`];
      if (includePublic) {
        if (orgId) {
          parts.push(sql`(e.scope_type = 'public' AND e.owner_user_id IN (SELECT u.id FROM "user" u WHERE u.org_id = ${orgId}))`);
        } else {
          parts.push(sql`e.scope_type = 'public'`);
        }
      }
      if (includeShared) {
        parts.push(sql`e.scope_type = 'shared'`);
      }
      scopeCondition = sql`(${sql.join(parts, sql` OR `)})`;
    }

    const searchTerms = queryText
      .replace(/[^\w\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 0)
      .slice(0, 5);

    if (searchTerms.length === 0) return [];

    const likeConditions = searchTerms.map(term => sql`e.canonical_name ILIKE ${'%' + term + '%'}`);
    const entityWhereClause = sql`${scopeCondition} AND e.status = 'active' AND (${sql.join(likeConditions, sql` OR `)})`;

    const seedEntities = await requireDb().execute(sql`
      SELECT e.id, e.canonical_name, e.entity_type, e.scope_type
      FROM entity e
      WHERE ${entityWhereClause}
      LIMIT 10
    `);

    const seedEntityIds: string[] = (seedEntities.rows || []).map((row: Record<string, unknown>) => row.id as string);

    if (seedEntityIds.length === 0) return [];

    const visitedEntityIds = new Set<string>(seedEntityIds);
    const allEntityIds = [...seedEntityIds];
    let currentHopEntityIds = [...seedEntityIds];

    for (let hop = 0; hop < maxHops; hop++) {
      if (currentHopEntityIds.length === 0) break;

      const relationScopeParts: SQL[] = [sql`r.owner_user_id = ${ownerDbId}`];
      if (includePublic) relationScopeParts.push(sql`r.scope_type = 'public'`);
      if (includeShared) relationScopeParts.push(sql`r.scope_type = 'shared'`);
      const relationScopeCondition = sql.join(relationScopeParts, sql` OR `);

      const idPlaceholders = sql.join(currentHopEntityIds.map(id => sql`${id}`), sql`, `);

      const connectedRelations = await requireDb().execute(sql`
        SELECT r.id, r.from_entity_id, r.relation_type, r.to_entity_id, r.scope_type
        FROM relation r
        WHERE ${relationScopeCondition}
          AND r.status = 'active'
          AND (r.from_entity_id IN (${idPlaceholders}) OR r.to_entity_id IN (${idPlaceholders}))
        LIMIT 50
      `);

      const nextHopEntityIds: string[] = [];
      for (const row of (connectedRelations.rows || []) as Record<string, unknown>[]) {
        const fromId = row.from_entity_id as string;
        const toId = row.to_entity_id as string;
        if (!visitedEntityIds.has(fromId)) {
          visitedEntityIds.add(fromId);
          nextHopEntityIds.push(fromId);
          allEntityIds.push(fromId);
        }
        if (!visitedEntityIds.has(toId)) {
          visitedEntityIds.add(toId);
          nextHopEntityIds.push(toId);
          allEntityIds.push(toId);
        }
      }

      currentHopEntityIds = nextHopEntityIds;
    }

    const allIdPlaceholders = sql.join(allEntityIds.map(id => sql`${id}`), sql`, `);

    const connectedFacts = await requireDb().execute(sql`
      SELECT f.id, f.subject_ref, f.predicate, f.object_value, f.scope_type, f.confidence
      FROM fact f
      WHERE f.status = 'active'
        AND (f.owner_user_id = ${ownerDbId} OR (f.scope_type = 'public' AND ${includePublic}))
        AND f.subject_ref IN (
          SELECT e.canonical_name FROM entity e WHERE e.id IN (${allIdPlaceholders})
        )
      LIMIT 20
    `);

    const results: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }> = [];

    for (const row of (connectedFacts.rows || []) as Record<string, unknown>[]) {
      const content = [row.subject_ref, row.predicate, row.object_value].filter(Boolean).join(' ');
      results.push({
        fact_id: row.id as string,
        content,
        score: Number(row.confidence || 0.5) * lexicalScore(queryText, content),
        source_scope: sourceScope(row.scope_type as string, ownerUserId)
      });
    }

    if (seedEntityIds.length > 0) {
      const allAttrRows = await requireDb().execute(sql`
        SELECT ea.entity_id, ea.attr_key, ea.attr_value, ea.confidence
        FROM entity_attribute ea
        WHERE ea.entity_id IN (${sql.join(seedEntityIds.map(id => sql`${id}`), sql`, `)})
        LIMIT 100
      `);

      const attrsByEntity = new Map<string, Array<{ attr_key: string; attr_value: string; confidence: number }>>();
      for (const attr of (allAttrRows.rows || []) as Record<string, unknown>[]) {
        const entityId = String(attr.entity_id);
        if (!attrsByEntity.has(entityId)) attrsByEntity.set(entityId, []);
        attrsByEntity.get(entityId)!.push({
          attr_key: String(attr.attr_key),
          attr_value: String(attr.attr_value),
          confidence: Number(attr.confidence || 0.5)
        });
      }

      for (const row of (seedEntities.rows || []) as Record<string, unknown>[]) {
        const attrs = attrsByEntity.get(String(row.id)) || [];
        for (const attr of attrs) {
          const content = `${row.canonical_name}.${attr.attr_key} = ${attr.attr_value}`;
          results.push({
            content,
            score: attr.confidence * lexicalScore(queryText, content),
            source_scope: sourceScope(row.scope_type as string, ownerUserId)
          });
        }
      }
    }

    return results;
  }

  private deduplicateItems(items: Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }>): Array<{ fact_id?: string; chunk_id?: string; content: string; score: number; source_scope: string }> {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = item.fact_id || item.chunk_id || item.content.slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // extractKnowledgeFromMemory: 定时从对话记忆中提取结构化知识
  // 扫描未处理的 memory_item 记录，调用 LLM 抽取实体和事实关系
  async extractKnowledgeFromMemory(input: { org_id?: string; limit: number; requested_by: string }): Promise<{ extracted_count: number; scanned_count: number; items: Array<Record<string, unknown>> }> {
    const extractedItems: Array<Record<string, unknown>> = [];
    let scannedCount = 0;

    try {
      const conditions: SQL[] = [];
      if (input.org_id) {
        conditions.push(eq(users.orgId, input.org_id));
      }

      // 查询最近活跃用户（按最近活动排序）
      const userResult = await requireDb().select({
        id: users.id,
        owner_user_id: users.id
      }).from(users)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(Math.min(input.limit, 50));

      scannedCount = userResult.length;

      for (const user of userResult) {
        try {
          // 从 memory_item 表中获取未处理的记忆内容
          const memories = await requireDb().select({
            content: sql<string>`(row_data->>'content')`,
            id: sql<string>`(row_data->>'id')`
          }).from(sql`memory_item`)
            .where(sql`((metadata->>'processed_for_extraction') IS NULL OR (metadata->>'processed_for_extraction') = 'false') AND owner_user_id = ${user.owner_user_id}`)
            .orderBy(sql`created_at DESC`)
            .limit(5);

          if (memories.length === 0) continue;

          const combinedContent = memories.map((m: { content: string; id: string }) => String(m.content || '')).join('\n---\n');
          if (!combinedContent.trim()) continue;

          const extracted = await this.tryExtractViaLLM(combinedContent);

          if (extracted && extracted.length > 0) {
            for (const item of extracted) {
              try {
                const factResult = await this.submitUserFact({
                  source_text: String(item.content || ''),
                  owner_user_id: String(user.owner_user_id),
                  org_id: input.org_id,
                  source: 'auto_extracted'
                });
                extractedItems.push({
                  fact_id: factResult.fact_id,
                  subject: item.subject || '',
                  content: String(item.content || '').substring(0, 200)
                });
              } catch (factErr) {
                  logger.warn('knowledge.extract.submit_failed', 'Failed to submit extracted fact', { error: String(factErr) });
                }
            }
          }

          // 标记记忆为已处理
          for (const m of memories) {
            const mem = m as { content: string; id: string };
            try {
              await requireDb().execute(
                sql`UPDATE memory_item SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{processed_for_extraction}', 'true') WHERE id = ${mem.id}`
              );
            } catch (markErr) {
              logger.warn('knowledge.extract.mark_failed', 'Failed to mark memory as processed', { memory_id: mem.id, error: String(markErr) });
            }
          }
        } catch (userErr) {
          logger.warn('knowledge.extract.user_failed', 'Failed to extract knowledge for user', { user_id: user.owner_user_id, error: String(userErr) });
        }
      }
    } catch (error) {
      logger.warn('knowledge.extract_failed', 'Knowledge extraction failed', { error: String(error) });
    }

    logger.info('knowledge.extracted', 'Knowledge extraction completed', {
      scanned_count: scannedCount,
      extracted_count: extractedItems.length
    });

    return { extracted_count: extractedItems.length, scanned_count: scannedCount, items: extractedItems };
  }

  // tryExtractViaLLM: 调用 LiteLLM 从文本中提取结构化知识
  private async tryExtractViaLLM(text: string): Promise<Array<{ subject: string; predicate: string; content: string }> | null> {
    const litellmUrl = process.env.LITELLM_URL || '';
    const litellmModel = process.env.LITELLM_MODEL || 'minimax-m2.7';
    const litellmApiKey = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '';
    if (!litellmApiKey) {
      logger.warn('knowledge.extract.no_api_key', 'LITELLM_MASTER_KEY or LITELLM_API_KEY not set, skipping LLM extraction');
      return null;
    }

    if (!litellmUrl) return null;

    try {
      const res = await fetch(`${litellmUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${litellmApiKey}` },
        body: JSON.stringify({
          model: litellmModel,
          messages: [{
            role: 'system',
            content: `从以下对话内容中提取有价值的业务知识。输出JSON: {"items":[{"subject":"主体","predicate":"关系类型","content":"知识内容描述"}]}

提取规则:
- 客户信息: 公司名、联系人、职位、联系方式
- 项目信息: 项目名、进度、关键时间点
- 业务关系: 合作方式、金额、合同期限
- 行业信息: 市场趋势、竞品动态、政策变化

如无值得记录的知识，返回 {"items":[]}`
          }, { role: 'user', content: text.substring(0, 4000) }],
          temperature: 0.2,
          max_tokens: 2048,
          response_format: { type: 'json_object' }
        }),
        signal: AbortSignal.timeout(20000)
      });

      if (!res.ok) return null;
      const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content) as { items?: Array<{ subject: string; predicate: string; content: string }> };
      return Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      logger.warn('knowledge.extract.llm_failed', 'LLM extraction call failed', { error: String(err) });
      return null;
    }
  }

  // ─── 用户文件管理 ───

  async listUserFiles(input: { owner_user_id: string; org_id?: string | null; category?: string; scope?: string; limit: number; offset: number }): Promise<{ files: Array<Record<string, unknown>>; total: number }> {
    const conditions: SQL[] = [];
    conditions.push(eq(userFiles.userId, input.owner_user_id));
    conditions.push(sql`${userFiles.status} != 'deleted'`);
    if (input.org_id) conditions.push(eq(userFiles.orgId, input.org_id));
    if (input.category) conditions.push(eq(userFiles.fileCategory, input.category));
    if (input.scope) conditions.push(eq(userFiles.scope, input.scope));

    const totalResult = await requireDb().select({ count: sql<number>`count(*)` }).from(userFiles)
      .where(and(...conditions));
    const total = Number(totalResult[0]?.count || 0);

    const rows = await requireDb().select().from(userFiles)
      .where(and(...conditions))
      .orderBy(sql`created_at DESC`)
      .limit(input.limit)
      .offset(input.offset);

    const files = rows.map(f => ({
      id: f.id,
      user_id: f.userId,
      org_id: f.orgId,
      storage_backend: f.storageBackend,
      storage_path: f.storagePath,
      original_name: f.originalName,
      mime_type: f.mimeType,
      byte_size: f.byteSize,
      file_category: f.fileCategory,
      scope: f.scope,
      source: f.source,
      status: f.status,
      created_at: f.createdAt?.toISOString(),
    }));
    return { files, total };
  }

  async uploadAndStoreFile(input: {
    owner_user_id: string;
    org_id: string | null;
    file_buffer_b64: string;
    original_name: string;
    mime_type: string;
    source: string;
    scope: string;
    file_category: string;
  }): Promise<{ ok: boolean; error?: string; file?: Record<string, unknown> }> {
    const userId = await withRetry(() => this.ensureUser(input.owner_user_id));
    if (!input.file_buffer_b64) return { ok: false, error: 'missing_file_buffer' };

    const buffer = Buffer.from(input.file_buffer_b64, 'base64');
    const now = new Date();
    const monthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const backend = artifactStorage.preferredBackend();

    const writeResult = await artifactStorage.storeUserFile(backend, input.owner_user_id, input.org_id, buffer, input.original_name, monthStr);
    const contentHash = sha256Buffer(buffer);

    const [file] = await withRetry(() => requireDb().insert(userFiles).values({
      userId: input.owner_user_id,
      orgId: input.org_id,
      storageBackend: writeResult.backend,
      storagePath: writeResult.storage_path,
      originalName: input.original_name,
      mimeType: input.mime_type,
      byteSize: buffer.byteLength,
      contentHash,
      fileCategory: input.file_category || 'upload',
      scope: input.scope || 'private',
      source: input.source || 'user_upload',
      status: 'active',
      metadata: {},
    }).returning());

    logger.info('file.stored', 'User file stored', { file_id: file.id, user_id: input.owner_user_id, original_name: input.original_name });
    return {
      ok: true,
      file: {
        id: file.id,
        user_id: file.userId,
        original_name: file.originalName,
        mime_type: file.mimeType,
        byte_size: file.byteSize,
        file_category: file.fileCategory,
        scope: file.scope,
        storage_backend: file.storageBackend,
        storage_path: file.storagePath,
        created_at: file.createdAt?.toISOString(),
      }
    };
  }

  async downloadUserFile(fileId: string, requestingUserId: string): Promise<{ file?: { original_name: string; mime_type: string; buffer_b64: string }; error?: string }> {
    const [row] = await requireDb().select().from(userFiles).where(eq(userFiles.id, fileId)).limit(1);
    if (!row) return { error: 'file_not_found' };
    if (row.status === 'deleted') return { error: 'file_deleted' };
    if (row.scope === 'private' && row.userId !== requestingUserId) return { error: 'access_denied' };

    const storageRef = row.storageBackend === 'minio'
      ? `minio://${artifactStorage.config.bucket}/${row.storagePath}`
      : row.storagePath;
    const buffer = await artifactStorage.readBuffer(row.storageBackend, storageRef);
    return {
      file: {
        original_name: row.originalName,
        mime_type: row.mimeType || 'application/octet-stream',
        buffer_b64: buffer.toString('base64'),
      }
    };
  }

  async updateFileScope(fileId: string, requestingUserId: string, newScope: string): Promise<{ ok: boolean; error?: string }> {
    const [row] = await requireDb().select().from(userFiles).where(eq(userFiles.id, fileId)).limit(1);
    if (!row) return { ok: false, error: 'file_not_found' };
    if (row.userId !== requestingUserId) return { ok: false, error: 'access_denied' };

    await requireDb().update(userFiles).set({
      scope: newScope,
      updatedAt: new Date(),
    } as Record<string, unknown>).where(eq(userFiles.id, fileId));

    logger.info('file.scope_updated', 'File scope updated', { file_id: fileId, scope: newScope });
    return { ok: true };
  }

  async deleteUserFile(fileId: string, requestingUserId: string): Promise<{ ok: boolean; error?: string }> {
    const [row] = await requireDb().select().from(userFiles).where(eq(userFiles.id, fileId)).limit(1);
    if (!row) return { ok: false, error: 'file_not_found' };
    if (row.userId !== requestingUserId) return { ok: false, error: 'access_denied' };

    await requireDb().update(userFiles).set({
      status: 'deleted',
      updatedAt: new Date(),
    } as Record<string, unknown>).where(eq(userFiles.id, fileId));

    logger.info('file.deleted', 'User file soft-deleted', { file_id: fileId });
    return { ok: true };
  }
}

export const factRetrievalService = new FactRetrievalService();
