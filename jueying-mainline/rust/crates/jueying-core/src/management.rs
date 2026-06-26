use std::collections::HashSet;

use serde::{Deserialize, Deserializer, Serialize};

use crate::validation::{
    issue, require_non_empty, validate_id, validate_iso_datetime, Validate, ValidationIssue,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementRoleType {
    Executive,
    Manager,
    AgentOperator,
    SpecializedAgent,
    Worker,
    Admin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementPermission {
    ViewManagementDashboard,
    CreateCommand,
    ScheduleCommand,
    ConfigureTrigger,
    DelegateToAgent,
    ApproveHighRisk,
    ViewAllProjects,
    ViewAssignedWork,
    ConfigureGovernance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementDefaultView {
    ManagementCommandCenter,
    AssignedWork,
    AdminGovernance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementCommandStatus {
    Draft,
    Scheduled,
    Active,
    Triggered,
    Delegated,
    Completed,
    Paused,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementTriggerType {
    Manual,
    Scheduled,
    Condition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementProjectStatus {
    Intake,
    Planning,
    Delegated,
    InProgress,
    NeedsInfo,
    Review,
    Done,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementProjectDomain {
    Sales,
    Delivery,
    Operations,
    Governance,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectHealth {
    Green,
    Yellow,
    Red,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DelegationActorType {
    Executive,
    PmAgent,
    SalesAgent,
    DeliveryAgent,
    WorkerAgent,
    HumanTwinAgent,
    Human,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionActorType {
    PmAgent,
    SalesAgent,
    DeliveryAgent,
    WorkerAgent,
    HumanTwinAgent,
    Human,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionUpdateType {
    Decomposition,
    Handoff,
    Progress,
    Evidence,
    Blocker,
    Result,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementCommandCenter {
    pub id: String,
    pub version: String,
    pub active_user_id: String,
    pub roles: Vec<ManagementRole>,
    pub commands: Vec<ManagementCommand>,
    pub execution_tasks: Vec<ManagementExecutionTask>,
    pub execution_updates: Vec<ManagementExecutionUpdate>,
    pub projects: Vec<ManagementProject>,
    pub swimlanes: Vec<ManagementSwimlane>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementRole {
    pub id: String,
    pub name: String,
    pub user_id: String,
    pub role_type: ManagementRoleType,
    pub permissions: Vec<ManagementPermission>,
    pub default_view: ManagementDefaultView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementCommand {
    pub id: String,
    pub title: String,
    pub status: ManagementCommandStatus,
    pub trigger_type: ManagementTriggerType,
    pub created_by_role_id: String,
    pub target_agent_id: String,
    pub objective: String,
    pub task_graph_id: String,
    pub project_id: String,
    #[serde(default)]
    pub generated_task_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<ManagementSchedule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<ManagementCondition>,
    #[serde(default)]
    pub delegation_chain: Vec<DelegationChainItem>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_triggered_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementSchedule {
    pub kind: ScheduleKind,
    pub timezone: String,
    pub next_run_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cadence_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleKind {
    Once,
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementCondition {
    pub signal: String,
    pub operator: ConditionOperator,
    pub threshold: String,
    pub evaluation_window: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionOperator {
    Equals,
    NotEquals,
    GreaterThan,
    LessThan,
    Contains,
    MissingFor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DelegationChainItem {
    pub order: u64,
    pub actor_type: DelegationActorType,
    pub actor_id: String,
    pub responsibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementExecutionTask {
    pub id: String,
    pub command_id: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_graph_id: Option<String>,
    pub title: String,
    pub status: ManagementProjectStatus,
    pub owner_actor_type: ExecutionActorType,
    pub owner_actor_id: String,
    pub source_agent_id: String,
    pub acceptance_criteria: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    pub progress_percent: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_update_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocker: Option<String>,
    #[serde(default)]
    pub evidence_ids: Vec<String>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagementExecutionUpdate {
    pub id: String,
    pub task_id: String,
    pub actor_type: ExecutionActorType,
    pub actor_id: String,
    pub update_type: ExecutionUpdateType,
    pub status: ManagementProjectStatus,
    pub message: String,
    pub progress_percent: f64,
    #[serde(default)]
    pub evidence_ids: Vec<String>,
    #[serde(default, skip_serializing)]
    pub evidence_ids_present: bool,
    pub created_at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManagementExecutionUpdateWire {
    id: String,
    task_id: String,
    actor_type: ExecutionActorType,
    actor_id: String,
    update_type: ExecutionUpdateType,
    status: ManagementProjectStatus,
    message: String,
    progress_percent: f64,
    evidence_ids: Option<Vec<String>>,
    created_at: String,
}

impl<'de> Deserialize<'de> for ManagementExecutionUpdate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = ManagementExecutionUpdateWire::deserialize(deserializer)?;
        let evidence_ids_present = wire.evidence_ids.is_some();
        Ok(Self {
            id: wire.id,
            task_id: wire.task_id,
            actor_type: wire.actor_type,
            actor_id: wire.actor_id,
            update_type: wire.update_type,
            status: wire.status,
            message: wire.message,
            progress_percent: wire.progress_percent,
            evidence_ids: wire.evidence_ids.unwrap_or_default(),
            evidence_ids_present,
            created_at: wire.created_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementProject {
    pub id: String,
    pub name: String,
    pub domain: ManagementProjectDomain,
    pub owner_role_id: String,
    pub task_graph_id: String,
    pub status: ManagementProjectStatus,
    pub health: ProjectHealth,
    pub command_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagementSwimlane {
    pub id: String,
    pub title: String,
    pub status: ManagementProjectStatus,
    #[serde(default)]
    pub task_ids: Vec<String>,
}

impl Validate for ManagementCommandCenter {
    fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = vec![];
        validate_id(&mut issues, "$.id", &self.id);
        require_non_empty(&mut issues, "$.version", &self.version);
        require_non_empty(&mut issues, "$.active_user_id", &self.active_user_id);
        if self.commands.is_empty() {
            issues.push(issue("$.commands", "expected at least 1 item"));
        }
        if self.execution_tasks.is_empty() {
            issues.push(issue("$.execution_tasks", "expected at least 1 item"));
        }
        if self.execution_updates.is_empty() {
            issues.push(issue("$.execution_updates", "expected at least 1 item"));
        }
        if self.projects.is_empty() {
            issues.push(issue("$.projects", "expected at least 1 item"));
        }
        if self.swimlanes.is_empty() {
            issues.push(issue("$.swimlanes", "expected at least 1 item"));
        }

        let role_ids: HashSet<&str> = self.roles.iter().map(|role| role.id.as_str()).collect();
        let command_ids: HashSet<&str> = self.commands.iter().map(|cmd| cmd.id.as_str()).collect();
        let task_ids: HashSet<&str> = self
            .execution_tasks
            .iter()
            .map(|task| task.id.as_str())
            .collect();
        let update_ids: HashSet<&str> = self
            .execution_updates
            .iter()
            .map(|update| update.id.as_str())
            .collect();
        let project_ids: HashSet<&str> = self
            .projects
            .iter()
            .map(|project| project.id.as_str())
            .collect();

        if !self.roles.iter().any(|role| {
            role.role_type == ManagementRoleType::Executive
                && role
                    .permissions
                    .contains(&ManagementPermission::CreateCommand)
        }) {
            issues.push(issue(
                "$.roles",
                "management command center requires an executive role with create_command permission",
            ));
        }
        if !self
            .roles
            .iter()
            .any(|role| role.user_id == self.active_user_id)
        {
            issues.push(issue(
                "$.active_user_id",
                "active_user_id must match a management role user_id",
            ));
        }

        for role in &self.roles {
            validate_id(&mut issues, "$.roles.id", &role.id);
            require_non_empty(&mut issues, "$.roles.name", &role.name);
            require_non_empty(&mut issues, "$.roles.user_id", &role.user_id);
            if role.permissions.is_empty() {
                issues.push(issue("$.roles.permissions", "expected at least 1 item"));
            }
        }

        for command in &self.commands {
            validate_id(&mut issues, "$.commands.id", &command.id);
            require_non_empty(&mut issues, "$.commands.title", &command.title);
            require_non_empty(
                &mut issues,
                "$.commands.target_agent_id",
                &command.target_agent_id,
            );
            require_non_empty(&mut issues, "$.commands.objective", &command.objective);
            validate_id(
                &mut issues,
                "$.commands.task_graph_id",
                &command.task_graph_id,
            );
            let creator = self
                .roles
                .iter()
                .find(|role| role.id == command.created_by_role_id);
            if !role_ids.contains(command.created_by_role_id.as_str()) {
                issues.push(issue(
                    format!("$.commands.{}.created_by_role_id", command.id),
                    format!("unknown role: {}", command.created_by_role_id),
                ));
            }
            if let Some(creator) = creator {
                if !creator
                    .permissions
                    .contains(&ManagementPermission::CreateCommand)
                {
                    issues.push(issue(
                        format!("$.commands.{}.created_by_role_id", command.id),
                        "command creator must have create_command permission",
                    ));
                }
                if command.schedule.is_some()
                    && !creator
                        .permissions
                        .contains(&ManagementPermission::ScheduleCommand)
                {
                    issues.push(issue(
                        format!("$.commands.{}.schedule", command.id),
                        "schedule creator must have schedule_command permission",
                    ));
                }
                if command.condition.is_some()
                    && !creator
                        .permissions
                        .contains(&ManagementPermission::ConfigureTrigger)
                {
                    issues.push(issue(
                        format!("$.commands.{}.condition", command.id),
                        "condition creator must have configure_trigger permission",
                    ));
                }
            }
            if matches!(command.trigger_type, ManagementTriggerType::Scheduled)
                && command.schedule.is_none()
            {
                issues.push(issue(
                    format!("$.commands.{}.schedule", command.id),
                    "scheduled command requires schedule",
                ));
            }
            if matches!(command.trigger_type, ManagementTriggerType::Condition)
                && command.condition.is_none()
            {
                issues.push(issue(
                    format!("$.commands.{}.condition", command.id),
                    "condition command requires condition",
                ));
            }
            if command.delegation_chain.len() < 3 {
                issues.push(issue(
                    format!("$.commands.{}.delegation_chain", command.id),
                    "command must express boss -> agent -> executor delegation",
                ));
            }
            let has_executive = command
                .delegation_chain
                .iter()
                .any(|item| item.actor_type == DelegationActorType::Executive);
            let has_agent = command.delegation_chain.iter().any(|item| {
                matches!(
                    item.actor_type,
                    DelegationActorType::PmAgent
                        | DelegationActorType::SalesAgent
                        | DelegationActorType::DeliveryAgent
                        | DelegationActorType::WorkerAgent
                        | DelegationActorType::HumanTwinAgent
                )
            });
            let has_executor = command.delegation_chain.iter().any(|item| {
                matches!(
                    item.actor_type,
                    DelegationActorType::Human | DelegationActorType::HumanTwinAgent
                )
            });
            for item in &command.delegation_chain {
                if item.order == 0 {
                    issues.push(issue(
                        format!("$.commands.{}.delegation_chain.order", command.id),
                        "delegation chain order must be >= 1",
                    ));
                }
                require_non_empty(
                    &mut issues,
                    "$.commands.delegation_chain.actor_id",
                    &item.actor_id,
                );
                require_non_empty(
                    &mut issues,
                    "$.commands.delegation_chain.responsibility",
                    &item.responsibility,
                );
            }
            if !(has_executive && has_agent && has_executor) {
                issues.push(issue(
                    format!("$.commands.{}.delegation_chain", command.id),
                    "delegation chain must include executive, agent, and human/subordinate executor",
                ));
            }
            if command.generated_task_ids.is_empty() {
                issues.push(issue(
                    format!("$.commands.{}.generated_task_ids", command.id),
                    "command must reference automatically decomposed execution tasks",
                ));
            }
            for task_id in &command.generated_task_ids {
                if !task_ids.contains(task_id.as_str()) {
                    issues.push(issue(
                        format!("$.commands.{}.generated_task_ids", command.id),
                        format!("unknown execution task: {task_id}"),
                    ));
                }
            }
            if !project_ids.contains(command.project_id.as_str()) {
                issues.push(issue(
                    format!("$.commands.{}.project_id", command.id),
                    format!("unknown project: {}", command.project_id),
                ));
            }
            validate_iso_datetime(&mut issues, "$.commands.created_at", &command.created_at);
            if let Some(schedule) = &command.schedule {
                require_non_empty(
                    &mut issues,
                    "$.commands.schedule.timezone",
                    &schedule.timezone,
                );
                validate_iso_datetime(
                    &mut issues,
                    "$.commands.schedule.next_run_at",
                    &schedule.next_run_at,
                );
            }
            if let Some(condition) = &command.condition {
                require_non_empty(
                    &mut issues,
                    "$.commands.condition.signal",
                    &condition.signal,
                );
                require_non_empty(
                    &mut issues,
                    "$.commands.condition.threshold",
                    &condition.threshold,
                );
                require_non_empty(
                    &mut issues,
                    "$.commands.condition.evaluation_window",
                    &condition.evaluation_window,
                );
            }
        }

        for task in &self.execution_tasks {
            validate_id(&mut issues, "$.execution_tasks.id", &task.id);
            require_non_empty(&mut issues, "$.execution_tasks.title", &task.title);
            require_non_empty(
                &mut issues,
                "$.execution_tasks.owner_actor_id",
                &task.owner_actor_id,
            );
            require_non_empty(
                &mut issues,
                "$.execution_tasks.source_agent_id",
                &task.source_agent_id,
            );
            require_non_empty(
                &mut issues,
                "$.execution_tasks.acceptance_criteria",
                &task.acceptance_criteria,
            );
            if let Some(task_graph_id) = &task.task_graph_id {
                validate_id(
                    &mut issues,
                    "$.execution_tasks.task_graph_id",
                    task_graph_id,
                );
            }
            if !command_ids.contains(task.command_id.as_str()) {
                issues.push(issue(
                    format!("$.execution_tasks.{}.command_id", task.id),
                    format!("unknown command: {}", task.command_id),
                ));
            }
            if !project_ids.contains(task.project_id.as_str()) {
                issues.push(issue(
                    format!("$.execution_tasks.{}.project_id", task.id),
                    format!("unknown project: {}", task.project_id),
                ));
            }
            if let Some(command) = self
                .commands
                .iter()
                .find(|command| command.id == task.command_id)
            {
                if !command
                    .generated_task_ids
                    .iter()
                    .any(|task_id| task_id == &task.id)
                {
                    issues.push(issue(
                        format!("$.execution_tasks.{}.command_id", task.id),
                        "execution task command_id must be reciprocal with command.generated_task_ids",
                    ));
                }
            }
            if let Some(update_id) = &task.latest_update_id {
                if !update_ids.contains(update_id.as_str()) {
                    issues.push(issue(
                        format!("$.execution_tasks.{}.latest_update_id", task.id),
                        format!("unknown execution update: {update_id}"),
                    ));
                }
            }
            if task.status == ManagementProjectStatus::Done
                && (task.result_summary.as_deref().unwrap_or("").is_empty()
                    || (task.progress_percent - 100.0).abs() > f64::EPSILON)
            {
                issues.push(issue(
                    format!("$.execution_tasks.{}", task.id),
                    "done execution task must include result_summary and 100 progress",
                ));
            }
            if !(0.0..=100.0).contains(&task.progress_percent) {
                issues.push(issue(
                    format!("$.execution_tasks.{}.progress_percent", task.id),
                    "expected >= 0 and <= 100",
                ));
            }
            if let Some(due_at) = &task.due_at {
                validate_iso_datetime(&mut issues, "$.execution_tasks.due_at", due_at);
            }
            if let Some(updated_at) = &task.updated_at {
                validate_iso_datetime(&mut issues, "$.execution_tasks.updated_at", updated_at);
            }
            for evidence_id in &task.evidence_ids {
                validate_id(&mut issues, "$.execution_tasks.evidence_ids", evidence_id);
            }
            validate_iso_datetime(
                &mut issues,
                "$.execution_tasks.created_at",
                &task.created_at,
            );
        }

        for update in &self.execution_updates {
            validate_id(&mut issues, "$.execution_updates.id", &update.id);
            require_non_empty(
                &mut issues,
                "$.execution_updates.actor_id",
                &update.actor_id,
            );
            require_non_empty(&mut issues, "$.execution_updates.message", &update.message);
            if !task_ids.contains(update.task_id.as_str()) {
                issues.push(issue(
                    format!("$.execution_updates.{}.task_id", update.id),
                    format!("unknown execution task: {}", update.task_id),
                ));
            }
            if !(0.0..=100.0).contains(&update.progress_percent) {
                issues.push(issue(
                    format!("$.execution_updates.{}.progress_percent", update.id),
                    "expected >= 0 and <= 100",
                ));
            }
            if matches!(
                update.update_type,
                ExecutionUpdateType::Result | ExecutionUpdateType::Evidence
            ) && !update.evidence_ids_present
            {
                issues.push(issue(
                    format!("$.execution_updates.{}.evidence_ids", update.id),
                    "result or evidence update must carry evidence_ids, even if empty",
                ));
            }
            for evidence_id in &update.evidence_ids {
                validate_id(&mut issues, "$.execution_updates.evidence_ids", evidence_id);
            }
            validate_iso_datetime(
                &mut issues,
                "$.execution_updates.created_at",
                &update.created_at,
            );
        }

        for project in &self.projects {
            validate_id(&mut issues, "$.projects.id", &project.id);
            require_non_empty(&mut issues, "$.projects.name", &project.name);
            validate_id(
                &mut issues,
                "$.projects.task_graph_id",
                &project.task_graph_id,
            );
            if !role_ids.contains(project.owner_role_id.as_str()) {
                issues.push(issue(
                    format!("$.projects.{}.owner_role_id", project.id),
                    format!("unknown role: {}", project.owner_role_id),
                ));
            }
            if project.command_ids.is_empty() {
                issues.push(issue(
                    format!("$.projects.{}.command_ids", project.id),
                    "expected at least 1 item",
                ));
            }
            for command_id in &project.command_ids {
                if !command_ids.contains(command_id.as_str()) {
                    issues.push(issue(
                        format!("$.projects.{}.command_ids", project.id),
                        format!("unknown command: {command_id}"),
                    ));
                }
            }
        }

        let mut lane_task_count = 0;
        for swimlane in &self.swimlanes {
            validate_id(&mut issues, "$.swimlanes.id", &swimlane.id);
            require_non_empty(&mut issues, "$.swimlanes.title", &swimlane.title);
            lane_task_count += swimlane.task_ids.len();
            for task_id in &swimlane.task_ids {
                if !task_ids.contains(task_id.as_str()) {
                    issues.push(issue(
                        format!("$.swimlanes.{}.task_ids", swimlane.id),
                        format!("unknown execution task: {task_id}"),
                    ));
                }
            }
        }
        if lane_task_count == 0 {
            issues.push(issue(
                "$.swimlanes",
                "swimlane board must contain at least one task",
            ));
        }

        issues
    }
}

impl ManagementRole {
    pub fn has(&self, permission: ManagementPermission) -> bool {
        self.permissions.contains(&permission)
    }
}

#[cfg(test)]
mod tests {
    use crate::{fixtures::load_json, ManagementCommandCenter, Validate};

    #[test]
    fn p1_management_command_center_validates() {
        let root = crate::fixtures::workspace_root();
        let center: ManagementCommandCenter =
            load_json(&root.join("fixtures/p1-demo/management-command-center.json")).unwrap();
        assert!(center.validate().is_empty());
    }

    #[test]
    fn command_creator_permissions_match_js_validator() {
        let root = crate::fixtures::workspace_root();
        let mut center: ManagementCommandCenter =
            load_json(&root.join("fixtures/p1-demo/management-command-center.json")).unwrap();
        let command = center.commands.first_mut().unwrap();
        let creator_id = command.created_by_role_id.clone();
        command.schedule = command.schedule.take().or_else(|| {
            Some(crate::ManagementSchedule {
                kind: crate::ScheduleKind::Once,
                timezone: "Asia/Shanghai".to_string(),
                next_run_at: "2026-06-01T00:00:00+08:00".to_string(),
                cadence_label: None,
            })
        });
        command.condition = command.condition.take().or_else(|| {
            Some(crate::ManagementCondition {
                signal: "risk".to_string(),
                operator: crate::ConditionOperator::Equals,
                threshold: "high".to_string(),
                evaluation_window: "1d".to_string(),
            })
        });
        let creator = center
            .roles
            .iter_mut()
            .find(|role| role.id == creator_id)
            .unwrap();
        creator.permissions.clear();

        let messages = center
            .validate()
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(messages.contains("command creator must have create_command permission"));
        assert!(messages.contains("schedule creator must have schedule_command permission"));
        assert!(messages.contains("condition creator must have configure_trigger permission"));
    }

    #[test]
    fn management_validator_rejects_schema_parity_edge_cases() {
        let root = crate::fixtures::workspace_root();
        let mut center: ManagementCommandCenter =
            load_json(&root.join("fixtures/p1-demo/management-command-center.json")).unwrap();
        let command = center.commands.first_mut().unwrap();
        command.target_agent_id.clear();
        command.objective.clear();
        command.task_graph_id = "bad id".to_string();
        command.delegation_chain[0].order = 0;
        command.delegation_chain[0].actor_id.clear();
        command.delegation_chain[0].responsibility.clear();

        let task = center.execution_tasks.first_mut().unwrap();
        task.title.clear();
        task.owner_actor_id.clear();
        task.source_agent_id.clear();
        task.acceptance_criteria.clear();
        task.progress_percent = 101.0;

        let update = center.execution_updates.first_mut().unwrap();
        update.actor_id.clear();
        update.message.clear();

        let messages = center
            .validate()
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(messages.contains("expected length >= 1"));
        assert!(messages.contains("does not match id pattern"));
        assert!(messages.contains("delegation chain order must be >= 1"));
        assert!(messages.contains("expected >= 0 and <= 100"));
    }

    #[test]
    fn management_validator_rejects_empty_top_level_collections() {
        let root = crate::fixtures::workspace_root();
        let mut center: ManagementCommandCenter =
            load_json(&root.join("fixtures/p1-demo/management-command-center.json")).unwrap();
        center.commands.clear();
        center.execution_tasks.clear();
        center.execution_updates.clear();
        center.projects.clear();
        center.swimlanes.clear();

        let messages = center
            .validate()
            .into_iter()
            .map(|issue| format!("{} {}", issue.path, issue.message))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(messages.contains("$.commands expected at least 1 item"));
        assert!(messages.contains("$.execution_tasks expected at least 1 item"));
        assert!(messages.contains("$.execution_updates expected at least 1 item"));
        assert!(messages.contains("$.projects expected at least 1 item"));
        assert!(messages.contains("$.swimlanes expected at least 1 item"));
    }

    #[test]
    fn result_or_evidence_update_requires_evidence_ids_presence() {
        let missing_evidence_ids = serde_json::json!({
            "id": "mupd_missing_evidence_ids",
            "task_id": "mtask_sales_gate_review",
            "actor_type": "pm_agent",
            "actor_id": "pm_agent_ops_001",
            "update_type": "result",
            "status": "review",
            "message": "Result update without the evidence_ids field.",
            "progress_percent": 90,
            "created_at": "2026-05-25T14:15:00+08:00"
        });
        let update: crate::ManagementExecutionUpdate =
            serde_json::from_value(missing_evidence_ids).unwrap();
        assert_eq!(update.evidence_ids, Vec::<String>::new());
        assert!(!update.evidence_ids_present);

        let root = crate::fixtures::workspace_root();
        let mut center: ManagementCommandCenter =
            load_json(&root.join("fixtures/p1-demo/management-command-center.json")).unwrap();
        center.execution_updates.push(update);
        center.execution_tasks[0].latest_update_id = Some("mupd_missing_evidence_ids".to_string());

        let messages = center
            .validate()
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(
            messages.contains("result or evidence update must carry evidence_ids, even if empty")
        );
    }

    #[test]
    fn active_user_must_match_a_role_user_id() {
        let root = crate::fixtures::workspace_root();
        let mut center: ManagementCommandCenter =
            load_json(&root.join("fixtures/p1-demo/management-command-center.json")).unwrap();
        center.active_user_id = "unknown_user".to_string();

        let messages = center
            .validate()
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(messages.contains("active_user_id must match a management role user_id"));
    }

    #[test]
    fn command_generated_tasks_must_be_reciprocal() {
        let root = crate::fixtures::workspace_root();
        let mut center: ManagementCommandCenter =
            load_json(&root.join("fixtures/p1-demo/management-command-center.json")).unwrap();
        let second_command_id = center.commands[1].id.clone();
        center.execution_tasks[0].command_id = second_command_id;

        let messages = center
            .validate()
            .into_iter()
            .map(|issue| issue.message)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(messages.contains(
            "execution task command_id must be reciprocal with command.generated_task_ids"
        ));
    }
}
