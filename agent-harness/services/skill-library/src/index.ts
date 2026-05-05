import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, setupDefaultHealthChecks, analyze, writeAggregationReport } from '@agent-harness/shared';

/**
 * skill-library 服务 - 技能库管理服务
 *
 * 功能概述：
 *   1. 技能的全生命周期管理（创建、查询、更新、删除/归档）
 *   2. 技能版本控制，支持多版本并存与回滚
 *   3. 技能发布/取消发布（draft → active → archived）
 *   4. 从 Markdown 任务描述导入技能定义（支持 AH-5 自动总结报告 和 AH-7 管理员后台配置 故事线）
 *   5. 技能定义导出为 Markdown 格式
 *   6. 技能搜索与匹配（支持关键词和类型筛选）
 *   7. 技能来源追踪（标记技能定义的原始出处）
 *
 * 数据模型（对应 DB schema 中的 skill、skill_version、skill_source 三张表）：
 *   - skill: 技能主表，记录技能元信息（名称、描述、类型、作用域、状态）
 *   - skill_version: 技能版本表，每次更新生成新版本，记录 definition_json 和 content_hash
 *   - skill_source: 技能来源表，记录技能定义的来源（Markdown 文件、手工创建等）
 *
 * API 路由设计：
 *   POST   /internal/skills/create       - 创建新技能（自动生成 v1 版本）
 *   GET    /internal/skills/search       - 搜索技能（关键词、类型过滤）
 *   GET    /internal/skills/:id          - 获取技能详情（含最新版本定义）
 *   POST   /internal/skills/:id/update   - 更新技能定义（自动递增版本号）
 *   POST   /internal/skills/:id/publish  - 发布技能（draft → active）
 *   POST   /internal/skills/:id/archive  - 归档技能（active → archived）
 *   POST   /internal/skills/import       - 从 Markdown 内容导入技能
 *   POST   /internal/skills/:id/export   - 导出技能定义为 Markdown
 *   GET    /internal/skills/:id/versions - 列出技能的所有版本
 *   GET    /internal/skills              - 列出技能（支持分页和过滤）
 */

const logger = createLogger('skill-library', {
  logFile: process.env.LOG_FILE || 'logs/skill-library.log'
});

setupDefaultHealthChecks(
  async () => {
    try { await import('pg'); return true; }
    catch { return false; }
  }
);

const port = Number(process.env.PORT || 3007);

/* ---- 类型定义 ---- */

