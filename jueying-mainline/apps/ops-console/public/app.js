const state = {
  data: null,
  view: "overview",
  userId: new URLSearchParams(window.location.search).get("user_id") ?? "user_exec_lina"
};

const viewTitles = {
  overview: "运营总览",
  management: "管理指挥",
  gates: "销售 Gate",
  taskgraph: "TaskGraph",
  gaps: "信息缺口",
  sync: "外部同步",
  storylines: "故事线验收",
  legacy: "主版本能力",
  contracts: "契约健康"
};

const elements = {
  loading: document.querySelector("#loading"),
  error: document.querySelector("#error"),
  healthPill: document.querySelector("#health-pill"),
  refreshButton: document.querySelector("#refresh-button"),
  viewTitle: document.querySelector("#view-title"),
  metricGrid: document.querySelector("#metric-grid"),
  alertsList: document.querySelector("#alerts-list"),
  managementRoleStrip: document.querySelector("#management-role-strip"),
  roleSwitcher: document.querySelector("#role-switcher"),
  commandForm: document.querySelector("#command-form"),
  dispatchPreview: document.querySelector("#dispatch-preview"),
  managementCommandList: document.querySelector("#management-command-list"),
  managementSwimlanes: document.querySelector("#management-swimlanes"),
  managementProjects: document.querySelector("#management-projects"),
  gateTable: document.querySelector("#gate-table"),
  taskList: document.querySelector("#task-list"),
  gapList: document.querySelector("#gap-list"),
  mirrorList: document.querySelector("#mirror-list"),
  writebackList: document.querySelector("#writeback-list"),
  legacySummary: document.querySelector("#legacy-summary"),
  legacyRuntime: document.querySelector("#legacy-runtime"),
  legacyGroups: document.querySelector("#legacy-groups"),
  legacyBridge: document.querySelector("#legacy-bridge"),
  legacyCutover: document.querySelector("#legacy-cutover"),
  storylineSummary: document.querySelector("#storyline-summary"),
  storylineRoles: document.querySelector("#storyline-roles"),
  operationPathSummary: document.querySelector("#operation-path-summary"),
  operationPathRoles: document.querySelector("#operation-path-roles"),
  contractHealth: document.querySelector("#contract-health")
};

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    setView(button.dataset.view);
  });
});

elements.refreshButton.addEventListener("click", () => {
  loadState();
});

elements.commandForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  previewManagementCommand(new FormData(elements.commandForm));
});

await loadState();

