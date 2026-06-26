use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    graph::plan_task_graph, ActorType, Evidence, ExternalWritebackIntent, InformationGap, Task,
    TaskGraph, Validate, WritebackPolicyDecision, WritebackPolicyResult,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyBridgePreview {
    pub ok: bool,
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
    writeback_decisions: &[WritebackPolicyResult],
) -> LegacyBridgePreview {
    let workflow_plan_payload =
        task_graph.and_then(|graph| checked_task_graph_to_legacy_workflow_plan(graph).ok());
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
        .enumerate()
        .map(|(index, intent)| {
            serde_json::json!({
                "intent_id": intent.id,
                "payload": writeback_intent_to_legacy_audit_event(intent, writeback_decisions.get(index))
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
        ok: workflow_plan_payload.is_some(),
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
        target_routes: serde_json::json!({
            "workflow_plan": "/internal/workflows/plan",
            "org_task_create": "/admin/tasks",
            "fact_write": "/internal/facts/write",
            "audit_projection": "/api/admin/audit"
        }),
    }
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
    let policy_decision = decision
        .map(|decision| writeback_policy_decision_str(&decision.decision))
        .unwrap_or_else(|| writeback_policy_decision_str(&intent.policy_decision));
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