/** 技能记录的核心字段（对应 DB skill 表 + 最新版本关联） */
interface SkillRecord {
  id: string;
  owner_user_id: string;
  org_id: string | null;
  scope_type: 'private' | 'org' | 'public';
  skill_name: string;
  description: string;
  skill_type: string;
  status: 'draft' | 'active' | 'archived' | 'deleted';
  metadata: Record<string, unknown>;
  version: number;
  definition_json: Record<string, unknown>;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

/** 技能版本的独立记录 */
interface SkillVersionRecord {
  id: string;
  skill_id: string;
  version: number;
  definition_json: Record<string, unknown>;
  content_hash: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** 技能来源记录 */
interface SkillSourceRecord {
  id: string;
  skill_version_id: string;
  source_type: 'markdown_import' | 'manual' | 'code_generated' | 'external_import';
  source_uri: string | null;
  content_text: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** 创建技能的请求体结构 */
interface CreateSkillInput {
  owner_user_id: string;
  org_id?: string;
  scope_type?: 'private' | 'org' | 'public';
  skill_name: string;
  description: string;
  skill_type?: string;
  definition_json: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** 更新技能定义的请求体结构 */
interface UpdateSkillInput {
  definition_json: Record<string, unknown>;
  description?: string;
  skill_type?: string;
  scope_type?: 'private' | 'org' | 'public';
}

/** Markdown 导入技能的请求体结构 */
interface ImportSkillInput {
  owner_user_id: string;
  org_id?: string;
  scope_type?: 'private' | 'org' | 'public';
  markdown_content: string;
  source_uri?: string;
  skill_name: string;
  description: string;
  skill_type: string;
  metadata?: Record<string, unknown>;
}

/* ---- 数据库连接管理 ---- */

let dbPool: InstanceType<typeof import('pg').Pool> | null = null;

/**
 * 获取数据库连接池（懒初始化，单例模式）
 * 数据库连接失败时降级为空存储运行，不阻塞服务启动
 *
 * @returns 数据库连接池实例，不可用时返回 null
 */
async function getDbPool() {
  if (dbPool) return dbPool;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  try {
    const { Pool } = await import('pg');
    dbPool = new Pool({ connectionString: dbUrl, max: 4 });
    await dbPool.query('SELECT 1');
    logger.info('db.connected', 'Skill-library connected to database');
    return dbPool;
  } catch (error) {
    logger.warn('db.connect_failed', 'Failed to connect to database', { error: String(error) });
    dbPool = null;
    return null;
  }
}

/* ---- HTTP 工具函数 ---- */

/**
 * 从 HTTP 请求中读取并解析 JSON Body
 * 支持流式读取，最大 10MB 限制防止内存溢出攻击
 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('request_body_too_large'));
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 *
 * @param res - HTTP Response 对象
 * @param statusCode - HTTP 状态码
 * @param data - 响应数据，将被 JSON.stringify 序列化
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** 生成标准 UUID（非安全上下文时回退到 Math.random） */
function generateId(): string {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

/* ---- 核心业务逻辑 ---- */

/**
 * 创建新技能
 *
 * 处理流程：
 *   1. 参数校验（owner_user_id 和 skill_name 为必填项）
 *   2. 在 skill 表中插入主记录，状态初始为 'draft'
 *   3. 在 skill_version 表中插入 v1 版本记录
 *   4. 计算 definition_json 的内容哈希用于版本追踪
 *   5. 如有 source_uri，在 skill_source 表中创建来源记录
 *
 * @returns 新创建的技能完整信息，HTTP 201
 */
async function createSkill(input: CreateSkillInput & { source_uri?: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) {
    return { status: 503, body: { ok: false, error: 'database_not_available' } };
  }

  const skillId = generateId();
  const now = new Date().toISOString();
  const scopeType = input.scope_type || 'private';
  const skillType = input.skill_type || 'prompt';
  const contentHash = createHash('sha256').update(JSON.stringify(input.definition_json)).digest('hex');

  try {
    await pool.query('BEGIN');

    // 步骤 1：创建技能主记录
    await pool.query(
      `INSERT INTO skill (id, owner_user_id, org_id, scope_type, skill_name, description, skill_type, status, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [skillId, input.owner_user_id, input.org_id || null, scopeType, input.skill_name, input.description, skillType, 'draft', JSON.stringify(input.metadata || {}), now, now]
    );

    // 步骤 2：创建 v1 版本记录
    const versionId = generateId();
    await pool.query(
      `INSERT INTO skill_version (id, skill_id, version, definition_json, content_hash, status, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [versionId, skillId, 1, JSON.stringify(input.definition_json), contentHash, 'draft', JSON.stringify({}), now]
    );

    // 步骤 3：记录技能来源
    const sourceId = generateId();
    const sourceType = input.source_uri ? 'markdown_import' : 'manual';
    await pool.query(
      `INSERT INTO skill_source (id, skill_version_id, source_type, source_uri, content_text, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sourceId, versionId, sourceType, input.source_uri || null, null, JSON.stringify({}), now]
    );

    await pool.query('COMMIT');

    logger.info('skill.created', 'Skill created successfully', {
      skill_id: skillId,
      skill_name: input.skill_name,
      scope_type: scopeType
    });

    return {
      status: 201,
      body: {
        ok: true,
        skill: {
          id: skillId,
          owner_user_id: input.owner_user_id,
          org_id: input.org_id || null,
          scope_type: scopeType,
          skill_name: input.skill_name,
          description: input.description,
          skill_type: skillType,
          status: 'draft',
          version: 1,
          definition_json: input.definition_json,
          content_hash: contentHash,
          created_at: now,
          updated_at: now
        }
      }
    };
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    logger.error('skill.create_failed', 'Failed to create skill', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'create_failed' } };
  }
}

/**
 * 搜索技能
 *
 * 搜索策略（多关键词加权匹配）：
 *   1. 将查询文本分词（按空白和标点拆分，过滤长度 ≤1 的碎片）
 *   2. 对每个关键词分别匹配 skill_name 和 description（ILIKE 模糊匹配）
 *   3. 名称匹配权重为 2，描述匹配权重为 1
 *   4. 使用 GREATEST 取最高分作为 match_score
 *   5. 支持可选的 scope_type 和 skill_type 精确过滤
 *   6. 仅返回非删除状态的技能
 *
 * @param query - 搜索关键词（可选，为空时返回全部）
 * @param scopeType - 按作用域过滤（可选）
 * @param skillType - 按技能类型过滤（可选）
 * @returns 匹配的技能列表，按 match_score 降序排列，最多 50 条
 */
async function searchSkills(query?: string, scopeType?: string, skillType?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) {
    return { status: 503, body: { ok: false, error: 'database_not_available' } };
  }

  try {
    const conditions: string[] = ["s.status != 'deleted'"];
    const params: unknown[] = [];
    let paramIdx = 1;
    let matchScoreExpr = '0';

    if (query) {
      const keywords = query
        .replace(/[^\w\u4e00-\u9fff]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1)
        .slice(0, 8);

      if (keywords.length > 0) {
        const likeConditions = keywords.map(() => `(s.skill_name ILIKE $${paramIdx} OR s.description ILIKE $${paramIdx + 1})`).join(' OR ');
        for (const kw of keywords) {
          params.push(`%${kw}%`, `%${kw}%`);
          paramIdx += 2;
        }
        conditions.push(`(${likeConditions})`);

        matchScoreExpr = `GREATEST(${keywords.map((_, i) => {
          const nameParam = paramIdx - keywords.length * 2 + i * 2;
          const descParam = nameParam + 1;
          return `CASE WHEN s.skill_name ILIKE $${nameParam} THEN 2 ELSE 0 END + CASE WHEN s.description ILIKE $${descParam} THEN 1 ELSE 0 END`;
        }).join(', ')})`;
      }
    }

    if (scopeType) {
      conditions.push(`s.scope_type = $${paramIdx}`);
      params.push(scopeType);
      paramIdx++;
    }

    if (skillType) {
      conditions.push(`s.skill_type = $${paramIdx}`);
      params.push(skillType);
      paramIdx++;
    }

    const sql = `
      SELECT s.id, s.owner_user_id, s.org_id, s.scope_type, s.skill_name, s.description, s.skill_type, s.status,
             s.metadata, s.created_at, s.updated_at,
             COALESCE(sv.version, 1) as version,
             COALESCE(sv.definition_json, '{}'::jsonb) as definition_json,
             COALESCE(sv.content_hash, '') as content_hash,
             (${matchScoreExpr}) as match_score
      FROM skill s
      LEFT JOIN LATERAL (
        SELECT version, definition_json, content_hash FROM skill_version
        WHERE skill_id = s.id ORDER BY version DESC LIMIT 1
      ) sv ON true
      WHERE ${conditions.join(' AND ')}
      ORDER BY match_score DESC, s.skill_name ASC
      LIMIT 50
    `;

    const result = await pool.query(sql, params);
    const skills = result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      owner_user_id: String(row.owner_user_id),
      org_id: row.org_id ? String(row.org_id) : null,
      scope_type: String(row.scope_type),
      skill_name: String(row.skill_name),
      description: String(row.description || ''),
      skill_type: String(row.skill_type),
      status: String(row.status),
      version: Number(row.version || 1),
      definition_json: typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : (row.definition_json || {}),
      content_hash: String(row.content_hash || ''),
      match_score: Number(row.match_score || 0),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at)
    }));

    return {
      status: 200,
      body: { ok: true, total: skills.length, skills }
    };
  } catch (error) {
    logger.error('skill.search_failed', 'Failed to search skills', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'search_failed' } };
  }
}

/**
 * 获取单个技能详情（含最新版本定义）
 *
 * @param skillId - 技能 UUID
 * @returns 技能详细信息，不存在时返回 404
 */
async function getSkill(skillId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) {
    return { status: 503, body: { ok: false, error: 'database_not_available' } };
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.owner_user_id, s.org_id, s.scope_type, s.skill_name, s.description, s.skill_type, s.status,
              s.metadata, s.created_at, s.updated_at,
              COALESCE(sv.version, 1) as version,
              COALESCE(sv.definition_json, '{}'::jsonb) as definition_json,
              COALESCE(sv.content_hash, '') as content_hash
       FROM skill s
       LEFT JOIN LATERAL (
         SELECT version, definition_json, content_hash FROM skill_version
         WHERE skill_id = s.id ORDER BY version DESC LIMIT 1
       ) sv ON true
       WHERE s.id = $1 AND s.status != 'deleted'`,
      [skillId]
    );

    if (result.rows.length === 0) {
      return { status: 404, body: { ok: false, error: 'skill_not_found' } };
    }

    const row = result.rows[0];
    return {
      status: 200,
      body: {
        ok: true,
        skill: {
          id: String(row.id),
          owner_user_id: String(row.owner_user_id),
          org_id: row.org_id ? String(row.org_id) : null,
          scope_type: String(row.scope_type),
          skill_name: String(row.skill_name),
          description: String(row.description || ''),
          skill_type: String(row.skill_type),
          status: String(row.status),
          version: Number(row.version || 1),
          definition_json: typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : (row.definition_json || {}),
          content_hash: String(row.content_hash || ''),
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
          created_at: String(row.created_at),
          updated_at: String(row.updated_at)
        }
      }
    };
  } catch (error) {
    logger.error('skill.get_failed', 'Failed to get skill', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'get_failed' } };
  }
}

/**
 * 更新技能定义（自动递增版本号）
 *
 * 更新策略：
 *   1. 保留现有技能的主记录不变
 *   2. 在 skill_version 表中新增一条版本记录（version = currentMaxVersion + 1）
 *   3. 仅当 definition_json 内容发生变化时才创建新版本
 *   4. 可同时更新 description、skill_type、scope_type 等元信息
 *
 * @param skillId - 目标技能 UUID
 * @param input - 新的定义数据
 * @returns 更新后的技能信息
 */
async function updateSkill(skillId: string, input: UpdateSkillInput): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) {
    return { status: 503, body: { ok: false, error: 'database_not_available' } };
  }

