use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    decide_writeback_policy, graph::plan_task_graph, policy_decision_allows, ActorType, Evidence,
    ExternalWritebackIntent, InformationGap, Task, TaskGraph, Validate, ValidationIssue,
    WritebackPolicyDecision, WritebackPolicyResult,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentifiedWritebackDecision {
    pub intent_id: String,
    pub recommendation: WritebackPolicyResult,
    pub final_decision: Option<WritebackPolicyResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyBridgeIssue {
    pub path: String,
    pub message: String,
}

impl From<ValidationIssue> for LegacyBridgeIssue {
    fn from(issue: ValidationIssue) -> Self {
        Self {
            path: issue.path,
            message: issue.message,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyBridgePreview {
    pub ok: bool,
    #[serde(default)]
    pub issues: Vec<LegacyBridgeIssue>,
    pub generated_at: String,
    pub workflow_plan_payload: Option<Value>,
    pub org_task_payloads: Vec<Value>,
    pub fact_write_payloads: Vec<Value>,
    pub audit_event_payloads: Vec<Value>,
    pub summary: Value,
    pub target_routes: Value,
}

pub fn build_legacy_bridge_preview(
    task_graph: Option<&TaskGraph>,
    gaps: &[InformationGap],
    evidence: &[Evidence],
    writeback_intents: &[ExternalWritebackIntent],
    writeback_decisions: &[IdentifiedWritebackDecision],
) -> LegacyBridgePreview {
    let mut issues = vec![];
    let workflow_plan_payload = match task_graph {
        Some(graph) => match checked_task_graph_to_legacy_workflow_plan(graph) {
            Ok(payload) => Some(payload),
            Err(error) => {
                issues.push(ValidationIssue::new(
                    "task_graph",
                    format!("invalid task graph: {error}"),
                ));
                None
            }
        },
        None => {
            issues.push(ValidationIssue::new("task_graph", "missing task graph"));
            None
        }
    };
    let task_ids: HashSet<&str> = task_graph
        .into_iter()
        .flat_map(|graph| graph.tasks.iter().map(|task| task.id.as_str()))
        .collect();
    let gap_ids: HashSet<&str> = gaps.iter().map(|gap| gap.id.as_str()).collect();
    let evidence_ids: HashSet<&str> = evidence.iter().map(|item| item.id.as_str()).collect();
    let gaps_by_id = gaps
        .iter()
        .map(|gap| (gap.id.as_str(), gap))
        .collect::<HashMap<_, _>>();
    let evidence_by_id = evidence
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<HashMap<_, _>>();
    let opportunity_id = task_graph
        .and_then(|graph| graph.business_refs.as_ref())
        .and_then(|refs| refs.get("opportunity_id"))
        .and_then(Value::as_str);
    let mut seen = HashSet::new();
    for gap in gaps {
        collect_issues(&mut issues, &format!("gaps.{}", gap.id), gap.validate());
        if !seen.insert(gap.id.as_str()) {
            issues.push(ValidationIssue::new(
                format!("gaps.{}", gap.id),
                "duplicate gap ID",
            ));
        }
        if !task_ids.contains(gap.task_id.as_str()) {
            issues.push(ValidationIssue::new(
                format!("gaps.{}.task_id", gap.id),
                "unknown task",
            ));
        }
        for id in &gap.closed_by_evidence_ids {
            if !evidence_ids.contains(id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!("gaps.{}.closed_by_evidence_ids", gap.id),
                    format!("unknown evidence: {id}"),
                ));
            } else if let Some(item) = evidence_by_id.get(id.as_str()) {
                validate_evidence_gap_association(&mut issues, gap, item, "closed_by_evidence_ids");
            }
        }
    }
    seen.clear();
    for item in evidence {
        collect_issues(
            &mut issues,
            &format!("evidence.{}", item.id),
            item.validate(),
        );
        if !seen.insert(item.id.as_str()) {
            issues.push(ValidationIssue::new(
                format!("evidence.{}", item.id),
                "duplicate evidence ID",
            ));
        }
        if item
            .task_id
            .as_deref()
            .is_some_and(|id| !task_ids.contains(id))
        {
            issues.push(ValidationIssue::new(
                format!("evidence.{}.task_id", item.id),
                "unknown task",
            ));
        }
        if item
            .gap_id
            .as_deref()
            .is_some_and(|id| !gap_ids.contains(id))
        {
            issues.push(ValidationIssue::new(
                format!("evidence.{}.gap_id", item.id),
                "unknown gap",
            ));
        } else if let (Some(task_id), Some(gap_id)) =
            (item.task_id.as_deref(), item.gap_id.as_deref())
        {
            if let Some(gap) = gaps_by_id.get(gap_id) {
                if gap.task_id != task_id {
                    issues.push(ValidationIssue::new(
                        format!("evidence.{}.gap_id", item.id),
                        format!(
                            "gap belongs to task {} but evidence belongs to task {task_id}",
                            gap.task_id
                        ),
                    ));
                }
            }
        }
    }
    seen.clear();
    for intent in writeback_intents {
        collect_issues(
            &mut issues,
            &format!("writeback_intents.{}", intent.id),
            intent.validate(),
        );
        if !seen.insert(intent.id.as_str()) {
            issues.push(ValidationIssue::new(
                format!("writeback_intents.{}", intent.id),
                "duplicate intent ID",
            ));
        }
        if intent
            .source
            .task_id
            .as_deref()
            .is_some_and(|id| !task_ids.contains(id))
        {
            issues.push(ValidationIssue::new(
                format!("writeback_intents.{}.source.task_id", intent.id),
                "unknown task",
            ));
        }
        for id in &intent.source.evidence_ids {
            if !evidence_ids.contains(id.as_str()) {
                issues.push(ValidationIssue::new(
                    format!("writeback_intents.{}.source.evidence_ids", intent.id),
                    format!("unknown evidence: {id}"),
                ));
            } else if let Some(item) = evidence_by_id.get(id.as_str()) {
                if let Some(source_task_id) = intent.source.task_id.as_deref() {
                    if item.task_id.as_deref() != Some(source_task_id) {
                        issues.push(ValidationIssue::new(
                            format!("writeback_intents.{}.source.evidence_ids", intent.id),
                            format!(
                                "evidence {id} belongs to task {:?} and cannot support source task {source_task_id}",
                                item.task_id
                            ),
                        ));
                    }
                    if let Some(gap_id) = item.gap_id.as_deref() {
                        if let Some(gap) = gaps_by_id.get(gap_id) {
                            if gap.task_id != source_task_id {
                                issues.push(ValidationIssue::new(
                                    format!("writeback_intents.{}.source.evidence_ids", intent.id),
                                    format!(
                                        "evidence {id} gap belongs to task {} and cannot support source task {source_task_id}",
                                        gap.task_id
                                    ),
                                ));
                            }
                        }
                    }
                }
                validate_evidence_opportunity(
                    &mut issues,
                    opportunity_id,
                    item,
                    &format!("writeback_intents.{}.source.evidence_ids", intent.id),
                );
            }
        }
    }
    if let Some(graph) = task_graph {
        for task in &graph.tasks {
            for id in &task.evidence_ids {
                if !evidence_ids.contains(id.as_str()) {
                    issues.push(ValidationIssue::new(
                        format!("task_graph.tasks.{}.evidence_ids", task.id),
                        format!("unknown evidence: {id}"),
                    ));
                } else if let Some(item) = evidence_by_id.get(id.as_str()) {
                    if let Some(owner_task_id) = item.task_id.as_deref() {
                        if owner_task_id != task.id {
                            issues.push(ValidationIssue::new(
                                format!("task_graph.tasks.{}.evidence_ids", task.id),
                                format!(
                                    "evidence {id} belongs to task {owner_task_id} and cannot be used by task {} acceptance",
                                    task.id
                                ),
                            ));
                        }
                    }
                    if let Some(gap_id) = item.gap_id.as_deref() {
                        if let Some(gap) = gaps_by_id.get(gap_id) {
                            if gap.task_id != task.id {
                                issues.push(ValidationIssue::new(
                                    format!("task_graph.tasks.{}.evidence_ids", task.id),
                                    format!(
                                        "evidence {id} gap belongs to task {} and cannot be used by task {} acceptance",
                                        gap.task_id, task.id
                                    ),
                                ));
                            }
                        }
                    }
                    validate_evidence_opportunity(
                        &mut issues,
                        opportunity_id,
                        item,
                        &format!("task_graph.tasks.{}.evidence_ids", task.id),
                    );
                }
            }
            for id in &task.information_gap_ids {
                if !gap_ids.contains(id.as_str()) {
                    issues.push(ValidationIssue::new(
                        format!("task_graph.tasks.{}.information_gap_ids", task.id),
                        format!("unknown gap: {id}"),
                    ));
                }
            }
        }
    }
    let mut decisions = HashMap::new();
    for entry in writeback_decisions {
        if decisions.insert(entry.intent_id.as_str(), entry).is_some() {
            issues.push(ValidationIssue::new(
                format!("writeback_decisions.{}", entry.intent_id),
                "duplicate decision for intent",
            ));
        }
        if !seen.contains(entry.intent_id.as_str()) {
            issues.push(ValidationIssue::new(
                format!("writeback_decisions.{}", entry.intent_id),
                "unknown intent",
            ));
        }
    }
    for intent in writeback_intents {
        let Some(entry) = decisions.get(intent.id.as_str()) else {
            issues.push(ValidationIssue::new(
                format!("writeback_decisions.{}", intent.id),
                "missing decision for intent",
            ));
            continue;
        };
        let computed = decide_writeback_policy(intent);
        if entry.recommendation.decision != computed.decision {
            issues.push(ValidationIssue::new(
                format!("writeback_decisions.{}.recommendation", intent.id),
                "recommendation differs from computed policy",
            ));
        }
        if let Some(final_decision) = &entry.final_decision {
            if !policy_decision_allows(&final_decision.decision, &computed.decision)
                || !policy_decision_allows(&final_decision.decision, &intent.policy_decision)
            {
                issues.push(ValidationIssue::new(
                    format!("writeback_decisions.{}.final_decision", intent.id),
                    "final decision is more permissive than policy",
                ));
            }
        }
    }
    if !issues.is_empty() {
        return LegacyBridgePreview {
            ok: false,
            issues: issues.into_iter().map(Into::into).collect(),
            generated_at: "2026-06-01T00:00:00+08:00".to_string(),
            workflow_plan_payload: None,
            org_task_payloads: vec![],
            fact_write_payloads: vec![],
            audit_event_payloads: vec![],
            summary: serde_json::json!({"workflow_stage_count": 0, "org_task_payload_count": 0, "fact_write_payload_count": 0, "audit_event_payload_count": 0}),
            target_routes: legacy_target_routes(),
        };
    }
    let org_task_payloads: Vec<Value> = gaps
        .iter()
        .filter(|gap| !matches!(format!("{:?}", gap.status).as_str(), "Closed" | "Waived"))
        .map(|gap| {
            serde_json::json!({
                "information_gap_id": gap.id,
                "payload": information_gap_to_legacy_org_task(gap)
            })
        })
        .collect();
    let fact_write_payloads: Vec<Value> = evidence
        .iter()
        .map(|item| {
            serde_json::json!({
                "evidence_id": item.id,
                "payload": evidence_to_legacy_fact_write(item)
            })
        })
        .collect();
    let audit_event_payloads: Vec<Value> = writeback_intents
        .iter()
        .map(|intent| {
            let entry = decisions[intent.id.as_str()];
            let decision = entry
                .final_decision
                .as_ref()
                .unwrap_or(&entry.recommendation);
            serde_json::json!({
                "intent_id": intent.id,
                "payload": writeback_intent_to_legacy_audit_event(intent, Some(decision))
            })
        })
        .collect();
    let workflow_stage_count = workflow_plan_payload
        .as_ref()
        .and_then(|payload| payload.pointer("/workflow_plan_preview/stage_chain"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    LegacyBridgePreview {
        ok: true,
        issues: vec![],
        generated_at: "2026-06-01T00:00:00+08:00".to_string(),
        workflow_plan_payload,
        summary: serde_json::json!({
            "workflow_stage_count": workflow_stage_count,
            "org_task_payload_count": org_task_payloads.len(),
            "fact_write_payload_count": fact_write_payloads.len(),
            "audit_event_payload_count": audit_event_payloads.len()
        }),
        org_task_payloads,
        fact_write_payloads,
        audit_event_payloads,
        target_routes: legacy_target_routes(),
    }
}

fn collect_issues(target: &mut Vec<ValidationIssue>, prefix: &str, issues: Vec<ValidationIssue>) {
    target.extend(
        issues
            .into_iter()
            .map(|issue| ValidationIssue::new(format!("{prefix} {}", issue.path), issue.message)),
    );
}

fn validate_evidence_gap_association(
    issues: &mut Vec<ValidationIssue>,
    gap: &InformationGap,
    evidence: &Evidence,
    field: &str,
) {
    if let Some(task_id) = evidence.task_id.as_deref() {
        if task_id != gap.task_id {
            issues.push(ValidationIssue::new(
                format!("gaps.{}.{}", gap.id, field),
                format!(
                    "evidence {} belongs to task {task_id}, but gap belongs to task {}",
                    evidence.id, gap.task_id
                ),
            ));
        }
    }
    if let Some(evidence_gap_id) = evidence.gap_id.as_deref() {
        if evidence_gap_id != gap.id {
            issues.push(ValidationIssue::new(
                format!("gaps.{}.{}", gap.id, field),
                format!(
                    "evidence {} belongs to gap {evidence_gap_id}, not gap {}",
                    evidence.id, gap.id
                ),
            ));
        }
    }
}

fn validate_evidence_opportunity(
    issues: &mut Vec<ValidationIssue>,
    expected_opportunity_id: Option<&str>,
    evidence: &Evidence,
    path: &str,
) {
    let Some(expected_opportunity_id) = expected_opportunity_id else {
        return;
    };
    let Some(actual_opportunity_id) = evidence
        .business_refs
        .as_ref()
        .and_then(|refs| refs.get("opportunity_id"))
        .and_then(Value::as_str)
    else {
        return;
    };
    if actual_opportunity_id != expected_opportunity_id {
        issues.push(ValidationIssue::new(
            path,
            format!(
                "evidence {} opportunity belongs to {actual_opportunity_id}, expected {expected_opportunity_id}",
                evidence.id
            ),
        ));
    }
}

fn legacy_target_routes() -> Value {
    serde_json::json!({
        "workflow_plan": "/internal/workflows/plan",
        "org_task_create": "/admin/tasks",
        "fact_write": "/internal/facts/write",
        "audit_projection": "/api/admin/audit"
    })
}

pub fn checked_task_graph_to_legacy_workflow_plan(task_graph: &TaskGraph) -> Result<Value, Value> {
    let contract_issues = task_graph.validate();
    if !contract_issues.is_empty() {
        return Err(serde_json::json!({
            "error": "invalid_task_graph_for_legacy_projection",
            "issues": contract_issues
        }));
    }
    let plan = plan_task_graph(&task_graph.tasks).map_err(|issues| {
        serde_json::json!({
            "error": "invalid_task_graph_for_legacy_projection",
            "issues": issues
        })
    })?;
    Ok(task_graph_to_legacy_workflow_plan_with_plan(
        task_graph,
        &plan.topological_order,
    ))
}

pub fn task_graph_to_legacy_workflow_plan(task_graph: &TaskGraph) -> Value {
    let order = task_graph
        .tasks
        .iter()
        .map(|task| task.id.clone())
        .collect::<Vec<_>>();
    task_graph_to_legacy_workflow_plan_with_plan(task_graph, &order)
}

fn task_graph_to_legacy_workflow_plan_with_plan(task_graph: &TaskGraph, order: &[String]) -> Value {
    let ordered_tasks = ordered_tasks(task_graph, order);
    let stage_chain: Vec<Value> = ordered_tasks
        .iter()
        .enumerate()
        .map(|(index, task)| legacy_stage_from_order(task_graph, task, index, &ordered_tasks))
        .collect();
    serde_json::json!({
        "user_id": "u_ai_native_ops",
        "user_role": "admin",
        "user_goal": format!("Run AI-native TaskGraph {}", task_graph.id),
        "task_type_hint": "implementation",
        "risk_level": "medium",
        "policy_snapshot_hash": format!("sha256:{}", "0".repeat(64)),
        "context": {
            "ai_native_task_graph_id": task_graph.id,
            "ai_native_run_id": task_graph.run_id,
            "autonomy_level": task_graph.autonomy_level,
            "business_refs": task_graph.business_refs.clone().unwrap_or_else(|| serde_json::json!({})),
            "stage_chain": stage_chain
        },
        "source": "ai_native_ops_bridge",
        "markdown_steps": ordered_tasks.iter().enumerate().map(|(index, task)| serde_json::json!({
            "seq": index,
            "name": task.id,
            "description": task.title
        })).collect::<Vec<_>>(),
        "workflow_plan_preview": {
            "plan_hash_seed": format!("{}:{}", task_graph.id, task_graph.version),
            "projection_note": "legacy workflow is a lossy linear projection of the validated TaskGraph DAG",
            "topological_order": ordered_tasks.iter().map(|task| task.id.clone()).collect::<Vec<_>>(),
            "stage_chain": ordered_tasks.iter().enumerate().map(|(index, task)| legacy_stage_from_order(task_graph, task, index, &ordered_tasks)).collect::<Vec<_>>()
        }
    })
}

fn legacy_stage_from_order(
    task_graph: &TaskGraph,
    task: &Task,
    index: usize,
    ordered_tasks: &[&Task],
) -> Value {
    serde_json::json!({
        "stage_id": task.id,
        "seq": index,
        "stage_key": task.id,
        "stage_type": infer_legacy_stage_type(task),
        "assigned_executor": infer_legacy_executor(task),
        "purpose": task.title,
        "inputs": {
            "required_refs": task.required_evidence,
            "optional_refs": task.evidence_ids
        },
        "retrieval_plan": {
            "enabled": !task.required_evidence.is_empty() || !task.information_gap_ids.is_empty()
        },
        "acceptance": {
            "must_have": task.required_evidence,
            "pass_rules": [task.acceptance_criteria],
            "fail_rules": ["required evidence missing", "acceptance criteria not met"]
        },
        "timeouts": {
            "soft_timeout_sec": 900,
            "hard_timeout_sec": 3600
        },
        "retry_policy": {
            "max_retries": 1,
            "max_repairs": if matches!(task.owner_actor_type, ActorType::WorkerAgent) { 1 } else { 0 }
        },
        "checkpoint_policy": {
            "on_enter": true,
            "on_progress": true,
            "on_exit": true
        },
        "on_success": ordered_tasks.get(index + 1).map(|next| next.id.clone()).unwrap_or_else(|| "complete".to_string()),
        "on_failure": "repair_or_fail",
        "ai_native_refs": {
            "task_graph_id": task_graph.id,
            "task_id": task.id,
            "owner_actor_type": task.owner_actor_type,
            "owner_actor_id": task.owner_actor_id,
            "information_gap_ids": task.information_gap_ids,
            "evidence_ids": task.evidence_ids,
            "external_refs": task.external_refs
        }
    })
}

fn ordered_tasks<'a>(task_graph: &'a TaskGraph, order: &[String]) -> Vec<&'a Task> {
    order
        .iter()
        .filter_map(|task_id| task_graph.tasks.iter().find(|task| &task.id == task_id))
        .collect()
}

pub fn information_gap_to_legacy_org_task(gap: &InformationGap) -> Value {
    let expected_evidence_types = gap.expected_evidence_types.as_deref().unwrap_or(&[]);
    let expected_evidence = if expected_evidence_types.is_empty() {
        "human_confirmation".to_string()
    } else {
        expected_evidence_types
            .iter()
            .map(|kind| {
                serde_json::to_string(kind)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    let prompt_message = [
        gap.question.clone(),
        "".to_string(),
        format!("为什么需要: {}", gap.reason),
        format!("期望证据: {}", expected_evidence),
        "请补充可验证的信息、截图、会议纪要、CRM链接或项目系统链接。".to_string(),
    ]
    .join("\n");
    serde_json::json!({
        "title": format!("补充信息: {}", gap.question.chars().take(80).collect::<String>()),
        "description": gap.reason,
        "task_type": "form",
        "schedule_type": "once",
        "cron_expression": null,
        "prompt_message": prompt_message,
        "target_channels": ["wecom", "feishu"],
        "org_id": null,
        "created_by": null,
        "ai_native_refs": {
            "information_gap_id": gap.id,
            "task_id": gap.task_id,
            "collector_actor_id": gap.collector_actor_id,
            "priority": gap.priority,
            "due_at": gap.due_at,
            "required_schema": gap.required_schema
        }
    })
}

pub fn evidence_to_legacy_fact_write(evidence: &Evidence) -> Value {
    let summary = evidence
        .content_ref
        .summary
        .clone()
        .unwrap_or_else(|| evidence.content_ref.value.clone());
    let subject_ref = evidence
        .business_refs
        .as_ref()
        .and_then(|refs| refs.get("opportunity_id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| evidence.task_id.clone())
        .unwrap_or_else(|| evidence.id.clone());
    serde_json::json!({
        "owner_user_id": "u_ai_native_ops",
        "fact_text": summary,
        "object_value": summary,
        "subject_ref": subject_ref,
        "predicate": format!("evidence.{}", serde_json::to_string(&evidence.evidence_type).unwrap_or_default().trim_matches('"')),
        "scope": ["private"],
        "mode": "insert",
        "evidence_refs": [{
            "evidence_pack_id": evidence.id,
            "evidence_pack_hash": format!("ai-native:{}", evidence.id)
        }],
        "confidence": evidence.quality_score.unwrap_or(0.72),
        "ai_native_refs": {
            "evidence_id": evidence.id,
            "evidence_type": evidence.evidence_type,
            "capture_channel": evidence.capture_channel,
            "content_ref": evidence.content_ref
        }
    })
}

pub fn writeback_intent_to_legacy_audit_event(
    intent: &ExternalWritebackIntent,
    decision: Option<&WritebackPolicyResult>,
) -> Value {
    let required = decision.map(|result| &result.decision);
    let selected = match required {
        Some(required) if !policy_decision_allows(&intent.policy_decision, required) => required,
        _ => &intent.policy_decision,
    };
    let policy_decision = writeback_policy_decision_str(selected);
    serde_json::json!({
        "user_id": intent.confirmed_by.clone().unwrap_or_else(|| intent.source.agent_id.clone()),
        "action": "external.writeback.intent",
        "resource_type": intent.system_type,
        "resource_ref": format!("{}:{}:{}", intent.provider, intent.target.object_type, intent.target.external_id),
        "resource_scope": intent.connection_id,
        "result": if policy_decision == "reject" { "failure" } else { "success" },
        "detail_json": {
            "intent_id": intent.id,
            "provider": intent.provider,
            "operation": intent.operation,
            "risk_level": intent.risk_level,
            "policy_decision": policy_decision,
            "reasons": decision.map(|item| item.reasons.clone()).unwrap_or_default(),
            "payload": intent.payload,
            "source": intent.source
        }
    })
}

fn writeback_policy_decision_str(decision: &WritebackPolicyDecision) -> &'static str {
    match decision {
        WritebackPolicyDecision::AutoExecute => "auto_execute",
        WritebackPolicyDecision::NeedsConfirmation => "needs_confirmation",
        WritebackPolicyDecision::Reject => "reject",
        WritebackPolicyDecision::ManualOnly => "manual_only",
    }
}

fn infer_legacy_stage_type(task: &Task) -> &'static str {
    if matches!(
        task.owner_actor_type,
        ActorType::Human | ActorType::HumanTwinAgent
    ) {
        "Approval"
    } else if !task.required_evidence.is_empty() || !task.information_gap_ids.is_empty() {
        "Retrieval"
    } else {
        "Generic"
    }
}

fn infer_legacy_executor(task: &Task) -> &'static str {
    if matches!(
        task.owner_actor_type,
        ActorType::Human | ActorType::HumanTwinAgent
    ) {
        "approval-executor"
    } else if !task.required_evidence.is_empty() || !task.information_gap_ids.is_empty() {
        "retrieval-aware-executor"
    } else {
        "generic-executor"
    }
}

#[cfg(test)]
mod tests {
    fn recommendations(
        intents: &[crate::ExternalWritebackIntent],
    ) -> Vec<super::IdentifiedWritebackDecision> {
        intents
            .iter()
            .map(|intent| super::IdentifiedWritebackDecision {
                intent_id: intent.id.clone(),
                recommendation: crate::decide_writeback_policy(intent),
                final_decision: None,
            })
            .collect()
    }

    use crate::{
        adapter::{
            checked_task_graph_to_legacy_workflow_plan, evidence_to_legacy_fact_write,
            task_graph_to_legacy_workflow_plan, writeback_intent_to_legacy_audit_event,
        },
        graph::plan_task_graph,
        ActorType, AutonomyLevel, ContentKind, ContentRef, Evidence, EvidenceType,
        ExternalSystemType, ExternalWritebackIntent, SourceType, WritebackOperation,
        WritebackPolicyDecision, WritebackPolicyResult, WritebackRiskLevel, WritebackSource,
        WritebackTarget,
    };

    #[test]
    fn legacy_projection_is_explicitly_linear_but_domain_plan_keeps_dependencies() {
        use crate::fixtures::load_p1_fixture_state;

        let root = crate::fixtures::workspace_root();
        let state = load_p1_fixture_state(&root).unwrap();
        let plan = plan_task_graph(&state.task_graph.tasks).unwrap();
        assert_eq!(plan.parallel_layers[0], vec!["task_discover_champion"]);
        let payload = task_graph_to_legacy_workflow_plan(&state.task_graph);
        assert_eq!(
            payload["workflow_plan_preview"]["stage_chain"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn legacy_fact_subject_prefers_opportunity_then_task_then_evidence_id() {
        let mut evidence = Evidence {
            id: "ev_bridge".to_string(),
            evidence_type: EvidenceType::CustomerQuote,
            source_type: SourceType::Human,
            source_actor_id: "user_sales".to_string(),
            capture_channel: "meeting".to_string(),
            task_id: Some("task_bridge".to_string()),
            gap_id: None,
            business_refs: Some(serde_json::json!({ "opportunity_id": "opp_bridge" })),
            content_ref: ContentRef {
                kind: ContentKind::Text,
                value: "Customer confirmed budget.".to_string(),
                summary: None,
            },
            quality_score: None,
            sensitivity: None,
            created_at: "2026-06-01T00:00:00+08:00".to_string(),
        };

        assert_eq!(
            evidence_to_legacy_fact_write(&evidence)["subject_ref"],
            "opp_bridge"
        );
        evidence.business_refs = None;
        assert_eq!(
            evidence_to_legacy_fact_write(&evidence)["subject_ref"],
            "task_bridge"
        );
        evidence.task_id = None;
        assert_eq!(
            evidence_to_legacy_fact_write(&evidence)["subject_ref"],
            "ev_bridge"
        );
    }

    #[test]
    fn legacy_audit_uses_snake_case_policy_decision_and_result() {
        let intent = ExternalWritebackIntent {
            id: "wbi_bridge".to_string(),
            connection_id: "conn_bridge".to_string(),
            system_type: ExternalSystemType::Crm,
            provider: "salesforce".to_string(),
            target: WritebackTarget {
                object_type: "opportunity".to_string(),
                external_id: "opp_bridge".to_string(),
            },
            operation: WritebackOperation::UpdateField,
            payload: serde_json::json!({ "amount": 100 }),
            source: WritebackSource {
                agent_id: "pm_agent".to_string(),
                task_id: None,
                evidence_ids: vec![],
                reason: "Bridge parity test".to_string(),
            },
            risk_level: WritebackRiskLevel::High,
            idempotency_key: "idem_bridge".to_string(),
            policy_decision: WritebackPolicyDecision::NeedsConfirmation,
            created_at: "2026-06-01T00:00:00+08:00".to_string(),
            confirmed_by: None,
            confirmed_at: None,
        };
        let decision = WritebackPolicyResult {
            decision: WritebackPolicyDecision::Reject,
            reasons: vec!["not allowed".to_string()],
        };
        let audit = writeback_intent_to_legacy_audit_event(&intent, Some(&decision));

        assert_eq!(audit["result"], "failure");
        assert_eq!(audit["detail_json"]["policy_decision"], "reject");
    }

    #[test]
    fn bridge_preview_and_org_task_match_js_payload_shape() {
        use crate::{
            adapter::{build_legacy_bridge_preview, information_gap_to_legacy_org_task},
            InformationGap, InformationGapStatus, Priority,
        };

        let gap = InformationGap {
            id: "gap_bridge".to_string(),
            task_id: "task_bridge".to_string(),
            status: InformationGapStatus::Open,
            question: "Need confirmation?".to_string(),
            reason: "Gate cannot pass.".to_string(),
            collector_actor_id: "user_sales".to_string(),
            required_schema: serde_json::json!({}),
            expected_evidence_types: None,
            priority: Priority::High,
            due_at: None,
            created_at: "2026-06-01T00:00:00+08:00".to_string(),
            closed_by_evidence_ids: vec![],
        };
        let payload = information_gap_to_legacy_org_task(&gap);
        assert!(payload["prompt_message"]
            .as_str()
            .unwrap()
            .contains("期望证据: human_confirmation"));

        let preview = build_legacy_bridge_preview(None, &[gap], &[], &[], &[]);
        assert!(!preview.ok);
        assert!(!preview.generated_at.is_empty());
    }

    #[test]
    fn bridge_preserves_stored_reject_and_manual_only_decisions() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let root = crate::fixtures::workspace_root();
        let mut state = load_p1_fixture_state(&root).unwrap();
        state.writeback_intents[0].policy_decision = WritebackPolicyDecision::Reject;
        state.writeback_intents[1].policy_decision = WritebackPolicyDecision::ManualOnly;
        let decisions = recommendations(&state.writeback_intents);
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert_eq!(
            preview.audit_event_payloads[0]["payload"]["detail_json"]["policy_decision"],
            "reject"
        );
        assert_eq!(
            preview.audit_event_payloads[0]["payload"]["result"],
            "failure"
        );
        assert_eq!(
            preview.audit_event_payloads[1]["payload"]["detail_json"]["policy_decision"],
            "manual_only"
        );
    }

    #[test]
    fn bridge_decisions_follow_intents_not_decision_array_positions() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let root = crate::fixtures::workspace_root();
        let mut state = load_p1_fixture_state(&root).unwrap();
        state.writeback_intents[1].risk_level = WritebackRiskLevel::High;
        state.writeback_intents[1].policy_decision = WritebackPolicyDecision::NeedsConfirmation;
        let mut decisions = recommendations(&state.writeback_intents);
        decisions.reverse();
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert_eq!(
            preview.audit_event_payloads[0]["payload"]["detail_json"]["policy_decision"],
            "auto_execute"
        );
        assert_eq!(
            preview.audit_event_payloads[1]["payload"]["detail_json"]["policy_decision"],
            "needs_confirmation"
        );
    }

    #[test]
    fn bridge_honors_explicit_reject_over_stored_confirmation() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let state = load_p1_fixture_state(&crate::fixtures::workspace_root()).unwrap();
        let mut intent = state.writeback_intents[0].clone();
        intent.policy_decision = WritebackPolicyDecision::NeedsConfirmation;
        let final_decision = WritebackPolicyResult {
            decision: WritebackPolicyDecision::Reject,
            reasons: vec!["human rejected".to_string()],
        };
        let decisions = [super::IdentifiedWritebackDecision {
            intent_id: intent.id.clone(),
            recommendation: crate::decide_writeback_policy(&intent),
            final_decision: Some(final_decision),
        }];
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &[intent],
            &decisions,
        );
        assert_eq!(
            preview.audit_event_payloads[0]["payload"]["result"],
            "failure"
        );
        assert_eq!(
            preview.audit_event_payloads[0]["payload"]["detail_json"]["policy_decision"],
            "reject"
        );
    }

    #[test]
    fn bridge_rejects_invalid_inputs_without_emitting_payloads() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let state = load_p1_fixture_state(&crate::fixtures::workspace_root()).unwrap();
        let decisions = recommendations(&state.writeback_intents);
        let assert_invalid = |preview: super::LegacyBridgePreview, source: &str| {
            assert!(!preview.ok);
            assert!(preview
                .issues
                .iter()
                .any(|issue| issue.path.contains(source)));
            assert!(preview.workflow_plan_payload.is_none());
            assert!(preview.org_task_payloads.is_empty());
            assert!(preview.fact_write_payloads.is_empty());
            assert!(preview.audit_event_payloads.is_empty());
        };
        let mut bad_evidence = state.evidence.clone();
        bad_evidence[0].content_ref.value.clear();
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &bad_evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert_invalid(preview, "evidence.");

        let mut bad_gaps = state.gaps.clone();
        bad_gaps[0].question.clear();
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &bad_gaps,
            &state.evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert_invalid(preview, "gaps.");

        let mut bad_intents = state.writeback_intents.clone();
        bad_intents[0].provider.clear();
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &bad_intents,
            &decisions,
        );
        assert_invalid(preview, "writeback_intents.");

        let mut bad_graph = state.task_graph.clone();
        bad_graph.tasks[0]
            .depends_on
            .push("task_unknown".to_string());
        let preview = build_legacy_bridge_preview(
            Some(&bad_graph),
            &state.gaps,
            &state.evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert_invalid(preview, "task_graph");
    }

    #[test]
    fn bridge_rejects_evidence_reused_across_tasks_or_unrelated_gaps() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let state = load_p1_fixture_state(&crate::fixtures::workspace_root()).unwrap();
        let decisions = recommendations(&state.writeback_intents);
        let mut cross_task = state.task_graph.clone();
        cross_task.tasks[0]
            .evidence_ids
            .push("ev_next_meeting_calendar".to_string());
        let preview = build_legacy_bridge_preview(
            Some(&cross_task),
            &state.gaps,
            &state.evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert!(!preview.ok);
        assert!(preview
            .issues
            .iter()
            .any(|issue| issue.message.contains("belongs to task")));
        assert!(preview.fact_write_payloads.is_empty());

        let mut wrong_gap = state.clone();
        wrong_gap.evidence[0].gap_id = Some(wrong_gap.gaps[0].id.clone());
        let preview = build_legacy_bridge_preview(
            Some(&wrong_gap.task_graph),
            &wrong_gap.gaps,
            &wrong_gap.evidence,
            &wrong_gap.writeback_intents,
            &decisions,
        );
        assert!(!preview.ok);
        assert!(preview
            .issues
            .iter()
            .any(|issue| issue.message.contains("gap belongs to task")));
        assert!(preview.fact_write_payloads.is_empty());
    }

    #[test]
    fn bridge_rejects_writeback_evidence_outside_source_task_or_opportunity() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let mut state = load_p1_fixture_state(&crate::fixtures::workspace_root()).unwrap();
        state.writeback_intents[0].source.task_id = Some("task_discover_champion".to_string());
        let decisions = recommendations(&state.writeback_intents);
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert!(!preview.ok);
        assert!(preview.issues.iter().any(|issue| {
            issue.path.contains("source.evidence_ids")
                && issue.message.contains("cannot support source task")
        }));

        state.writeback_intents[0].source.task_id = Some("task_discover_next_action".to_string());
        state.evidence[0].business_refs = Some(serde_json::json!({
            "opportunity_id": "opp_other"
        }));
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &state.writeback_intents,
            &recommendations(&state.writeback_intents),
        );
        assert!(!preview.ok);
        assert!(preview
            .issues
            .iter()
            .any(|issue| issue.message.contains("opportunity belongs to")));
    }

    #[test]
    fn bridge_decision_ids_fail_closed_on_missing_duplicate_unknown_or_stale_policy() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let state = load_p1_fixture_state(&crate::fixtures::workspace_root()).unwrap();
        let decisions = recommendations(&state.writeback_intents);
        let check = |entries: &[super::IdentifiedWritebackDecision]| {
            build_legacy_bridge_preview(
                Some(&state.task_graph),
                &state.gaps,
                &state.evidence,
                &state.writeback_intents,
                entries,
            )
        };
        let missing = check(&decisions[..1]);
        assert!(!missing.ok);
        assert!(missing.audit_event_payloads.is_empty());
        assert!(missing
            .issues
            .iter()
            .any(|issue| issue.message == "missing decision for intent"));

        let mut duplicate = decisions.clone();
        duplicate.push(decisions[0].clone());
        let preview = check(&duplicate);
        assert!(!preview.ok);
        assert!(preview
            .issues
            .iter()
            .any(|issue| issue.message == "duplicate decision for intent"));

        let mut unknown = decisions.clone();
        unknown[0].intent_id = "wbi_unknown".to_string();
        let preview = check(&unknown);
        assert!(!preview.ok);
        assert!(preview
            .issues
            .iter()
            .any(|issue| issue.message == "unknown intent"));

        let mut stale = decisions;
        stale[0].recommendation.decision = WritebackPolicyDecision::NeedsConfirmation;
        let preview = check(&stale);
        assert!(!preview.ok);
        assert!(preview
            .issues
            .iter()
            .any(|issue| issue.message == "recommendation differs from computed policy"));
    }

    #[test]
    fn bridge_applies_reordered_final_decisions_without_permissive_override() {
        use crate::{adapter::build_legacy_bridge_preview, fixtures::load_p1_fixture_state};
        let state = load_p1_fixture_state(&crate::fixtures::workspace_root()).unwrap();
        let mut decisions = recommendations(&state.writeback_intents);
        decisions[0].final_decision = Some(WritebackPolicyResult {
            decision: WritebackPolicyDecision::Reject,
            reasons: vec!["human rejected".to_string()],
        });
        decisions.reverse();
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &state.writeback_intents,
            &decisions,
        );
        assert!(
            preview.ok,
            "{:?}",
            preview
                .issues
                .iter()
                .map(|issue| &issue.message)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            preview.audit_event_payloads[0]["payload"]["result"],
            "failure"
        );
        assert_eq!(
            preview.audit_event_payloads[1]["payload"]["detail_json"]["policy_decision"],
            "auto_execute"
        );

        let mut high_risk = state.writeback_intents.clone();
        high_risk[0].risk_level = WritebackRiskLevel::High;
        high_risk[0].policy_decision = WritebackPolicyDecision::NeedsConfirmation;
        let mut decisions = recommendations(&high_risk);
        decisions[0].final_decision = Some(WritebackPolicyResult {
            decision: WritebackPolicyDecision::AutoExecute,
            reasons: vec!["unsafe approval".to_string()],
        });
        let preview = build_legacy_bridge_preview(
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            &high_risk,
            &decisions,
        );
        assert!(!preview.ok);
        assert!(preview.audit_event_payloads.is_empty());
        assert!(preview
            .issues
            .iter()
            .any(|issue| issue.message == "final decision is more permissive than policy"));
    }

    #[test]
    fn checked_legacy_projection_requires_valid_task_graph_and_uses_topological_order() {
        let mut dependency = crate::Task {
            id: "task_dependency".to_string(),
            title: "Dependency".to_string(),
            status: crate::TaskStatus::Accepted,
            owner_actor_type: ActorType::PmAgent,
            owner_actor_id: "pm_agent_ops_001".to_string(),
            depends_on: vec![],
            required_evidence: vec![],
            information_gap_ids: vec![],
            evidence_ids: vec!["ev_dependency".to_string()],
            acceptance_criteria: "Dependency is done.".to_string(),
            due_at: None,
            replan_reason: None,
            external_refs: vec![],
        };
        let dependent = crate::Task {
            id: "task_dependent".to_string(),
            title: "Dependent".to_string(),
            status: crate::TaskStatus::Ready,
            owner_actor_type: ActorType::PmAgent,
            owner_actor_id: "pm_agent_ops_001".to_string(),
            depends_on: vec![dependency.id.clone()],
            required_evidence: vec![],
            information_gap_ids: vec![],
            evidence_ids: vec![],
            acceptance_criteria: "Dependent can start.".to_string(),
            due_at: None,
            replan_reason: None,
            external_refs: vec![],
        };
        let mut graph = crate::TaskGraph {
            id: "tg_checked_projection".to_string(),
            run_id: "run_checked_projection".to_string(),
            version: 1,
            status: crate::TaskGraphStatus::Active,
            generated_by: None,
            autonomy_level: AutonomyLevel::L1,
            business_refs: None,
            tasks: vec![dependent, dependency.clone()],
        };
        let payload = checked_task_graph_to_legacy_workflow_plan(&graph).unwrap();

        assert_eq!(
            payload["workflow_plan_preview"]["topological_order"],
            serde_json::json!(["task_dependency", "task_dependent"])
        );

        dependency.status = crate::TaskStatus::NeedsInfo;
        dependency.evidence_ids.clear();
        graph.tasks[1] = dependency;
        let error = checked_task_graph_to_legacy_workflow_plan(&graph).unwrap_err();
        assert_eq!(error["error"], "invalid_task_graph_for_legacy_projection");
    }
}
