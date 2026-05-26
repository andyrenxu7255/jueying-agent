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
    return typeof value === "number" && Number.isInteger(value);
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

  for (const field of rule.required ?? []) {
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

function issue(path, message) {
  return { path, message };
}
