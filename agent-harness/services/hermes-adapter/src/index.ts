import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, analyze, writeAggregationReport, sendJson as sendJsonShared, verifyInternalAuth } from '@agent-harness/shared'
import { MemoryRepository } from './repositories/memory-repository'
import type { MemoryEntry } from './repositories/memory-repository'
import { SkillRepository } from './repositories/skill-repository'
import { MemoryAnalysisRepository } from './repositories/memory-analysis-repository'
import { MemoryService } from './services/memory-service'

const logger = createLogger('hermes-adapter', {
  logFile: process.env.LOG_FILE || 'logs/hermes-adapter.log'
})
const port = Number(process.env.PORT || 3005)

const memoryRepository = new MemoryRepository()
const skillRepository = new SkillRepository()
const analysisRepository = new MemoryAnalysisRepository()
const memoryService = new MemoryService(memoryRepository)

const memoryStore = new Map<string, MemoryEntry[]>()
const MAX_MEMORY_PER_SESSION = Number(process.env.MAX_MEMORY_PER_SESSION || 100)
const MEMORY_SUMMARY_THRESHOLD = Number(process.env.MEMORY_SUMMARY_THRESHOLD || 50)
const FACT_RETRIEVAL_URL = process.env.FACT_RETRIEVAL_URL || 'http://fact-retrieval:3000'
const LITELLM_URL = process.env.LITELLM_URL || process.env.LLM_API_URL || 'http://litellm:4000'
const LITELLM_MODEL = process.env.LITELLM_MODEL || process.env.LLM_MODEL || ''
if (!LITELLM_MODEL) logger.error('config.missing', 'LITELLM_MODEL environment variable is not set')
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY || process.env.LLM_API_KEY || ''
if (!LITELLM_MASTER_KEY) logger.warn('config.missing', 'LITELLM_MASTER_KEY or LLM_API_KEY environment variable is not set')

let dbPool: InstanceType<typeof import('pg').Pool> | null = null
let dbPoolPromise: Promise<InstanceType<typeof import('pg').Pool> | null> | null = null

async function getDbPool() {
  if (dbPool) return dbPool
  if (dbPoolPromise) return dbPoolPromise
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return null
  dbPoolPromise = (async () => {
    try {
      const { Pool } = await import('pg')
      const pool = new Pool({ connectionString: dbUrl, max: 4 })
      await pool.query('SELECT 1')
      logger.info('db.connected', 'Hermes adapter connected to database')
      dbPool = pool
      return dbPool
    } catch (error) {
      logger.warn('db.connect_failed', 'Failed to connect to database', { error: String(error) })
      return null
    } finally {
      dbPoolPromise = null
    }
  })()
  return dbPoolPromise
}

function getMemoryKey(ownerUserId: string, sessionId: string): string {
  return `${ownerUserId}::${sessionId}`
}

function generateId(): string {
  return randomUUID()
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    const MAX_BODY_SIZE = 10 * 1024 * 1024
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error('request_body_too_large'))
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  sendJsonShared(res, statusCode, data as Record<string, unknown>)
}

function estimateTokenCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

