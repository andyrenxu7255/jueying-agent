use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    decide_writeback_policy, Evidence, ExternalFactMirror, ExternalWritebackIntent, FixtureState,
    Freshness, InformationGap, LegacyBridgePreview, ManagementCommand, ManagementCommandCenter,
    ManagementExecutionTask, ManagementExecutionUpdate, ManagementPermission, ManagementProject,
    ManagementProjectStatus, ManagementRole, SalesGateStatus, Task, TaskGraph,
    WritebackPolicyDecision,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatingConsoleViewModel {
    pub run_id: String,
    pub task_graph_id: String,
    pub task_graph_status: String,
    pub active_role: Option<RoleSummary>,
    pub task_counts: BTreeMap<String, usize>,
    pub gate_counts: BTreeMap<String, usize>,
    pub stale_mirror_count: usize,
    pub pending_writeback_count: usize,
    pub role_action_count: usize,
    pub role_action_queue: Vec<RoleAction>,
    pub primary_alerts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleSummary {
    pub id: String,
    pub name: String,
    pub user_id: String,
    pub role_type: String,
    pub permissions: Vec<String>,
    pub default_view: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleAction {
    pub rank: usize,
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub title: String,
    pub reason: String,
    pub next_step: String,
    pub target_view: String,
    pub target_view_label: String,
    pub priority: String,
    pub status: String,
    pub due_at: Option<String>,
    pub owner: Value,
    pub related: Value,
}

pub fn build_operating_console_view_model(state: &FixtureState) -> OperatingConsoleViewModel {
    let task_counts = count_by(
        state
            .task_graph
            .tasks
            .iter()
            .map(|task| format!("{:?}", task.status).to_case()),
    );
    let gate_counts = count_by(
        state
            .gate_checks
            .iter()
            .map(|check| format!("{:?}", check.status).to_case()),
    );
    let stale_mirror_count = state
        .mirrors
        .iter()
        .filter(|mirror| !matches!(mirror.freshness, Some(Freshness::Fresh)))
        .count();
    let pending_writeback_count = state
        .writeback_intents
        .iter()
        .filter(|intent| intent.policy_decision != WritebackPolicyDecision::AutoExecute)
        .count();
    let role_context = RoleContext::from_management(&state.management);
    let role_action_queue = build_role_action_queue(state, &role_context);

    let mut primary_alerts = vec![];
    if let Some(count) = task_counts.get("needs_info") {
        if *count > 0 {
            primary_alerts.push(format!("{count} task(s) need information"));
        }
    }
    if let Some(count) = gate_counts.get("missing") {
        if *count > 0 {
            primary_alerts.push(format!("{count} sales gate(s) missing evidence"));
        }
    }
    if stale_mirror_count > 0 {
        primary_alerts.push(format!("{stale_mirror_count} external mirror(s) stale"));
    }
    if pending_writeback_count > 0 {
        primary_alerts.push(format!(
            "{pending_writeback_count} writeback intent(s) need confirmation"
        ));
    }

    OperatingConsoleViewModel {
        run_id: state.task_graph.run_id.clone(),
        task_graph_id: state.task_graph.id.clone(),
        task_graph_status: format!("{:?}", state.task_graph.status).to_case(),
        active_role: role_context.active_role.map(summarize_role),
        task_counts,
        gate_counts,
        stale_mirror_count,
        pending_writeback_count,
        role_action_count: role_action_queue.len(),
        role_action_queue,
        primary_alerts,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskGraphViewModel {
    pub id: String,
    pub run_id: String,
    pub version: u64,
    pub status: String,
    pub tasks: Vec<TaskView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskView {
    pub id: String,
    pub title: String,
    pub status: String,
    pub owner: Value,
    pub depends_on: Vec<String>,
    pub evidence: Vec<Evidence>,
    pub information_gaps: Vec<InformationGap>,
    pub acceptance_criteria: String,
    pub due_at: Option<String>,
}

pub fn build_task_graph_view_model(
    task_graph: &TaskGraph,
    evidence: &[Evidence],
    gaps: &[InformationGap],
) -> TaskGraphViewModel {
    let evidence_by_id: HashMap<&str, &Evidence> = evidence
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect();
    let gaps_by_id: HashMap<&str, &InformationGap> =
        gaps.iter().map(|gap| (gap.id.as_str(), gap)).collect();
    TaskGraphViewModel {
        id: task_graph.id.clone(),
        run_id: task_graph.run_id.clone(),
        version: task_graph.version,
        status: format!("{:?}", task_graph.status).to_case(),
        tasks: task_graph
            .tasks
            .iter()
            .map(|task| TaskView {
                id: task.id.clone(),
                title: task.title.clone(),
                status: format!("{:?}", task.status).to_case(),
                owner: serde_json::json!({
                    "type": format!("{:?}", task.owner_actor_type).to_case(),
                    "id": task.owner_actor_id
                }),
                depends_on: task.depends_on.clone(),
                evidence: task
                    .evidence_ids
                    .iter()
                    .filter_map(|id| evidence_by_id.get(id.as_str()).copied().cloned())
                    .collect(),
                information_gaps: task
                    .information_gap_ids
                    .iter()
                    .filter_map(|id| gaps_by_id.get(id.as_str()).copied().cloned())
                    .collect(),
                acceptance_criteria: task.acceptance_criteria.clone(),
                due_at: task.due_at.clone(),
            })
            .collect(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalSyncConsoleViewModel {
    pub mirrors: Vec<Value>,
    pub writeback_queue: Vec<Value>,
}

pub fn build_external_sync_console_view_model(
    mirrors: &[ExternalFactMirror],
    writeback_intents: &[ExternalWritebackIntent],
) -> ExternalSyncConsoleViewModel {
    ExternalSyncConsoleViewModel {
        mirrors: mirrors
            .iter()
            .map(|mirror| {
                serde_json::json!({
                    "id": mirror.id,
                    "system_type": format!("{:?}", mirror.system_type).to_case(),
                    "provider": mirror.provider,
                    "object_type": mirror.object_type,
                    "external_id": mirror.external_id,
                    "external_url": mirror.external_url,
                    "freshness": mirror.freshness.as_ref().map(|v| format!("{:?}", v).to_case()),
                    "mirrored_at": mirror.mirrored_at
                })
            })
            .collect(),
        writeback_queue: writeback_intents
            .iter()
            .map(|intent| {
                serde_json::json!({
                    "id": intent.id,
                    "system_type": format!("{:?}", intent.system_type).to_case(),
                    "provider": intent.provider,
                    "operation": format!("{:?}", intent.operation).to_case(),
                    "target": intent.target,
                    "risk_level": format!("{:?}", intent.risk_level).to_case(),
                    "policy_decision": format!("{:?}", intent.policy_decision).to_case(),
                    "created_at": intent.created_at
                })
            })
            .collect(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagementCommandCenterViewModel {
    pub ok: bool,
    pub active_role: Option<RoleSummary>,
    pub summary: Value,
    pub permissions: Value,
    pub roles: Vec<RoleSummary>,
    pub command_templates: Vec<Value>,
    pub commands: Vec<Value>,
    pub projects: Vec<Value>,
    pub swimlanes: Vec<Value>,
    pub execution_updates: Vec<Value>,
    pub action_hint: String,
}

pub fn build_management_command_center_view_model(
    management: &ManagementCommandCenter,
) -> ManagementCommandCenterViewModel {
    build_management_command_center_view_model_with_context(management, None, &[], &[], None)
}

pub fn build_management_command_center_view_model_with_context(
    management: &ManagementCommandCenter,
    task_graph: Option<&TaskGraph>,
    gaps: &[InformationGap],
    evidence: &[Evidence],
    bridge_preview: Option<&LegacyBridgePreview>,
) -> ManagementCommandCenterViewModel {
    let role_context = RoleContext::from_management(management);
    let visible_commands = visible_commands(management, &role_context);
    let visible_command_ids: HashSet<&str> = visible_commands
        .iter()
        .map(|command| command.id.as_str())
        .collect();
    let visible_projects = visible_projects(management, &role_context, &visible_command_ids);
    let visible_graph_ids: HashSet<&str> = visible_commands
        .iter()
        .map(|command| command.task_graph_id.as_str())
        .chain(
            visible_projects
                .iter()
                .map(|project| project.task_graph_id.as_str()),
        )
        .collect();
    let visible_execution_tasks = management
        .execution_tasks
        .iter()
        .filter(|task| {
            role_context.can_see_execution_task(&task.owner_actor_id, &task.source_agent_id)
        })
        .collect::<Vec<_>>();
    let command_counts = count_by(
        visible_commands
            .iter()
            .map(|command| format!("{:?}", command.trigger_type).to_case()),
    );
    let project_counts = count_by(
        visible_projects
            .iter()
            .map(|project| format!("{:?}", project.health).to_case()),
    );
    let execution_status_counts = count_by(
        visible_execution_tasks
            .iter()
            .map(|task| format!("{:?}", task.status).to_case()),
    );
    let delegated_task_count = visible_execution_tasks
        .iter()
        .filter(|task| {
            matches!(
                task.status,
                ManagementProjectStatus::Delegated
                    | ManagementProjectStatus::NeedsInfo
                    | ManagementProjectStatus::InProgress
            )
        })
        .count();
    let visible_task_ids: HashSet<&str> = visible_execution_tasks
        .iter()
        .map(|task| task.id.as_str())
        .collect();
    ManagementCommandCenterViewModel {
        ok: role_context.active_role.is_some()
            && (role_context.has_permission(ManagementPermission::ViewManagementDashboard)
                || role_context.has_permission(ManagementPermission::ViewAssignedWork)
                || role_context.has_permission(ManagementPermission::ViewAllProjects)),
        active_role: role_context.active_role.map(summarize_role),
        summary: serde_json::json!({
            "command_count": visible_commands.len(),
            "scheduled_command_count": command_counts.get("scheduled").copied().unwrap_or(0),
            "condition_command_count": command_counts.get("condition").copied().unwrap_or(0),
            "manual_command_count": command_counts.get("manual").copied().unwrap_or(0),
            "project_count": visible_projects.len(),
            "red_project_count": project_counts.get("red").copied().unwrap_or(0),
            "decomposed_task_count": visible_execution_tasks.len(),
            "delegated_task_count": delegated_task_count,
            "in_progress_task_count": execution_status_counts.get("in_progress").copied().unwrap_or(0),
            "result_task_count": execution_status_counts.get("done").copied().unwrap_or(0),
            "bridge_org_task_count": bridge_preview
                .and_then(|preview| preview.summary.get("org_task_payload_count"))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        }),
        permissions: summarize_management_permissions(role_context.active_role),
        roles: management.roles.iter().map(summarize_role).collect(),
        command_templates: command_templates(),
        commands: visible_commands
            .iter()
            .map(|command| command_view(command, management, visible_execution_tasks.as_slice()))
            .collect(),
        projects: visible_projects
            .iter()
            .map(|project| project_view(project, management, &visible_command_ids))
            .collect(),
        swimlanes: management
            .swimlanes
            .iter()
            .map(|lane| {
                let tasks = lane
                    .task_ids
                    .iter()
                    .filter_map(|task_id| {
                        management
                            .execution_tasks
                            .iter()
                            .find(|task| task.id.as_str() == task_id.as_str())
                            .filter(|task| {
                                role_context.can_see_execution_task(
                                    &task.owner_actor_id,
                                    &task.source_agent_id,
                                )
                            })
                            .map(|task| execution_task_view(task, management, &visible_command_ids))
                            .or_else(|| {
                                task_graph.and_then(|graph| {
                                    graph
                                        .tasks
                                        .iter()
                                        .find(|task| task.id.as_str() == task_id.as_str())
                                        .map(|task| {
                                            task_graph_task_view(
                                                task,
                                                role_context.can_see_task(
                                                    task,
                                                    graph.id.as_str(),
                                                    &visible_graph_ids,
                                                ),
                                                gaps,
                                                evidence,
                                            )
                                        })
                                })
                            })
                    })
                    .filter(|task| task["visible"].as_bool().unwrap_or(true))
                    .map(|mut task| {
                        if let Some(object) = task.as_object_mut() {
                            object.remove("visible");
                        }
                        task
                    })
                    .collect::<Vec<_>>();
                serde_json::json!({
                    "id": lane.id,
                    "title": lane.title,
                    "status": format!("{:?}", lane.status).to_case(),
                    "tasks": tasks
                })
            })
            .collect(),
        execution_updates: management
            .execution_updates
            .iter()
            .filter(|update| visible_task_ids.contains(update.task_id.as_str()))
            .map(execution_update_view)
            .collect(),
        action_hint:
            "Boss command remains a management command; TaskGraph stays the execution fact center."
                .to_string(),
    }
}

fn task_graph_task_view(
    task: &Task,
    visible: bool,
    gaps: &[InformationGap],
    evidence: &[Evidence],
) -> Value {
    serde_json::json!({
        "visible": visible,
        "id": task.id,
        "title": task.title,
        "status": format!("{:?}", task.status).to_case(),
        "source": "task_graph_task",
        "command": null,
        "owner": {
            "type": format!("{:?}", task.owner_actor_type).to_case(),
            "id": task.owner_actor_id
        },
        "due_at": task.due_at,
        "progress_percent": null,
        "latest_update": null,
        "result_summary": null,
        "blocker": null,
        "gap_count": gaps.iter().filter(|gap| gap.task_id.as_str() == task.id.as_str()).count(),
        "evidence_count": evidence.iter().filter(|item| item.task_id.as_deref() == Some(task.id.as_str())).count(),
        "acceptance_criteria": task.acceptance_criteria
    })
}

fn visible_commands<'a>(
    management: &'a ManagementCommandCenter,
    role_context: &RoleContext<'a>,
) -> Vec<&'a ManagementCommand> {
    management
        .commands
        .iter()
        .filter(|command| {
            role_context
                .visible_commands()
                .contains(command.id.as_str())
        })
        .collect()
}

fn visible_projects<'a>(
    management: &'a ManagementCommandCenter,
    role_context: &RoleContext<'a>,
    visible_command_ids: &HashSet<&str>,
) -> Vec<&'a ManagementProject> {
    if role_context.has_permission(ManagementPermission::ViewAllProjects)
        || role_context.has_permission(ManagementPermission::ViewManagementDashboard)
    {
        return management.projects.iter().collect();
    }
    management
        .projects
        .iter()
        .filter(|project| {
            role_context
                .active_role
                .map(|role| project.owner_role_id == role.id)
                .unwrap_or(false)
                || project
                    .command_ids
                    .iter()
                    .any(|command_id| visible_command_ids.contains(command_id.as_str()))
        })
        .collect()
}

fn summarize_management_permissions(role: Option<&ManagementRole>) -> Value {
    let has = |permission| role.map(|role| role.has(permission)).unwrap_or(false);
    serde_json::json!({
        "can_view_management_dashboard": has(ManagementPermission::ViewManagementDashboard),
        "can_create_command": has(ManagementPermission::CreateCommand),
        "can_schedule_command": has(ManagementPermission::ScheduleCommand),
        "can_configure_trigger": has(ManagementPermission::ConfigureTrigger),
        "can_delegate_to_agent": has(ManagementPermission::DelegateToAgent),
        "can_approve_high_risk": has(ManagementPermission::ApproveHighRisk),
        "can_view_all_projects": has(ManagementPermission::ViewAllProjects),
        "can_view_assigned_work": has(ManagementPermission::ViewAssignedWork),
        "can_configure_governance": has(ManagementPermission::ConfigureGovernance)
    })
}

fn command_templates() -> Vec<Value> {
    vec![
        serde_json::json!({
            "id": "manual_agent_dispatch",
            "label": "即时下发",
            "trigger_type": "manual",
            "description": "老板输入经营意图，运营 PM Agent 拆成 TaskGraph 并委派给专门 Agent。"
        }),
        serde_json::json!({
            "id": "scheduled_routine",
            "label": "定时任务",
            "trigger_type": "scheduled",
            "description": "按固定节奏自动巡检项目、销售、交付或任意组织管理事项。"
        }),
        serde_json::json!({
            "id": "condition_escalation",
            "label": "条件触发",
            "trigger_type": "condition",
            "description": "当外部系统或 TaskGraph 信号越过阈值时自动升级并派发任务。"
        }),
    ]
}

fn command_view(
    command: &ManagementCommand,
    management: &ManagementCommandCenter,
    visible_execution_tasks: &[&ManagementExecutionTask],
) -> Value {
    let generated_task_count = command
        .generated_task_ids
        .iter()
        .filter(|task_id| {
            visible_execution_tasks
                .iter()
                .any(|task| task.id.as_str() == task_id.as_str())
        })
        .count();
    serde_json::json!({
        "id": command.id,
        "title": command.title,
        "status": format!("{:?}", command.status).to_case(),
        "trigger_type": format!("{:?}", command.trigger_type).to_case(),
        "objective": command.objective,
        "target_agent_id": command.target_agent_id,
        "generated_task_count": generated_task_count,
        "schedule": command.schedule,
        "condition": command.condition,
        "project": management.projects.iter().find(|project| project.id == command.project_id),
        "delegation_chain": command.delegation_chain,
        "created_at": command.created_at,
        "last_triggered_at": command.last_triggered_at
    })
}

fn project_view(
    project: &ManagementProject,
    management: &ManagementCommandCenter,
    visible_command_ids: &HashSet<&str>,
) -> Value {
    let owner = management
        .roles
        .iter()
        .find(|role| role.id == project.owner_role_id)
        .map(summarize_role);
    let commands = project
        .command_ids
        .iter()
        .filter(|command_id| visible_command_ids.contains(command_id.as_str()))
        .filter_map(|command_id| {
            management
                .commands
                .iter()
                .find(|command| command.id.as_str() == command_id.as_str())
        })
        .map(command_summary_view)
        .collect::<Vec<_>>();
    serde_json::json!({
        "id": project.id,
        "name": project.name,
        "domain": format!("{:?}", project.domain).to_case(),
        "owner_role_id": project.owner_role_id,
        "task_graph_id": project.task_graph_id,
        "status": format!("{:?}", project.status).to_case(),
        "health": format!("{:?}", project.health).to_case(),
        "command_ids": project.command_ids
            .iter()
            .filter(|command_id| visible_command_ids.contains(command_id.as_str()))
            .collect::<Vec<_>>(),
        "owner": owner,
        "commands": commands
    })
}

fn execution_task_view(
    task: &ManagementExecutionTask,
    management: &ManagementCommandCenter,
    visible_command_ids: &HashSet<&str>,
) -> Value {
    let command = management
        .commands
        .iter()
        .find(|command| command.id.as_str() == task.command_id.as_str())
        .filter(|command| visible_command_ids.contains(command.id.as_str()))
        .or_else(|| {
            management
                .commands
                .iter()
                .find(|command| command.id.as_str() == task.command_id.as_str())
        });
    let update = task
        .latest_update_id
        .as_ref()
        .and_then(|update_id| {
            management
                .execution_updates
                .iter()
                .find(|update| update.id.as_str() == update_id.as_str())
        })
        .map(execution_update_view);
    serde_json::json!({
        "id": task.id,
        "title": task.title,
        "status": format!("{:?}", task.status).to_case(),
        "source": "management_execution_task",
        "command": command.map(command_summary_view),
        "owner": {
            "type": format!("{:?}", task.owner_actor_type).to_case(),
            "id": task.owner_actor_id
        },
        "source_agent_id": task.source_agent_id,
        "due_at": task.due_at,
        "progress_percent": task.progress_percent,
        "latest_update": update,
        "result_summary": task.result_summary,
        "blocker": task.blocker,
        "evidence_count": task.evidence_ids.len(),
        "acceptance_criteria": task.acceptance_criteria
    })
}

fn command_summary_view(command: &ManagementCommand) -> Value {
    serde_json::json!({
        "id": command.id,
        "title": command.title,
        "trigger_type": format!("{:?}", command.trigger_type).to_case(),
        "status": format!("{:?}", command.status).to_case()
    })
}

fn execution_update_view(update: &ManagementExecutionUpdate) -> Value {
    serde_json::json!({
        "id": update.id,
        "task_id": update.task_id,
        "actor_type": format!("{:?}", update.actor_type).to_case(),
        "actor_id": update.actor_id,
        "update_type": format!("{:?}", update.update_type).to_case(),
        "status": format!("{:?}", update.status).to_case(),
        "message": update.message,
        "progress_percent": update.progress_percent,
        "evidence_ids": update.evidence_ids,
        "created_at": update.created_at
    })
}

fn build_role_action_queue(state: &FixtureState, role_context: &RoleContext) -> Vec<RoleAction> {
    let mut actions = vec![];
    let task_by_id: HashMap<&str, _> = state
        .task_graph
        .tasks
        .iter()
        .map(|task| (task.id.as_str(), task))
        .collect();
    let can_see_dashboard = role_context.can_see_dashboard();

    for task in &state.management.execution_tasks {
        if matches!(task.status, ManagementProjectStatus::Done) {
            continue;
        }
        if !role_context.can_see_execution_task(&task.owner_actor_id, &task.source_agent_id) {
            continue;
        }
        actions.push(RoleAction {
            rank: 0,
            id: format!("management:{}", task.id),
            source_type: "management_execution_task".to_string(),
            source_id: task.id.clone(),
            title: task.title.clone(),
            reason: task
                .blocker
                .clone()
                .unwrap_or_else(|| task.acceptance_criteria.clone()),
            next_step: execution_task_next_step(&task.status),
            target_view: "management".to_string(),
            target_view_label: "管理指挥".to_string(),
            priority: execution_task_priority(&task.status, task.blocker.is_some()),
            status: format!("{:?}", task.status).to_case(),
            due_at: task.due_at.clone(),
            owner: serde_json::json!({
                "type": format!("{:?}", task.owner_actor_type).to_case(),
                "id": task.owner_actor_id
            }),
            related: serde_json::json!({
                "command_id": task.command_id,
                "project_id": task.project_id
            }),
        });
    }

    for gap in &state.gaps {
        let status = format!("{:?}", gap.status).to_case();
        if matches!(status.as_str(), "closed" | "waived") {
            continue;
        }
        if !can_see_dashboard
            && role_context
                .active_role
                .as_ref()
                .map(|role| role.user_id.as_str())
                != Some(gap.collector_actor_id.as_str())
        {
            continue;
        }
        let task = task_by_id.get(gap.task_id.as_str());
        actions.push(RoleAction {
            rank: 0,
            id: format!("gap:{}", gap.id),
            source_type: "information_gap".to_string(),
            source_id: gap.id.clone(),
            title: gap.question.clone(),
            reason: gap.reason.clone(),
            next_step: "打开信息缺口，按要求补齐字段、证据类型和截止时间。".to_string(),
            target_view: "gaps".to_string(),
            target_view_label: "信息缺口".to_string(),
            priority: format!("{:?}", gap.priority).to_case(),
            status,
            due_at: gap.due_at.clone(),
            owner: serde_json::json!({"type": "collector", "id": gap.collector_actor_id}),
            related: serde_json::json!({
                "task_id": gap.task_id,
                "task_title": task.map(|task| task.title.clone())
            }),
        });
    }

    for check in &state.gate_checks {
        if !matches!(
            check.status,
            SalesGateStatus::Missing
                | SalesGateStatus::Collecting
                | SalesGateStatus::NeedsSupplement
                | SalesGateStatus::Rejected
        ) {
            continue;
        }
        actions.push(RoleAction {
            rank: 0,
            id: format!("gate:{}", check.id),
            source_type: "sales_gate_check".to_string(),
            source_id: check.id.clone(),
            title: format!("{} 仍需补齐", check.gate_id),
            reason: format!("{:?} 阶段 Gate 状态为 {:?}", check.stage, check.status),
            next_step: "打开销售 Gate，查看缺口、推荐 Activity 和需要补充的证据。".to_string(),
            target_view: "gates".to_string(),
            target_view_label: "销售 Gate".to_string(),
            priority: "high".to_string(),
            status: format!("{:?}", check.status).to_case(),
            due_at: None,
            owner: serde_json::json!({"type": "gate_owner", "id": check.owner_id}),
            related: serde_json::json!({
                "opportunity_id": check.opportunity_id,
                "information_gap_ids": check.information_gap_ids,
                "recommended_activity_ids": check.recommended_activity_ids
            }),
        });
    }

    if can_see_dashboard {
        for mirror in &state.mirrors {
            if matches!(mirror.freshness, Some(Freshness::Fresh)) {
                continue;
            }
            actions.push(RoleAction {
                rank: 0,
                id: format!("mirror:{}", mirror.id),
                source_type: "external_fact_mirror".to_string(),
                source_id: mirror.id.clone(),
                title: format!("{} {} 镜像需要刷新", mirror.provider, mirror.object_type),
                reason: format!("{} freshness is not fresh", mirror.external_id),
                next_step: "打开外部同步，核对外部事实镜像和 Agent 判断是否一致。".to_string(),
                target_view: "sync".to_string(),
                target_view_label: "外部同步".to_string(),
                priority: "medium".to_string(),
                status: mirror
                    .freshness
                    .as_ref()
                    .map(|value| format!("{:?}", value).to_case())
                    .unwrap_or_else(|| "unknown".to_string()),
                due_at: None,
                owner: serde_json::json!({"type": "external_system", "id": mirror.provider}),
                related: serde_json::json!({
                    "system_type": format!("{:?}", mirror.system_type).to_case(),
                    "external_id": mirror.external_id
                }),
            });
        }
        for intent in &state.writeback_intents {
            if intent.policy_decision == WritebackPolicyDecision::AutoExecute {
                continue;
            }
            let decision = decide_writeback_policy(intent);
            actions.push(RoleAction {
                rank: 0,
                id: format!("writeback:{}", intent.id),
                source_type: "external_writeback_intent".to_string(),
                source_id: intent.id.clone(),
                title: format!("{} {:?} 需要确认", intent.provider, intent.operation),
                reason: decision.reasons.join("; "),
                next_step: "打开外部同步，确认、拒绝或转人工处理该反写意图。".to_string(),
                target_view: "sync".to_string(),
                target_view_label: "外部同步".to_string(),
                priority: "high".to_string(),
                status: format!("{:?}", intent.policy_decision).to_case(),
                due_at: Some(intent.created_at.clone()),
                owner: serde_json::json!({"type": "source_agent", "id": intent.source.agent_id}),
                related: serde_json::json!({
                    "system_type": format!("{:?}", intent.system_type).to_case(),
                    "target": intent.target
                }),
            });
        }
    }

    actions.sort_by(|left, right| {
        priority_rank(&left.priority)
            .cmp(&priority_rank(&right.priority))
            .then_with(|| left.due_at.cmp(&right.due_at))
            .then_with(|| left.title.cmp(&right.title))
    });
    actions
        .into_iter()
        .take(6)
        .enumerate()
        .map(|(index, mut action)| {
            action.rank = index + 1;
            action
        })
        .collect()
}

struct RoleContext<'a> {
    active_role: Option<&'a ManagementRole>,
    visible_command_ids: HashSet<&'a str>,
}

impl<'a> RoleContext<'a> {
    fn from_management(management: &'a ManagementCommandCenter) -> Self {
        let active_role = management
            .roles
            .iter()
            .find(|role| role.user_id == management.active_user_id);
        let visible_command_ids: HashSet<&str> = match active_role {
            Some(role)
                if role.has(ManagementPermission::ViewAllProjects)
                    || role.has(ManagementPermission::ViewManagementDashboard) =>
            {
                management
                    .commands
                    .iter()
                    .map(|cmd| cmd.id.as_str())
                    .collect()
            }
            Some(role) if role.has(ManagementPermission::ViewAssignedWork) => management
                .commands
                .iter()
                .filter(|cmd| {
                    cmd.delegation_chain
                        .iter()
                        .any(|item| item.actor_id == role.user_id)
                })
                .map(|cmd| cmd.id.as_str())
                .collect(),
            _ => HashSet::new(),
        };
        Self {
            active_role,
            visible_command_ids,
        }
    }

    fn visible_commands(&self) -> &HashSet<&'a str> {
        &self.visible_command_ids
    }

    fn has_permission(&self, permission: ManagementPermission) -> bool {
        self.active_role
            .map(|role| role.has(permission))
            .unwrap_or(false)
    }

    fn can_see_dashboard(&self) -> bool {
        self.has_permission(ManagementPermission::ViewAllProjects)
            || self.has_permission(ManagementPermission::ViewManagementDashboard)
            || self.has_permission(ManagementPermission::ConfigureGovernance)
    }

    fn can_see_execution_task(&self, owner_actor_id: &str, source_agent_id: &str) -> bool {
        let Some(role) = self.active_role else {
            return false;
        };
        if self.can_see_dashboard() {
            return true;
        }
        if !role.has(ManagementPermission::ViewAssignedWork) {
            return false;
        }
        owner_actor_id == role.user_id || source_agent_id == role.user_id
    }

    fn can_see_task(&self, task: &Task, graph_id: &str, visible_graph_ids: &HashSet<&str>) -> bool {
        let Some(role) = self.active_role else {
            return false;
        };
        if self.can_see_dashboard() {
            return true;
        }
        if !role.has(ManagementPermission::ViewAssignedWork) {
            return false;
        }
        task.owner_actor_id == role.user_id
            || visible_graph_ids.contains(graph_id)
            || task
                .information_gap_ids
                .iter()
                .any(|gap_id| gap_id.contains(role.user_id.as_str()))
    }
}

fn summarize_role(role: &ManagementRole) -> RoleSummary {
    RoleSummary {
        id: role.id.clone(),
        name: role.name.clone(),
        user_id: role.user_id.clone(),
        role_type: format!("{:?}", role.role_type).to_case(),
        permissions: role
            .permissions
            .iter()
            .map(|permission| format!("{:?}", permission).to_case())
            .collect(),
        default_view: format!("{:?}", role.default_view).to_case(),
    }
}

fn execution_task_priority(status: &ManagementProjectStatus, has_blocker: bool) -> String {
    if has_blocker
        || matches!(
            status,
            ManagementProjectStatus::NeedsInfo | ManagementProjectStatus::Blocked
        )
    {
        "high"
    } else if matches!(
        status,
        ManagementProjectStatus::InProgress | ManagementProjectStatus::Review
    ) {
        "medium"
    } else {
        "low"
    }
    .to_string()
}

fn execution_task_next_step(status: &ManagementProjectStatus) -> String {
    match status {
        ManagementProjectStatus::NeedsInfo => "打开管理指挥，查看缺口和阻塞原因，补齐进展或证据。",
        ManagementProjectStatus::Review => {
            "打开管理指挥，检查结果摘要和证据，决定通过、补充或升级。"
        }
        ManagementProjectStatus::InProgress => "打开管理指挥，核对最新进展、下一步和是否需要升级。",
        ManagementProjectStatus::Delegated => {
            "打开管理指挥，确认委派链已经开始执行并跟进第一条回流。"
        }
        ManagementProjectStatus::Blocked => "打开管理指挥，处理阻塞并决定是否升级给负责人。",
        _ => "打开管理指挥，查看该任务的最新状态和下一步。",
    }
    .to_string()
}

fn priority_rank(priority: &str) -> usize {
    match priority {
        "high" => 0,
        "medium" => 1,
        "low" => 2,
        _ => 3,
    }
}

fn count_by(values: impl Iterator<Item = String>) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for value in values {
        *counts.entry(value).or_insert(0) += 1;
    }
    counts
}

trait ToSnakeCase {
    fn to_case(&self) -> String;
}

impl ToSnakeCase for String {
    fn to_case(&self) -> String {
        let mut out = String::new();
        for (index, ch) in self.chars().enumerate() {
            if ch.is_ascii_uppercase() {
                if index > 0 {
                    out.push('_');
                }
                out.push(ch.to_ascii_lowercase());
            } else {
                out.push(ch);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        fixtures::load_p1_fixture_state,
        view_models::{
            build_management_command_center_view_model,
            build_management_command_center_view_model_with_context,
            build_operating_console_view_model,
        },
    };

    #[test]
    fn operating_console_surfaces_next_actions() {
        let root = crate::fixtures::workspace_root();
        let state = load_p1_fixture_state(&root).unwrap();
        let view = build_operating_console_view_model(&state);
        assert_eq!(view.task_counts["needs_info"], 1);
        assert!(view.role_action_count > 0);
        assert!(view
            .primary_alerts
            .iter()
            .any(|item| item.contains("need information")));
    }

    #[test]
    fn management_command_center_projection_matches_js_surface_shape() {
        let root = crate::fixtures::workspace_root();
        let state = load_p1_fixture_state(&root).unwrap();
        let view = build_management_command_center_view_model(&state.management);

        assert!(view.ok);
        assert_eq!(view.summary["command_count"], 3);
        assert_eq!(view.summary["scheduled_command_count"], 1);
        assert_eq!(view.summary["condition_command_count"], 1);
        assert_eq!(view.summary["manual_command_count"], 1);
        assert_eq!(view.permissions["can_create_command"], true);
        assert_eq!(view.command_templates.len(), 3);
        assert_eq!(view.commands.len(), 3);
        assert!(!view.projects.is_empty());
        assert!(view.swimlanes.iter().any(|lane| lane["tasks"]
            .as_array()
            .is_some_and(|tasks| !tasks.is_empty())));
        assert!(!view.execution_updates.is_empty());
    }

    #[test]
    fn management_command_center_context_matches_js_fallback_surface() {
        let root = crate::fixtures::workspace_root();
        let mut state = load_p1_fixture_state(&root).unwrap();
        state.management.swimlanes.push(crate::ManagementSwimlane {
            id: "lane_task_graph_fallback".to_string(),
            title: "TaskGraph fallback".to_string(),
            status: crate::ManagementProjectStatus::InProgress,
            task_ids: vec![state.task_graph.tasks[0].id.clone()],
        });
        let bridge = crate::LegacyBridgePreview {
            ok: true,
            generated_at: "2026-06-01T00:00:00+08:00".to_string(),
            workflow_plan_payload: None,
            org_task_payloads: vec![serde_json::json!({ "payload": {} })],
            fact_write_payloads: vec![],
            audit_event_payloads: vec![],
            summary: serde_json::json!({ "org_task_payload_count": 1 }),
            target_routes: serde_json::json!({}),
        };

        let view = build_management_command_center_view_model_with_context(
            &state.management,
            Some(&state.task_graph),
            &state.gaps,
            &state.evidence,
            Some(&bridge),
        );

        assert_eq!(view.summary["bridge_org_task_count"], 1);
        assert!(view.swimlanes.iter().any(|lane| {
            lane["id"] == "lane_task_graph_fallback"
                && lane["tasks"].as_array().is_some_and(|tasks| {
                    tasks.iter().any(|task| task["source"] == "task_graph_task")
                })
        }));
    }

    #[test]
    fn management_command_center_role_visibility_matches_js_rules() {
        let root = crate::fixtures::workspace_root();
        let mut state = load_p1_fixture_state(&root).unwrap();
        state.management.active_user_id = "sales_agent_001".to_string();
        state.management.swimlanes.push(crate::ManagementSwimlane {
            id: "lane_mixed_visibility".to_string(),
            title: "Mixed visibility".to_string(),
            status: crate::ManagementProjectStatus::InProgress,
            task_ids: vec![
                "mtask_weekly_sales_gate_check".to_string(),
                "mtask_weekly_delivery_risk_scan".to_string(),
            ],
        });

        let view = build_management_command_center_view_model(&state.management);
        let visible_ids = view
            .swimlanes
            .iter()
            .flat_map(|lane| lane["tasks"].as_array().cloned().unwrap_or_default())
            .filter_map(|task| task["id"].as_str().map(ToString::to_string))
            .collect::<Vec<_>>();

        assert!(visible_ids.contains(&"mtask_weekly_sales_gate_check".to_string()));
        assert!(!visible_ids.contains(&"mtask_weekly_delivery_risk_scan".to_string()));
    }

    #[test]
    fn project_view_does_not_leak_hidden_command_ids() {
        let root = crate::fixtures::workspace_root();
        let mut state = load_p1_fixture_state(&root).unwrap();
        state.management.active_user_id = "sales_agent_001".to_string();
        let visible_command_id = "cmd_weekly_pipeline_review".to_string();
        state.management.projects.push(crate::ManagementProject {
            id: "proj_sales_agent_owned".to_string(),
            name: "Sales owned project".to_string(),
            domain: crate::ManagementProjectDomain::Sales,
            owner_role_id: "role_sales_agent".to_string(),
            task_graph_id: state.task_graph.id.clone(),
            status: crate::ManagementProjectStatus::InProgress,
            health: crate::ProjectHealth::Yellow,
            command_ids: vec![
                visible_command_id.clone(),
                "cmd_trigger_delivery_delay".to_string(),
            ],
        });

        let view = build_management_command_center_view_model(&state.management);
        let project = view
            .projects
            .iter()
            .find(|project| project["id"] == "proj_sales_agent_owned")
            .expect("owned project stays visible");
        let command_ids = project["command_ids"].as_array().unwrap();

        assert_eq!(command_ids, &vec![serde_json::json!(visible_command_id)]);
    }
}
