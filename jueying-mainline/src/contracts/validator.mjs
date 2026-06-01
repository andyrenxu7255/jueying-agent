import { agentOutputPayloadRules, contractSchemas } from "./schema.mjs";

export class ValidationError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export function validateContract(kind, value, options = {}) {
  const schema = contractSchemas[kind];
  if (!schema) {
    throw new Error(`Unknown contract kind: ${kind}`);
  }

  const issues = validateAgainstSchema(value, schema, "$");

  if (kind === "taskGraph") {
    issues.push(...validateTaskGraphSemantics(value));
  }

  if (kind === "salesGateCheck") {
    issues.push(...validateSalesGateCheckSemantics(value, options.salesGateIndex));
  }

  if (kind === "externalWritebackIntent") {
    issues.push(...validateWritebackIntentSemantics(value));
  }

  if (kind === "agentOutput") {
    issues.push(...validateAgentOutputSemantics(value));
  }

  if (kind === "managementCommandCenter") {
    issues.push(...validateManagementCommandCenterSemantics(value));
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function assertContract(kind, value, options = {}) {
  const result = validateContract(kind, value, options);
  if (!result.ok) {
    throw new ValidationError(`Invalid ${kind} contract`, result.issues);
  }
  return value;
}

function validateAgainstSchema(value, schema, path) {
  const issues = [];

  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(issue(path, `expected one of ${schema.enum.join(", ")}`));
    return issues;
  }

  if (schema.type) {
    const typeOk = isType(value, schema.type);
    if (!typeOk) {
      issues.push(issue(path, `expected ${schema.type}`));
      return issues;
    }
  }

  if (schema.type === "object") {
    issues.push(...validateObject(value, schema, path));
  }

  if (schema.type === "array") {
    issues.push(...validateArray(value, schema, path));
  }

  if (schema.type === "string") {
    issues.push(...validateString(value, schema, path));
  }

  if (schema.type === "integer" && !Number.isInteger(value)) {
    issues.push(issue(path, "expected integer"));
  }

  if ((schema.type === "number" || schema.type === "integer") && typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push(issue(path, `expected >= ${schema.minimum}`));
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push(issue(path, `expected <= ${schema.maximum}`));
    }
  }

  return issues;
}

function validateObject(value, schema, path) {
  const issues = [];
  const required = schema.required ?? [];
  const properties = schema.properties ?? {};

  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      issues.push(issue(`${path}.${key}`, "required field missing"));
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        issues.push(issue(`${path}.${key}`, "unknown field"));
      }
    }
  }

  for (const [key, childSchema] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) {
      issues.push(...validateAgainstSchema(value[key], childSchema, `${path}.${key}`));
    }
  }

  return issues;
}

