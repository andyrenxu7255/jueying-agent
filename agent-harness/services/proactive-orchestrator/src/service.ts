import type { Pool } from 'pg';
import { createLogger } from '@agent-harness/shared';
import {
  buildEvidenceHash,
  buildInsightText,
  buildMissionDraft,
  clampNumber,
  proactiveInsightReviewSchema,
  proactiveMissionDispatchSchema,
  proactiveRuleInputSchema,
  type EvidenceRef,
  type InsightDraft,
  type RuleSnapshot,
  type SignalSnapshot,
  type ProactiveInsightStatus,
  type ProactiveRuleStatus,
  safeArray,
  safeRecord,
} from './domain';

const logger = createLogger('proactive-orchestrator');

export interface ProactiveDashboard {
  summary: Record<string, number>;
  rules: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  insights: Array<Record<string, unknown>>;
  missions: Array<Record<string, unknown>>;
  reports: Array<Record<string, unknown>>;
  refreshed_at: string;
}

export interface ScanOutcome {
  run: Record<string, unknown>;
  insights: Array<Record<string, unknown>>;
  report: Record<string, unknown> | null;
}

export interface ServiceDependencies {
  factRetrievalUrl: string;
  hermesUrl: string;
  gatewayUrl: string;
  internalToken: string;
  ownerUserId: string;
  timeoutMs: number;
}

interface QueryResultRow {
  [key: string]: unknown;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function fromJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeRuleRow(row: QueryResultRow): RuleSnapshot {
  return {
    id: String(row.id),
    org_id: row.org_id ? String(row.org_id) : null,
    created_by: String(row.created_by),
    rule_name: String(row.rule_name || ''),
    description: String(row.description || ''),
    status: String(row.status || 'active') as ProactiveRuleStatus,
    schedule_expression: String(row.schedule_expression || ''),
    trigger_source: String(row.trigger_source || 'hybrid'),
    target_scope: String(row.target_scope || 'org'),
    approval_mode: String(row.approval_mode || 'review_first'),
    scan_window_hours: Number(row.scan_window_hours || 72),
    priority: Number(row.priority || 50),
    evidence_policy: fromJson<Record<string, unknown>>(row.evidence_policy, {}),
    routing_policy: fromJson<Record<string, unknown>>(row.routing_policy, {}),
    metadata: fromJson<Record<string, unknown>>(row.metadata, {}),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function normalizeRow(row: QueryResultRow): Record<string, unknown> {
  return { ...row };
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, status: 0, body: { ok: false, error: 'timeout' } };
    }
    logger.warn('http.get_failed', 'Failed to call external service', { url, error: String(error) });
    return { ok: false, status: 0, body: { ok: false, error: 'service_unavailable' } };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url: string, body: Record<string, unknown>, headers: Record<string, string>, timeoutMs: number): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, status: 0, body: { ok: false, error: 'timeout' } };
    }
    logger.warn('http.post_failed', 'Failed to call external service', { url, error: String(error) });
    return { ok: false, status: 0, body: { ok: false, error: 'service_unavailable' } };
  } finally {
    clearTimeout(timer);
  }
}

export class ProactiveOrchestratorService {
  private readonly pool: Pool | null;
  private readonly deps: ServiceDependencies;
  private scanInFlight = false;

  constructor(pool: Pool | null, deps: ServiceDependencies) {
    this.pool = pool;
    this.deps = deps;
  }

  private headers(): Record<string, string> {
    return this.deps.internalToken ? { 'x-internal-token': this.deps.internalToken } : {};
  }

