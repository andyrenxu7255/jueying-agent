import type { Pool } from 'pg';

interface PoolEntry {
  pool: Pool;
  createdAt: number;
}

const pools = new Map<string, PoolEntry>();

export async function getPool(name: string, opts?: { max?: number }): Promise<Pool | null> {
  const existing = pools.get(name);
  if (existing) return existing.pool;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;

  try {
    const { Pool: PgPool } = await import('pg');
    const max = opts?.max ?? 4;

    const pool = new PgPool({
      connectionString: dbUrl,
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    await pool.query('SELECT 1');

    pools.set(name, { pool, createdAt: Date.now() });
    return pool;
  } catch {
    return null;
  }
}

export async function closeAllPools(): Promise<void> {
  for (const [, entry] of pools) {
    try { await entry.pool.end(); } catch { /* ignore */ }
  }
  pools.clear();
}