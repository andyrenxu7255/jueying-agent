import { eq, and, or, ilike, desc, ne, sql } from 'drizzle-orm'
import { skills, skillVersions } from '@agent-harness/shared'
import { db } from '../db'

export interface SkillRecord {
  id: string
  skill_name: string
  description: string
  skill_type: string
  scope_type: string
  status: string
  version: number
  definition_json: Record<string, unknown>
}

export class SkillRepository {
  async searchSkills(ownerUserId: string, query?: string): Promise<SkillRecord[]> {
    if (!db) return []

    const conditions = [ne(skills.status, 'deleted')]

    if (query) {
      conditions.push(
        or(
          ilike(skills.skillName, `%${query}%`),
          ilike(skills.description, `%${query}%`),
        )!
      )
    }

    const results = await db
      .select({
        id: skills.id,
        skill_name: skills.skillName,
        description: skills.description,
        skill_type: skills.skillType,
        scope_type: skills.scopeType,
        status: skills.status,
        version: sql<number>`COALESCE(sv.version, 1)`.mapWith(Number),
        definition_json: sql<Record<string, unknown>>`COALESCE(sv.definition_json, '{}'::jsonb)`.mapWith(value => {
          if (typeof value === 'string') return JSON.parse(value)
          return (value as Record<string, unknown>) || {}
        }),
      })
      .from(skills)
      .leftJoin(
        sql`LATERAL (
          SELECT version, definition_json FROM skill_version
          WHERE skill_id = skill.id
          ORDER BY version DESC LIMIT 1
        ) sv`,
        sql`true`
      )
      .where(and(...conditions))
      .orderBy(skills.skillName)
      .limit(20)

    return results.map(row => ({
      id: row.id,
      skill_name: row.skill_name,
      description: row.description ?? '',
      skill_type: row.skill_type,
      scope_type: row.scope_type,
      status: row.status,
      version: row.version || 1,
      definition_json: row.definition_json || {},
    }))
  }

  async getSkillById(skillId: string): Promise<SkillRecord | null> {
    if (!db) return null

    const results = await db
      .select({
        id: skills.id,
        skill_name: skills.skillName,
        description: skills.description,
        skill_type: skills.skillType,
        scope_type: skills.scopeType,
        status: skills.status,
        version: sql<number>`COALESCE(sv.version, 1)`.mapWith(Number),
        definition_json: sql<Record<string, unknown>>`COALESCE(sv.definition_json, '{}'::jsonb)`.mapWith(value => {
          if (typeof value === 'string') return JSON.parse(value)
          return (value as Record<string, unknown>) || {}
        }),
      })
      .from(skills)
      .leftJoin(
        sql`LATERAL (
          SELECT version, definition_json FROM skill_version
          WHERE skill_id = skill.id
          ORDER BY version DESC LIMIT 1
        ) sv`,
        sql`true`
      )
      .where(and(eq(skills.id, skillId), ne(skills.status, 'deleted')))
      .limit(1)

    if (results.length === 0) return null

    const row = results[0]
    return {
      id: row.id,
      skill_name: row.skill_name,
      description: row.description ?? '',
      skill_type: row.skill_type,
      scope_type: row.scope_type,
      status: row.status,
      version: row.version || 1,
      definition_json: row.definition_json || {},
    }
  }
}