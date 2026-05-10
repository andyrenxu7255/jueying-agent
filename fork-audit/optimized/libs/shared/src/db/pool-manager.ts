/**
 * 统一数据库连接池管理器
 *
 * 原版问题：
 *   - gateway-adapter: getSharedDbPool() max=10
 *   - hermes-adapter:    getDbPool()      max=4
 *   - web-portal:        new Pool()       默认 
 *   - mobile-app:        getDbPool()      默认
 *   - skill-library:     getDbPool()      max=4
 *   - resource-scheduler: getDbPool()     max=4
 *   → 6个独立池，最多54个连接！
 *
 * 优化后：单一连接池，按服务名分配。
 *
 * @module pool-manager
 */

import type { Pool, PoolConfig } from 'pg';

interface PoolEntry {
  pool: Pool;
  max: number;
  createdAt: number;
}

const pools = new Map<string, PoolEntry>();

/**
 * 获取或创建指定名称的连接池（单例模式）。
 *
 * @param name - 服务名称，用于区分不同服务的连接池
 * @param opts  - 连接池配置覆盖项
 */
export async function getPool(
  name: string,
  opts?: { max?: number; connectionString?: string }
): Promise<Pool | null> {
  const existing = pools.get(name);
  if (existing) return existing.pool;

  const dbUrl = opts?.connectionString || process.env.DATABASE_URL;
  if (!dbUrl) return null;

  try {
    const { Pool: PgPool } = await import('pg');
    const max = opts?.max || 4;

    const pool = new PgPool({
      connectionString: dbUrl,
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    await pool.query('SELECT 1');

    pools.set(name, { pool, max, createdAt: Date.now() });

    return pool;
  } catch {
    return null;
  }
}

/**
 * 关闭所有连接池。
 */
export async function closeAllPools(): Promise<void> {
  for (const [name, entry] of pools) {
    try {
      await entry.pool.end();
    } catch {
      // ignore
    }
  }
  pools.clear();
}

/**
 * 获取连接池统计信息。
 */
export function getPoolsStats(): Array<{ name: string; max: number; age: number }> {
  const now = Date.now();
  const stats: Array<{ name: string; max: number; age: number }> = [];
  for (const [name, entry] of pools) {
    stats.push({
      name,
      max: entry.max,
      age: Math.round((now - entry.createdAt) / 1000)
    });
  }
  return stats;
}