export function buildOperatingConsoleViewModel({ taskGraph, gateChecks, mirrors, writebackIntents }) {
  const taskCounts = countBy(taskGraph.tasks, "status");
  const gateCounts = countBy(gateChecks, "status");
  const staleMirrors = mirrors.filter((mirror) => mirror.freshness !== "fresh");
  const pendingWritebacks = writebackIntents.filter((intent) => intent.policy_decision !== "auto_execute");

  return {
    run_id: taskGraph.run_id,
    task_graph_id: taskGraph.id,
    task_graph_status: taskGraph.status,
    task_counts: taskCounts,
    gate_counts: gateCounts,
    stale_mirror_count: staleMirrors.length,
    pending_writeback_count: pendingWritebacks.length,
    primary_alerts: [
      ...alertIf(taskCounts.needs_info > 0, `${taskCounts.needs_info} task(s) need information`),
      ...alertIf(gateCounts.missing > 0, `${gateCounts.missing} sales gate(s) missing evidence`),
      ...alertIf(staleMirrors.length > 0, `${staleMirrors.length} external mirror(s) stale`),
      ...alertIf(pendingWritebacks.length > 0, `${pendingWritebacks.length} writeback intent(s) need confirmation`)
    ]
  };
}

export function buildTaskGraphViewModel({ taskGraph, evidence, gaps }) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const gapsById = new Map(gaps.map((gap) => [gap.id, gap]));

  return {
    id: taskGraph.id,
    run_id: taskGraph.run_id,
    version: taskGraph.version,
    status: taskGraph.status,
    tasks: taskGraph.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      owner: {
        type: task.owner_actor_type,
        id: task.owner_actor_id
      },
      depends_on: task.depends_on ?? [],
      evidence: (task.evidence_ids ?? []).map((id) => evidenceById.get(id)).filter(Boolean),
      information_gaps: (task.information_gap_ids ?? []).map((id) => gapsById.get(id)).filter(Boolean),
      acceptance_criteria: task.acceptance_criteria,
      due_at: task.due_at
    }))
  };
}

export function buildInformationGapInboxViewModel({ gaps, taskGraph }) {
  const tasksById = new Map(taskGraph.tasks.map((task) => [task.id, task]));
  return {
    open_count: gaps.filter((gap) => !["closed", "waived"].includes(gap.status)).length,
    gaps: gaps.map((gap) => {
      const task = tasksById.get(gap.task_id);
      return {
        id: gap.id,
        status: gap.status,
        priority: gap.priority,
        question: gap.question,
        reason: gap.reason,
        collector_actor_id: gap.collector_actor_id,
        task: task ? { id: task.id, title: task.title } : null,
        expected_evidence_types: gap.expected_evidence_types,
        due_at: gap.due_at
      };
    })
  };
}

export function buildExternalSyncConsoleViewModel({ mirrors, writebackIntents }) {
  return {
    mirrors: mirrors.map((mirror) => ({
      id: mirror.id,
      system_type: mirror.system_type,
      provider: mirror.provider,
      object_type: mirror.object_type,
      external_id: mirror.external_id,
      external_url: mirror.external_url,
      freshness: mirror.freshness,
      mirrored_at: mirror.mirrored_at
    })),
    writeback_queue: writebackIntents.map((intent) => ({
      id: intent.id,
      system_type: intent.system_type,
      provider: intent.provider,
      operation: intent.operation,
      target: intent.target,
      risk_level: intent.risk_level,
      policy_decision: intent.policy_decision,
      created_at: intent.created_at
    }))
  };
}