  private async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) return [];
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  private async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(sql, params);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async listRules(orgId?: string | null): Promise<RuleSnapshot[]> {
    const rows = await this.query(
      `SELECT * FROM proactive_rule
        WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
        ORDER BY priority DESC, created_at DESC`,
      [orgId || null]
    );
    return rows.map(normalizeRuleRow);
  }

  async getRule(ruleId: string): Promise<RuleSnapshot | null> {
    const rows = await this.query(`SELECT * FROM proactive_rule WHERE id = $1 LIMIT 1`, [ruleId]);
    return rows[0] ? normalizeRuleRow(rows[0]) : null;
  }

  async createRule(input: unknown): Promise<RuleSnapshot> {
    const data = proactiveRuleInputSchema.parse(input);
    const result = await this.pool?.query<QueryResultRow>(
      `INSERT INTO proactive_rule (
         org_id, created_by, rule_name, description, status, schedule_expression,
         trigger_source, target_scope, approval_mode, scan_window_hours, priority,
         evidence_policy, routing_policy, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb)
       RETURNING *`,
      [
        data.org_id || null,
        data.created_by,
        data.rule_name,
        data.description,
        data.status,
        data.schedule_expression,
        data.trigger_source,
        data.target_scope,
        data.approval_mode,
        data.scan_window_hours,
        data.priority,
        json(data.evidence_policy),
        json(data.routing_policy),
        json(data.metadata),
      ]
    );
    if (!result || result.rows.length === 0) throw new Error('database_unavailable');
    return normalizeRuleRow(result.rows[0]);
  }

  async updateRule(ruleId: string, patch: unknown): Promise<RuleSnapshot | null> {
    const current = await this.getRule(ruleId);
    if (!current) return null;
    const data = proactiveRuleInputSchema.partial().parse(patch);
    const next = {
      ...current,
      ...data,
      evidence_policy: data.evidence_policy ? { ...current.evidence_policy, ...data.evidence_policy } : current.evidence_policy,
      routing_policy: data.routing_policy ? { ...current.routing_policy, ...data.routing_policy } : current.routing_policy,
      metadata: data.metadata ? { ...current.metadata, ...data.metadata } : current.metadata,
    };
    const result = await this.pool?.query<QueryResultRow>(
      `UPDATE proactive_rule
          SET org_id = $2,
              rule_name = $3,
              description = $4,
              status = $5,
              schedule_expression = $6,
              trigger_source = $7,
              target_scope = $8,
              approval_mode = $9,
              scan_window_hours = $10,
              priority = $11,
              evidence_policy = $12::jsonb,
              routing_policy = $13::jsonb,
              metadata = $14::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        ruleId,
        next.org_id,
        next.rule_name,
        next.description,
        next.status,
        next.schedule_expression,
        next.trigger_source,
        next.target_scope,
        next.approval_mode,
        next.scan_window_hours,
        next.priority,
        json(next.evidence_policy),
        json(next.routing_policy),
        json(next.metadata),
      ]
    );
    return result && result.rows[0] ? normalizeRuleRow(result.rows[0]) : null;
  }

  async archiveRule(ruleId: string): Promise<RuleSnapshot | null> {
    return this.updateRule(ruleId, { status: 'archived' });
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    const result = await this.pool?.query(`DELETE FROM proactive_rule WHERE id = $1 RETURNING id`, [ruleId]);
    return Boolean(result && result.rows.length > 0);
  }

  async getDashboard(orgId?: string | null): Promise<ProactiveDashboard> {
    await this.syncDerivedState(orgId || null);
    const [rules, runs, insights, missions, reports] = await Promise.all([
      this.query(`SELECT * FROM proactive_rule WHERE ($1::uuid IS NULL OR org_id = $1::uuid) ORDER BY priority DESC, created_at DESC LIMIT 50`, [orgId || null]),
      this.query(`SELECT * FROM proactive_run WHERE ($1::uuid IS NULL OR org_id = $1::uuid) ORDER BY created_at DESC LIMIT 20`, [orgId || null]),
      this.query(`SELECT * FROM proactive_insight WHERE ($1::uuid IS NULL OR org_id = $1::uuid) ORDER BY created_at DESC LIMIT 30`, [orgId || null]),
      this.query(`SELECT * FROM proactive_mission WHERE ($1::uuid IS NULL OR org_id = $1::uuid) ORDER BY created_at DESC LIMIT 30`, [orgId || null]),
      this.query(`SELECT * FROM proactive_report WHERE ($1::uuid IS NULL OR org_id = $1::uuid) ORDER BY created_at DESC LIMIT 20`, [orgId || null]),
    ]);

    const summaryRows = await Promise.all([
      this.query(`SELECT count(*)::int AS count FROM proactive_rule WHERE ($1::uuid IS NULL OR org_id = $1::uuid) AND status = 'active'`, [orgId || null]),
      this.query(`SELECT count(*)::int AS count FROM proactive_run WHERE ($1::uuid IS NULL OR org_id = $1::uuid)`, [orgId || null]),
      this.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE ($1::uuid IS NULL OR org_id = $1::uuid) AND review_status = 'pending'`, [orgId || null]),
      this.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE ($1::uuid IS NULL OR org_id = $1::uuid) AND review_status IN ('approved', 'auto_approved')`, [orgId || null]),
      this.query(`SELECT count(*)::int AS count FROM proactive_mission WHERE ($1::uuid IS NULL OR org_id = $1::uuid) AND status IN ('queued', 'assigned', 'submitted')`, [orgId || null]),
      this.query(`SELECT count(*)::int AS count FROM proactive_mission WHERE ($1::uuid IS NULL OR org_id = $1::uuid) AND status IN ('done', 'verified')`, [orgId || null]),
      this.query(`SELECT count(*)::int AS count FROM proactive_report WHERE ($1::uuid IS NULL OR org_id = $1::uuid) AND status = 'published'`, [orgId || null]),
    ]);

    const summary = {
      active_rules: Number(summaryRows[0][0]?.count || 0),
      total_runs: Number(summaryRows[1][0]?.count || 0),
      pending_insights: Number(summaryRows[2][0]?.count || 0),
      approved_insights: Number(summaryRows[3][0]?.count || 0),
      open_missions: Number(summaryRows[4][0]?.count || 0),
      completed_missions: Number(summaryRows[5][0]?.count || 0),
      published_reports: Number(summaryRows[6][0]?.count || 0),
    };

    return {
      summary,
      rules: rules.map(normalizeRow),
      runs: runs.map(normalizeRow),
      insights: insights.map(normalizeRow),
      missions: missions.map(normalizeRow),
      reports: reports.map(normalizeRow),
      refreshed_at: new Date().toISOString(),
    };
  }

  async startRun(input: { rule_id?: string; org_id?: string; triggered_by?: string; dry_run?: boolean }): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = [];
    const targetRule = input.rule_id ? await this.getRule(input.rule_id) : null;
    const rules = input.rule_id ? (targetRule ? [targetRule] : []) : await this.listRules(input.org_id || null);
    for (const rule of rules) {
      if (!rule || rule.status !== 'active') continue;
      const outcome = await this.scanRule(rule, input.triggered_by || rule.created_by, Boolean(input.dry_run));
      results.push(outcome);
    }
    return results;
  }

  async scanRule(rule: RuleSnapshot, triggeredBy: string, dryRun = false): Promise<Record<string, unknown>> {
    const startedAt = new Date();
    const runRow = await this.pool?.query<QueryResultRow>(
      `INSERT INTO proactive_run (
         rule_id, org_id, status, started_at, metadata, run_summary
       )
       VALUES ($1,$2,'running',now(),$3::jsonb,$4::jsonb)
       RETURNING *`,
      [
        rule.id,
        rule.org_id,
        json({ triggered_by: triggeredBy, scan_window_hours: rule.scan_window_hours, dry_run: dryRun, rule_status: rule.status }),
        json({ stage: 'scan_started' }),
      ]
    );
    if (!runRow || runRow.rows.length === 0) throw new Error('database_unavailable');
    const run = runRow.rows[0];

    const signals = await this.collectSignals(rule);
    const insights = buildInsightText(rule, signals);
    const storedInsights: Array<Record<string, unknown>> = [];
    for (const insight of insights) {
      const reviewStatus: ProactiveInsightStatus = rule.approval_mode === 'auto_when_safe' && insight.confidence >= this.minConfidence(rule)
        ? 'auto_approved'
        : 'pending';
      const evidenceHash = buildEvidenceHash(insight.evidence_refs);
      const duplicateRows = await this.query(
        `SELECT * FROM proactive_insight
          WHERE rule_id = $1
            AND insight_type = $2
            AND evidence_pack_hash = $3
            AND review_status IN ('pending', 'approved', 'auto_approved')
          ORDER BY updated_at DESC
          LIMIT 1`,
        [rule.id, insight.insight_type, evidenceHash]
      );
      if (duplicateRows[0]) {
        const updatedDuplicate = await this.pool?.query<QueryResultRow>(
          `UPDATE proactive_insight
              SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                  updated_at = now()
            WHERE id = $1
            RETURNING *`,
          [
            duplicateRows[0].id,
            json({
              last_seen_run_id: run.id,
              last_seen_at: new Date().toISOString(),
              duplicate_scan: true,
            }),
          ]
        );
        storedInsights.push(normalizeRow(updatedDuplicate?.rows[0] || duplicateRows[0]));
        continue;
      }
      const inserted = await this.pool?.query<QueryResultRow>(
        `INSERT INTO proactive_insight (
           run_id, rule_id, org_id, insight_title, insight_summary, insight_type,
           confidence, evidence_pack_hash, evidence_refs, review_status, metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)
         RETURNING *`,
        [
          run.id,
          rule.id,
          rule.org_id,
          insight.insight_title,
          insight.insight_summary,
          insight.insight_type,
          insight.confidence,
          evidenceHash,
          json(insight.evidence_refs),
          reviewStatus,
          json({ ...insight.metadata, review_status: reviewStatus, triggered_by: triggeredBy }),
        ]
      );
      if (inserted && inserted.rows[0]) storedInsights.push(normalizeRow(inserted.rows[0]));
    }

    await this.refreshRunSummary(String(run.id));
    const report = await this.upsertReport(String(run.id), {
      run_status: 'reviewing',
      triggered_by: triggeredBy,
      signals,
      insights: storedInsights,
      generated_at: startedAt.toISOString(),
      dry_run: dryRun,
    });
    await this.exec(`UPDATE proactive_run SET status = 'reviewing', updated_at = now() WHERE id = $1`, [run.id]);
    return {
      ok: true,
      run: normalizeRow({ ...run, status: 'reviewing' }),
      insights: storedInsights,
      report,
    };
  }

  private minConfidence(rule: RuleSnapshot): number {
    return Number(rule.evidence_policy.min_confidence || 0.72);
  }

  async collectSignals(rule: RuleSnapshot): Promise<SignalSnapshot> {
    const windowHours = clampNumber(rule.scan_window_hours, 1, 8760, 72);
    const windowClause = `created_at >= now() - ($1::int || ' hours')::interval`;
    const orgParam = rule.org_id || null;

    const [documents, facts, memories, skills, tasks, assignments] = await Promise.all([
      this.query(`SELECT id, title, source_uri, status, metadata, created_at, source_kind, owner_user_id, org_id, content_hash
                    FROM document
                   WHERE ($2::uuid IS NULL OR org_id = $2::uuid) AND ${windowClause}
                   ORDER BY created_at DESC LIMIT 50`, [windowHours, orgParam]),
      this.query(`SELECT id, subject_ref, predicate, object_value, status, confidence, metadata, created_at, org_id
                    FROM fact
                   WHERE ($2::uuid IS NULL OR org_id = $2::uuid) AND ${windowClause}
                   ORDER BY created_at DESC LIMIT 100`, [windowHours, orgParam]),
      this.query(`SELECT id, title, summary, category, status, confidence, relevance_score, metadata, created_at
                    FROM org_memory_summary
                   WHERE ($2::uuid IS NULL OR org_id = $2::uuid) AND ${windowClause}
                   ORDER BY created_at DESC LIMIT 30`, [windowHours, orgParam]),
      this.query(`SELECT id, skill_name, description, skill_type, status, metadata, created_at
                    FROM skill
                   WHERE ($2::uuid IS NULL OR org_id = $2::uuid) AND ${windowClause} AND status != 'deleted'
                   ORDER BY created_at DESC LIMIT 50`, [windowHours, orgParam]),
      this.query(`SELECT id, title, description, task_type, schedule_type, status, prompt_message, metadata, created_at
                    FROM org_task
                   WHERE ($2::uuid IS NULL OR org_id = $2::uuid) AND ${windowClause}
                   ORDER BY created_at DESC LIMIT 50`, [windowHours, orgParam]),
      this.query(`SELECT a.id, a.task_id, a.user_id, a.org_id, a.status, a.response_data, a.feedback_summary, a.evidence_refs, a.metadata, a.created_at, t.title, t.description, t.prompt_message
                    FROM org_task_assignment a
                    JOIN org_task t ON t.id = a.task_id
                   WHERE ($2::uuid IS NULL OR a.org_id = $2::uuid)
                     AND a.created_at >= now() - ($1::int || ' hours')::interval
                   ORDER BY a.created_at DESC LIMIT 100`, [windowHours, orgParam]),
    ]);

    let retrievalItems: Array<Record<string, unknown>> = [];
    try {
      const retrieval = await postJson(
        `${this.deps.factRetrievalUrl.replace(/\/$/, '')}/internal/retrieval/query`,
        {
          owner_user_id: this.deps.ownerUserId,
          org_id: rule.org_id || undefined,
          query_text: `${rule.rule_name} ${rule.description}`.trim(),
          intent_type: 'similar-case',
          allowed_scopes: ['public:workflow', 'public:skill', `private:${this.deps.ownerUserId}`],
        },
        { 'x-internal-token': this.deps.internalToken },
        this.deps.timeoutMs
      );
      if (retrieval.ok && retrieval.body && typeof retrieval.body === 'object') {
        const body = retrieval.body as Record<string, unknown>;
        const evidencePack = safeRecord(body.evidence_pack);
        retrievalItems = safeArray(evidencePack.items);
      }
    } catch (error) {
      logger.warn('retrieval.query_failed', 'Failed to query fact retrieval for proactive scan', { error: String(error) });
    }

    const memorySummary = await this.loadMemorySummary(rule.org_id || null);

    return {
      documents: documents.map(normalizeRow),
      facts: facts.map(normalizeRow),
      memories: memories.map(normalizeRow),
      skills: skills.map(normalizeRow),
      tasks: tasks.map(normalizeRow),
      assignments: assignments.map(normalizeRow),
      retrieval_items: retrievalItems,
      memory_summary: memorySummary,
    };
  }

  private async loadMemorySummary(orgId: string | null): Promise<Array<Record<string, unknown>>> {
    try {
      const result = await getJson(
        `${this.deps.hermesUrl.replace(/\/$/, '')}/internal/memory/summary?org_id=${encodeURIComponent(orgId || '')}`,
        this.headers(),
        this.deps.timeoutMs
      );
      if (result.ok && result.body && typeof result.body === 'object') {
        const body = result.body as Record<string, unknown>;
        if (Array.isArray(body.summaries)) {
          return body.summaries.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
        }
      }
    } catch {
      /* fall back to DB */
    }
    const rows = await this.query(`SELECT id, title, summary, category, confidence, relevance_score, metadata, created_at
                                     FROM org_memory_summary
                                    WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
                                    ORDER BY created_at DESC LIMIT 20`, [orgId]);
    return rows.map(normalizeRow);
  }

  async reviewInsight(insightId: string, payload: unknown): Promise<Record<string, unknown> | null> {
    const action = proactiveInsightReviewSchema.parse(payload);
    const currentRows = await this.query(`SELECT * FROM proactive_insight WHERE id = $1 LIMIT 1`, [insightId]);
    const current = currentRows[0];
    if (!current) return null;
    const reviewStatus = action.action === 'approve' ? 'approved' : 'rejected';
    const updated = await this.pool?.query<QueryResultRow>(
      `UPDATE proactive_insight
          SET review_status = $2,
              review_note = $3,
              reviewer_id = $4,
              reviewed_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [insightId, reviewStatus, action.review_note || '', action.reviewer_id || null]
    );
    if (!updated || updated.rows.length === 0) return null;
    const insight = normalizeRow(updated.rows[0]);
    if (reviewStatus === 'approved') {
      await this.createMissionFromInsight(insight, action.reviewer_id || null);
    }
    await this.refreshRunSummary(String(current.run_id));
    return insight;
  }

  async listInsights(orgId?: string | null, reviewStatus?: string | null): Promise<Array<Record<string, unknown>>> {
    const rows = await this.query(
      `SELECT * FROM proactive_insight
        WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
          AND ($2::text IS NULL OR review_status = $2::text)
       ORDER BY created_at DESC`,
      [orgId || null, reviewStatus || null]
    );
    return rows.map(normalizeRow);
  }

  async listMissions(orgId?: string | null, status?: string | null): Promise<Array<Record<string, unknown>>> {
    const rows = await this.query(
      `SELECT * FROM proactive_mission
        WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
          AND ($2::text IS NULL OR status = $2::text)
       ORDER BY created_at DESC`,
      [orgId || null, status || null]
    );
    return rows.map(normalizeRow);
  }

  async dispatchMission(missionId: string, payload: unknown): Promise<Record<string, unknown> | null> {
    const dispatch = proactiveMissionDispatchSchema.parse(payload);
    const currentRows = await this.query(`SELECT * FROM proactive_mission WHERE id = $1 LIMIT 1`, [missionId]);
    const mission = currentRows[0];
    if (!mission) return null;
    if (!dispatch.force && !['draft', 'queued'].includes(String(mission.status))) {
      return normalizeRow(mission);
    }
    const insightRows = await this.query(`SELECT * FROM proactive_insight WHERE id = $1 LIMIT 1`, [String(mission.insight_id)]);
    const insight = insightRows[0];
    if (!insight) return null;
    const ruleRows = await this.query(`SELECT * FROM proactive_rule WHERE id = $1 LIMIT 1`, [String(insight.rule_id)]);
    const rule = ruleRows[0] ? normalizeRuleRow(ruleRows[0]) : null;
    if (!rule) return null;

    const orgId = mission.org_id ? String(mission.org_id) : null;
    const targetUserId = dispatch.target_user_id || (await this.pickTargetUserId(orgId, String(rule.created_by), String(mission.mission_type)));
    const task = await this.createOrgTaskForMission(normalizeRow(mission), normalizeRow(insight), rule, targetUserId);

    const updatedMission = await this.pool?.query<QueryResultRow>(
      `UPDATE proactive_mission
          SET status = 'assigned',
              target_user_id = $2,
              workflow_ref = $3,
              assignment_ref = $4,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [missionId, targetUserId, String(task.task_id), String(task.assignment_id)]
    );
    await this.refreshRunSummary(String(mission.run_id));
    if (updatedMission && updatedMission.rows[0]) {
      return normalizeRow(updatedMission.rows[0]);
    }
    return normalizeRow(mission);
  }

  async completeMissionByAssignment(assignmentId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.query(
      `SELECT m.*, a.status AS assignment_status, a.response_data, a.feedback_summary, a.evidence_refs
         FROM proactive_mission m
         JOIN org_task_assignment a ON a.id = m.assignment_ref
        WHERE a.id = $1
        LIMIT 1`,
      [assignmentId]
    );
    const row = rows[0];
    if (!row) return null;
    if (String(row.assignment_status) !== 'completed') return normalizeRow(row);
    const updated = await this.pool?.query<QueryResultRow>(
      `UPDATE proactive_mission
          SET status = 'done',
              metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{completion}', $2::jsonb, true),
              updated_at = now()
        WHERE assignment_ref = $1
        RETURNING *`,
      [assignmentId, json({
        completed_at: new Date().toISOString(),
        feedback_summary: row.feedback_summary || '',
        evidence_refs: row.evidence_refs || [],
      })]
    );
    await this.refreshRunSummary(String(row.run_id));
    if (!updated || !updated.rows[0]) return normalizeRow(row);
    return normalizeRow(updated.rows[0]);
  }

  async listRuns(orgId?: string | null): Promise<Array<Record<string, unknown>>> {
    const rows = await this.query(
      `SELECT * FROM proactive_run
        WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
       ORDER BY created_at DESC`,
      [orgId || null]
    );
    return rows.map(normalizeRow);
  }

  async listReports(orgId?: string | null): Promise<Array<Record<string, unknown>>> {
    const rows = await this.query(
      `SELECT * FROM proactive_report
        WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
       ORDER BY created_at DESC`,
      [orgId || null]
    );
    return rows.map(normalizeRow);
  }

  async publishReport(reportId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool?.query<QueryResultRow>(
      `UPDATE proactive_report
          SET status = 'published',
              published_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [reportId]
    );
    return result && result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }

  async startScheduledScan(): Promise<Array<Record<string, unknown>>> {
    if (this.scanInFlight) {
      return [];
    }
    this.scanInFlight = true;
    try {
      const rules = await this.listRules(null);
      const outputs: Array<Record<string, unknown>> = [];
      for (const rule of rules.filter((item) => item.status === 'active')) {
        try {
          outputs.push(await this.scanRule(rule, rule.created_by, false));
        } catch (error) {
          logger.warn('scan.rule_failed', 'Scheduled scan failed for rule', { rule_id: rule.id, error: String(error) });
          await this.failRunForRule(rule.id, String(error));
        }
      }
      return outputs;
    } finally {
      this.scanInFlight = false;
    }
  }

  async syncDerivedState(orgId?: string | null): Promise<void> {
    if (!this.pool) return;
    const pendingMissions = await this.query(
      `SELECT m.id, m.run_id, m.assignment_ref, a.status AS assignment_status, a.response_data, a.feedback_summary, a.evidence_refs
         FROM proactive_mission m
         LEFT JOIN org_task_assignment a ON a.id = m.assignment_ref
        WHERE ($1::uuid IS NULL OR m.org_id = $1::uuid)
          AND m.status IN ('assigned', 'submitted', 'verified')
        ORDER BY m.updated_at DESC`,
      [orgId || null]
    );
    for (const row of pendingMissions) {
      const assignmentStatus = String(row.assignment_status || '');
      if (assignmentStatus === 'completed') {
        await this.pool.query(
          `UPDATE proactive_mission
              SET status = 'done',
                  metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{completion}', $2::jsonb, true),
                  updated_at = now()
            WHERE id = $1`,
          [row.id, json({ completed_at: new Date().toISOString(), feedback_summary: row.feedback_summary || '', evidence_refs: row.evidence_refs || [] })]
        );
      } else if (assignmentStatus === 'submitted') {
        await this.pool.query(`UPDATE proactive_mission SET status = 'submitted', updated_at = now() WHERE id = $1`, [row.id]);
      }
    }
    const runs = await this.query(`SELECT id FROM proactive_run WHERE ($1::uuid IS NULL OR org_id = $1::uuid) AND status IN ('running', 'reviewing', 'dispatched')`, [orgId || null]);
    for (const run of runs) {
      await this.refreshRunSummary(String(run.id));
    }
  }

  private async refreshRunSummary(runId: string): Promise<void> {
    if (!this.pool) return;
    const [insights, missions, assignments, approved, rejected, pending] = await Promise.all([
      this.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE run_id = $1`, [runId]),
      this.query(`SELECT count(*)::int AS count FROM proactive_mission WHERE run_id = $1`, [runId]),
      this.query(`SELECT count(*)::int AS count FROM proactive_mission WHERE run_id = $1 AND status IN ('assigned', 'submitted', 'verified', 'done')`, [runId]),
      this.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE run_id = $1 AND review_status IN ('approved', 'auto_approved')`, [runId]),
      this.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE run_id = $1 AND review_status = 'rejected'`, [runId]),
      this.query(`SELECT count(*)::int AS count FROM proactive_insight WHERE run_id = $1 AND review_status = 'pending'`, [runId]),
    ]);
    const row = await this.query(`SELECT * FROM proactive_run WHERE id = $1 LIMIT 1`, [runId]);
    const current = row[0];
    const completedMissions = await this.query(`SELECT count(*)::int AS count FROM proactive_mission WHERE run_id = $1 AND status IN ('done', 'verified')`, [runId]);
    const pendingCount = Number(pending[0]?.count || 0);
    const approvedCount = Number(approved[0]?.count || 0);
    const missionCount = Number(missions[0]?.count || 0);
    const completedMissionCount = Number(completedMissions[0]?.count || 0);
    const finished = pendingCount === 0 && approvedCount > 0 && completedMissionCount >= missionCount && missionCount > 0;
    await this.pool.query(
      `UPDATE proactive_run
          SET generated_insights = $2,
              generated_missions = $3,
              dispatched_assignments = $4,
              status = CASE WHEN $6::boolean THEN 'completed' ELSE CASE WHEN $7::int > 0 THEN 'reviewing' ELSE status END END,
              finished_at = CASE WHEN $6::boolean THEN now() ELSE finished_at END,
              run_summary = $5::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [
        runId,
        Number(insights[0]?.count || 0),
        Number(missions[0]?.count || 0),
        Number(assignments[0]?.count || 0),
        json({
          run_id: runId,
          total_insights: Number(insights[0]?.count || 0),
          pending_insights: Number(pending[0]?.count || 0),
          approved_insights: Number(approved[0]?.count || 0),
          rejected_insights: Number(rejected[0]?.count || 0),
          total_missions: missionCount,
          dispatched_assignments: Number(assignments[0]?.count || 0),
          completed_missions: completedMissionCount,
          completed: finished,
        }),
        finished,
        pendingCount,
      ]
    );
    if (current && finished) {
      await this.upsertReport(runId, {
        finalized: true,
        completed_at: new Date().toISOString(),
      });
    }
  }

  private async failRunForRule(ruleId: string, errorMessage: string): Promise<void> {
    await this.exec(
      `UPDATE proactive_run
          SET status = 'failed',
              error_message = $2,
              finished_at = now(),
              updated_at = now()
        WHERE rule_id = $1 AND status IN ('running', 'reviewing')`,
      [ruleId, errorMessage.slice(0, 1000)]
    );
  }

  private async createMissionFromInsight(insight: Record<string, unknown>, reviewerId: string | null): Promise<Record<string, unknown> | null> {
    if (!this.pool) return null;
    const ruleRows = await this.query(`SELECT * FROM proactive_rule WHERE id = $1 LIMIT 1`, [String(insight.rule_id)]);
    const rule = ruleRows[0] ? normalizeRuleRow(ruleRows[0]) : null;
    if (!rule) return null;
    const targetUserId = await this.pickTargetUserId(rule.org_id, rule.created_by, String(insight.insight_type || 'other'));
    const missionDraft = buildMissionDraft(rule, {
      insight_title: String(insight.insight_title || 'Mission'),
      insight_summary: String(insight.insight_summary || ''),
      insight_type: String(insight.insight_type || 'other'),
      confidence: Number(insight.confidence || 0.7),
      evidence_refs: safeArray(insight.evidence_refs).map((ref) => ({
        source_type: String(ref.source_type || 'document'),
        ref_id: String(ref.ref_id || ref.id || ''),
        title: String(ref.title || 'evidence'),
        summary: String(ref.summary || '').slice(0, 240),
        source_uri: typeof ref.source_uri === 'string' ? ref.source_uri : undefined,
      })).filter((ref) => Boolean(ref.ref_id)),
      metadata: safeRecord(insight.metadata),
    } as InsightDraft, String((safeRecord(rule.routing_policy).escalation_role || 'user')), targetUserId);
    const inserted = await this.pool.query<QueryResultRow>(
      `INSERT INTO proactive_mission (
         run_id, insight_id, org_id, mission_title, mission_summary, mission_type, status,
         priority, target_user_id, evidence_refs, response_schema, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)
       RETURNING *`,
      [
        insight.run_id,
        insight.id,
        rule.org_id,
        missionDraft.mission_title,
        missionDraft.mission_summary,
        missionDraft.mission_type,
        missionDraft.priority,
        targetUserId,
        json(missionDraft.evidence_refs),
        json(missionDraft.response_schema),
        json({ ...missionDraft.metadata, reviewer_id: reviewerId, insight_review_status: insight.review_status || 'pending' }),
      ]
    );
    if (!inserted.rows[0]) return null;
    await this.refreshRunSummary(String(insight.run_id));
    return normalizeRow(inserted.rows[0]);
  }

  private async createOrgTaskForMission(mission: Record<string, unknown>, insight: Record<string, unknown>, rule: RuleSnapshot, targetUserId: string): Promise<{ task_id: string; assignment_id: string }> {
    if (!this.pool) throw new Error('database_unavailable');
    const taskChannels = Array.isArray(safeRecord(rule.routing_policy).preferred_channels)
      ? (safeRecord(rule.routing_policy).preferred_channels as unknown[]).map((item) => String(item)).filter(Boolean)
      : ['wecom', 'feishu'];
    const taskResult = await this.pool.query<QueryResultRow>(
      `INSERT INTO org_task (
         org_id, created_by, title, description, task_type, schedule_type, status,
         prompt_message, target_channels, required_fields, metadata,
         proactive_rule_id, proactive_run_id, proactive_insight_id, proactive_mission_id,
         source_type, review_status, source_summary, evidence_refs, rule_metadata
       )
       VALUES ($1,$2,$3,$4,$5,'once','active',$6,$7::text[],$8::jsonb,$9::jsonb,
               $10,$11,$12,$13,'proactive_orchestrator',$14,$15,$16::jsonb,$17::jsonb)
       RETURNING *`,
      [
        rule.org_id,
        rule.created_by,
        String(mission.mission_title || insight.insight_title || 'Proactive Mission'),
        String(mission.mission_summary || insight.insight_summary || ''),
        'form',
        [
          `主动编排任务: ${String(mission.mission_title || insight.insight_title || '')}`,
          `验证状态: ${String(insight.review_status || 'pending')}`,
          `规则: ${rule.rule_name}`,
          `信心值: ${String(insight.confidence || 0)}`,
          `证据: ${(safeArray(mission.evidence_refs).length || safeArray(insight.evidence_refs).length)}`,
        ].join('\n'),
        taskChannels,
        json(['summary', 'evidence_refs']),
        json({
          source: 'proactive_orchestrator',
          proactive_rule_id: rule.id,
          proactive_run_id: mission.run_id,
          proactive_insight_id: mission.insight_id,
          proactive_mission_id: mission.id,
          proactive_mission_type: mission.mission_type || 'user_task',
          validation_status: insight.review_status || 'pending',
          evidence_pack_hash: insight.evidence_pack_hash || buildEvidenceHash(safeArray(mission.evidence_refs).map((ref) => ({
            source_type: String(ref.source_type || 'document'),
            ref_id: String(ref.ref_id || ''),
            title: String(ref.title || 'evidence'),
            summary: String(ref.summary || ''),
          } as EvidenceRef))),
        }),
        rule.id,
        mission.run_id,
        mission.insight_id,
        mission.id,
        String(insight.review_status || 'pending'),
        String(insight.insight_summary || mission.mission_summary || '').slice(0, 1000),
        json(mission.evidence_refs || insight.evidence_refs || []),
        json({ rule_name: rule.rule_name, routing_policy: rule.routing_policy, evidence_policy: rule.evidence_policy }),
      ]
    );
    const task = taskResult.rows[0];
    if (!task) throw new Error('task_create_failed');
    const assignmentResult = await this.pool.query<QueryResultRow>(
      `INSERT INTO org_task_assignment (
         task_id, user_id, org_id, status, response_data, metadata, proactive_mission_id, proactive_run_id
       )
       VALUES ($1,$2,$3,'pending','{}'::jsonb,$4::jsonb,$5,$6)
       RETURNING *`,
      [
        task.id,
        targetUserId,
        rule.org_id,
        json({
          source: 'proactive_orchestrator',
          proactive_mission_id: mission.id,
          proactive_run_id: mission.run_id,
          proactive_insight_id: mission.insight_id,
        }),
        mission.id,
        mission.run_id,
      ]
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) throw new Error('assignment_create_failed');
    await this.pool.query(
      `UPDATE proactive_mission SET assignment_ref = $2, workflow_ref = $3, status = 'queued', updated_at = now() WHERE id = $1`,
      [mission.id, assignment.id, String(task.id)]
    );
    const notify = await postJson(
      `${this.deps.gatewayUrl.replace(/\/$/, '')}/internal/tasks/notify`,
      { task_id: task.id },
      { 'x-internal-token': this.deps.internalToken },
      this.deps.timeoutMs
    );
    if (!notify.ok) {
      logger.warn('task.notify_failed', 'Failed to notify assignment through gateway', { task_id: task.id, status: notify.status });
    }
    await this.pool.query(`UPDATE proactive_mission SET status = 'assigned', updated_at = now() WHERE id = $1`, [mission.id]);
    return { task_id: String(task.id), assignment_id: String(assignment.id) };
  }

  private async pickTargetUserId(orgId: string | null, fallbackUserId: string, insightType: string): Promise<string> {
    const preferredRole = insightType === 'admin_review' || insightType === 'skill_upgrade' ? 'admin' : 'user';
    const rows = await this.query(
      `SELECT id, role
         FROM "user"
        WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
          AND status = 'active'
        ORDER BY CASE WHEN role = $2 THEN 0 WHEN role = 'admin' THEN 1 ELSE 2 END, created_at ASC
        LIMIT 1`,
      [orgId || null, preferredRole]
    );
    if (rows[0]?.id) return String(rows[0].id);
    const fallbackRows = await this.query(`SELECT id FROM "user" WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`, []);
    if (fallbackRows[0]?.id) return String(fallbackRows[0].id);
    return fallbackUserId;
  }

  private async upsertReport(runId: string, extraMetadata: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const runRows = await this.query(`SELECT * FROM proactive_run WHERE id = $1 LIMIT 1`, [runId]);
    const run = runRows[0];
    if (!run) return null;
    const insights = await this.query(`SELECT * FROM proactive_insight WHERE run_id = $1 ORDER BY created_at DESC`, [runId]);
    const missions = await this.query(`SELECT * FROM proactive_mission WHERE run_id = $1 ORDER BY created_at DESC`, [runId]);
    const summary = {
      run_id: runId,
      rule_id: run.rule_id,
      status: run.status,
      insights: insights.length,
      missions: missions.length,
      approved_insights: insights.filter((item) => ['approved', 'auto_approved'].includes(String(item.review_status))).length,
      pending_insights: insights.filter((item) => String(item.review_status) === 'pending').length,
      assigned_missions: missions.filter((item) => ['assigned', 'submitted', 'verified', 'done'].includes(String(item.status))).length,
      completed_missions: missions.filter((item) => ['done', 'verified'].includes(String(item.status))).length,
      extra: extraMetadata,
    };
    const body = {
      overview: summary,
      insights: insights.slice(0, 12).map(normalizeRow),
      missions: missions.slice(0, 12).map(normalizeRow),
      run: normalizeRow(run),
    };
    const existing = await this.query(`SELECT * FROM proactive_report WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1`, [runId]);
    if (existing[0]) {
      const updated = await this.pool?.query<QueryResultRow>(
        `UPDATE proactive_report
            SET report_title = $2,
                report_summary = $3,
                report_body = $4::jsonb,
                status = CASE WHEN $5 THEN 'published' ELSE status END,
                published_at = CASE WHEN $5 THEN COALESCE(published_at, now()) ELSE published_at END,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          String(existing[0].id),
          `主动编排报告 - ${String(run.rule_id).slice(0, 8)}`,
          `扫描到 ${insights.length} 条洞察，${missions.length} 个任务，${summary.completed_missions} 个已完成。`,
          json(body),
          Boolean(extraMetadata.finalized),
        ]
      );
      return updated && updated.rows[0] ? normalizeRow(updated.rows[0]) : normalizeRow(existing[0]);
    }
    const inserted = await this.pool?.query<QueryResultRow>(
      `INSERT INTO proactive_report (
         run_id, org_id, report_title, report_summary, report_type, status, report_body, metadata
       )
       VALUES ($1,$2,$3,$4,'review','draft',$5::jsonb,$6::jsonb)
       RETURNING *`,
      [
        runId,
        run.org_id || null,
        `主动编排报告 - ${String(run.rule_id).slice(0, 8)}`,
        `扫描到 ${insights.length} 条洞察，${missions.length} 个任务，${summary.completed_missions} 个已完成。`,
        json(body),
        json({ generated_at: new Date().toISOString(), ...extraMetadata }),
      ]
    );
    return inserted && inserted.rows[0] ? normalizeRow(inserted.rows[0]) : null;
  }

  async getById(table: 'run' | 'insight' | 'mission' | 'report', id: string): Promise<Record<string, unknown> | null> {
    const tableMap = {
      run: 'proactive_run',
      insight: 'proactive_insight',
      mission: 'proactive_mission',
      report: 'proactive_report',
    };
    const rows = await this.query(`SELECT * FROM ${tableMap[table]} WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ? normalizeRow(rows[0]) : null;
  }
}
