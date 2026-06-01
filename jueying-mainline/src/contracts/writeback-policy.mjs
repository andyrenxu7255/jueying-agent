const HIGH_RISK_OPERATIONS = new Set(["update_field", "update_status"]);
const LOW_RISK_OPERATIONS = new Set(["create_note", "create_task", "create_comment", "add_link"]);

const HIGH_RISK_FIELDS = new Set([
  "amount",
  "stage",
  "expected_close_date",
  "close_date",
  "status",
  "assignee",
  "due_date",
  "priority",
  "owner",
  "budget"
]);

export function decideWritebackPolicy(intent) {
  const reasons = [];

  if (intent.risk_level === "high") {
    reasons.push("high-risk intent requires human confirmation");
    return {
      decision: "needs_confirmation",
      reasons
    };
  }

  if (HIGH_RISK_OPERATIONS.has(intent.operation)) {
    reasons.push(`${intent.operation} is a high-risk operation`);
    return {
      decision: "needs_confirmation",
      reasons
    };
  }

  const payloadFields = flattenPayloadKeys(intent.payload);
  const riskyFields = payloadFields.filter((field) => HIGH_RISK_FIELDS.has(field));
  if (riskyFields.length > 0) {
    reasons.push(`payload touches high-risk field(s): ${riskyFields.join(", ")}`);
    return {
      decision: "needs_confirmation",
      reasons
    };
  }

  if (intent.risk_level === "medium") {
    reasons.push("medium-risk intent defaults to confirmation");
    return {
      decision: "needs_confirmation",
      reasons
    };
  }

  if (LOW_RISK_OPERATIONS.has(intent.operation)) {
    reasons.push(`${intent.operation} is low-risk and auditable`);
    return {
      decision: "auto_execute",
      reasons
    };
  }

  reasons.push("operation is not explicitly allowed for automatic execution");
  return {
    decision: "manual_only",
    reasons
  };
}

function flattenPayloadKeys(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const keys = [];
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    if (child && typeof child === "object" && !Array.isArray(child)) {
      keys.push(...flattenPayloadKeys(child, key));
    }
  }
  return keys;
}