async function loadState() {
  elements.loading.hidden = false;
  elements.error.hidden = true;
  try {
    const response = await fetch(`/api/state?user_id=${encodeURIComponent(state.userId)}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    state.data = await response.json();
    render();
    refreshLegacyRuntime();
  } catch (error) {
    elements.error.hidden = false;
    elements.error.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    elements.loading.hidden = true;
  }
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("is-active", section.id === `view-${view}`);
  });
  elements.viewTitle.textContent = viewTitles[view] ?? "运营总览";
}

function render() {
  const data = state.data;
  const healthOk = data.health.ok;
  elements.healthPill.textContent = healthOk ? "Contracts OK" : "Needs Attention";
  elements.healthPill.className = `pill ${healthOk ? "is-ok" : "is-danger"}`;
  renderOverview(data);
  renderManagement(data.views.management_command_center);
  renderGates(data.sales.discover_audit);
  renderTaskGraph(data.views.task_graph);
  renderGaps(data.views.information_gap_inbox);
  renderSync(data.views.external_sync_console, data.external_sync.writeback_policy_decisions);
  renderLegacy(data.views.legacy_integration, data.views.legacy_bridge_preview);
  renderStorylines(data.views.storyline_acceptance);
  renderOperationPaths(data.views.operation_path_tests);
  renderContracts(data);
  setView(state.view);
}

async function previewManagementCommand(formData) {
  if (!elements.dispatchPreview) return;
  elements.dispatchPreview.innerHTML = `
    <div class="compact-item">
      <strong>正在生成指挥预览</strong>
      <p>运营 PM Agent 正在把经营意图转换成委派链和 TaskGraph。</p>
    </div>
  `;
  const payload = {
    ...Object.fromEntries(formData.entries()),
    user_id: state.userId
  };
  try {
    const response = await fetch(`/api/management/dispatch-preview?user_id=${encodeURIComponent(state.userId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    renderDispatchPreview(await response.json());
  } catch (error) {
    elements.dispatchPreview.innerHTML = `
      <div class="compact-item">
        <strong>生成失败</strong>
        <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      </div>
    `;
  }
}

function renderManagement(viewModel) {
  if (!viewModel || !elements.managementRoleStrip) return;
  const role = viewModel.active_role;
  const summary = viewModel.summary;
  const canCreate = viewModel.permissions?.can_create_command === true;
  state.userId = role?.user_id ?? state.userId;
  elements.managementRoleStrip.innerHTML = `
    <div class="role-card">
      <span>当前登录视角</span>
      <strong>${escapeHtml(role?.name ?? "未登录")}</strong>
      <p>${escapeHtml(role?.role_type ?? "unknown")} · ${escapeHtml((role?.permissions ?? []).join(" / "))}</p>
    </div>
    <div class="role-card">
      <span>指令</span>
      <strong>${escapeHtml(String(summary.command_count))}</strong>
      <p>${escapeHtml(`${summary.manual_command_count} 即时 / ${summary.scheduled_command_count} 定时 / ${summary.condition_command_count} 条件`)}</p>
    </div>
    <div class="role-card">
      <span>项目</span>
      <strong>${escapeHtml(String(summary.project_count))}</strong>
      <p>${escapeHtml(`${summary.red_project_count} 个红灯项目 · ${summary.delegated_task_count} 个已委派任务`)}</p>
    </div>
    <div class="role-card">
      <span>执行闭环</span>
      <strong>${escapeHtml(String(summary.decomposed_task_count ?? 0))}</strong>
      <p>${escapeHtml(`${summary.in_progress_task_count ?? 0} 执行中 · ${summary.result_task_count ?? 0} 有结果`)}</p>
    </div>
    <div class="role-card">
      <span>旧主版本派单</span>
      <strong>${escapeHtml(String(summary.bridge_org_task_count))}</strong>
      <p>Information Gap 可进入 org_task / assignment 通道</p>
    </div>
  `;
  renderRoleSwitcher(viewModel);
  setCommandFormAvailability(canCreate, role);

  elements.managementCommandList.innerHTML = viewModel.commands.map((command) => `
    <div class="compact-item command-item">
      <strong>${escapeHtml(command.title)} · ${statusPill(command.status)}</strong>
      <p>${escapeHtml(command.trigger_type)} · ${escapeHtml(command.objective)}</p>
      <p>${escapeHtml(`自动拆解：${command.generated_task_count ?? 0} 个执行任务`)}</p>
      ${command.schedule ? `<p>定时：${escapeHtml(command.schedule.cadence_label ?? command.schedule.next_run_at)}</p>` : ""}
      ${command.condition ? `<p>条件：${escapeHtml(`${command.condition.signal} ${command.condition.operator} ${command.condition.threshold}`)}</p>` : ""}
      <div class="delegation-chain">
        ${command.delegation_chain.map((item) => `<span>${escapeHtml(`${item.order}. ${item.actor_type}`)}</span>`).join("")}
      </div>
    </div>
  `).join("");

  elements.managementSwimlanes.innerHTML = viewModel.swimlanes.map((lane) => `
    <section class="swimlane">
      <header>
        <h4>${escapeHtml(lane.title)}</h4>
        <span>${escapeHtml(String(lane.tasks.length))}</span>
      </header>
      <div class="swimlane-tasks">
        ${lane.tasks.length ? lane.tasks.map((task) => `
          <article class="swimlane-card">
            <strong>${escapeHtml(task.title)}</strong>
            ${task.command ? `<p>来自：${escapeHtml(task.command.title)}</p>` : ""}
            <p>${escapeHtml(task.owner.type)} / ${escapeHtml(task.owner.id)}</p>
            ${typeof task.progress_percent === "number" ? `
              <div class="progress-bar" aria-label="${escapeHtml(`进度 ${task.progress_percent}%`)}">
                <span style="width: ${escapeHtml(String(task.progress_percent))}%"></span>
              </div>
              <p>${escapeHtml(`进度 ${task.progress_percent}%`)}</p>
            ` : ""}
            ${task.latest_update ? `<p>进展：${escapeHtml(task.latest_update.message)}</p>` : ""}
            ${task.result_summary ? `<p>结果：${escapeHtml(task.result_summary)}</p>` : ""}
            ${task.blocker ? `<p>阻塞：${escapeHtml(task.blocker)}</p>` : ""}
            <div class="tag-row">
              <span>${escapeHtml(task.status)}</span>
              ${typeof task.gap_count === "number" ? `<span>${escapeHtml(`${task.gap_count} gaps`)}</span>` : ""}
              <span>${escapeHtml(`${task.evidence_count} evidence`)}</span>
              <span>${escapeHtml(task.source === "management_execution_task" ? "执行任务" : "TaskGraph")}</span>
            </div>
          </article>
        `).join("") : `<div class="empty-lane">暂无任务</div>`}
      </div>
    </section>
  `).join("");

  elements.managementProjects.innerHTML = viewModel.projects.map((project) => `
    <article class="project-card">
      <header>
        <div>
          <h4>${escapeHtml(project.name)}</h4>
          <p>${escapeHtml(project.domain)} · ${escapeHtml(project.status)}</p>
        </div>
        ${statusPill(project.health)}
      </header>
      <p>${escapeHtml(project.commands.map((command) => command.title).join(" / "))}</p>
    </article>
  `).join("");

  if (!elements.dispatchPreview.innerHTML || !canCreate) {
    renderDispatchPreview({
      ok: viewModel.permissions.can_create_command,
      command: viewModel.commands.find((command) => command.trigger_type === "manual") ?? viewModel.commands[0],
      task: viewModel.swimlanes.flatMap((lane) => lane.tasks)[0] ?? null,
      bridge_routes: {
        workflow_plan: "/internal/workflows/plan",
        org_task_create: "/admin/tasks",
        human_assignment: "/internal/tasks/assign",
        audit_projection: "/api/admin/audit"
      },
      warnings: canCreate ? [] : [`${role?.name ?? "当前角色"}没有下发管理指令权限，可查看看板但不能创建任务。`]
    });
  }
}

function renderRoleSwitcher(viewModel) {
  if (!elements.roleSwitcher) return;
  const activeUserId = viewModel.active_role?.user_id;
  elements.roleSwitcher.innerHTML = (viewModel.roles ?? []).map((role) => {
    const active = role.user_id === activeUserId;
    const permissions = role.permissions ?? [];
    return `
      <button type="button" class="role-switch ${active ? "is-active" : ""}" data-user-id="${escapeHtml(role.user_id)}" aria-pressed="${active ? "true" : "false"}">
        <strong>${escapeHtml(role.name)}</strong>
        <span>${escapeHtml(role.role_type)} · ${escapeHtml(permissions.join(" / "))}</span>
      </button>
    `;
  }).join("");
  elements.roleSwitcher.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const userId = button.dataset.userId;
      if (!userId || userId === state.userId) return;
      state.userId = userId;
      elements.dispatchPreview.innerHTML = "";
      loadState();
    });
  });
}