export function buildManagementCommandCenterViewModel({ management, taskGraph, gaps, evidence, bridgePreview }) {
  const activeRole = (management.roles ?? []).find((role) => role.user_id === management.active_user_id) ?? management.roles?.[0];
  const tasksById = new Map((taskGraph.tasks ?? []).map((task) => [task.id, task]));
  const executionTasksById = new Map((management.execution_tasks ?? []).map((task) => [task.id, task]));
  const executionUpdatesById = new Map((management.execution_updates ?? []).map((update) => [update.id, update]));
  const gapsByTaskId = groupBy(gaps ?? [], "task_id");
  const evidenceByTaskId = groupBy(evidence ?? [], "task_id");
  const permissions = summarizeManagementPermissions(activeRole);
  const visibleCommands = filterVisibleCommands(management.commands ?? [], activeRole, permissions);
  const visibleCommandIds = new Set(visibleCommands.map((command) => command.id));
  const visibleProjects = filterVisibleProjects(management.projects ?? [], activeRole, permissions, visibleCommandIds);
  const visibleGraphIds = new Set([
    ...visibleCommands.map((command) => command.task_graph_id),
    ...visibleProjects.map((project) => project.task_graph_id)
  ].filter(Boolean));
  const commandsById = new Map(visibleCommands.map((command) => [command.id, command]));
  const visibleExecutionTasks = (management.execution_tasks ?? []).filter((task) =>
    canSeeExecutionTask(task, activeRole, permissions, visibleCommandIds, visibleGraphIds)
  );
  const commandCounts = countBy(visibleCommands, "trigger_type");
  const projectCounts = countBy(visibleProjects, "health");
  const executionStatusCounts = countBy(visibleExecutionTasks, "status");

  return {
    ok: Boolean(activeRole && (
      permissions.can_view_management_dashboard ||
      permissions.can_view_assigned_work ||
      permissions.can_view_all_projects
    )),
    active_role: activeRole ? summarizeRole(activeRole) : null,
    summary: {
      command_count: visibleCommands.length,
      scheduled_command_count: commandCounts.scheduled ?? 0,
      condition_command_count: commandCounts.condition ?? 0,
      manual_command_count: commandCounts.manual ?? 0,
      project_count: visibleProjects.length,
      red_project_count: projectCounts.red ?? 0,
      decomposed_task_count: visibleExecutionTasks.length,
      delegated_task_count: visibleExecutionTasks.filter((task) => ["delegated", "needs_info", "in_progress"].includes(task.status)).length,
      in_progress_task_count: executionStatusCounts.in_progress ?? 0,
      result_task_count: executionStatusCounts.done ?? 0,
      bridge_org_task_count: bridgePreview?.summary?.org_task_payload_count ?? 0
    },
    permissions,
    roles: (management.roles ?? []).map(summarizeRole),
    command_templates: [
      {
        id: "manual_agent_dispatch",
        label: "即时下发",
        trigger_type: "manual",
        description: "老板输入经营意图，运营 PM Agent 拆成 TaskGraph 并委派给专门 Agent。"
      },
      {
        id: "scheduled_routine",
        label: "定时任务",
        trigger_type: "scheduled",
        description: "按固定节奏自动巡检项目、销售、交付或任意组织管理事项。"
      },
      {
        id: "condition_escalation",
        label: "条件触发",
        trigger_type: "condition",
        description: "当外部系统或 TaskGraph 信号越过阈值时自动升级并派发任务。"
      }
    ],
    commands: visibleCommands.map((command) => ({
      id: command.id,
      title: command.title,
      status: command.status,
      trigger_type: command.trigger_type,
      objective: command.objective,
      target_agent_id: command.target_agent_id,
      generated_task_count: (command.generated_task_ids ?? []).filter((taskId) => visibleExecutionTasks.some((task) => task.id === taskId)).length,
      schedule: command.schedule ?? null,
      condition: command.condition ?? null,
      project: (management.projects ?? []).find((project) => project.id === command.project_id) ?? null,
      delegation_chain: command.delegation_chain ?? [],
      created_at: command.created_at,
      last_triggered_at: command.last_triggered_at ?? null
    })),
    projects: visibleProjects.map((project) => ({
      ...project,
      owner: summarizeRole((management.roles ?? []).find((role) => role.id === project.owner_role_id)),
      commands: (project.command_ids ?? []).map((id) => commandsById.get(id)).filter(Boolean).map((command) => ({
        id: command.id,
        title: command.title,
        trigger_type: command.trigger_type,
        status: command.status
      }))
    })),
    swimlanes: (management.swimlanes ?? []).map((lane) => ({
      id: lane.id,
      title: lane.title,
      status: lane.status,
      tasks: (lane.task_ids ?? []).map((taskId) => {
        const executionTask = executionTasksById.get(taskId);
        if (executionTask) {
          if (!canSeeExecutionTask(executionTask, activeRole, permissions, visibleCommandIds, visibleGraphIds)) return null;
          const update = executionTask.latest_update_id ? executionUpdatesById.get(executionTask.latest_update_id) : null;
          const command = commandsById.get(executionTask.command_id) ??
            (management.commands ?? []).find((item) => item.id === executionTask.command_id);
          return {
            id: executionTask.id,
            title: executionTask.title,
            status: executionTask.status,
            source: "management_execution_task",
            command: command ? {
              id: command.id,
              title: command.title,
              trigger_type: command.trigger_type,
              status: command.status
            } : null,
            owner: {
              type: executionTask.owner_actor_type,
              id: executionTask.owner_actor_id
            },
            source_agent_id: executionTask.source_agent_id,
            due_at: executionTask.due_at ?? null,
            progress_percent: executionTask.progress_percent,
            latest_update: update ? {
              id: update.id,
              type: update.update_type,
              actor_type: update.actor_type,
              actor_id: update.actor_id,
              message: update.message,
              progress_percent: update.progress_percent,
              created_at: update.created_at
            } : null,
            result_summary: executionTask.result_summary ?? null,
            blocker: executionTask.blocker ?? null,
            evidence_count: (executionTask.evidence_ids ?? []).length,
            acceptance_criteria: executionTask.acceptance_criteria
          };
        }
        const task = tasksById.get(taskId);
        if (!task) return null;
        if (!canSeeTask(task, activeRole, permissions, visibleGraphIds, taskGraph.id)) return null;
        return {
          id: task.id,
          title: task.title,
          status: task.status,
          source: "task_graph_task",
          command: null,
          owner: {
            type: task.owner_actor_type,
            id: task.owner_actor_id
          },
          due_at: task.due_at ?? null,
          progress_percent: null,
          latest_update: null,
          result_summary: null,
          blocker: null,
          gap_count: (gapsByTaskId.get(task.id) ?? []).length,
          evidence_count: (evidenceByTaskId.get(task.id) ?? []).length,
          acceptance_criteria: task.acceptance_criteria
        };
      }).filter(Boolean)
    })),
    execution_updates: (management.execution_updates ?? [])
      .filter((update) => {
        const task = executionTasksById.get(update.task_id);
        return task && canSeeExecutionTask(task, activeRole, permissions, visibleCommandIds, visibleGraphIds);
      })
      .map((update) => ({ ...update }))
  };
}

