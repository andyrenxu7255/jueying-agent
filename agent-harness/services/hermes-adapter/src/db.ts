import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hermesMemories } from '@agent-harness/shared';
import { configManager, getDatabaseSslConfig } from '@agent-harness/shared';

const schema = { hermesMemories };

const databaseUrl = process.env.DATABASE_URL || configManager.getPath<string>('database.url');

export const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_MAX || 5),
  ssl: getDatabaseSslConfig(configManager.get())
}) : null;

export const db = pool ? drizzle(pool, { schema }) : null;

export async function closeDbPool(): Promise<void> {
  if (pool) await pool.end();
}
