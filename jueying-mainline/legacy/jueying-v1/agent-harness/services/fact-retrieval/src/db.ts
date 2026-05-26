import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  users, channelIdentities, policySnapshots, workflowDefinitions, workflowInstances,
  workflowStages, checkpoints, workflowEvents, executionSessions, documents,
  documentVersions, documentChunks, entities, relations, facts, factEvidence,
  factConflicts, artifactObjects, retrievalTraces, auditEvents, memoryItems,
  memorySources, memoryUsageLogs, skills, skillVersions, skillSources, projectionEvents,
  userFiles
} from '@agent-harness/shared';
import { configManager, getDatabaseSslConfig } from '@agent-harness/shared';

const schema = {
  users, channelIdentities, policySnapshots, workflowDefinitions, workflowInstances,
  workflowStages, checkpoints, workflowEvents, executionSessions, documents,
  documentVersions, documentChunks, entities, relations, facts, factEvidence,
  factConflicts, artifactObjects, retrievalTraces, auditEvents, memoryItems,
  memorySources, memoryUsageLogs, skills, skillVersions, skillSources, projectionEvents,
  userFiles
};

const databaseUrl = process.env.DATABASE_URL || configManager.getPath<string>('database.url');

if (!databaseUrl) {
  console.warn('[fact-retrieval] DATABASE_URL not set — service will run in degraded mode (no DB persistence)');
}

export const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_MAX || 10),
  ssl: getDatabaseSslConfig(configManager.get())
}) : null;

export const db = pool ? drizzle(pool, { schema }) : null;

export async function closeDbPool(): Promise<void> {
  if (pool) await pool.end();
}
