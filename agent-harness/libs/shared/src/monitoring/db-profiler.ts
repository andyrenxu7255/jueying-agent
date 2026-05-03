import { createLogger } from '../logging/logger';
import { metricsRegistry } from '../metrics/metrics';

const logger = createLogger('db-profiler');

export interface DbQueryLog {
  queryHash: string;
  textSummary: string;
  durationMs: number;
  rowCount: number;
  error?: string;
}

const SLOW_QUERY_THRESHOLD_MS = 500;
const queryStats = new Map<string, { count: number; totalMs: number; maxMs: number }>();

function hashQuery(text: string): string {
  let hash = 0;
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `q_${Math.abs(hash).toString(36)}`;
}

function summarizeQuery(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const keyword = trimmed.match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)/i);
  const prefix = keyword ? keyword[1].toUpperCase() : 'QUERY';
  const short = trimmed.length > 150 ? trimmed.slice(0, 147) + '...' : trimmed;
  return `[${prefix}] ${short}`;
}

export function createDbProfiler(pool: import('pg').Pool): import('pg').Pool {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const originalQuery = require('pg').Pool.prototype.query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool.query = async function (this: any, ...args: any[]) {
    const startTime = performance.now();
    let textSummary = 'unknown';

    if (typeof args[0] === 'string') {
      textSummary = summarizeQuery(args[0]);
    } else if (args[0] && typeof args[0] === 'object' && 'text' in (args[0] as Record<string, unknown>)) {
      textSummary = summarizeQuery((args[0] as Record<string, string>).text);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await originalQuery.apply(this, args as any);
      const durationMs = Math.round(performance.now() - startTime);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rowCount = Array.isArray(result) ? result.length : (result as any).rowCount || 0;

      metricsRegistry.observe('db.query.duration_ms', durationMs);
      metricsRegistry.increment('db.query.total', 1);
      if (rowCount !== null) metricsRegistry.increment('db.query.rows_returned', rowCount);

      const queryHash = hashQuery(textSummary);
      const stats = queryStats.get(queryHash) || { count: 0, totalMs: 0, maxMs: 0 };
      stats.count += 1;
      stats.totalMs += durationMs;
      if (durationMs > stats.maxMs) stats.maxMs = durationMs;
      queryStats.set(queryHash, stats);

      if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
        logger.warn('db.query.slow', `Slow query (${durationMs}ms): ${textSummary.slice(0, 200)}`, {
          duration_ms: durationMs,
          row_count: rowCount,
          query_summary: textSummary.slice(0, 200),
          query_hash: queryHash,
          total_calls: stats.count,
          avg_ms: Math.round(stats.totalMs / stats.count)
        });
      }

      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      metricsRegistry.increment('db.query.errors', 1);

      logger.error('db.query.error', `DB query failed (${durationMs}ms): ${textSummary.slice(0, 200)}`, {
        duration_ms: durationMs,
        query_summary: textSummary.slice(0, 200),
        error: (error as Error).message
      });

      throw error;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return pool;
}

export function getQueryStats(): Array<{
  queryHash: string;
  count: number;
  avgMs: number;
  maxMs: number;
}> {
  return Array.from(queryStats.entries()).map(([hash, stats]) => ({
    queryHash: hash,
    count: stats.count,
    avgMs: Math.round(stats.totalMs / stats.count),
    maxMs: stats.maxMs
  }));
}

export function resetQueryStats(): void {
  queryStats.clear();
}