export function buildManagementCommandDispatchPreview({ management, commandInput, taskGraph }) {
  const activeRole = (management.roles ?? []).find((role) => role.user_id === management.active_user_id) ?? management.roles?.[0];
  const canCreate = activeRole?.permissions?.includes("create_command") === true;
  const executiveRole = (management.roles ?? []).find((role) =>
    role.role_type === "executive" && role.permissions?.includes("create_command")
  );
  const triggerType = commandInput?.trigger_type ?? "manual";
  const commandId = `cmd_preview_${slugify(commandInput?.title ?? "management-command")}`;
  const taskId = `task_preview_${slugify(commandInput?.title ?? "management-task")}`;
  const projectId = commandInput?.project_id ?? management.projects?.[0]?.id;
  const targetAgentId = commandInput?.target_agent_id ?? "pm_agent_ops_001";
  const specializedAgentType = commandInput?.specialized_agent_type ?? "sales_agent";
  const specializedAgentId = commandInput?.specialized_agent_id ?? "sales_agent_001";
  const executorType = commandInput?.executor_type ?? "human_twin_agent";
  const executorId = commandInput?.executor_id ?? "twin_sales_andy";
  const createdAt = "2026-05-31T18:30:00+08:00";
  const executionTasks = buildPreviewExecutionTasks({
    commandId,
    commandInput,
    executorId,
    executorType,
    projectId,
    specializedAgentId,
    specializedAgentType,
    targetAgentId,
    taskGraph,
    taskId
  });
  const executionUpdates = buildPreviewExecutionUpdates({ executionTasks, targetAgentId });

  return {
    ok: canCreate,
    command: {
      id: commandId,
      title: commandInput?.title ?? "New management command",
      status: triggerType === "manual" ? "delegated" : triggerType === "scheduled" ? "scheduled" : "active",
      trigger_type: triggerType,
      created_by_role_id: activeRole?.id ?? null,
      target_agent_id: targetAgentId,
      objective: commandInput?.objective ?? "",
      task_graph_id: taskGraph.id,
      project_id: projectId,
      generated_task_ids: executionTasks.map((task) => task.id),
      schedule: triggerType === "scheduled" ? {
        kind: commandInput?.schedule_kind ?? "weekly",
        timezone: commandInput?.timezone ?? "Asia/Shanghai",
        next_run_at: commandInput?.next_run_at ?? "2026-06-01T09:00:00+08:00",
        cadence_label: commandInput?.cadence_label ?? "每周一 09:00"
      } : undefined,
      condition: triggerType === "condition" ? {
        signal: commandInput?.condition_signal ?? "task_graph.blocked_count",
        operator: commandInput?.condition_operator ?? "greater_than",
        threshold: commandInput?.condition_threshold ?? "0",
        evaluation_window: commandInput?.evaluation_window ?? "rolling_24h"
      } : undefined,
      delegation_chain: [
        {
          order: 1,
          actor_type: "executive",
          actor_id: canCreate ? activeRole?.user_id ?? "unknown" : executiveRole?.user_id ?? "unknown",
          responsibility: "提出经营意图、截止时间和验收口径。"
        },
        {
          order: 2,
          actor_type: "pm_agent",
          actor_id: targetAgentId,
          responsibility: "转换为 TaskGraph、拆分任务、选择专门 Agent。"
        },
        {
          order: 3,
          actor_type: specializedAgentType,
          actor_id: specializedAgentId,
          responsibility: "执行专业判断并派发给下属或 Worker Agent。"
        },
        {
          order: 4,
          actor_type: executorType,
          actor_id: executorId,
          responsibility: "收集证据、提交反馈、等待验收。"
        }
      ],
      created_at: createdAt
    },
    task: {
      id: taskId,
      title: commandInput?.title ?? "New management task",
      status: "assigned",
      owner_actor_type: "pm_agent",
      owner_actor_id: targetAgentId,
      depends_on: [],
      required_evidence: ["human_confirmation", "system_event"],
      information_gap_ids: [],
      evidence_ids: [],
      acceptance_criteria: commandInput?.acceptance_criteria ?? "Agent returns evidence, result, blocker, and next step.",
      due_at: commandInput?.due_at ?? "2026-06-03T18:00:00+08:00"
    },
    execution_tasks: executionTasks,
    execution_updates: executionUpdates,
    swimlane_projection: {
      delegated: executionTasks.filter((task) => task.status === "delegated").map((task) => task.id),
      in_progress: executionTasks.filter((task) => task.status === "in_progress").map((task) => task.id),
      needs_info: executionTasks.filter((task) => task.status === "needs_info").map((task) => task.id),
      review: executionTasks.filter((task) => task.status === "review").map((task) => task.id),
      done: executionTasks.filter((task) => task.status === "done").map((task) => task.id)
    },
    bridge_routes: {
      workflow_plan: "/internal/workflows/plan",
      org_task_create: "/admin/tasks",
      human_assignment: "/internal/tasks/assign",
      audit_projection: "/api/admin/audit"
    },
    warnings: canCreate ? [] : ["active role cannot create management commands"]
  };
}