  try {
    await pool.query('BEGIN');

    // 获取当前技能信息和最新版本号
    const current = await pool.query(
      `SELECT s.*, sv.version as current_version, sv.content_hash as current_hash
       FROM skill s
       LEFT JOIN LATERAL (
         SELECT version, content_hash FROM skill_version
         WHERE skill_id = s.id ORDER BY version DESC LIMIT 1
       ) sv ON true
       WHERE s.id = $1 AND s.status != 'deleted'`,
      [skillId]
    );

    if (current.rows.length === 0) {
      await pool.query('ROLLBACK');
      return { status: 404, body: { ok: false, error: 'skill_not_found' } };
    }

    const row = current.rows[0];
    const newContentHash = createHash('sha256').update(JSON.stringify(input.definition_json)).digest('hex');

    // 更新主记录的可变字段
    const updates: string[] = [];
    const updateParams: unknown[] = [];
    let updateIdx = 1;

    if (input.description !== undefined) {
      updates.push(`description = $${updateIdx++}`);
      updateParams.push(input.description);
    }
    if (input.skill_type !== undefined) {
      updates.push(`skill_type = $${updateIdx++}`);
      updateParams.push(input.skill_type);
    }
    if (input.scope_type !== undefined) {
      updates.push(`scope_type = $${updateIdx++}`);
      updateParams.push(input.scope_type);
    }
    updates.push(`updated_at = $${updateIdx++}`);
    updateParams.push(new Date().toISOString());

    if (updates.length > 0) {
      updateParams.push(skillId);
      await pool.query(`UPDATE skill SET ${updates.join(', ')} WHERE id = $${updateIdx}`, updateParams);
    }

    // content_hash 相同时不创建新版本，避免无意义的版本增长
    if (newContentHash !== String(row.current_hash || '')) {
      const newVersion = Number(row.current_version || 0) + 1;
      const versionId = generateId();
      const now = new Date().toISOString();

      await pool.query(
        `INSERT INTO skill_version (id, skill_id, version, definition_json, content_hash, status, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [versionId, skillId, newVersion, JSON.stringify(input.definition_json), newContentHash, String(row.status), JSON.stringify({}), now]
      );

      // 记录版本来源（继承上一版本的 source_uri）
      const prevSource = await pool.query(
        `SELECT source_uri FROM skill_source WHERE skill_version_id = (
           SELECT id FROM skill_version WHERE skill_id = $1 ORDER BY version DESC LIMIT 1 OFFSET 1
         )`, [skillId]
      ).catch(() => ({ rows: [] }));
      const prevUri = prevSource.rows[0]?.source_uri || null;

      const sourceId = generateId();
      await pool.query(
        `INSERT INTO skill_source (id, skill_version_id, source_type, source_uri, content_text, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sourceId, versionId, 'manual', prevUri, null, JSON.stringify({ previous_version: row.current_version }), now]
      );

      logger.info('skill.version_created', 'New skill version created', {
        skill_id: skillId,
        old_version: row.current_version,
        new_version: newVersion
      });
    }

    await pool.query('COMMIT');

    const updated = await getSkill(skillId);
    return updated;
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    logger.error('skill.update_failed', 'Failed to update skill', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'update_failed' } };
  }
}

/**
 * 发布技能（draft → active）
 * 仅 draft 状态的技能可以发布到 active
 */
async function publishSkill(skillId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) return { status: 503, body: { ok: false, error: 'database_not_available' } };

