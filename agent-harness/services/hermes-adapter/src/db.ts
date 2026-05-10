import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { hermesMemories } from '@agent-harness/shared';
import { configManager, getDatabaseSslConfig, getPool } from '@agent-harness/shared';

const schema = { hermesMemories };

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export async function initDb(): Promise<ReturnType<typeof drizzle> | null> {
  if (_db !== null) return _db;
  _pool = await getPool('hermes-adapter', { max: Number(process.env.DB_POOL_MAX || 5) });
  if (!_pool) return null;
  _db = drizzle(_pool, { schema });
  return _db;
}

export async function closeDbPool(): Promise<void> {
  if (_pool) { await _pool.end(); }
  _pool = null;
  _db = null;
}