function buildPreviewExecutionTasks({
  commandId,
  commandInput,
  executorId,
  executorType,
  projectId,
  specializedAgentId,
  specializedAgentType,
  targetAgentId,
  taskGraph,
  taskId
}) {
  const baseTitle = commandInput?.title ?? "New management task";
  const createdAt = "2026-05-31T18:30:00+08:00";
  return [
    {
      id: taskId,
      command_id: commandId,
      project_id: projectId,
      task_graph_id: taskGraph.id,
      title: `PM Agent 拆解：${baseTitle}`,
      status: "delegated",
      owner_actor_type: "pm_agent",
      owner_actor_id: targetAgentId,
      source_agent_id: targetAgentId,
      acceptance_criteria: "把老板意图拆成可执行工作项、责任人、验收标准和泳道状态。",
      due_at: commandInput?.due_at ?? "2026-06-03T18:00:00+08:00",
      progress_percent: 10,
      latest_update_id: `${taskId}_decomposition`,
      result_summary: "已生成专门 Agent 执行任务和下属/Worker 补采任务。",
      evidence_ids: [],
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: `${taskId}_specialist`,
      command_id: commandId,
      project_id: projectId,
      task_graph_id: taskGraph.id,
      title: `${specializedAgentType} 执行：${baseTitle}`,
      status: "in_progress",
      owner_actor_type: specializedAgentType,
      owner_actor_id: specializedAgentId,
      source_agent_id: targetAgentId,
      acceptance_criteria: commandInput?.acceptance_criteria ?? "专门 Agent 返回判断、证据、风险、阻塞和下一步。",
      due_at: commandInput?.due_at ?? "2026-06-03T18:00:00+08:00",
      progress_percent: 25,
      latest_update_id: `${taskId}_specialist_progress`,
      blocker: "等待下属或外部事实补齐后进入验收。",
      evidence_ids: [],
      created_at: createdAt,
      updated_at: createdAt
    },
    {
      id: `${taskId}_executor`,
      command_id: commandId,
      project_id: projectId,
      task_graph_id: taskGraph.id,
      title: `${executorType} 补齐执行证据：${baseTitle}`,
      status: "needs_info",
      owner_actor_type: executorType,
      owner_actor_id: executorId,
      source_agent_id: specializedAgentId,
      acceptance_criteria: "提交执行结果、进展说明或缺口证据，供 Agent 验收。",
      due_at: commandInput?.due_at ?? "2026-06-03T18:00:00+08:00",
      progress_percent: 0,
      latest_update_id: `${taskId}_executor_handoff`,
      blocker: "等待人员提交进展或结果。",
      evidence_ids: [],
      created_at: createdAt,
      updated_at: createdAt
    }
  ];
}