function validateArray(value, schema, path) {
  const issues = [];

  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    issues.push(issue(path, `expected at least ${schema.minItems} item(s)`));
  }

  if (schema.items) {
    value.forEach((item, index) => {
      issues.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`));
    });
  }

  return issues;
}

function validateString(value, schema, path) {
  const issues = [];

  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    issues.push(issue(path, `expected length >= ${schema.minLength}`));
  }

  if (schema.pattern) {
    const re = new RegExp(schema.pattern);
    if (!re.test(value)) {
      issues.push(issue(path, `does not match pattern ${schema.pattern}`));
    }
  }

  return issues;
}

function isType(value, type) {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  if (type === "integer") {
    return typeof value === "number";
  }
  return typeof value === type;
}

function validateTaskGraphSemantics(graph) {
  const issues = [];
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.tasks)) {
    return issues;
  }

  const taskIds = new Set();
  for (const task of graph.tasks) {
    if (taskIds.has(task.id)) {
      issues.push(issue("$.tasks", `duplicate task id: ${task.id}`));
    }
    taskIds.add(task.id);
  }

  for (const task of graph.tasks) {
    for (const dependencyId of task.depends_on ?? []) {
      if (!taskIds.has(dependencyId)) {
        issues.push(issue(`$.tasks.${task.id}.depends_on`, `unknown dependency: ${dependencyId}`));
      }
      if (dependencyId === task.id) {
        issues.push(issue(`$.tasks.${task.id}.depends_on`, "task cannot depend on itself"));
      }
    }

    const needsEvidence = ["accepted"].includes(task.status);
    const hasEvidence = Array.isArray(task.evidence_ids) && task.evidence_ids.length > 0;
    const waived = task.status === "waived";
    if (needsEvidence && !hasEvidence && !waived) {
      issues.push(issue(`$.tasks.${task.id}.evidence_ids`, "accepted task must reference evidence"));
    }
  }

  issues.push(...detectCycles(graph.tasks));
  return issues;
}

function detectCycles(tasks) {
  const issues = [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();

  function visit(taskId, trail) {
    if (visiting.has(taskId)) {
      issues.push(issue("$.tasks", `dependency cycle detected: ${[...trail, taskId].join(" -> ")}`));
      return;
    }
    if (visited.has(taskId)) {
      return;
    }
    const task = byId.get(taskId);
    if (!task) {
      return;
    }
    visiting.add(taskId);
    for (const dep of task.depends_on ?? []) {
      visit(dep, [...trail, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) {
    visit(task.id, []);
  }

  return issues;
}

function validateSalesGateCheckSemantics(check, salesGateIndex) {
  const issues = [];
  if (!check || typeof check !== "object") {
    return issues;
  }

  if (salesGateIndex) {
    const gate = salesGateIndex.get(check.gate_id);
    if (!gate) {
      issues.push(issue("$.gate_id", `unknown gate id: ${check.gate_id}`));
    } else if (gate.stage !== check.stage) {
      issues.push(issue("$.stage", `gate ${check.gate_id} belongs to ${gate.stage}`));
    }
  }

  const confirmed = ["confirmed", "evidence_submitted"].includes(check.status);
  const hasEvidence = Array.isArray(check.evidence_ids) && check.evidence_ids.length > 0;
  if (confirmed && !hasEvidence) {
    issues.push(issue("$.evidence_ids", "confirmed or evidence_submitted gate must reference evidence"));
  }

  const missing = ["missing", "collecting", "needs_supplement", "rejected"].includes(check.status);
  const hasGap = Array.isArray(check.information_gap_ids) && check.information_gap_ids.length > 0;
  if (missing && !hasGap) {
    issues.push(issue("$.information_gap_ids", "missing gate must reference an information gap"));
  }

  return issues;
}

function validateWritebackIntentSemantics(intent) {
  const issues = [];
  if (!intent || typeof intent !== "object") {
    return issues;
  }

  if (intent.risk_level === "high" && intent.policy_decision === "auto_execute") {
    issues.push(issue("$.policy_decision", "high-risk writeback cannot auto_execute"));
  }

  if (
    intent.operation === "update_status" &&
    intent.policy_decision === "auto_execute"
  ) {
    issues.push(issue("$.policy_decision", "status updates require confirmation"));
  }

  return issues;
}

function validateAgentOutputSemantics(output) {
  const issues = [];
  if (!output || typeof output !== "object" || !output.payload || typeof output.payload !== "object") {
    return issues;
  }

  const rule = agentOutputPayloadRules[output.kind];
  if (!rule) {
    return issues;
  }

  for (const field of rule.required) {
    if (!Object.hasOwn(output.payload, field)) {
      issues.push(issue(`$.payload.${field}`, "required field missing for agent output kind"));
    }
  }

  if (rule.decisionEnum && Object.hasOwn(output.payload, "decision")) {
    if (!rule.decisionEnum.includes(output.payload.decision)) {
      issues.push(issue("$.payload.decision", `expected one of ${rule.decisionEnum.join(", ")}`));
    }
  }

  if (output.kind === "pm_agent_verify") {
    const decisionNeedsEvidence = ["accepted"].includes(output.payload.decision);
    const evidenceIds = output.payload.evidence_ids;
    if (decisionNeedsEvidence && (!Array.isArray(evidenceIds) || evidenceIds.length === 0)) {
      issues.push(issue("$.payload.evidence_ids", "accepted verification must reference evidence"));
    }
  }

  if (output.kind === "human_twin_collect_result") {
    const completeness = output.payload.completeness;
    if (typeof completeness !== "number" || completeness < 0 || completeness > 1) {
      issues.push(issue("$.payload.completeness", "expected number between 0 and 1"));
    }
  }

  return issues;
}

function validateManagementCommandCenterSemantics(center) {
  const issues = [];
  if (!center || typeof center !== "object") {
    return issues;
  }

  const roles = Array.isArray(center.roles) ? center.roles : [];
  const commands = Array.isArray(center.commands) ? center.commands : [];
  const executionTasks = Array.isArray(center.execution_tasks) ? center.execution_tasks : [];
  const executionUpdates = Array.isArray(center.execution_updates) ? center.execution_updates : [];
  const projects = Array.isArray(center.projects) ? center.projects : [];
  const swimlanes = Array.isArray(center.swimlanes) ? center.swimlanes : [];
  const roleIds = new Set(roles.map((role) => role.id));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const commandIds = new Set(commands.map((command) => command.id));
  const executionTaskIds = new Set(executionTasks.map((task) => task.id));
  const executionUpdateIds = new Set(executionUpdates.map((update) => update.id));
  const projectIds = new Set(projects.map((project) => project.id));
  const taskIds = new Set();

  if (!roles.some((role) => role.role_type === "executive" && role.permissions?.includes("create_command"))) {
    issues.push(issue("$.roles", "management command center requires an executive role with create_command permission"));
  }

  for (const command of commands) {
    if (!roleIds.has(command.created_by_role_id)) {
      issues.push(issue(`$.commands.${command.id}.created_by_role_id`, `unknown role: ${command.created_by_role_id}`));
    }
    const creator = roleById.get(command.created_by_role_id);
    if (creator && !creator.permissions?.includes("create_command")) {
      issues.push(issue(`$.commands.${command.id}.created_by_role_id`, "command creator must have create_command permission"));
    }
    if (command.trigger_type === "scheduled" && !command.schedule) {
      issues.push(issue(`$.commands.${command.id}.schedule`, "scheduled command requires schedule"));
    }
    if (command.trigger_type === "condition" && !command.condition) {
      issues.push(issue(`$.commands.${command.id}.condition`, "condition command requires condition"));
    }
    if (command.schedule && creator && !creator.permissions?.includes("schedule_command")) {
      issues.push(issue(`$.commands.${command.id}.schedule`, "schedule creator must have schedule_command permission"));
    }
    if (command.condition && creator && !creator.permissions?.includes("configure_trigger")) {
      issues.push(issue(`$.commands.${command.id}.condition`, "condition creator must have configure_trigger permission"));
    }
    if ((command.delegation_chain ?? []).length < 3) {
      issues.push(issue(`$.commands.${command.id}.delegation_chain`, "command must express boss -> agent -> executor delegation"));
    }
    const chainTypes = (command.delegation_chain ?? []).map((item) => item.actor_type);
    if (!chainTypes.includes("executive") || !chainTypes.some((type) => type.endsWith("_agent")) || !chainTypes.some((type) => ["human", "human_twin_agent"].includes(type))) {
      issues.push(issue(`$.commands.${command.id}.delegation_chain`, "delegation chain must include executive, agent, and human/subordinate executor"));
    }
    if (!Array.isArray(command.generated_task_ids) || command.generated_task_ids.length === 0) {
      issues.push(issue(`$.commands.${command.id}.generated_task_ids`, "command must reference automatically decomposed execution tasks"));
    }
    for (const taskId of command.generated_task_ids ?? []) {
      if (!executionTaskIds.has(taskId)) {
        issues.push(issue(`$.commands.${command.id}.generated_task_ids`, `unknown execution task: ${taskId}`));
      }
    }
  }

  for (const task of executionTasks) {
    if (!commandIds.has(task.command_id)) {
      issues.push(issue(`$.execution_tasks.${task.id}.command_id`, `unknown command: ${task.command_id}`));
    }
    if (!projectIds.has(task.project_id)) {
      issues.push(issue(`$.execution_tasks.${task.id}.project_id`, `unknown project: ${task.project_id}`));
    }
    if (task.latest_update_id && !executionUpdateIds.has(task.latest_update_id)) {
      issues.push(issue(`$.execution_tasks.${task.id}.latest_update_id`, `unknown execution update: ${task.latest_update_id}`));
    }
    if (task.status === "done" && (!task.result_summary || task.progress_percent !== 100)) {
      issues.push(issue(`$.execution_tasks.${task.id}`, "done execution task must include result_summary and 100 progress"));
    }
    if (["in_progress", "needs_info", "review"].includes(task.status) && typeof task.progress_percent !== "number") {
      issues.push(issue(`$.execution_tasks.${task.id}.progress_percent`, "active execution task must include progress"));
    }
  }

  for (const update of executionUpdates) {
    if (!executionTaskIds.has(update.task_id)) {
      issues.push(issue(`$.execution_updates.${update.id}.task_id`, `unknown execution task: ${update.task_id}`));
    }
    if (["result", "evidence"].includes(update.update_type) && (!Array.isArray(update.evidence_ids))) {
      issues.push(issue(`$.execution_updates.${update.id}.evidence_ids`, "result or evidence update must carry evidence_ids, even if empty"));
    }
  }

  for (const project of projects) {
    if (!roleIds.has(project.owner_role_id)) {
      issues.push(issue(`$.projects.${project.id}.owner_role_id`, `unknown role: ${project.owner_role_id}`));
    }
    for (const commandId of project.command_ids ?? []) {
      if (!commandIds.has(commandId)) {
        issues.push(issue(`$.projects.${project.id}.command_ids`, `unknown command: ${commandId}`));
      }
    }
  }

  for (const swimlane of swimlanes) {
    for (const taskId of swimlane.task_ids ?? []) {
      if (!executionTaskIds.has(taskId)) {
        issues.push(issue(`$.swimlanes.${swimlane.id}.task_ids`, `unknown execution task: ${taskId}`));
      }
      taskIds.add(taskId);
    }
  }
  if (taskIds.size === 0) {
    issues.push(issue("$.swimlanes", "swimlane board must contain at least one task"));
  }

  for (const command of commands) {
    if (!projectIds.has(command.project_id)) {
      issues.push(issue(`$.commands.${command.id}.project_id`, `unknown project: ${command.project_id}`));
    }
  }

  return issues;
}

function issue(path, message) {
  return { path, message };
}