async function compressMemory(entries: MemoryEntry[]): Promise<string> {
  if (entries.length < MEMORY_SUMMARY_THRESHOLD) {
    return entries.map(e => `${e.role}: ${e.content}`).join('\n')
  }

  try {
    const conversationText = entries.map(e => `${e.role}: ${e.content}`).join('\n')
    const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(LITELLM_MASTER_KEY ? { authorization: `Bearer ${LITELLM_MASTER_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: LITELLM_MODEL,
        messages: [
          { role: 'system', content: 'Summarize the following conversation history concisely, preserving key facts, decisions, and context. Output only the summary.' },
          { role: 'user', content: conversationText },
        ],
        max_tokens: 1024,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      logger.warn('memory.compress_failed', 'LLM compression failed, using raw text', { status: response.status })
      return conversationText
    }

    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    return result.choices?.[0]?.message?.content || conversationText
  } catch (error) {
    logger.warn('memory.compress_error', 'LLM compression error, using raw text', { error: String(error) })
    return entries.map(e => `${e.role}: ${e.content}`).join('\n')
  }
}

const server = createServer(async (req, res) => {
  httpRequestLogger(req)
  let responseBody = ''
  const originalEnd = res.end.bind(res)
  const responseChunks: Buffer[] = []
  const originalWrite = res.write.bind(res)
  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) responseChunks.push(Buffer.from(String(chunk)))
    return (originalWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2])
  } as typeof res.write
  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) responseChunks.push(Buffer.from(String(chunk)))
    responseBody = Buffer.concat(responseChunks).toString('utf-8').slice(0, 2000)
    return (originalEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2])
  } as typeof res.end

  const pathname = new URL(req.url || '/', `http://localhost:${port}`).pathname

  if (pathname === '/health/live' || pathname === '/health/ready') {
    sendJson(res, 200, { ok: true, service: 'hermes-adapter' })
    return
  }

  if (pathname === '/internal/memory' && req.method === 'POST') {
    const body = await readJson(req)
    const ownerUserId = String(body.owner_user_id || '')
    const orgId = body.org_id ? String(body.org_id) : null
    const sessionId = String(body.session_id || 'default')
    const role = String(body.role || 'user') as MemoryEntry['role']
    const content = String(body.content || '')

    if (!ownerUserId || !content) {
      sendJson(res, 400, { ok: false, error: 'missing_required_fields', required: ['owner_user_id', 'content'] })
      return
    }

    const key = getMemoryKey(ownerUserId, sessionId)
    let entries = memoryStore.get(key) || []

    const entry: MemoryEntry = {
      id: generateId(),
      owner_user_id: ownerUserId,
      org_id: orgId,
      session_id: sessionId,
      role,
      content,
      token_count: estimateTokenCount(content),
      metadata: (body.metadata as Record<string, unknown>) || {},
      created_at: new Date().toISOString(),
    }

    entries.push(entry)

    void memoryService.persistSingleToDb(entry).catch(err => logger.warn('hermes.persist.db_failed', 'Failed to persist memory to DB', { error: String(err) }))
    void memoryService.persistToFactRetrieval(ownerUserId, orgId, sessionId, [entry]).catch(err => logger.warn('hermes.persist.fact_failed', 'Failed to persist to fact retrieval', { error: String(err) }))

    if (entries.length > MAX_MEMORY_PER_SESSION) {
      const overflow = entries.slice(0, entries.length - MEMORY_SUMMARY_THRESHOLD)
      await memoryService.persistToDb(overflow)
      await memoryService.persistToFactRetrieval(ownerUserId, orgId, sessionId, overflow)
      entries = entries.slice(-MEMORY_SUMMARY_THRESHOLD)
    }

    memoryStore.set(key, entries)

    sendJson(res, 200, {
      ok: true,
      memory_id: entry.id,
      session_id: sessionId,
      entry_count: entries.length,
      total_tokens: entries.reduce((sum, e) => sum + e.token_count, 0),
    })
    return
  }

  if (pathname === '/internal/memory/recall' && req.method === 'POST') {
    const body = await readJson(req)
    const ownerUserId = String(body.owner_user_id || '')
    const sessionId = String(body.session_id || 'default')
    const orgId = typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined
    const limit = Math.min(Number(body.limit || 20), MAX_MEMORY_PER_SESSION)

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' })
      return
    }

    const key = getMemoryKey(ownerUserId, sessionId)
    const inMemoryEntries = memoryStore.get(key) || []
    const dbEntries = await memoryService.recallFromDb(ownerUserId, sessionId, limit, orgId)

    const allEntries = [...dbEntries, ...inMemoryEntries]
    const recalled = allEntries.slice(-limit)

    const compressed = await compressMemory(recalled)

    sendJson(res, 200, {
      ok: true,
      session_id: sessionId,
      entry_count: recalled.length,
      total_tokens: recalled.reduce((sum, e) => sum + e.token_count, 0),
      compressed_context: compressed,
      entries: recalled.map(e => ({
        id: e.id,
        role: e.role,
        content: e.content,
        token_count: e.token_count,
        created_at: e.created_at,
      })),
    })
    return
  }

  if (pathname === '/internal/memory/clear' && req.method === 'POST') {
    const body = await readJson(req)
    const ownerUserId = String(body.owner_user_id || '')
    const sessionId = String(body.session_id || '')

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' })
      return
    }

    if (sessionId) {
      const key = getMemoryKey(ownerUserId, sessionId)
      const entries = memoryStore.get(key) || []
      await memoryService.persistToFactRetrieval(ownerUserId, null, sessionId, entries)
      memoryStore.delete(key)
      await memoryService.clearSessionFromDb(ownerUserId, sessionId)
      sendJson(res, 200, { ok: true, cleared_session: sessionId, cleared_count: entries.length })
    } else {
      let totalCleared = 0
      for (const [key, entries] of memoryStore.entries()) {
        if (key.startsWith(`${ownerUserId}::`)) {
          await memoryService.persistToFactRetrieval(ownerUserId, null, key.split('::')[1], entries)
          memoryStore.delete(key)
          totalCleared += entries.length
        }
      }
      const dbCleared = await memoryService.clearAllFromDb(ownerUserId)
      totalCleared += dbCleared
      sendJson(res, 200, { ok: true, cleared_all_sessions: true, cleared_count: totalCleared })
    }
    return
  }

  if (pathname === '/internal/skills/search' && req.method === 'POST') {
    const body = await readJson(req)
    const ownerUserId = String(body.owner_user_id || '')
    const query = String(body.query || '')

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' })
      return
    }

    const skills = await skillRepository.searchSkills(ownerUserId, query)

    sendJson(res, 200, {
      ok: true,
      query,
      total: skills.length,
      skills: skills.map(s => ({
        id: s.id,
        skill_name: s.skill_name,
        description: s.description,
        skill_type: s.skill_type,
        scope_type: s.scope_type,
        status: s.status,
        version: s.version,
        definition_json: s.definition_json,
      })),
    })
    return
  }

  if (pathname.startsWith('/internal/skills/') && req.method === 'GET' && pathname !== '/internal/skills/search') {
    const skillId = pathname.split('/internal/skills/')[1]
    if (!skillId) {
      sendJson(res, 400, { ok: false, error: 'missing_skill_id' })
      return
    }

    try {
      const skill = await skillRepository.getSkillById(skillId)

      if (!skill) {
        sendJson(res, 404, { ok: false, error: 'skill_not_found' })
        return
      }

      sendJson(res, 200, {
        ok: true,
        skill: {
          id: skill.id,
          skill_name: skill.skill_name,
          description: skill.description,
          skill_type: skill.skill_type,
          scope_type: skill.scope_type,
          status: skill.status,
          version: skill.version,
          definition_json: skill.definition_json,
        },
      })
    } catch (error) {
      logger.warn('skill.db_error', 'Database error when fetching skill', { error: String(error) })
      sendJson(res, 500, { ok: false, error: 'database_error' })
    }
    return
  }

  if (pathname === '/internal/context/compress' && req.method === 'POST') {
    const body = await readJson(req)
    const ownerUserId = String(body.owner_user_id || '')
    const sessionId = String(body.session_id || 'default')
    const orgId = typeof body.org_id === 'string' && body.org_id ? body.org_id : undefined
    const maxTokens = Number(body.max_tokens || 2048)

    if (!ownerUserId) {
      sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' })
      return
    }

    const key = getMemoryKey(ownerUserId, sessionId)
    const inMemoryEntries = memoryStore.get(key) || []
    const dbEntries = await memoryService.recallFromDb(ownerUserId, sessionId, 50, orgId)
    const entries = [...dbEntries, ...inMemoryEntries]
    const totalTokens = entries.reduce((sum, e) => sum + e.token_count, 0)

    if (totalTokens <= maxTokens) {
      sendJson(res, 200, {
        ok: true,
        compressed: false,
        original_tokens: totalTokens,
        context: entries.map(e => `${e.role}: ${e.content}`).join('\n'),
      })
      return
    }

    const compressed = await compressMemory(entries)
    const compressedTokens = estimateTokenCount(compressed)

    sendJson(res, 200, {
      ok: true,
      compressed: true,
      original_tokens: totalTokens,
      compressed_tokens: compressedTokens,
      compression_ratio: totalTokens > 0 ? compressedTokens / totalTokens : 1,
      context: compressed,
    })
    return
  }

  // ============================================================
  // 梦境模式：记忆分析端点 (Dream Mode - Memory Analysis)
  // ============================================================
  if (pathname === '/internal/memory/analyze' && req.method === 'POST') {
    const body = await readJson(req)
    const ownerUserId = String(body.owner_user_id || '')
    const orgId = body.org_id ? String(body.org_id) : null
    const dateStr = String(body.date || new Date().toISOString().slice(0, 10))
    const pool = await getDbPool()

    if (!ownerUserId || !pool) {
      sendJson(res, 400, { ok: false, error: !ownerUserId ? 'missing_owner_user_id' : 'database_not_available' })
      return
    }

    try {
      const memResult = await analysisRepository.getMemoryItemsForAnalysis(ownerUserId, dateStr)

      let itemsCompressed = 0
      let factsGenerated = 0
      const compressionResults: Array<Record<string, unknown>> = []

      for (const row of memResult) {
        const charCount = row.char_count
        if (charCount >= 4000) {
          try {
            const compressResponse = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(LITELLM_MASTER_KEY ? { authorization: `Bearer ${LITELLM_MASTER_KEY}` } : {}),
              },
              body: JSON.stringify({
                model: LITELLM_MODEL,
                messages: [
                  { role: 'system', content: '将以下对话内容压缩为不超过2000字的摘要，保留核心决策、关键数据和行动项。只输出摘要。' },
                  { role: 'user', content: String(row.content_text).substring(0, 8000) },
                ],
                max_tokens: 1024,
                temperature: 0.3,
              }),
            })

            if (compressResponse.ok) {
              const cr = await compressResponse.json() as { choices?: Array<{ message?: { content?: string } }> }
              const summary = cr.choices?.[0]?.message?.content || ''
              if (summary) {
                await pool.query(
                  `UPDATE memory_item SET content_text = $1, summary = $2,
                   metadata = metadata || jsonb_build_object('compressed', true, 'original_char_count', $3, 'compressed_char_count', $4, 'compressed_at', $5)
                   WHERE id = $6`,
                  [summary, summary, charCount, summary.length, new Date().toISOString(), row.id]
                )
                await pool.query(
                  `INSERT INTO memory_compression_log (memory_item_id, owner_user_id, org_id, compression_method, original_char_count, compressed_char_count, summary_text)
                   VALUES ($1,$2,$3,'llm_summary',$4,$5,$6)`,
                  [row.id, ownerUserId, orgId, charCount, summary.length, summary]
                )
                itemsCompressed++
                compressionResults.push({ memory_id: row.id, original: charCount, compressed: summary.length })
              }
            }
          } catch (compressErr) {
            logger.warn('dream.compress_failed', 'Memory compression failed for item', { memory_id: row.id, error: String(compressErr) })
          }
        }
      }

      const summaryText = memResult.slice(0, 10).map(r =>
        String(r.summary || r.content_text || '').substring(0, 500)
      ).join('\n---\n')

      if (summaryText.length > 200) {
        try {
          const extractResponse = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(LITELLM_MASTER_KEY ? { authorization: `Bearer ${LITELLM_MASTER_KEY}` } : {}),
            },
            body: JSON.stringify({
              model: LITELLM_MODEL,
              messages: [
                { role: 'system', content: '分析以下当日记忆片段，提取：1) 关键业务决策 2) 客户洞察 3) 可复用技能模板。以JSON格式输出：{"facts":[{"subject":"","predicate":"","object":"","category":""}],"skills":[{"name":"","description":"","type":""}],"daily_summary":"一句话今日总结"}' },
                { role: 'user', content: summaryText },
              ],
              max_tokens: 1500,
              temperature: 0.3,
              response_format: { type: 'json_object' },
            }),
          })

          if (extractResponse.ok) {
            const er = await extractResponse.json() as { choices?: Array<{ message?: { content?: string } }> }
            const extracted = er.choices?.[0]?.message?.content || '{}'
            try {
              const parsed = JSON.parse(extracted)
              const facts = parsed.facts || []
              for (const fact of facts) {
                try {
                  const factRes = await fetch(`${FACT_RETRIEVAL_URL}/internal/facts/write`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      owner_user_id: ownerUserId,
                      org_id: orgId,
                      scope: ['private'],
                      mode: 'insert',
                      subject_ref: String(fact.subject || '').substring(0, 500),
                      predicate: String(fact.predicate || '').substring(0, 500),
                      object_value: String(fact.object || '').substring(0, 500),
                      confidence: 0.6,
                      source: 'dream_extraction',
                      date: dateStr,
                    }),
                  })
                  if (factRes.ok) {
                    factsGenerated++
                  } else {
                    logger.warn('dream.fact_write_rejected', 'Fact-retrieval rejected dream fact', { status: factRes.status })
                  }
                } catch (factErr) {
                  logger.warn('dream.fact_write_failed', 'Failed to write dream fact to fact-retrieval', { error: String(factErr) })
                }
              }
            } catch (parseErr) {
              logger.warn('dream.extract_parse_failed', 'Failed to parse extraction result', { error: String(parseErr) })
            }
          }
        } catch (extractErr) {
          logger.warn('dream.extract_failed', 'Memory extraction failed', { error: String(extractErr) })
        }
      }

      const runId = await analysisRepository.insertAnalysisRun({
        orgId,
        runType: 'dream_user',
        scopeUserId: ownerUserId,
        status: 'completed',
        itemsScanned: memResult.length,
        itemsCompressed,
        factsGenerated,
        resultSummary: { compressions: compressionResults, date: dateStr },
      })

      sendJson(res, 200, {
        ok: true,
        run_id: runId,
        items_scanned: memResult.length,
        items_compressed: itemsCompressed,
        facts_generated: factsGenerated,
        date: dateStr,
      })
    } catch (err) {
      logger.error('memory.analyze_failed', 'Memory analysis failed', { error: String(err), user: ownerUserId })
      sendJson(res, 500, { ok: false, error: 'analyze_failed' })
    }
    return
  }

  if (pathname === '/internal/memory/analyze/org' && req.method === 'POST') {
    const body = await readJson(req)
    const orgId = String(body.org_id || '')
    const pool = await getDbPool()

    if (!orgId || !pool) {
      sendJson(res, 400, { ok: false, error: !orgId ? 'missing_org_id' : 'database_not_available' })
      return
    }

    try {
      const factsResult = await analysisRepository.getDreamFacts()

      let itemsExtracted = 0
      for (const fact of factsResult) {
        const existingCheck = await pool.query(
          `SELECT id FROM org_memory_summary WHERE org_id = $1 AND title = $2 LIMIT 1`,
          [orgId, String(fact.subject_ref || '').substring(0, 200)]
        )

        if (existingCheck.rows.length === 0) {
          const category = String(fact.metadata?.category || 'other')
          const validCategories = ['business_rule', 'customer_insight', 'project_decision', 'process_knowledge', 'technical_discovery', 'team_collaboration', 'other']
          await pool.query(
            `INSERT INTO org_memory_summary (org_id, title, content_text, summary, category, source_user_ids, source_fact_ids, confidence, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'candidate')`,
            [
              orgId,
              String(fact.subject_ref || '').substring(0, 200),
              String(fact.object_value || '').substring(0, 5000),
              String(fact.predicate || '').substring(0, 500),
              validCategories.includes(category) ? category : 'other',
              [fact.owner_user_id],
              [fact.id],
              Math.min(1, Math.max(0, Number(fact.confidence || 0.5)))
            ]
          )
          itemsExtracted++
        }
      }

      const runId = await analysisRepository.insertAnalysisRun({
        orgId,
        runType: 'dream_org',
        status: 'completed',
        itemsScanned: factsResult.length,
        itemsExtracted,
        resultSummary: { date: new Date().toISOString().slice(0, 10) },
      })

      sendJson(res, 200, {
        ok: true,
        run_id: runId,
        items_scanned: factsResult.length,
        items_extracted: itemsExtracted,
      })
    } catch (err) {
      logger.error('memory.analyze_org_failed', 'Org memory analysis failed', { error: String(err), org_id: orgId })
      sendJson(res, 500, { ok: false, error: 'analyze_org_failed' })
    }
    return
  }

  if (pathname === '/internal/memory/summary' && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    const orgId = url.searchParams.get('org_id') || ''
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
    const offset = Number(url.searchParams.get('offset') || 0)

    try {
      const summaries = await analysisRepository.getOrgMemorySummaries(orgId || undefined, limit, offset)
      sendJson(res, 200, { ok: true, summaries, limit, offset })
    } catch (err) {
      logger.error('memory.summary_failed', 'Failed to query org memory summary', { error: String(err) })
      sendJson(res, 500, { ok: false, error: 'query_failed' })
    }
    return
  }

  if (pathname === '/internal/memory/analysis-runs' && req.method === 'GET') {
    try {
      const runs = await analysisRepository.getAnalysisRuns(50)
      sendJson(res, 200, { ok: true, runs })
    } catch (err) {
      logger.error('memory.runs_failed', 'Failed to query analysis runs', { error: String(err) })
      sendJson(res, 500, { ok: false, error: 'query_failed' })
    }
    return
  }

  if (pathname === '/internal/memory/compression-logs' && req.method === 'GET') {
    if (!verifyInternalAuth(req)) { sendJson(res, 403, { ok: false, error: 'internal_auth_required' }); return }
    try {
      const logs = await analysisRepository.getCompressionLogs(50)
      sendJson(res, 200, { ok: true, logs })
    } catch (err) {
      logger.error('memory.compression_logs_failed', 'Failed to query compression logs', { error: String(err) })
      sendJson(res, 500, { ok: false, error: 'query_failed' })
    }
    return
  }

  if (pathname === '/internal/memory/access-log' && req.method === 'GET') {
    if (!verifyInternalAuth(req)) { sendJson(res, 403, { ok: false, error: 'internal_auth_required' }); return }
    try {
      const logs = await analysisRepository.getAccessLogs(50)
      sendJson(res, 200, { ok: true, logs })
    } catch (err) {
      logger.error('memory.access_log_failed', 'Failed to query access log', { error: String(err) })
      sendJson(res, 500, { ok: false, error: 'query_failed' })
    }
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'not_found' }))
  await httpResponseLogger(req, res, responseBody)
})

let aT_: ReturnType<typeof setInterval> | null = null

server.listen(port, () => {
  logger.info('service.started', 'Hermes adapter started', { port })
  void getDbPool()
  aT_ = setInterval(() => {
    const report = analyze()
    if (report.status !== 'normal') writeAggregationReport(report)
  }, 15000)
  if (aT_.unref) aT_.unref()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (aT_) { clearInterval(aT_); aT_ = null }
    writeAggregationReport(analyze())
    metricsRegistry.shutdown()
    server.close(async () => {
      await logger.shutdown()
      process.exit(0)
    })
  })
}