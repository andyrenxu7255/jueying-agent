/**
 * Audit Writer — 审计日志写入器
 *
 * 缓冲批量写入审计事件到 audit_event 表，支持:
 * - 内存缓冲区(100条触发 / 5秒定时 / 上限10000条)
 * - 批量 DB INSERT 高性能写入
 * - 数据库不可用时降级到日志输出
 * - 敏感字段自动脱敏(token/secret/password等)
 * - 关键操作(PolicyDenied/CrossUserRead)即时日志
 *
 * @module audit-writer
 */

import { randomUUID } from 'node:crypto';
import { configManager, createLogger, getDatabaseSslConfig } from '@agent-harness/shared';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

let pgPool: Pool | null = null;

function getPool(): Pool | null {
  if (!pgPool && process.env.DATABASE_URL) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      ssl: getDatabaseSslConfig(configManager.get())
    });
  }
  return pgPool;
}

export const REQUIRED_AUDIT_ACTIONS = [
  'identity.bind',
  'identity.conflict',
  'policy.snapshot.create',
  'policy.denied',
  'workflow.create',
  'workflow.state.changed',
  'workflow.pause',
  'workflow.resume',
  'workflow.cancel',
  'fact.written',
  'fact.conflict.detected',
  'artifact.create',
  'code.session.created',
  'code.verification.completed',
  'checkpoint.resume',
  'replay.start',
  'public.publish',
  'admin.cross_user_read'
] as const;

export type AuditAction = typeof REQUIRED_AUDIT_ACTIONS[number];

export interface AuditEntry {
  id: string;
  user_id: string;
  org_id?: string;
  workflow_instance_id?: string;
  action: AuditAction | string;
  resource_type: string;
  resource_ref: string;
  resource_scope: string;
  result: 'success' | 'failure';
  detail_json: Record<string, unknown>;
  trace_id?: string;
  occurred_at: string;
}

const SENSITIVE_FIELDS = ['user_id', 'session_id', 'token', 'secret', 'api_key', 'password', 'authorization', 'credential'] as const;

function maskField(key: string, value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  const lowerKey = key.toLowerCase();
  for (const sensitive of SENSITIVE_FIELDS) {
    if (lowerKey.includes(sensitive)) {
      if (value.length <= 8) return '***';
      return value.slice(0, 4) + '***' + value.slice(-4);
    }
  }
  return value;
}

function maskSensitive(record: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitive(value as Record<string, unknown>);
    } else {
      masked[key] = maskField(key, value);
    }
  }
  return masked;
}

function safeAuditLog(entry: AuditEntry): Record<string, unknown> {
  return maskSensitive({
    audit_id: entry.id,
    action: entry.action,
    user_id: entry.user_id,
    resource_type: entry.resource_type,
    resource_ref: entry.resource_ref,
    result: entry.result,
    occurred_at: entry.occurred_at,
    has_workflow: Boolean(entry.workflow_instance_id),
    has_org: Boolean(entry.org_id)
  });
}

export class AuditWriter {
  private logger = createLogger('audit');
  private buffer: AuditEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000;
  private readonly MAX_BUFFER_SIZE = 10000;
  private droppedEntries = 0;

  private ensureFlushInterval(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL_MS);
    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }

  async write(entry: Omit<AuditEntry, 'id' | 'occurred_at'>): Promise<void> {
    this.ensureFlushInterval();
    const auditEntry: AuditEntry = {
      ...entry,
      id: randomUUID(),
      occurred_at: new Date().toISOString()
    };

    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.droppedEntries += 1;
      this.logger.error('audit.buffer_overflow', 'Audit buffer overflow, dropping incoming entry', {
        dropped_entries: this.droppedEntries,
        max_buffer_size: this.MAX_BUFFER_SIZE,
        last_action: (entry.action || '').slice(0, 40)
      });
      return;
    }

    this.buffer.push(auditEntry);

    if (this.isCriticalAction(entry.action)) {
      this.logger.info('audit.critical', `Critical audit: ${entry.action}`, safeAuditLog(auditEntry));
    }

    if (this.buffer.length >= this.BUFFER_SIZE) {
      await this.flush();
    }
  }

  private isCriticalAction(action: string): boolean {
    const criticalActions = [
      'policy.denied',
      'admin.cross_user_read',
      'public.publish',
      'workflow.cancel'
    ];
    return criticalActions.includes(action);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    try {
      if (process.env.DATABASE_URL) {
        await this.flushToDatabase(entries);
      } else {
        for (const entry of entries) {
          this.logger.info('audit.write', 'Audit entry written (log-only)', safeAuditLog(entry));
        }
      }
    } catch (error) {
      this.logger.error('audit.flush_failed', 'Failed to flush audit entries', {
        error: (error as Error).message,
        entry_count: entries.length
      });
      if (this.buffer.length + entries.length <= this.MAX_BUFFER_SIZE) {
        this.buffer.unshift(...entries);
      }
    }
  }

  private async flushToDatabase(entries: AuditEntry[]): Promise<void> {
    const pool = getPool();
    if (!pool) {
      for (const entry of entries) {
        this.logger.info('audit.write', 'Audit entry written (log-only)', safeAuditLog(entry));
      }
      return;
    }

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();

      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (let i = 0; i < entries.length; i++) {
        const offset = i * 12;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`);
        values.push(
          entries[i].id,
          entries[i].user_id,
          entries[i].org_id || null,
          entries[i].workflow_instance_id || null,
          entries[i].action,
          entries[i].resource_type,
          entries[i].resource_ref,
          entries[i].resource_scope,
          entries[i].result,
          JSON.stringify(entries[i].detail_json),
          entries[i].trace_id || null,
          entries[i].occurred_at
        );
      }

      await client.query(
        `insert into audit_event (id, user_id, org_id, workflow_instance_id, action, resource_type, resource_ref, resource_scope, result, detail_json, trace_id, occurred_at)
         values ${placeholders.join(', ')}
         on conflict (id) do nothing`,
        values
      );

      this.logger.info('audit.db.flushed', 'Audit entries flushed to database', {
        entry_count: entries.length
      });
    } catch (error) {
      this.logger.warn('audit.db.write_failed', 'Database write failed, falling back to log', {
        error: String(error),
        entry_count: entries.length
      });
      for (const entry of entries) {
        this.logger.info('audit.write', 'Audit entry written (fallback)', safeAuditLog(entry));
      }
    } finally {
      if (client) client.release();
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
    if (pgPool) {
      await pgPool.end();
      pgPool = null;
    }
  }
}

export const auditWriter = new AuditWriter();