function setCommandFormAvailability(canCreate, role) {
  if (!elements.commandForm) return;
  const controls = elements.commandForm.querySelectorAll("input, select, textarea, button");
  controls.forEach((control) => {
    control.disabled = !canCreate;
  });
  elements.commandForm.classList.toggle("is-read-only", !canCreate);
  let notice = elements.commandForm.querySelector(".permission-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "permission-notice";
    elements.commandForm.prepend(notice);
  }
  notice.hidden = canCreate;
  notice.textContent = `${role?.name ?? "当前角色"}可查看管理看板，但没有下发新任务的权限。`;
}

function renderDispatchPreview(preview) {
  if (!elements.dispatchPreview) return;
  const command = preview.command;
  const warnings = preview.warnings ?? [];
  const executionTasks = preview.execution_tasks ?? [];
  elements.dispatchPreview.innerHTML = `
    <div class="compact-item">
      <strong>${escapeHtml(command?.title ?? "指挥预览")} · ${statusPill(preview.ok ? "ready" : "blocked")}</strong>
      <p>${escapeHtml(command?.objective ?? "")}</p>
      ${warnings.length ? `<p>${escapeHtml(warnings.join(" / "))}</p>` : ""}
    </div>
    <div class="delegation-preview">
      ${(command?.delegation_chain ?? []).map((item) => `
        <div class="chain-node">
          <span>${escapeHtml(String(item.order))}</span>
          <strong>${escapeHtml(item.actor_type)}</strong>
          <p>${escapeHtml(item.responsibility)}</p>
        </div>
      `).join("")}
    </div>
    <div class="meta-grid">
      <div class="meta"><span>TaskGraph</span><strong>${escapeHtml(command?.task_graph_id ?? "")}</strong></div>
      <div class="meta"><span>Task</span><p>${escapeHtml(preview.task?.title ?? "等待生成")}</p></div>
      <div class="meta"><span>Bridge</span><p>${escapeHtml(Object.values(preview.bridge_routes ?? {}).join(" / "))}</p></div>
    </div>
    ${executionTasks.length ? `
      <div class="preview-execution">
        ${executionTasks.map((task) => `
          <article class="swimlane-card">
            <strong>${escapeHtml(task.title)}</strong>
            <p>${escapeHtml(`${task.owner_actor_type} / ${task.owner_actor_id}`)}</p>
            <div class="progress-bar" aria-label="${escapeHtml(`进度 ${task.progress_percent}%`)}">
              <span style="width: ${escapeHtml(String(task.progress_percent))}%"></span>
            </div>
            <p>${escapeHtml(`泳道：${task.status} · 进度 ${task.progress_percent}%`)}</p>
            ${task.result_summary ? `<p>结果：${escapeHtml(task.result_summary)}</p>` : ""}
            ${task.blocker ? `<p>阻塞：${escapeHtml(task.blocker)}</p>` : ""}
          </article>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function renderOverview(data) {
  const overview = data.views.operating_console;
  const metrics = [
    ["Tasks Need Info", overview.task_counts.needs_info ?? 0, "Human Twin 需要补采的信息任务"],
    ["Accepted Tasks", overview.task_counts.accepted ?? 0, "已有证据并通过验收的任务"],
    ["Missing Gates", overview.gate_counts.missing ?? 0, "销售 Gate 仍缺证据"],
    ["Writeback Pending", overview.pending_writeback_count ?? 0, "需要确认的外部系统反写"]
  ];
  elements.metricGrid.innerHTML = metrics.map(([label, value, detail]) => `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `).join("");

  const alerts = overview.primary_alerts.length > 0 ? overview.primary_alerts : ["当前样例没有高优先级异常。"];
  elements.alertsList.innerHTML = alerts.map((alert) => `
    <div class="alert-item">
      <span aria-hidden="true">!</span>
      <div>${escapeHtml(alert)}</div>
    </div>
  `).join("");
}

function renderGates(audit) {
  elements.gateTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th scope="col">Gate</th>
          <th scope="col">状态</th>
          <th scope="col">证据</th>
          <th scope="col">缺口</th>
          <th scope="col">推荐动作</th>
        </tr>
      </thead>
      <tbody>
        ${audit.checks.map((check) => `
          <tr>
            <td><strong>${escapeHtml(check.gate_id)}</strong></td>
            <td>${statusPill(check.status)}</td>
            <td>${escapeHtml(check.evidence_ids.join(", ") || "无")}</td>
            <td>${escapeHtml(check.information_gap_ids.join(", ") || "无")}</td>
            <td>${escapeHtml(check.recommended_activity_ids.join(", ") || "无")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderTaskGraph(viewModel) {
  elements.taskList.innerHTML = viewModel.tasks.map((task) => `
    <article class="task-card">
      <header>
        <div>
          <h4>${escapeHtml(task.title)}</h4>
          <p>${escapeHtml(task.acceptance_criteria)}</p>
        </div>
        ${statusPill(task.status)}
      </header>
      <div class="meta-grid">
        <div class="meta"><span>Owner</span><strong>${escapeHtml(task.owner.type)} / ${escapeHtml(task.owner.id)}</strong></div>
        <div class="meta"><span>Depends On</span><p>${escapeHtml(task.depends_on.join(", ") || "None")}</p></div>
        <div class="meta"><span>Due</span><p>${escapeHtml(task.due_at ?? "Unset")}</p></div>
      </div>
      <div class="meta-grid">
        <div class="meta"><span>Evidence</span><p>${escapeHtml(task.evidence.map((item) => item.id).join(", ") || "None")}</p></div>
        <div class="meta"><span>Information Gaps</span><p>${escapeHtml(task.information_gaps.map((gap) => gap.id).join(", ") || "None")}</p></div>
        <div class="meta"><span>Task ID</span><p>${escapeHtml(task.id)}</p></div>
      </div>
    </article>
  `).join("");
}

function renderGaps(viewModel) {
  elements.gapList.innerHTML = viewModel.gaps.map((gap) => `
    <article class="task-card">
      <header>
        <div>
          <h4>${escapeHtml(gap.question)}</h4>
          <p>${escapeHtml(gap.reason)}</p>
        </div>
        ${statusPill(gap.status)}
      </header>
      <div class="meta-grid">
        <div class="meta"><span>Priority</span><strong>${escapeHtml(gap.priority)}</strong></div>
        <div class="meta"><span>Collector</span><p>${escapeHtml(gap.collector_actor_id)}</p></div>
        <div class="meta"><span>Expected Evidence</span><p>${escapeHtml(gap.expected_evidence_types.join(", "))}</p></div>
      </div>
    </article>
  `).join("");
}

function renderSync(viewModel, decisions) {
  elements.mirrorList.innerHTML = viewModel.mirrors.map((mirror) => `
    <div class="compact-item">
      <strong>${escapeHtml(mirror.provider)} / ${escapeHtml(mirror.object_type)}</strong>
      <p>${escapeHtml(mirror.external_id)} · ${escapeHtml(mirror.freshness)} · ${escapeHtml(mirror.mirrored_at)}</p>
    </div>
  `).join("");

  const decisionById = new Map(decisions.map((item) => [item.intent_id, item]));
  elements.writebackList.innerHTML = viewModel.writeback_queue.map((intent) => {
    const decision = decisionById.get(intent.id);
    return `
      <div class="compact-item">
        <strong>${escapeHtml(intent.operation)} · ${escapeHtml(intent.provider)}</strong>
        <p>${escapeHtml(intent.id)} · ${escapeHtml(intent.risk_level)} · ${escapeHtml(decision?.decision ?? intent.policy_decision)}</p>
      </div>
    `;
  }).join("");
}

function renderLegacy(viewModel, bridgePreview) {
  const summary = viewModel.summary;
  const summaryItems = [
    ["Ready", `${summary.ready_percent}%`, `${summary.critical_ready}/${summary.critical_total} 个关键能力 adapter ready`],
    ["Capabilities", summary.capability_count, "JueYing 主版本能力域"],
    ["Routes", summary.route_count, "已映射主版本接口"],
    ["Data Objects", summary.data_object_count, "已映射主版本数据对象"]
  ];
  elements.legacySummary.innerHTML = summaryItems.map(([label, value, detail]) => `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `).join("");
  renderLegacyRuntime(null, true);

  elements.legacyGroups.innerHTML = viewModel.capability_groups.map((group) => `
    <section class="workspace-band">
      <div class="section-heading">
        <h3>${escapeHtml(group.name)}</h3>
        <p>${escapeHtml(group.capabilities.length)} 个能力域</p>
      </div>
      <div class="capability-grid">
        ${group.capabilities.map((capability) => `
          <article class="capability-card">
            <header>
              <div>
                <h4>${escapeHtml(capability.name)}</h4>
                <p>${escapeHtml(capability.new_concept)}</p>
              </div>
              ${statusPill(capability.status)}
            </header>
            <p>${escapeHtml(capability.ai_native_role)}</p>
            <div class="meta-grid">
              <div class="meta"><span>Routes</span><strong>${escapeHtml(String(capability.route_count))}</strong></div>
              <div class="meta"><span>Objects</span><strong>${escapeHtml(String(capability.data_objects.length))}</strong></div>
              <div class="meta"><span>Mode</span><p>${escapeHtml(capability.integration_mode)}</p></div>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");

  const bridgeItems = [
    ["Workflow", bridgePreview.summary.workflow_stage_count, bridgePreview.target_routes.workflow_plan],
    ["Org Task", bridgePreview.summary.org_task_payload_count, bridgePreview.target_routes.org_task_create],
    ["Fact Write", bridgePreview.summary.fact_write_payload_count, bridgePreview.target_routes.fact_write],
    ["Audit", bridgePreview.summary.audit_event_payload_count, bridgePreview.target_routes.audit_projection]
  ];
  elements.legacyBridge.innerHTML = bridgeItems.map(([label, value, route]) => `
    <div class="compact-item">
      <strong>${escapeHtml(label)} · ${escapeHtml(String(value))}</strong>
      <p>${escapeHtml(route)}</p>
    </div>
  `).join("");

  elements.legacyCutover.innerHTML = viewModel.cutover_plan.map((item) => `
    <div class="compact-item">
      <strong>${escapeHtml(item.area)} · ${escapeHtml(item.current_state)}</strong>
      <p>${escapeHtml(item.new_surface)} · ${escapeHtml(item.next_step)}</p>
    </div>
  `).join("");
}

async function refreshLegacyRuntime() {
  if (!state.data || !elements.legacyRuntime) return;
  try {
    const response = await fetch("/api/jueying/mainline/runtime-health?timeout_ms=1500", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Runtime health request failed: ${response.status}`);
    }
    renderLegacyRuntime(await response.json(), false);
  } catch (error) {
    renderLegacyRuntime({
      ok: false,
      online_count: 0,
      service_count: 0,
      services: [],
      error: error instanceof Error ? error.message : String(error)
    }, false);
  }
}

function renderLegacyRuntime(runtime, loading) {
  if (!elements.legacyRuntime) return;
  if (loading) {
    elements.legacyRuntime.innerHTML = `
      <div class="compact-item">
        <strong>正在检查 JueYing 主版本服务</strong>
        <p>等待实时健康检查返回...</p>
      </div>
    `;
    return;
  }

  const services = runtime?.services ?? [];
  const headerStatus = runtime?.ok ? "online" : "partial";
  const serviceItems = services.map((service) => `
    <div class="compact-item runtime-service">
      <strong>${escapeHtml(service.service_name)} · ${statusPill(service.online ? "online" : service.status ?? "offline")}</strong>
      <p>${escapeHtml(service.health_url)} · HTTP ${escapeHtml(String(service.http_status ?? 0))} · ${escapeHtml(String(service.latency_ms ?? 0))}ms</p>
    </div>
  `).join("");

  elements.legacyRuntime.innerHTML = `
    <div class="compact-item">
      <strong>JueYing Runtime · ${statusPill(headerStatus)}</strong>
      <p>${escapeHtml(String(runtime?.online_count ?? 0))}/${escapeHtml(String(runtime?.service_count ?? 0))} 个服务在线 · ${escapeHtml(runtime?.generated_at ?? "未生成")}</p>
      ${runtime?.error ? `<p>${escapeHtml(runtime.error)}</p>` : ""}
    </div>
    ${serviceItems || `
      <div class="compact-item">
        <strong>暂无服务明细</strong>
        <p>主版本适配仍可查看；实时服务可能未启动。</p>
      </div>
    `}
  `;
}

function renderStorylines(viewModel) {
  const summaryItems = [
    ["Roles", viewModel.summary.role_count, "被验收的用户和 Agent 角色"],
    ["Storylines", viewModel.summary.storyline_count, "端到端故事线"],
    ["Steps", `${viewModel.summary.passed_step_count}/${viewModel.summary.step_count}`, "逐步骤验收通过情况"],
    ["Coverage", `${viewModel.summary.covered_story_count}/${viewModel.summary.documented_story_count}`, "SS / PD / XS 场景故事覆盖"]
  ];
  elements.storylineSummary.innerHTML = summaryItems.map(([label, value, detail]) => `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `).join("");

  elements.storylineRoles.innerHTML = viewModel.roles.map((role) => `
    <section class="workspace-band storyline-role">
      <header class="storyline-role-header">
        <div>
          <h3>${escapeHtml(role.name)}</h3>
          <p>${escapeHtml(role.primary_goal)}</p>
        </div>
        ${statusPill(role.status)}
      </header>
      <div class="meta-grid">
        <div class="meta"><span>Storylines</span><strong>${escapeHtml(String(role.storyline_count))}</strong></div>
        <div class="meta"><span>Steps</span><strong>${escapeHtml(`${role.passed_step_count}/${role.step_count}`)}</strong></div>
        <div class="meta"><span>Issues</span><strong>${escapeHtml(String(role.issue_count))}</strong></div>
      </div>
      <div class="storyline-stack">
        ${role.storylines.map((storyline) => `
          <article class="storyline-card">
            <header>
              <div>
                <h4>${escapeHtml(storyline.title)}</h4>
                <p>${escapeHtml(`${storyline.passed_step_count}/${storyline.step_count} steps`)}</p>
              </div>
              ${statusPill(storyline.status)}
            </header>
            <div class="step-list">
              ${storyline.steps.map((step) => `
                <div class="step-item">
                  <div class="step-title">
                    <strong>${escapeHtml(step.action)}</strong>
                    ${statusPill(step.status)}
                  </div>
                  <p>${escapeHtml(step.expected_result)}</p>
                  <div class="tag-row">
                    ${step.story_refs.slice(0, 5).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
                    ${step.gate_refs.slice(0, 3).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
                    ${step.ui_surfaces.slice(0, 3).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function renderOperationPaths(viewModel) {
  if (!elements.operationPathSummary || !elements.operationPathRoles) return;
  const summaryItems = [
    ["Operation Paths", `${viewModel.summary.passed_operation_path_count}/${viewModel.summary.operation_path_count}`, "逐角色操作路径测试用例"],
    ["Assertions", `${viewModel.summary.passed_assertion_count}/${viewModel.summary.assertion_count}`, "UI / API / Contract / Fixture / Bridge 断言"],
    ["External Sync", viewModel.summary.external_sync_path_count, "CRM 和项目管理外部同步路径"],
    ["Legacy Bridge", viewModel.summary.legacy_bridge_path_count, "JueYing 主版本桥接路径"]
  ];
  elements.operationPathSummary.innerHTML = summaryItems.map(([label, value, detail]) => `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `).join("");

  elements.operationPathRoles.innerHTML = viewModel.roles.map((role) => `
    <section class="workspace-band storyline-role">
      <header class="storyline-role-header">
        <div>
          <h3>${escapeHtml(role.name)}</h3>
          <p>${escapeHtml(`${role.passed_operation_path_count}/${role.operation_path_count} operation paths`)}</p>
        </div>
        ${statusPill(role.status)}
      </header>
      <div class="storyline-stack">
        ${role.storylines.map((storyline) => `
          <article class="storyline-card">
            <header>
              <div>
                <h4>${escapeHtml(storyline.title)}</h4>
                <p>${escapeHtml(`${storyline.passed_operation_path_count}/${storyline.operation_path_count} paths`)}</p>
              </div>
              ${statusPill(storyline.status)}
            </header>
            <div class="step-list">
              ${storyline.test_cases.map((testCase) => `
                <div class="step-item">
                  <div class="step-title">
                    <strong>${escapeHtml(testCase.action)}</strong>
                    ${statusPill(testCase.status)}
                  </div>
                  <p>${escapeHtml(`${testCase.passed_assertion_count}/${testCase.assertion_count} assertions · ${testCase.expected_result}`)}</p>
                  <div class="tag-row">
                    ${testCase.verification_modes.slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
                    ${testCase.ui_surfaces.slice(0, 3).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
                  </div>
                </div>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function renderContracts(data) {
  elements.contractHealth.innerHTML = `
    <div class="meta-grid">
      <div class="meta"><span>Health</span><strong>${escapeHtml(data.health.ok ? "OK" : "Failed")}</strong></div>
      <div class="meta"><span>Gate Count</span><strong>${escapeHtml(String(data.sales.gate_count))}</strong></div>
      <div class="meta"><span>JueYing Mainline</span><strong>${escapeHtml(data.views.legacy_integration.ok ? "OK" : "Failed")}</strong></div>
      <div class="meta"><span>Storylines</span><strong>${escapeHtml(data.views.storyline_acceptance.ok ? "OK" : "Failed")}</strong></div>
      <div class="meta"><span>Operation Paths</span><strong>${escapeHtml(data.views.operation_path_tests.ok ? "OK" : "Failed")}</strong></div>
      <div class="meta"><span>Generated</span><p>${escapeHtml(data.generated_at)}</p></div>
    </div>
    <pre>${escapeHtml(JSON.stringify(data.health, null, 2))}</pre>
  `;
}

function statusPill(status) {
  const className = statusClass(status);
  return `<span class="status ${className}">${escapeHtml(status)}</span>`;
}

function statusClass(status) {
  if (["accepted", "confirmed", "evidence_submitted", "fresh", "auto_execute", "adapter_ready", "pass", "online"].includes(status)) {
    return "is-ok";
  }
  if (["missing", "needs_info", "needs_supplement", "collecting", "needs_confirmation", "partial"].includes(status)) {
    return "is-warn";
  }
  if (["rejected", "blocked", "failed"].includes(status)) {
    return "is-danger";
  }
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
