/**
 * gateway-adapter 内存管理器
 *
 * 从原版 ~2200行文件中提取 rememberContext / recallContext / loadUserPersona /
 * getWorkspaceInfo 逻辑，使用 TTLMap 防止内存泄漏。
 *
 * @module memory-manager
 */

import { TTLMap } from '../../libs/shared/src/utils/ttl-map';
import { llmClient } from '../../libs/shared/src/llm/client';
import { getPool } from '../../libs/shared/src/db/pool-manager';
import type { Pool } from 'pg';

const memoryStore = new TTLMap<string, Array<{ role: string; content: string; timestamp: number }>>(86400000); // 24小时TTL

interface UserPersona {
  soul: string | null;
  identity: string | null;
  toneStyle: string | null;
  behaviorBoundary: string | null;
  skillTags: string;
}

interface WorkspaceInfo {
  docCount: number;
  factCount: number;
  memoryCount: number;
}

export class MemoryManager {
  private hermesUrl: string;
  private litellmUrl: string;
  private litellmModel: string;
  private litellmApiKey: string;

  constructor(config?: { hermesUrl?: string; litellmUrl?: string; litellmModel?: string; litellmApiKey?: string }) {
    this.hermesUrl = config?.hermesUrl || process.env.HERMES_URL || 'http://hermes-adapter:3000';
    this.litellmUrl = config?.litellmUrl || process.env.LITELLM_URL || '';
    this.litellmModel = config?.litellmModel || process.env.LITELLM_MODEL || 'minimax-m2.7';
    this.litellmApiKey = config?.litellmApiKey || process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '';
  }

  async remember(ownerUserId: string, sessionId: string, role: string, content: string): Promise<void> {
    // 本地存储
    const key = `${ownerUserId}::${sessionId}`;
    const existing = memoryStore.get(key) || [];
    existing.push({ role, content, timestamp: Date.now() });

    // 保留最近100条
    if (existing.length > 100) {
      existing.splice(0, existing.length - 100);
    }
    memoryStore.set(key, existing);

    // 异步持久化到 Hermes
    this.fireAndForget(
      fetch(`${this.hermesUrl}/internal/memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner_user_id: ownerUserId, session_id: sessionId, role, content }),
        signal: AbortSignal.timeout(5000)
      }),
      'memory_persist'
    );
  }

  async recall(ownerUserId: string, sessionId: string): Promise<{ context: string; degraded: boolean }> {
    try {
      const res = await fetch(`${this.hermesUrl}/internal/memory/recall`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner_user_id: ownerUserId, session_id: sessionId, limit: 20 }),
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        // 降级到本地存储
        return { context: this.getLocalContext(ownerUserId, sessionId), degraded: true };
      }

      const body = await res.json() as { compressed_context?: string };
      return { context: body.compressed_context || '', degraded: false };
    } catch {
      return { context: this.getLocalContext(ownerUserId, sessionId), degraded: true };
    }
  }

  private getLocalContext(ownerUserId: string, sessionId: string): string {
    const key = `${ownerUserId}::${sessionId}`;
    const existing = memoryStore.get(key);
    if (!existing || existing.length === 0) return '';

    const recent = existing.slice(-10);
    return recent.map(m => `[${m.role}]: ${m.content.slice(0, 200)}`).join('\n');
  }

  async loadPersona(ownerUserId: string): Promise<UserPersona | null> {
    try {
      const pool = await getPool('gateway-adapter');
      if (!pool) return null;

      const result = await pool.query(
        `SELECT soul, identity, tone_style, behavior_boundary, skill_tags FROM user_profile WHERE user_id = $1 LIMIT 1`,
        [ownerUserId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      const tags = typeof row.skill_tags === 'string'
        ? JSON.parse(row.skill_tags)
        : Array.isArray(row.skill_tags) ? row.skill_tags.join(', ') : '';

      return {
        soul: typeof row.soul === 'string' ? row.soul : null,
        identity: typeof row.identity === 'string' ? row.identity : null,
        toneStyle: typeof row.tone_style === 'string' ? row.tone_style : null,
        behaviorBoundary: typeof row.behavior_boundary === 'string' ? row.behavior_boundary : null,
        skillTags: typeof tags === 'string' ? tags : String(tags || '')
      };
    } catch {
      return null;
    }
  }

  async getWorkspaceInfo(ownerUserId: string): Promise<WorkspaceInfo> {
    try {
      const pool = await getPool('gateway-adapter');
      if (!pool) return { docCount: 0, factCount: 0, memoryCount: 0 };

      const [docR, factR, memR] = await Promise.all([
        pool.query(`SELECT COUNT(*) as cnt FROM document WHERE owner_user_id = $1`, [ownerUserId]),
        pool.query(`SELECT COUNT(*) as cnt FROM fact WHERE owner_user_id = $1 AND status = 'active'`, [ownerUserId]),
        pool.query(`SELECT COUNT(*) as cnt FROM hermes_memory WHERE owner_user_id = $1`, [ownerUserId])
      ]);

      return {
        docCount: Number(docR.rows[0]?.cnt || 0),
        factCount: Number(factR.rows[0]?.cnt || 0),
        memoryCount: Number(memR.rows[0]?.cnt || 0)
      };
    } catch {
      return { docCount: 0, factCount: 0, memoryCount: 0 };
    }
  }

  async generateChatReply(
    userText: string,
    ownerUserId: string,
    context?: string
  ): Promise<{ text: string; modelCallOk: boolean }> {
    const persona = await this.loadPersona(ownerUserId);
    const workspace = await this.getWorkspaceInfo(ownerUserId);

    const systemPrompt = `你是一个企业级AI智能助手。
${persona ? `【你的身份与行为准则】
- 核心性格(soul): ${persona.soul || '专业、高效、贴心的企业AI助手'}
- 身份定位(identity): ${persona.identity || '企业级AI智能助手'}
- 语气风格(tone): ${persona.toneStyle || '专业、简洁、准确'}
- 行为边界: ${persona.behaviorBoundary || '保护用户隐私，不泄露敏感信息'}
- 技能标签: ${persona.skillTags || '通用知识问答'}` : ''}
${workspace ? `【你的独立工作区信息】
- 工作区目录: /workspace/${ownerUserId}
- 已有文档数: ${workspace.docCount}
- 已有事实数: ${workspace.factCount}
- 已存储记忆条数: ${workspace.memoryCount}` : ''}

核心行为准则:
- 用中文回复，专业、简洁、准确
- 优先从组织知识库中查找答案
- 对不确定的信息明确标注"待确认"
- 保护用户隐私，不泄露敏感信息`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];
    if (context) {
      messages.push({ role: 'system', content: `对话历史摘要:\n${context}` });
    }
    messages.push({ role: 'user', content: userText });

    const result = await llmClient.call({
      systemPrompt: messages[0].content,
      userPrompt: messages.slice(1).map(m => `[${m.role}]: ${m.content}`).join('\n\n'),
      temperature: 0.3,
      maxTokens: 2048,
      timeoutMs: 120000
    });

    if (!result.ok || !result.content) {
      return { text: '模型暂不可用，已收到你的消息。', modelCallOk: false };
    }

    return { text: result.content, modelCallOk: true };
  }

  private fireAndForget(promise: Promise<unknown>, tag: string): void {
    promise.catch(() => {}); // 静默失败
  }
}

export const memoryManager = new MemoryManager();