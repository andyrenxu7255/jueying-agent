import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PROACTIVE_RULE_STATUS = ['active', 'paused', 'archived'] as const;
export const PROACTIVE_RUN_STATUS = ['pending', 'running', 'reviewing', 'dispatched', 'completed', 'failed', 'cancelled'] as const;
export const PROACTIVE_INSIGHT_STATUS = ['pending', 'approved', 'rejected', 'auto_approved'] as const;
export const PROACTIVE_MISSION_STATUS = ['draft', 'queued', 'assigned', 'submitted', 'verified', 'blocked', 'done', 'cancelled'] as const;
export const PROACTIVE_REPORT_STATUS = ['draft', 'published', 'archived'] as const;

export type ProactiveRuleStatus = typeof PROACTIVE_RULE_STATUS[number];
export type ProactiveRunStatus = typeof PROACTIVE_RUN_STATUS[number];
export type ProactiveInsightStatus = typeof PROACTIVE_INSIGHT_STATUS[number];
export type ProactiveMissionStatus = typeof PROACTIVE_MISSION_STATUS[number];
export type ProactiveReportStatus = typeof PROACTIVE_REPORT_STATUS[number];

export const proactiveRuleInputSchema = z.object({
  org_id: z.string().uuid().nullable().optional(),
  created_by: z.string().uuid(),
  rule_name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  status: z.enum(PROACTIVE_RULE_STATUS).default('active'),
  schedule_expression: z.string().min(1).max(120),
  trigger_source: z.enum(['fact', 'memory', 'skill', 'manual', 'hybrid']).default('hybrid'),
  target_scope: z.enum(['user', 'org', 'mixed']).default('org'),
  approval_mode: z.enum(['review_first', 'auto_when_safe', 'manual_only']).default('review_first'),
  scan_window_hours: z.number().int().min(1).max(8760).default(72),
  priority: z.number().int().min(1).max(100).default(50),
  evidence_policy: z.record(z.unknown()).default({}),
  routing_policy: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
});

export const proactiveInsightReviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  review_note: z.string().max(2000).default(''),
  reviewer_id: z.string().uuid().optional(),
});

export const proactiveMissionDispatchSchema = z.object({
  force: z.boolean().default(false),
  target_user_id: z.string().uuid().optional(),
});

export interface EvidenceRef {
  source_type: string;
  ref_id: string;
  title: string;
  summary: string;
  source_uri?: string;
}

