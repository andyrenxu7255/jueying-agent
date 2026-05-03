import type { WorkflowPlan } from '@agent-harness/contracts'

export interface ValidationIssue {
  field: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

const STAGE_EXECUTOR_MAP: Record<string, string[]> = {
  IntentClarification: ['generic-executor'],
  PlanGeneration: ['generic-executor'],
  EvidenceRetrieval: ['retrieval-aware-executor'],
  MemoryRetrieval: ['retrieval-aware-executor'],
  ObjectExtraction: ['generic-executor'],
  ArchitectureDesign: ['generic-executor'],
  SpecGeneration: ['generic-executor'],
  DecisionMaking: ['generic-executor'],
  Implementation: ['code-executor'],
  Verification: ['verification-executor'],
  Repair: ['repair-executor', 'code-executor'],
  Approval: ['generic-executor', 'approval-executor', 'human-gateway'],
  ResultReporting: ['generic-executor'],
  SkillExtraction: ['generic-executor'],
  DreamSummarization: ['generic-executor'],
  Archive: ['generic-executor']
}

export class PlanValidator {
  validate(plan: WorkflowPlan): ValidationResult {
    const issues: ValidationIssue[] = []

    if (!plan.stage_chain.length) {
      issues.push({ field: 'stage_chain', message: 'stage_chain must not be empty' })
    }

    const seenSeq = new Set<number>()
    const seenKeys = new Set<string>()

    for (const [index, stage] of plan.stage_chain.entries()) {
      if (seenSeq.has(stage.seq)) {
        issues.push({ field: `stage_chain[${index}].seq`, message: 'seq must be unique' })
      }
      seenSeq.add(stage.seq)

      if (seenKeys.has(stage.stage_key)) {
        issues.push({ field: `stage_chain[${index}].stage_key`, message: 'stage_key must be unique' })
      }
      seenKeys.add(stage.stage_key)

      if (stage.timeouts.soft_timeout_sec >= stage.timeouts.hard_timeout_sec) {
        issues.push({
          field: `stage_chain[${index}].timeouts`,
          message: 'soft_timeout_sec must be smaller than hard_timeout_sec'
        })
      }

      if (stage.retry_policy.max_repairs > plan.budgets.repair_budget) {
        issues.push({
          field: `stage_chain[${index}].retry_policy.max_repairs`,
          message: 'max_repairs exceeds workflow repair_budget'
        })
      }

      if (stage.retrieval_plan.allow_graph && (stage.retrieval_plan.max_graph_hops || 0) > 2) {
        issues.push({
          field: `stage_chain[${index}].retrieval_plan.max_graph_hops`,
          message: 'max_graph_hops must be <= 2'
        })
      }

      const allowedExecutors = STAGE_EXECUTOR_MAP[stage.stage_type] || []
      if (!allowedExecutors.includes(stage.assigned_executor)) {
        issues.push({
          field: `stage_chain[${index}].assigned_executor`,
          message: `assigned_executor ${stage.assigned_executor} is invalid for stage_type ${stage.stage_type}`
        })
      }
    }

    return {
      ok: issues.length === 0,
      issues
    }
  }
}

export const planValidator = new PlanValidator()
