use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validation::{
    issue, require_non_empty, validate_id, validate_iso_datetime, Validate, ValidationIssue,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskGraphStatus {
    Draft,
    ReadyForConfirmation,
    Active,
    Blocked,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Ready,
    Assigned,
    InProgress,
    NeedsInfo,
    NeedsSupplement,
    Blocked,
    Accepted,
    Rejected,
    Waived,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InformationGapStatus {
    Open,
    Collecting,
    EvidenceSubmitted,
    Closed,
    Waived,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SalesGateStatus {
    Unknown,
    Missing,
    Collecting,
    EvidenceSubmitted,
    Confirmed,
    NeedsSupplement,
    Rejected,
    Waived,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutonomyLevel {
    L0,
    L1,
    L2,
    L3,
    L4,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorType {
    PmAgent,
    WorkerAgent,
    HumanTwinAgent,
    Human,
    ExternalSystem,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    MeetingSummary,
    MeetingMinutes,
    CustomerQuote,
    Email,
    ChatScreenshot,
    WhiteboardPhoto,
    SalesNote,
    StakeholderMap,
    ChampionConfirmation,
    EbConfirmation,
    BudgetNote,
    CalendarEvent,
    CustomerConfirmation,
    EvaluationCriteria,
    ProcessNote,
    ValidationPlan,
    BusinessCase,
    Quote,
    PricingModel,
    ApprovalRecord,
    OrderChecklist,
    ContractDocument,
    Sow,
    RiskNote,
    NegotiationPlan,
    ContactRecord,
    InternalReview,
    ExternalResearch,
    CrmUrl,
    CrmSnapshot,
    PmUrl,
    PmSnapshot,
    DeliveryConfirmation,
    HumanConfirmation,
    SystemEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalSystemType {
    Crm,
    ProjectManagement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WritebackRiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WritebackPolicyDecision {
    AutoExecute,
    NeedsConfirmation,
    Reject,
    ManualOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WritebackOperation {
    CreateNote,
    CreateTask,
    CreateComment,
    AddLink,
    UpdateField,
    UpdateStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOutputKind {
    PmAgentPlan,
    PmAgentVerify,
    HumanTwinCollectPrompt,
    HumanTwinCollectResult,
    ManagementCommandPlan,
    ScheduledCommandTick,
    ConditionTriggerMatch,
    Replan,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SalesStage {
    Discover,
    Scope,
    GoNoGo,
    ValidateSolution,
    BusinessCase,
    NegotiateClose,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    Human,
    Agent,
    System,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    Text,
    File,
    Url,
    ExternalRecord,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sensitivity {
    Public,
    Internal,
    Confidential,
    Restricted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Freshness {
    Fresh,
    Stale,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContentRef {
    pub kind: ContentKind,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub id: String,
    pub evidence_type: EvidenceType,
    pub source_type: SourceType,
    pub source_actor_id: String,
    pub capture_channel: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_refs: Option<Value>,
    pub content_ref: ContentRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality_score: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sensitivity: Option<Sensitivity>,
    pub created_at: String,
}

impl Validate for Evidence {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        require_non_empty(&mut issues, "$.source_actor_id", &self.source_actor_id);
        require_non_empty(&mut issues, "$.capture_channel", &self.capture_channel);
        if let Some(task_id) = &self.task_id {
            validate_id(&mut issues, "$.task_id", task_id);
        }
        if let Some(gap_id) = &self.gap_id {
            validate_id(&mut issues, "$.gap_id", gap_id);
        }
        require_non_empty(&mut issues, "$.content_ref.value", &self.content_ref.value);
        if let Some(score) = self.quality_score {
            if !(0.0..=1.0).contains(&score) {
                issues.push(issue("$.quality_score", "expected >= 0 and <= 1"));
            }
        }
        validate_iso_datetime(&mut issues, "$.created_at", &self.created_at);
        issues
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InformationGap {
    pub id: String,
    pub task_id: String,
    pub status: InformationGapStatus,
    pub question: String,
    pub reason: String,
    pub collector_actor_id: String,
    pub required_schema: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_evidence_types: Option<Vec<EvidenceType>>,
    pub priority: Priority,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub closed_by_evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low,
    Medium,
    High,
    Urgent,
}

impl Validate for InformationGap {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        validate_id(&mut issues, "$.task_id", &self.task_id);
        require_non_empty(&mut issues, "$.question", &self.question);
        require_non_empty(&mut issues, "$.reason", &self.reason);
        require_non_empty(
            &mut issues,
            "$.collector_actor_id",
            &self.collector_actor_id,
        );
        if let Some(expected_evidence_types) = &self.expected_evidence_types {
            if expected_evidence_types.is_empty() {
                issues.push(issue(
                    "$.expected_evidence_types",
                    "expected at least 1 item(s) when present",
                ));
            }
        }
        if let Some(due_at) = &self.due_at {
            validate_iso_datetime(&mut issues, "$.due_at", due_at);
        }
        validate_iso_datetime(&mut issues, "$.created_at", &self.created_at);
        for id in &self.closed_by_evidence_ids {
            validate_id(&mut issues, "$.closed_by_evidence_ids", id);
        }
        issues
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskGraph {
    pub id: String,
    pub run_id: String,
    pub version: u64,
    pub status: TaskGraphStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated_by: Option<String>,
    pub autonomy_level: AutonomyLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_refs: Option<Value>,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
    pub owner_actor_type: ActorType,
    pub owner_actor_id: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub required_evidence: Vec<EvidenceType>,
    #[serde(default)]
    pub information_gap_ids: Vec<String>,
    #[serde(default)]
    pub evidence_ids: Vec<String>,
    pub acceptance_criteria: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replan_reason: Option<String>,
    #[serde(default)]
    pub external_refs: Vec<ExternalRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalRef {
    pub system_type: ExternalSystemType,
    pub mirror_id: String,
}

impl Validate for TaskGraph {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        validate_id(&mut issues, "$.run_id", &self.run_id);
        if self.version == 0 {
            issues.push(issue("$.version", "expected >= 1"));
        }
        if self.tasks.is_empty() {
            issues.push(issue("$.tasks", "expected at least 1 item"));
        }

        let mut ids = HashSet::new();
        for task in &self.tasks {
            validate_id(&mut issues, "$.tasks.id", &task.id);
            require_non_empty(&mut issues, "$.tasks.title", &task.title);
            require_non_empty(&mut issues, "$.tasks.owner_actor_id", &task.owner_actor_id);
            require_non_empty(
                &mut issues,
                "$.tasks.acceptance_criteria",
                &task.acceptance_criteria,
            );
            if !ids.insert(task.id.clone()) {
                issues.push(issue("$.tasks", format!("duplicate task id: {}", task.id)));
            }
            let mut dependency_ids = HashSet::new();
            for dependency_id in &task.depends_on {
                validate_id(&mut issues, "$.tasks.depends_on", dependency_id);
                if dependency_id == &task.id {
                    issues.push(issue(
                        format!("$.tasks.{}.depends_on", task.id),
                        "task cannot depend on itself",
                    ));
                }
                if !dependency_ids.insert(dependency_id.as_str()) {
                    issues.push(issue(
                        format!("$.tasks.{}.depends_on", task.id),
                        format!("duplicate dependency: {dependency_id}"),
                    ));
                }
            }
            for gap_id in &task.information_gap_ids {
                validate_id(&mut issues, "$.tasks.information_gap_ids", gap_id);
            }
            for evidence_id in &task.evidence_ids {
                validate_id(&mut issues, "$.tasks.evidence_ids", evidence_id);
            }
            for external_ref in &task.external_refs {
                validate_id(
                    &mut issues,
                    "$.tasks.external_refs.mirror_id",
                    &external_ref.mirror_id,
                );
            }
            if let Some(due_at) = &task.due_at {
                validate_iso_datetime(&mut issues, "$.tasks.due_at", due_at);
            }
            if task.status == TaskStatus::Accepted && task.evidence_ids.is_empty() {
                issues.push(issue(
                    format!("$.tasks.{}.evidence_ids", task.id),
                    "accepted task must reference evidence",
                ));
            }
        }

        for task in &self.tasks {
            for dependency_id in &task.depends_on {
                if !ids.contains(dependency_id) {
                    issues.push(issue(
                        format!("$.tasks.{}.depends_on", task.id),
                        format!("unknown dependency: {dependency_id}"),
                    ));
                }
            }
        }

        issues.extend(crate::graph::dependency_cycle_issues(&self.tasks));
        issues.extend(crate::graph::dependency_status_issues(&self.tasks));
        issues
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SalesGateCheck {
    pub id: String,
    pub opportunity_id: String,
    pub stage: SalesStage,
    pub gate_id: String,
    pub status: SalesGateStatus,
    pub evidence_ids: Vec<String>,
    pub information_gap_ids: Vec<String>,
    pub recommended_activity_ids: Vec<String>,
    pub owner_id: String,
    pub updated_at: String,
}

impl Validate for SalesGateCheck {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        require_non_empty(&mut issues, "$.opportunity_id", &self.opportunity_id);
        if !valid_gate_id(&self.gate_id) {
            issues.push(issue("$.gate_id", "does not match gate id pattern"));
        }
        for evidence_id in &self.evidence_ids {
            validate_id(&mut issues, "$.evidence_ids", evidence_id);
        }
        for gap_id in &self.information_gap_ids {
            validate_id(&mut issues, "$.information_gap_ids", gap_id);
        }
        for activity_id in &self.recommended_activity_ids {
            validate_id(&mut issues, "$.recommended_activity_ids", activity_id);
        }
        require_non_empty(&mut issues, "$.owner_id", &self.owner_id);
        validate_iso_datetime(&mut issues, "$.updated_at", &self.updated_at);
        if matches!(
            self.status,
            SalesGateStatus::Confirmed | SalesGateStatus::EvidenceSubmitted
        ) && self.evidence_ids.is_empty()
        {
            issues.push(issue(
                "$.evidence_ids",
                "confirmed or evidence_submitted gate must reference evidence",
            ));
        }
        if matches!(
            self.status,
            SalesGateStatus::Missing
                | SalesGateStatus::Collecting
                | SalesGateStatus::NeedsSupplement
                | SalesGateStatus::Rejected
        ) && self.information_gap_ids.is_empty()
        {
            issues.push(issue(
                "$.information_gap_ids",
                "missing gate must reference an information gap",
            ));
        }
        issues
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalFactMirror {
    pub id: String,
    pub connection_id: String,
    pub system_type: ExternalSystemType,
    pub provider: String,
    pub object_type: String,
    pub external_id: String,
    pub external_url: String,
    pub mirrored_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_updated_at: Option<String>,
    pub field_snapshot: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_mapping_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freshness: Option<Freshness>,
}

impl Validate for ExternalFactMirror {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        validate_id(&mut issues, "$.connection_id", &self.connection_id);
        require_non_empty(&mut issues, "$.provider", &self.provider);
        require_non_empty(&mut issues, "$.object_type", &self.object_type);
        require_non_empty(&mut issues, "$.external_id", &self.external_id);
        require_non_empty(&mut issues, "$.external_url", &self.external_url);
        validate_iso_datetime(&mut issues, "$.mirrored_at", &self.mirrored_at);
        if let Some(source_updated_at) = &self.source_updated_at {
            validate_iso_datetime(&mut issues, "$.source_updated_at", source_updated_at);
        }
        issues
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalWritebackIntent {
    pub id: String,
    pub connection_id: String,
    pub system_type: ExternalSystemType,
    pub provider: String,
    pub target: WritebackTarget,
    pub operation: WritebackOperation,
    pub payload: Value,
    pub source: WritebackSource,
    pub risk_level: WritebackRiskLevel,
    pub idempotency_key: String,
    pub policy_decision: WritebackPolicyDecision,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WritebackTarget {
    pub object_type: String,
    pub external_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WritebackSource {
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default)]
    pub evidence_ids: Vec<String>,
    pub reason: String,
}

impl Validate for ExternalWritebackIntent {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        validate_id(&mut issues, "$.connection_id", &self.connection_id);
        require_non_empty(&mut issues, "$.provider", &self.provider);
        require_non_empty(
            &mut issues,
            "$.target.object_type",
            &self.target.object_type,
        );
        require_non_empty(
            &mut issues,
            "$.target.external_id",
            &self.target.external_id,
        );
        require_non_empty(&mut issues, "$.source.agent_id", &self.source.agent_id);
        require_non_empty(&mut issues, "$.source.reason", &self.source.reason);
        if let Some(task_id) = &self.source.task_id {
            validate_id(&mut issues, "$.source.task_id", task_id);
        }
        for evidence_id in &self.source.evidence_ids {
            validate_id(&mut issues, "$.source.evidence_ids", evidence_id);
        }
        if self.idempotency_key.len() < 8 {
            issues.push(issue("$.idempotency_key", "expected length >= 8"));
        }
        validate_iso_datetime(&mut issues, "$.created_at", &self.created_at);
        if let Some(confirmed_at) = &self.confirmed_at {
            validate_iso_datetime(&mut issues, "$.confirmed_at", confirmed_at);
        }
        if self.risk_level == WritebackRiskLevel::High
            && self.policy_decision == WritebackPolicyDecision::AutoExecute
        {
            issues.push(issue(
                "$.policy_decision",
                "high-risk writeback cannot auto_execute",
            ));
        }
        if self.operation == WritebackOperation::UpdateStatus
            && self.policy_decision == WritebackPolicyDecision::AutoExecute
        {
            issues.push(issue(
                "$.policy_decision",
                "status updates require confirmation",
            ));
        }
        let computed_policy = crate::writeback::decide_writeback_policy(self);
        if !crate::writeback::policy_decision_allows(
            &self.policy_decision,
            &computed_policy.decision,
        ) {
            issues.push(issue(
                "$.policy_decision",
                format!(
                    "stored policy_decision is more permissive than computed policy {:?}: {}",
                    computed_policy.decision,
                    computed_policy.reasons.join("; ")
                ),
            ));
        }
        issues
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentOutput {
    pub id: String,
    pub kind: AgentOutputKind,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub created_at: String,
    pub payload: Value,
}

impl Validate for AgentOutput {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        require_non_empty(&mut issues, "$.agent_id", &self.agent_id);
        if let Some(run_id) = &self.run_id {
            validate_id(&mut issues, "$.run_id", run_id);
        }
        if let Some(task_id) = &self.task_id {
            validate_id(&mut issues, "$.task_id", task_id);
        }
        validate_iso_datetime(&mut issues, "$.created_at", &self.created_at);
        let Some(payload) = self.payload.as_object() else {
            issues.push(issue("$.payload", "expected object"));
            return issues;
        };
        for &field in required_agent_payload_fields(&self.kind) {
            if !payload.contains_key(field) {
                issues.push(issue(
                    format!("$.payload.{field}"),
                    "required field missing for agent output kind",
                ));
            }
        }
        if self.kind == AgentOutputKind::PmAgentVerify {
            if let Some(decision) = payload.get("decision").and_then(Value::as_str) {
                let valid = matches!(
                    decision,
                    "accepted"
                        | "needs_supplement"
                        | "blocked"
                        | "rejected"
                        | "escalated"
                        | "waived"
                );
                if !valid {
                    issues.push(issue(
                        "$.payload.decision",
                        "expected known verification decision",
                    ));
                }
                let evidence_empty = payload
                    .get("evidence_ids")
                    .and_then(Value::as_array)
                    .map(Vec::is_empty)
                    .unwrap_or(true);
                if decision == "accepted" && evidence_empty {
                    issues.push(issue(
                        "$.payload.evidence_ids",
                        "accepted verification must reference evidence",
                    ));
                }
            }
        }
        if self.kind == AgentOutputKind::HumanTwinCollectResult {
            let ok = payload
                .get("completeness")
                .and_then(Value::as_f64)
                .map(|value| (0.0..=1.0).contains(&value))
                .unwrap_or(false);
            if !ok {
                issues.push(issue(
                    "$.payload.completeness",
                    "expected number between 0 and 1",
                ));
            }
        }
        issues
    }
}

pub fn required_agent_payload_fields(kind: &AgentOutputKind) -> &'static [&'static str] {
    match kind {
        AgentOutputKind::PmAgentPlan => &["task_graph", "information_gaps", "rationale"],
        AgentOutputKind::PmAgentVerify => &["decision", "task_id", "evidence_ids", "reason"],
        AgentOutputKind::HumanTwinCollectPrompt => &[
            "gap_id",
            "recipient_id",
            "message",
            "required_schema",
            "deadline",
        ],
        AgentOutputKind::HumanTwinCollectResult => {
            &["gap_id", "collector_actor_id", "evidence", "completeness"]
        }
        AgentOutputKind::ManagementCommandPlan => &[
            "command_id",
            "task_graph_id",
            "delegation_chain",
            "expected_outcome",
        ],
        AgentOutputKind::ScheduledCommandTick => {
            &["command_id", "scheduled_for", "next_run_at", "reason"]
        }
        AgentOutputKind::ConditionTriggerMatch => &[
            "command_id",
            "signal",
            "observed_value",
            "threshold",
            "reason",
        ],
        AgentOutputKind::Replan => &[
            "reason",
            "trigger_evidence_ids",
            "affected_task_ids",
            "new_task_graph",
        ],
    }
}

pub fn evidence_types_from_values(values: &[Evidence]) -> HashMap<EvidenceType, Vec<&Evidence>> {
    let mut grouped: HashMap<EvidenceType, Vec<&Evidence>> = HashMap::new();
    for item in values {
        grouped
            .entry(item.evidence_type.clone())
            .or_default()
            .push(item);
    }
    grouped
}

pub fn valid_gate_id(value: &str) -> bool {
    let mut parts = value.split("-G");
    let prefix = parts.next();
    let number = parts.next();
    parts.next().is_none()
        && matches!(prefix, Some("D" | "S" | "G" | "V" | "B" | "N"))
        && number
            .map(|n| !n.is_empty() && n.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use crate::{InformationGap, SalesGateCheck, Validate};

    #[test]
    fn sales_gate_check_required_arrays_match_js_schema() {
        let missing_arrays = serde_json::json!({
            "id": "sgc_missing_arrays",
            "opportunity_id": "opp_acme_001",
            "stage": "discover",
            "gate_id": "D-G1",
            "status": "missing",
            "owner_id": "user_sales",
            "updated_at": "2026-06-01T00:00:00+08:00"
        });

        assert!(serde_json::from_value::<SalesGateCheck>(missing_arrays).is_err());
    }

    #[test]
    fn task_graph_unknown_fields_are_rejected_but_payload_values_stay_open() {
        let graph_with_extra = serde_json::json!({
            "id": "tg_extra",
            "run_id": "run_extra",
            "version": 1,
            "status": "active",
            "autonomy_level": "L1",
            "tasks": [{
                "id": "task_extra",
                "title": "Task",
                "status": "ready",
                "owner_actor_type": "pm_agent",
                "owner_actor_id": "pm_agent_ops_001",
                "acceptance_criteria": "done",
                "unexpected": true
            }]
        });
        assert!(serde_json::from_value::<crate::TaskGraph>(graph_with_extra).is_err());

        let output_with_open_payload = serde_json::json!({
            "id": "out_payload_open",
            "kind": "pm_agent_plan",
            "agent_id": "pm_agent_ops_001",
            "created_at": "2026-06-01T00:00:00+08:00",
            "payload": {
                "task_graph": {},
                "information_gaps": [],
                "rationale": "ok",
                "future_extension": { "kept": true }
            }
        });
        assert!(serde_json::from_value::<crate::AgentOutput>(output_with_open_payload).is_ok());
    }

    #[test]
    fn information_gap_expected_evidence_types_match_js_optional_array_schema() {
        let missing_expected = serde_json::json!({
            "id": "gap_missing_expected",
            "task_id": "task_gap",
            "status": "open",
            "question": "Need evidence?",
            "reason": "Gate requires evidence.",
            "collector_actor_id": "user_sales",
            "required_schema": {},
            "priority": "medium",
            "created_at": "2026-06-01T00:00:00+08:00"
        });
        let missing = serde_json::from_value::<InformationGap>(missing_expected).unwrap();
        assert!(missing.expected_evidence_types.is_none());
        assert!(missing.validate().is_empty());

        let explicit_empty = serde_json::json!({
            "id": "gap_empty_expected",
            "task_id": "task_gap",
            "status": "open",
            "question": "Need evidence?",
            "reason": "Gate requires evidence.",
            "collector_actor_id": "user_sales",
            "required_schema": {},
            "expected_evidence_types": [],
            "priority": "medium",
            "created_at": "2026-06-01T00:00:00+08:00"
        });
        let gap = serde_json::from_value::<InformationGap>(explicit_empty).unwrap();
        let messages = gap
            .validate()
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(messages.contains("expected at least 1 item"));
    }
}