function buildPreviewExecutionUpdates({ executionTasks, targetAgentId }) {
  const createdAt = "2026-05-31T18:30:00+08:00";
  return executionTasks.map((task) => ({
    id: task.latest_update_id,
    task_id: task.id,
    actor_type: task.owner_actor_type === "pm_agent" ? "pm_agent" : task.owner_actor_type,
    actor_id: task.owner_actor_type === "pm_agent" ? targetAgentId : task.owner_actor_id,
    update_type: task.owner_actor_type === "pm_agent" ? "decomposition" : task.status === "needs_info" ? "handoff" : "progress",
    status: task.status,
    message: task.owner_actor_type === "pm_agent"
      ? "老板意图已自动拆解为可执行任务，并投射到泳道。"
      : task.status === "needs_info"
        ? "已派给责任人补齐执行证据，等待进展或结果回流。"
        : "执行任务已进入处理，等待证据和阶段结果。",
    progress_percent: task.progress_percent,
    evidence_ids: [],
    created_at: createdAt
  }));
}

function countBy(items, field) {
  const counts = {};
  for (const item of items) {
    const key = item[field];
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function groupBy(items, field) {
  const groups = new Map();
  for (const item of items) {
    const key = item[field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function summarizeRole(role) {
  if (!role) return null;
  return {
    id: role.id,
    name: role.name,
    user_id: role.user_id,
    role_type: role.role_type,
    permissions: role.permissions,
    default_view: role.default_view
  };
}

function summarizeManagementPermissions(role) {
  const permissions = role?.permissions ?? [];
  return {
    can_create_command: permissions.includes("create_command"),
    can_schedule_command: permissions.includes("schedule_command"),
    can_configure_trigger: permissions.includes("configure_trigger"),
    can_delegate_to_agent: permissions.includes("delegate_to_agent"),
    can_view_all_projects: permissions.includes("view_all_projects"),
    can_view_management_dashboard: permissions.includes("view_management_dashboard"),
    can_view_assigned_work: permissions.includes("view_assigned_work"),
    can_configure_governance: permissions.includes("configure_governance")
  };
}

function filterVisibleCommands(commands, role, permissions) {
  if (!role) return [];
  if (permissions.can_view_all_projects || permissions.can_view_management_dashboard) {
    return commands;
  }
  if (!permissions.can_view_assigned_work) {
    return [];
  }
  return commands.filter((command) =>
    (command.delegation_chain ?? []).some((item) => item.actor_id === role.user_id)
  );
}

function filterVisibleProjects(projects, role, permissions, visibleCommandIds) {
  if (!role) return [];
  if (permissions.can_view_all_projects || permissions.can_view_management_dashboard) {
    return projects;
  }
  if (!permissions.can_view_assigned_work) {
    return [];
  }
  return projects.filter((project) =>
    project.owner_role_id === role.id ||
    (project.command_ids ?? []).some((commandId) => visibleCommandIds.has(commandId))
  );
}

function canSeeTask(task, role, permissions, visibleGraphIds, taskGraphId) {
  if (!role) return false;
  if (permissions.can_view_all_projects || permissions.can_view_management_dashboard) {
    return true;
  }
  if (!permissions.can_view_assigned_work) {
    return false;
  }
  return task.owner_actor_id === role.user_id ||
    visibleGraphIds.has(taskGraphId) ||
    (task.information_gap_ids ?? []).some((gapId) => gapId.includes(role.user_id));
}

function canSeeExecutionTask(task, role, permissions, visibleCommandIds, visibleGraphIds) {
  if (!role) return false;
  if (permissions.can_view_all_projects || permissions.can_view_management_dashboard) {
    return true;
  }
  if (!permissions.can_view_assigned_work) {
    return false;
  }
  return task.owner_actor_id === role.user_id ||
    task.source_agent_id === role.user_id ||
    visibleCommandIds.has(task.command_id) ||
    visibleGraphIds.has(task.task_graph_id);
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "command";
}

function alertIf(condition, message) {
  return condition ? [message] : [];
}
