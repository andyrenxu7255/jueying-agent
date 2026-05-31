export const TASK_GRAPH_STATUSES = [
  "draft",
  "ready_for_confirmation",
  "active",
  "blocked",
  "completed",
  "cancelled"
];

export const TASK_STATUSES = [
  "pending",
  "ready",
  "assigned",
  "in_progress",
  "needs_info",
  "needs_supplement",
  "blocked",
  "accepted",
  "rejected",
  "waived",
  "cancelled"
];

export const INFORMATION_GAP_STATUSES = [
  "open",
  "collecting",
  "evidence_submitted",
  "closed",
  "waived",
  "expired"
];

export const SALES_GATE_STATUSES = [
  "unknown",
  "missing",
  "collecting",
  "evidence_submitted",
  "confirmed",
  "needs_supplement",
  "rejected",
  "waived"
];

export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3", "L4"];

export const ACTOR_TYPES = [
  "pm_agent",
  "worker_agent",
  "human_twin_agent",
  "human",
  "external_system"
];

export const EVIDENCE_TYPES = [
  "meeting_summary",
  "meeting_minutes",
  "customer_quote",
  "email",
  "chat_screenshot",
  "whiteboard_photo",
  "sales_note",
  "stakeholder_map",
  "champion_confirmation",
  "eb_confirmation",
  "budget_note",
  "calendar_event",
  "customer_confirmation",
  "evaluation_criteria",
  "process_note",
  "validation_plan",
  "business_case",
  "quote",
  "pricing_model",
  "approval_record",
  "order_checklist",
  "contract_document",
  "sow",
  "risk_note",
  "negotiation_plan",
  "contact_record",
  "internal_review",
  "external_research",
  "crm_url",
  "crm_snapshot",
  "pm_url",
  "pm_snapshot",
  "delivery_confirmation",
  "human_confirmation",
  "system_event"
];

export const EXTERNAL_SYSTEM_TYPES = ["crm", "project_management"];

export const WRITEBACK_RISK_LEVELS = ["low", "medium", "high"];

export const WRITEBACK_POLICY_DECISIONS = [
  "auto_execute",
  "needs_confirmation",
  "reject",
  "manual_only"
];

export const AGENT_OUTPUT_KINDS = [
  "pm_agent_plan",
  "pm_agent_verify",
  "human_twin_collect_prompt",
  "human_twin_collect_result",
  "management_command_plan",
  "scheduled_command_tick",
  "condition_trigger_match",
  "replan"
];

export const MANAGEMENT_COMMAND_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "triggered",
  "delegated",
  "completed",
  "paused",
  "cancelled"
];

export const MANAGEMENT_TRIGGER_TYPES = [
  "manual",
  "scheduled",
  "condition"
];

export const MANAGEMENT_PROJECT_STATUSES = [
  "intake",
  "planning",
  "delegated",
  "in_progress",
  "needs_info",
  "review",
  "done",
  "blocked"
];

export const VERIFY_DECISIONS = [
  "accepted",
  "needs_supplement",
  "blocked",
  "rejected",
  "escalated",
  "waived"
];

export const SALES_STAGE_ORDER = [
  "discover",
  "scope",
  "go_no_go",
  "validate_solution",
  "business_case",
  "negotiate_close"
];