  try {
    const result = await pool.query(
      `UPDATE skill SET status = 'active', updated_at = $2 WHERE id = $1 AND status = 'draft' RETURNING id, status`,
      [skillId, new Date().toISOString()]
    );

    if (result.rows.length === 0) {
      const check = await pool.query(`SELECT status FROM skill WHERE id = $1`, [skillId]);
      if (check.rows.length === 0) {
        return { status: 404, body: { ok: false, error: 'skill_not_found' } };
      }
      return { status: 409, body: { ok: false, error: 'invalid_state_transition', current_status: String(check.rows[0].status) } };
    }

    logger.info('skill.published', 'Skill published', { skill_id: skillId });
    return { status: 200, body: { ok: true, skill_id: skillId, status: 'active' } };
  } catch (error) {
    logger.error('skill.publish_failed', 'Failed to publish skill', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'publish_failed' } };
  }
}

/**
 * 归档技能（active → archived）
 * 已归档的技能不再出现在默认搜索结果中，但不会被物理删除
 */
async function archiveSkill(skillId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) return { status: 503, body: { ok: false, error: 'database_not_available' } };

  try {
    const result = await pool.query(
      `UPDATE skill SET status = 'archived', updated_at = $2 WHERE id = $1 AND status = 'active' RETURNING id, status`,
      [skillId, new Date().toISOString()]
    );

    if (result.rows.length === 0) {
      const check = await pool.query(`SELECT status FROM skill WHERE id = $1`, [skillId]);
      if (check.rows.length === 0) {
        return { status: 404, body: { ok: false, error: 'skill_not_found' } };
      }
      return { status: 409, body: { ok: false, error: 'invalid_state_transition', current_status: String(check.rows[0].status) } };
    }

    logger.info('skill.archived', 'Skill archived', { skill_id: skillId });
    return { status: 200, body: { ok: true, skill_id: skillId, status: 'archived' } };
  } catch (error) {
    logger.error('skill.archive_failed', 'Failed to archive skill', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'archive_failed' } };
  }
}

/**
 * 获取技能的所有版本历史
 *
 * @param skillId - 技能 UUID
 * @returns 按版本号降序排列的版本列表
 */
async function getSkillVersions(skillId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) return { status: 503, body: { ok: false, error: 'database_not_available' } };

  try {
    const check = await pool.query(`SELECT id FROM skill WHERE id = $1 AND status != 'deleted'`, [skillId]);
    if (check.rows.length === 0) {
      return { status: 404, body: { ok: false, error: 'skill_not_found' } };
    }

    const result = await pool.query(
      `SELECT id, skill_id, version, definition_json, content_hash, status, metadata, created_at
       FROM skill_version WHERE skill_id = $1 ORDER BY version DESC LIMIT 50`,
      [skillId]
    );

    const versions = result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      skill_id: String(row.skill_id),
      version: Number(row.version),
      definition_json: typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : (row.definition_json || {}),
      content_hash: String(row.content_hash),
      status: String(row.status),
      created_at: String(row.created_at)
    }));

    return { status: 200, body: { ok: true, skill_id: skillId, total: versions.length, versions } };
  } catch (error) {
    logger.error('skill.versions_failed', 'Failed to get skill versions', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'versions_failed' } };
  }
}

/**
 * 从 Markdown 内容导入技能定义
 *
 * Markdown 解析规则：
 *   1. 第一行 `# 技能名称` 作为 skill_name
 *   2. `> 描述文本` 引用块作为 description
 *   3. `**类型:** value` 粗体键值对提取 skill_type
 *   4. `**作用域:** value` 提取 scope_type
 *   5. `## 阶段定义` 之后的 JSON 代码块解析为 stage_chain
 *   6. 其他 `**key:** value` 对存入 metadata
 *
 * 此功能对应 AH-5（自动总结报告）和 AH-7（管理员后台配置）故事线中
 * "从 Markdown 任务模板导入技能定义"的场景
 */
function parseMarkdownSkill(markdown: string): ImportSkillInput & { definition_json: Record<string, unknown> } {
  const lines = markdown.split('\n');
  let skillName = '';
  let description = '';
  let skillType = 'prompt';
  let scopeType = 'private';
  const metadata: Record<string, string> = {};
  const definitionJson: Record<string, unknown> = {};
  let inDefinition = false;
  let definitionLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 第一级标题作为技能名称
    if (trimmed.startsWith('# ') && !skillName) {
      skillName = trimmed.slice(2).trim();
      continue;
    }

    // 引用块作为描述
    if (trimmed.startsWith('> ') && !description) {
      description = trimmed.slice(2).trim();
      continue;
    }

    // 粗体键值对解析
    const boldMatch = trimmed.match(/^\*\*(.+?):\*\*\s*(.+)/);
    if (boldMatch) {
      const key = boldMatch[1].trim();
      const value = boldMatch[2].trim();
      if (key === '类型' || key === 'Type') skillType = value;
      else if (key === '作用域' || key === 'Scope') scopeType = value;
      else metadata[key] = value;
      continue;
    }

    // 阶段定义区域收集 JSON
    if (trimmed.startsWith('## ') && (trimmed.includes('阶段') || trimmed.includes('Stage') || trimmed.includes('定义') || trimmed.includes('Definition'))) {
      inDefinition = true;
      continue;
    }

    if (inDefinition) {
      if (trimmed.startsWith('```')) {
        if (definitionLines.length > 0) {
          try {
            const parsed = JSON.parse(definitionLines.join('\n'));
            Object.assign(definitionJson, parsed);
          } catch {
            definitionJson.raw_definition = definitionLines.join('\n');
          }
          definitionLines = [];
        }
        inDefinition = false;
        continue;
      }
      definitionLines.push(line);
    }
  }

  // 兜底：如果没有解析到 JSON 定义，使用空 stage_chain
  if (Object.keys(definitionJson).length === 0) {
    definitionJson.stage_chain = [];
  }

  return {
    owner_user_id: '',
    markdown_content: markdown,
    definition_json: definitionJson,
    skill_name: skillName || '未命名技能',
    description: description || '',
    scope_type: scopeType as 'private' | 'org' | 'public',
    skill_type: skillType
  };
}