export interface RuleSnapshot {
  id: string;
  org_id: string | null;
  created_by: string;
  rule_name: string;
  description: string;
  status: ProactiveRuleStatus;
  schedule_expression: string;
  trigger_source: string;
  target_scope: string;
  approval_mode: string;
  scan_window_hours: number;
  priority: number;
  evidence_policy: Record<string, unknown>;
  routing_policy: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SignalSnapshot {
  documents: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  memories: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  retrieval_items: Array<Record<string, unknown>>;
  memory_summary: Array<Record<string, unknown>>;
}

export interface InsightDraft {
  insight_title: string;
  insight_summary: string;
  insight_type: string;
  confidence: number;
  evidence_refs: EvidenceRef[];
  metadata: Record<string, unknown>;
}

export interface MissionDraft {
  mission_title: string;
  mission_summary: string;
  mission_type: string;
  priority: number;
  evidence_refs: EvidenceRef[];
  response_schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function safeArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}

export function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function inferInsightType(text: string): string {
  const normalized = text.toLowerCase();
  if (/(clawhub|skill|升级|version|版本|changelog|变更)/.test(normalized)) return 'skill_upgrade';
  if (/(follow[- ]?up|跟进|客户|champion|pipeline|deal|商机|机会|business case|roi)/.test(normalized)) return 'customer_followup';
  if (/(gap|missing|lack|不足|空白|缺口|未覆盖|not found)/.test(normalized)) return 'fact_gap';
  if (/(process|流程|协作|堵塞|blocked|延迟|pending|待办)/.test(normalized)) return 'process_issue';
  return 'other';
}

export function buildEvidenceHash(refs: EvidenceRef[]): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(refs)).digest('hex')}`;
}

export function scoreInsight(evidenceCount: number, baseScore = 0.72): number {
  return Math.round(Math.min(0.98, baseScore + evidenceCount * 0.05) * 100) / 100;
}

export function buildMissionType(insightType: string, routingPolicy: Record<string, unknown>): string {
  const explicit = normalizeText(routingPolicy.default_mission_type);
  if (explicit) return explicit;
  switch (insightType) {
    case 'skill_upgrade':
      return 'skill_upgrade';
    case 'fact_gap':
      return 'fact_collection';
    case 'process_issue':
      return 'admin_review';
    case 'customer_followup':
      return 'user_task';
    default:
      return 'other';
  }
}

export function dedupeEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.source_type}:${ref.ref_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export function buildInsightText(rule: RuleSnapshot, signals: SignalSnapshot): InsightDraft[] {
  const insights: InsightDraft[] = [];
  const docText = signals.documents.map((doc) => `${doc.title || ''} ${doc.content_text || doc.summary || ''}`.trim()).join('\n');
  const taskText = signals.assignments.map((assignment) => `${assignment.status || ''} ${JSON.stringify(assignment.response_data || {})}`).join('\n');

  const meddicEvidence = dedupeEvidenceRefs(signals.documents.slice(0, 3).map((doc) => ({
    source_type: 'document',
    ref_id: String(doc.id || ''),
    title: String(doc.title || 'document'),
    summary: String(doc.source_uri || doc.content_text || '').slice(0, 240),
    source_uri: typeof doc.source_uri === 'string' ? doc.source_uri : undefined,
  })).filter((ref) => Boolean(ref.ref_id)));

  if (/(meddic|champion|pipeline|business case|销售|客户|跟进)/i.test(`${rule.rule_name} ${rule.description} ${docText}`)) {
    insights.push({
      insight_title: 'MEDDIC 销售复盘与客户跟进',
      insight_summary: '现有 demo 知识库包含 MEDDIC 销售资料，建议把 Champion、痛点、预算、决策标准和下一步动作作为主动跟进的优先核对项。',
      insight_type: inferInsightType('customer follow up'),
      confidence: scoreInsight(meddicEvidence.length, 0.8),
      evidence_refs: meddicEvidence,
      metadata: {
        source: 'demo_seed',
        rule_id: rule.id,
        scenario: 'meddic_sales_ops',
      },
    });
  }

  const clawhubSkills = signals.skills.filter((skill) => {
    const metadata = parseJsonRecord(skill.metadata);
    return metadata.installed_from === 'clawhub.ai' || metadata.source === 'clawhub.ai' || Boolean(metadata.clawhub_slug);
  });

  if (clawhubSkills.length > 0) {
    insights.push({
      insight_title: 'ClawHub 技能升级检查',
      insight_summary: '检测到来自 ClawHub 的预制技能，建议逐个核对当前版本、变更说明和是否需要升级确认。',
      insight_type: 'skill_upgrade',
      confidence: scoreInsight(clawhubSkills.length, 0.78),
      evidence_refs: dedupeEvidenceRefs(clawhubSkills.slice(0, 4).map((skill) => ({
        source_type: 'skill',
        ref_id: String(skill.id || ''),
        title: String(skill.skill_name || 'skill'),
        summary: String(skill.description || '').slice(0, 240),
        source_uri: typeof skill.source_uri === 'string' ? skill.source_uri : undefined,
      })).filter((ref) => Boolean(ref.ref_id))),
      metadata: {
        source: 'clawhub',
        rule_id: rule.id,
        installed_skill_count: clawhubSkills.length,
      },
    });
  }

  const pendingAssignments = signals.assignments.filter((assignment) => {
    const status = normalizeText(assignment.status);
    return status === 'pending' || status === 'notified' || status === 'assigned';
  });

  if (pendingAssignments.length > 0 || /pending|待办|blocked|阻塞|流程/.test(`${rule.rule_name} ${rule.description} ${taskText}`)) {
    insights.push({
      insight_title: '任务链路待验证与派单状态检查',
      insight_summary: `当前共有 ${pendingAssignments.length} 条待处理派单，需要确认验证状态、反馈摘要和后续派单是否已经真正闭环。`,
      insight_type: 'process_issue',
      confidence: scoreInsight(Math.max(1, pendingAssignments.length), 0.74),
      evidence_refs: dedupeEvidenceRefs(pendingAssignments.slice(0, 4).map((assignment) => ({
        source_type: 'assignment',
        ref_id: String(assignment.id || ''),
        title: String(assignment.title || assignment.task_id || 'assignment'),
        summary: String(assignment.prompt_message || assignment.description || '').slice(0, 240),
      })).filter((ref) => Boolean(ref.ref_id))),
      metadata: {
        source: 'org_task',
        rule_id: rule.id,
        pending_assignment_count: pendingAssignments.length,
      },
    });
  }

  if (signals.facts.length < 5 && signals.documents.length > 0) {
    insights.push({
      insight_title: '事实层补强建议',
      insight_summary: '知识库已有 demo 内容，但事实层可继续补充结构化事实和证据链，以提高后续自动派单的置信度。',
      insight_type: 'fact_gap',
      confidence: scoreInsight(signals.documents.length, 0.7),
      evidence_refs: meddicEvidence.slice(0, 2),
      metadata: {
        source: 'fact_retrieval',
        rule_id: rule.id,
        fact_count: signals.facts.length,
        document_count: signals.documents.length,
      },
    });
  }

  if (insights.length === 0) {
    insights.push({
      insight_title: '主动运营扫描完成',
      insight_summary: '当前规则已完成一次巡检，但没有命中强信号。可以扩大扫描窗口或补充更明确的事实层输入。',
      insight_type: 'other',
      confidence: 0.72,
      evidence_refs: [],
      metadata: {
        source: 'scan_summary',
        rule_id: rule.id,
      },
    });
  }

  return insights.slice(0, 5);
}

export function buildMissionDraft(rule: RuleSnapshot, insight: InsightDraft, assigneeRole: string, targetUserId: string): MissionDraft {
  const missionType = buildMissionType(insight.insight_type, rule.routing_policy);
  const titlePrefix = assigneeRole === 'admin' ? '管理员复核' : '用户协同';
  return {
    mission_title: `${titlePrefix} - ${insight.insight_title}`,
    mission_summary: insight.insight_summary,
    mission_type: missionType,
    priority: clampNumber(rule.priority, 1, 100, 50),
    evidence_refs: insight.evidence_refs,
    response_schema: {
      summary: 'string',
      evidence_refs: 'array',
      next_steps: 'array',
      blockers: 'array',
    },
    metadata: {
      rule_id: rule.id,
      insight_type: insight.insight_type,
      target_user_id: targetUserId,
      assignee_role: assigneeRole,
      approval_mode: rule.approval_mode,
    },
  };
}