/**
 * 将技能定义导出为 Markdown 格式
 *
 * 导出格式与 import 时的解析规则对应，确保导入导出的往返完整性：
 *   # 技能名称
 *   > 描述
 *   **类型:** xxx
 *   **作用域:** xxx
 *   **版本:** N
 *
 *   ## 阶段定义
 *   ```json
 *   { ... definition_json ... }
 *   ```
 */
async function exportSkillToMarkdown(skillId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await getSkill(skillId);
  if (result.status !== 200) return result;

  const skill = result.body.skill as Record<string, unknown>;
  const stageChain = (skill.definition_json as Record<string, unknown>)?.stage_chain || [];

  const markdown = [
    `# ${skill.skill_name}`,
    '',
    `> ${skill.description || ''}`,
    '',
    `**类型:** ${skill.skill_type}`,
    `**作用域:** ${skill.scope_type}`,
    `**版本:** ${skill.version}`,
    `**状态:** ${skill.status}`,
    '',
    '## 阶段定义',
    '',
    '```json',
    JSON.stringify(stageChain, null, 2),
    '```',
    '',
    `*导出时间: ${new Date().toISOString()}*`
  ].join('\n');

  return {
    status: 200,
    body: {
      ok: true,
      skill_id: skillId,
      skill_name: skill.skill_name,
      format: 'markdown',
      markdown
    }
  };
}

/**
 * 列出技能（支持分页和多重过滤）
 *
 * 过滤维度：
 *   - owner_user_id: 按所有者过滤
 *   - org_id: 按组织过滤
 *   - scope_type: 按作用域过滤（private/org/public）
 *   - skill_type: 按类型过滤
 *   - status: 按状态过滤（默认排除 deleted）
 *
 * @param options - 分页和过滤参数
 * @returns 技能列表及总数
 */
async function listSkills(options: {
  owner_user_id?: string;
  org_id?: string;
  scope_type?: string;
  skill_type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const pool = await getDbPool();
  if (!pool) return { status: 503, body: { ok: false, error: 'database_not_available' } };

  try {
    const conditions: string[] = ["s.status != 'deleted'"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (options.owner_user_id) {
      conditions.push(`s.owner_user_id = $${paramIdx++}`);
      params.push(options.owner_user_id);
    }
    if (options.org_id) {
      conditions.push(`s.org_id = $${paramIdx++}`);
      params.push(options.org_id);
    }
    if (options.scope_type) {
      conditions.push(`s.scope_type = $${paramIdx++}`);
      params.push(options.scope_type);
    }
    if (options.skill_type) {
      conditions.push(`s.skill_type = $${paramIdx++}`);
      params.push(options.skill_type);
    }
    if (options.status) {
      conditions.push(`s.status = $${paramIdx++}`);
      params.push(options.status);
    }

    const limit = Math.min(options.limit || 50, 200);
    const offset = options.offset || 0;
    const limitParam = paramIdx++;
    const offsetParam = paramIdx++;

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM skill s WHERE ${conditions.join(' AND ')}`,
      params
    );

    const sql = `
      SELECT s.id, s.owner_user_id, s.org_id, s.scope_type, s.skill_name, s.description, s.skill_type, s.status,
             s.created_at, s.updated_at,
             COALESCE(sv.version, 1) as version,
             COALESCE(sv.content_hash, '') as content_hash
      FROM skill s
      LEFT JOIN LATERAL (
        SELECT version, content_hash FROM skill_version
        WHERE skill_id = s.id ORDER BY version DESC LIMIT 1
      ) sv ON true
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.updated_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await pool.query(sql, [...params, limit, offset]);
    const skills = result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      owner_user_id: String(row.owner_user_id),
      org_id: row.org_id ? String(row.org_id) : null,
      scope_type: String(row.scope_type),
      skill_name: String(row.skill_name),
      description: String(row.description || ''),
      skill_type: String(row.skill_type),
      status: String(row.status),
      version: Number(row.version || 1),
      content_hash: String(row.content_hash || ''),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at)
    }));

    return {
      status: 200,
      body: {
        ok: true,
        total: Number(countResult.rows[0].total),
        limit,
        offset,
        skills
      }
    };
  } catch (error) {
    logger.error('skill.list_failed', 'Failed to list skills', { error: String(error) });
    return { status: 500, body: { ok: false, error: 'list_failed' } };
  }
}

/* ---- HTTP 路由定义 ---- */

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';
  const captureWrite = res.write.bind(res);
  const captureEnd = res.end.bind(res);
  const chunks: Buffer[] = [];

  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    return (captureWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
  } as typeof res.write;

  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    responseBody = Buffer.concat(chunks).toString('utf-8').slice(0, 2000);
    return (captureEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
  } as typeof res.end;

  try {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    // 健康检查端点
    if (pathname === '/health/live' || pathname === '/health/ready') {
      sendJson(res, 200, { ok: true, service: 'skill-library' });
      return;
    }

    // 创建技能
    if (pathname === '/internal/skills/create' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');

      if (!ownerUserId) {
        sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' });
        return;
      }

      const skillName = String(body.skill_name || '');
      if (!skillName.trim()) {
        sendJson(res, 400, { ok: false, error: 'missing_skill_name' });
        return;
      }

      const result = await createSkill({
        owner_user_id: ownerUserId,
        org_id: body.org_id ? String(body.org_id) : undefined,
        scope_type: body.scope_type as 'private' | 'org' | 'public' | undefined,
        skill_name: skillName,
        description: String(body.description || ''),
        skill_type: body.skill_type as string | undefined,
        definition_json: (body.definition_json as Record<string, unknown>) || {},
        metadata: body.metadata as Record<string, unknown> | undefined,
        source_uri: body.source_uri as string | undefined
      });

      sendJson(res, result.status, result.body);
      return;
    }

    // 搜索技能
    if (pathname === '/internal/skills/search' && req.method === 'GET') {
      const query = parsedUrl.searchParams.get('query') || undefined;
      const scopeType = parsedUrl.searchParams.get('scope_type') || undefined;
      const skillType = parsedUrl.searchParams.get('skill_type') || undefined;
      const result = await searchSkills(query, scopeType, skillType);
      sendJson(res, result.status, result.body);
      return;
    }

    // 从 Markdown 导入技能
    if (pathname === '/internal/skills/import' && req.method === 'POST') {
      const body = await readJson(req);
      const ownerUserId = String(body.owner_user_id || '');
      const markdownContent = String(body.markdown_content || '');

      if (!ownerUserId) {
        sendJson(res, 400, { ok: false, error: 'missing_owner_user_id' });
        return;
      }

      if (!markdownContent.trim()) {
        sendJson(res, 400, { ok: false, error: 'missing_markdown_content' });
        return;
      }

      const parsed = parseMarkdownSkill(markdownContent);
      const result = await createSkill({
        owner_user_id: ownerUserId,
        org_id: body.org_id ? String(body.org_id) : undefined,
        scope_type: (body.scope_type || parsed.scope_type) as 'private' | 'org' | 'public',
        skill_name: parsed.skill_name,
        description: parsed.description || String(body.description || ''),
        skill_type: parsed.skill_type || String(body.skill_type || 'prompt'),
        definition_json: parsed.definition_json,
        metadata: (body.metadata as Record<string, unknown>) || parsed.metadata as unknown as Record<string, unknown>,
        source_uri: body.source_uri as string || 'markdown_import'
      });

      sendJson(res, result.status, result.body);
      return;
    }

    // 路由匹配：/internal/skills/:id/export
    if (pathname.startsWith('/internal/skills/') && pathname.endsWith('/export') && req.method === 'GET') {
      const skillId = pathname.split('/')[3];
      if (!skillId) {
        sendJson(res, 400, { ok: false, error: 'missing_skill_id' });
        return;
      }
      const result = await exportSkillToMarkdown(skillId);
      sendJson(res, result.status, result.body);
      return;
    }

    // 路由匹配：/internal/skills/:id/versions
    if (pathname.startsWith('/internal/skills/') && pathname.endsWith('/versions') && req.method === 'GET') {
      const skillId = pathname.split('/')[3];
      if (!skillId) {
        sendJson(res, 400, { ok: false, error: 'missing_skill_id' });
        return;
      }
      const result = await getSkillVersions(skillId);
      sendJson(res, result.status, result.body);
      return;
    }

    // 路由匹配：/internal/skills/:id/publish
    if (pathname.startsWith('/internal/skills/') && pathname.endsWith('/publish') && req.method === 'POST') {
      const skillId = pathname.split('/')[3];
      if (!skillId) {
        sendJson(res, 400, { ok: false, error: 'missing_skill_id' });
        return;
      }
      const result = await publishSkill(skillId);
      sendJson(res, result.status, result.body);
      return;
    }

    // 路由匹配：/internal/skills/:id/archive
    if (pathname.startsWith('/internal/skills/') && pathname.endsWith('/archive') && req.method === 'POST') {
      const skillId = pathname.split('/')[3];
      if (!skillId) {
        sendJson(res, 400, { ok: false, error: 'missing_skill_id' });
        return;
      }
      const result = await archiveSkill(skillId);
      sendJson(res, result.status, result.body);
      return;
    }

    // 路由匹配：/internal/skills/:id/update
    if (pathname.startsWith('/internal/skills/') && pathname.endsWith('/update') && req.method === 'POST') {
      const skillId = pathname.split('/')[3];
      if (!skillId) {
        sendJson(res, 400, { ok: false, error: 'missing_skill_id' });
        return;
      }
      const body = await readJson(req);

      if (!body.definition_json) {
        sendJson(res, 400, { ok: false, error: 'missing_definition_json' });
        return;
      }

      const result = await updateSkill(skillId, {
        definition_json: body.definition_json as Record<string, unknown>,
        description: body.description as string | undefined,
        skill_type: body.skill_type as string | undefined,
        scope_type: body.scope_type as 'private' | 'org' | 'public' | undefined
      });

      sendJson(res, result.status, result.body);
      return;
    }

    // ============================================================
    // 梦境模式：技能审核与管理端点 (Dream Mode - Skill Audit)
    // ============================================================
    if (pathname === '/internal/skills/audit' && req.method === 'POST') {
      const body = await readJson(req);
      const skillId = String(body.skill_id || '');
      const auditorUserId = String(body.auditor_user_id || '');
      const pool = await getDbPool();

      if (!skillId || !pool) {
        sendJson(res, 400, { ok: false, error: !skillId ? 'missing_skill_id' : 'database_not_available' });
        return;
      }

      try {
        const skillResult = await pool.query(`SELECT * FROM skill WHERE id = $1`, [skillId]);
        if (skillResult.rows.length === 0) {
          sendJson(res, 404, { ok: false, error: 'skill_not_found' });
          return;
        }
        const skill = skillResult.rows[0];

        const versionResult = await pool.query(
          `SELECT * FROM skill_version WHERE skill_id = $1 ORDER BY version DESC LIMIT 1`,
          [skillId]
        );
        const latestVersion = versionResult.rows[0];

        let functionalityScore = 70;
        let securityScore = 70;
        let performanceScore = 70;
        let orgFitScore = 70;

        const def = latestVersion?.definition_json || {};
        let defStr = '';
        try { defStr = JSON.stringify(def); } catch { defStr = String(def); }

        if (typeof def === 'object' && def !== null) {
          if (def.stage_chain || def.prompt_template) functionalityScore = 75;
          if (def.tools || def.capabilities) functionalityScore = Math.min(85, functionalityScore + 10);
          if (def.params || def.parameters) functionalityScore = Math.min(90, functionalityScore + 5);
        }
        if (defStr.length < 500) securityScore = 60;
        else if (defStr.length < 2000) securityScore = 75;
        else securityScore = 85;
        if (defStr.length < 3000) performanceScore = 80;
        else performanceScore = 70;
        if (skill.scope_type === 'org' || skill.scope_type === 'public') orgFitScore = 85;
        else orgFitScore = 65;

        const overallScore = Math.round((functionalityScore + securityScore + performanceScore + orgFitScore) / 4);
        const auditResult = overallScore >= 70 ? 'approved' : 'needs_revision';

        await pool.query(
          `INSERT INTO skill_audit_record (skill_id, auditor_user_id, org_id, audit_type,
           functionality_score, security_score, performance_score, org_fit_score, overall_score, audit_result)
           VALUES ($1,$2,$3,'manual_review',$4,$5,$6,$7,$8,$9)`,
          [skillId, auditorUserId || null, skill.org_id, functionalityScore, securityScore, performanceScore, orgFitScore, overallScore, auditResult]
        );

        if (overallScore >= 80 && (skill.scope_type === 'private' || skill.scope_type === 'draft')) {
          await pool.query(`UPDATE skill SET scope_type = 'org', status = 'active' WHERE id = $1`, [skillId]);

          await pool.query(
            `INSERT INTO org_skill_registry (org_id, skill_id, promoted_by, promoted_from_skill_id, origination_type, origination_user_id, category, status)
             VALUES ($1,$2,$3,$2,'user_upgrade',$4,'other','active')
             ON CONFLICT DO NOTHING`,
            [skill.org_id || '00000000-0000-0000-0000-000000000001', skillId, auditorUserId || null, skill.owner_user_id]
          );
        }

        sendJson(res, 200, {
          ok: true,
          audit: { skill_id: skillId, overall_score: overallScore, audit_result: auditResult,
            scores: { functionality: functionalityScore, security: securityScore, performance: performanceScore, org_fit: orgFitScore } }
        });
      } catch (err) {
        logger.error('skill.audit_failed', 'Skill audit failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'audit_failed' });
      }
      return;
    }

    if (pathname === '/internal/skills/audit/batch' && req.method === 'POST') {
      const body = await readJson(req);
      const orgId = String(body.org_id || '');
      const pool = await getDbPool();

      if (!pool) { sendJson(res, 500, { ok: false, error: 'database_not_available' }); return; }

      try {
        const recentSkills = await pool.query(
          `SELECT s.id, s.owner_user_id, s.org_id, s.scope_type, s.status FROM skill s
           WHERE s.created_at >= now() - interval '7 days' AND s.status = 'active'
           ${orgId ? 'AND s.org_id = $1' : ''}
           LIMIT 100`,
          orgId ? [orgId] : []
        );

        let audited = 0;
        let promoted = 0;

        for (const skill of recentSkills.rows) {
          const versionResult = await pool.query(
            `SELECT definition_json FROM skill_version WHERE skill_id = $1 ORDER BY version DESC LIMIT 1`,
            [skill.id]
          );
          const def = versionResult.rows[0]?.definition_json || {};
          let defStr = '';
          try { defStr = JSON.stringify(def); } catch { defStr = String(def); }

          let functionalityScore = 70;
          let securityScore = 70;
          let performanceScore = 70;
          let orgFitScore = 70;

          if (typeof def === 'object' && def !== null) {
            if (def.stage_chain || def.prompt_template) functionalityScore = 75;
            if (def.tools || def.capabilities) functionalityScore = Math.min(85, functionalityScore + 10);
            if (def.params || def.parameters) functionalityScore = Math.min(90, functionalityScore + 5);
          }
          if (defStr.length < 500) securityScore = 60;
          else if (defStr.length < 2000) securityScore = 75;
          else securityScore = 85;
          if (defStr.length < 3000) performanceScore = 80;
          else performanceScore = 70;
          if (skill.scope_type === 'org' || skill.scope_type === 'public') orgFitScore = 85;
          else orgFitScore = 65;

          const overallScore = Math.round((functionalityScore + securityScore + performanceScore + orgFitScore) / 4);
          const auditResult = overallScore >= 70 ? 'approved' : 'needs_revision';

          await pool.query(
            `INSERT INTO skill_audit_record (skill_id, auditor_user_id, org_id, audit_type,
             functionality_score, security_score, performance_score, org_fit_score, overall_score, audit_result)
             VALUES ($1,null,$2,'daily_review',$3,$4,$5,$6,$7,$8)`,
            [skill.id, skill.org_id, functionalityScore, securityScore, performanceScore, orgFitScore, overallScore, auditResult]
          );

          if (overallScore >= 80 && (skill.scope_type === 'private' || skill.scope_type === 'draft')) {
            await pool.query(`UPDATE skill SET scope_type = 'org', status = 'active' WHERE id = $1`, [skill.id]);
            await pool.query(
              `INSERT INTO org_skill_registry (org_id, skill_id, promoted_by, promoted_from_skill_id, origination_type, origination_user_id, category, status)
               VALUES ($1,$2,null,$2,'user_upgrade',$3,'other','active')
               ON CONFLICT DO NOTHING`,
              [skill.org_id || '00000000-0000-0000-0000-000000000001', skill.id, skill.owner_user_id]
            );
            promoted++;
          }
          audited++;
        }

        sendJson(res, 200, { ok: true, audited, promoted });
      } catch (err) {
        logger.error('skill.audit_batch_failed', 'Batch skill audit failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'audit_batch_failed' });
      }
      return;
    }

    if (pathname.match(/^\/internal\/skills\/[0-9a-f-]{36}\/promote-to-org$/) && req.method === 'POST') {
      const skillId = pathname.split('/')[3];
      const body = await readJson(req);
      const promotedBy = String(body.promoted_by || '');
      const pool = await getDbPool();

      if (!pool) { sendJson(res, 500, { ok: false, error: 'database_not_available' }); return; }

      try {
        const skillResult = await pool.query(`SELECT * FROM skill WHERE id = $1`, [skillId]);
        if (skillResult.rows.length === 0) {
          sendJson(res, 404, { ok: false, error: 'skill_not_found' });
          return;
        }
        const skill = skillResult.rows[0];
        await pool.query(`UPDATE skill SET scope_type = 'org', status = 'active' WHERE id = $1`, [skillId]);
        await pool.query(
          `INSERT INTO org_skill_registry (org_id, skill_id, promoted_by, promoted_from_skill_id, origination_type, origination_user_id, category, status)
           VALUES ($1,$2,$3,$2,'user_upgrade',$4,'other','active')
           ON CONFLICT DO NOTHING`,
          [skill.org_id || '00000000-0000-0000-0000-000000000001', skillId, promotedBy || null, skill.owner_user_id]
        );
        sendJson(res, 200, { ok: true, skill_id: skillId, scope_type: 'org' });
      } catch (err) {
        logger.error('skill.promote_failed', 'Skill promotion failed', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'promote_failed' });
      }
      return;
    }

    if (pathname === '/internal/skills/org-registry' && req.method === 'GET') {
      const pool = await getDbPool();
      const orgId = parsedUrl.searchParams.get('org_id') || '';
      if (!pool) { sendJson(res, 500, { ok: false, error: 'database_not_available' }); return; }

      try {
        const result = await pool.query(
          `SELECT osr.*, s.skill_name, s.description FROM org_skill_registry osr JOIN skill s ON osr.skill_id = s.id
           WHERE osr.status = 'active' ${orgId ? 'AND osr.org_id = $1' : ''}
           ORDER BY osr.created_at DESC LIMIT 100`,
          orgId ? [orgId] : []
        );
        sendJson(res, 200, { ok: true, skills: result.rows });
      } catch (err) {
        logger.error('skill.org_registry_failed', 'Failed to query org skill registry', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'query_failed' });
      }
      return;
    }

    if (pathname === '/internal/skills/audit-records' && req.method === 'GET') {
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 500, { ok: false, error: 'database_not_available' }); return; }
      try {
        const result = await pool.query(
          `SELECT sar.*, s.skill_name FROM skill_audit_record sar JOIN skill s ON sar.skill_id = s.id
           ORDER BY sar.created_at DESC LIMIT 100`
        );
        sendJson(res, 200, { ok: true, records: result.rows });
      } catch (err) {
        logger.error('skill.audit_records_failed', 'Failed to query audit records', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'query_failed' });
      }
      return;
    }

    if (pathname === '/internal/skills/usage-stats' && req.method === 'GET') {
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 500, { ok: false, error: 'database_not_available' }); return; }
      try {
        const result = await pool.query(
          `SELECT sus.*, s.skill_name FROM skill_usage_stats sus JOIN skill s ON sus.skill_id = s.id
           ORDER BY sus.usage_date DESC LIMIT 100`
        );
        sendJson(res, 200, { ok: true, stats: result.rows });
      } catch (err) {
        logger.error('skill.usage_stats_failed', 'Failed to query usage stats', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'query_failed' });
      }
      return;
    }

    if (pathname === '/internal/skills/scene-assessments' && req.method === 'GET') {
      const pool = await getDbPool();
      if (!pool) { sendJson(res, 500, { ok: false, error: 'database_not_available' }); return; }
      try {
        const result = await pool.query(
          `SELECT * FROM scene_value_assessment ORDER BY value_score DESC LIMIT 100`
        );
        sendJson(res, 200, { ok: true, assessments: result.rows });
      } catch (err) {
        logger.error('skill.scene_assessments_failed', 'Failed to query scene assessments', { error: String(err) });
        sendJson(res, 500, { ok: false, error: 'query_failed' });
      }
      return;
    }

    // 路由匹配：GET /internal/skills/:id（单个技能详情）
    if (pathname.startsWith('/internal/skills/') && req.method === 'GET') {
      const pathParts = pathname.split('/');
      if (pathParts.length === 4 && pathParts[3] && /^[0-9a-f-]{36}$/i.test(pathParts[3])) {
        const skillId = pathParts[3];
        const result = await getSkill(skillId);
        sendJson(res, result.status, result.body);
        return;
      }
    }

    // 路由匹配：GET /internal/skills（技能列表）
    if (pathname === '/internal/skills' && req.method === 'GET') {
      const result = await listSkills({
        owner_user_id: parsedUrl.searchParams.get('owner_user_id') || undefined,
        org_id: parsedUrl.searchParams.get('org_id') || undefined,
        scope_type: parsedUrl.searchParams.get('scope_type') || undefined,
        skill_type: parsedUrl.searchParams.get('skill_type') || undefined,
        status: parsedUrl.searchParams.get('status') || undefined,
        limit: Number(parsedUrl.searchParams.get('limit') || 50),
        offset: Number(parsedUrl.searchParams.get('offset') || 0)
      });
      sendJson(res, result.status, result.body);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.unhandled_error', 'Unhandled request error', {
      error: (error as Error).message,
      stack: (error as Error).stack?.slice(0, 500)
    });
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    }
  }
  await httpResponseLogger(req, res, responseBody);
});

/* ---- 服务生命周期管理 ---- */

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

server.listen(port, () => {
  logger.info('service.started', 'Skill-library service started', { port });
  void getDbPool();

  aggregationInterval = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') {
      writeAggregationReport(report);
    }
  }, 15000);
  if (aggregationInterval.unref) aggregationInterval.unref();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (aggregationInterval) { clearInterval(aggregationInterval); aggregationInterval = null; }
    writeAggregationReport(analyze());
    metricsRegistry.shutdown();
    server.close(async () => {
      await logger.shutdown();
      process.exit(0);
    });
  });
}
