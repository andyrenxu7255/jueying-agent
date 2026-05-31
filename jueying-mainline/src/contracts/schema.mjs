import {
  AGENT_OUTPUT_KINDS,
  ACTOR_TYPES,
  AUTONOMY_LEVELS,
  EVIDENCE_TYPES,
  EXTERNAL_SYSTEM_TYPES,
  INFORMATION_GAP_STATUSES,
  MANAGEMENT_COMMAND_STATUSES,
  MANAGEMENT_PROJECT_STATUSES,
  MANAGEMENT_TRIGGER_TYPES,
  SALES_GATE_STATUSES,
  SALES_STAGE_ORDER,
  TASK_GRAPH_STATUSES,
  TASK_STATUSES,
  VERIFY_DECISIONS,
  WRITEBACK_POLICY_DECISIONS,
  WRITEBACK_RISK_LEVELS
} from "./constants.mjs";

const isoDateTimePattern =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|[+-]\\d{2}:\\d{2})$";

const idPattern = "^[a-zA-Z][a-zA-Z0-9_:-]*$";

const record = {
  type: "object",
  additionalProperties: true
};

export const evidenceSchema = {
  $id: "https://teamclaw.ai/schemas/evidence.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "evidence_type",
    "source_type",
    "source_actor_id",
    "capture_channel",
    "content_ref",
    "created_at"
  ],
  properties: {
    id: { type: "string", pattern: idPattern },
    evidence_type: { type: "string", enum: EVIDENCE_TYPES },
    source_type: { type: "string", enum: ["human", "agent", "system", "external"] },
    source_actor_id: { type: "string", minLength: 1 },
    capture_channel: { type: "string", minLength: 1 },
    task_id: { type: "string", pattern: idPattern },
    gap_id: { type: "string", pattern: idPattern },
    business_refs: record,
    content_ref: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value"],
      properties: {
        kind: { type: "string", enum: ["text", "file", "url", "external_record"] },
        value: { type: "string", minLength: 1 },
        summary: { type: "string" }
      }
    },
    quality_score: { type: "number", minimum: 0, maximum: 1 },
    sensitivity: { type: "string", enum: ["public", "internal", "confidential", "restricted"] },
    created_at: { type: "string", pattern: isoDateTimePattern }
  }
};

export const informationGapSchema = {
  $id: "https://teamclaw.ai/schemas/information-gap.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "task_id",
    "status",
    "question",
    "reason",
    "collector_actor_id",
    "required_schema",
    "priority",
    "created_at"
  ],
  properties: {
    id: { type: "string", pattern: idPattern },
    task_id: { type: "string", pattern: idPattern },
    status: { type: "string", enum: INFORMATION_GAP_STATUSES },
    question: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 },
    collector_actor_id: { type: "string", minLength: 1 },
    required_schema: record,
    expected_evidence_types: {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: EVIDENCE_TYPES }
    },
    priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
    due_at: { type: "string", pattern: isoDateTimePattern },
    created_at: { type: "string", pattern: isoDateTimePattern },
    closed_by_evidence_ids: {
      type: "array",
      items: { type: "string", pattern: idPattern }
    }
  }
};

export const taskGraphSchema = {
  $id: "https://teamclaw.ai/schemas/task-graph.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["id", "run_id", "version", "status", "autonomy_level", "tasks"],
  properties: {
    id: { type: "string", pattern: idPattern },
    run_id: { type: "string", pattern: idPattern },
    version: { type: "integer", minimum: 1 },
    status: { type: "string", enum: TASK_GRAPH_STATUSES },
    generated_by: { type: "string", minLength: 1 },
    autonomy_level: { type: "string", enum: AUTONOMY_LEVELS },
    business_refs: record,
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "status",
          "owner_actor_type",
          "owner_actor_id",
          "acceptance_criteria"
        ],
        properties: {
          id: { type: "string", pattern: idPattern },
          title: { type: "string", minLength: 1 },
          status: { type: "string", enum: TASK_STATUSES },
          owner_actor_type: { type: "string", enum: ACTOR_TYPES },
          owner_actor_id: { type: "string", minLength: 1 },
          depends_on: {
            type: "array",
            items: { type: "string", pattern: idPattern }
          },
          required_evidence: {
            type: "array",
            items: { type: "string", enum: EVIDENCE_TYPES }
          },
          information_gap_ids: {
            type: "array",
            items: { type: "string", pattern: idPattern }
          },
          evidence_ids: {
            type: "array",
            items: { type: "string", pattern: idPattern }
          },
          acceptance_criteria: { type: "string", minLength: 1 },
          due_at: { type: "string", pattern: isoDateTimePattern },
          replan_reason: { type: "string" },
          external_refs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["system_type", "mirror_id"],
              properties: {
                system_type: { type: "string", enum: EXTERNAL_SYSTEM_TYPES },
                mirror_id: { type: "string", pattern: idPattern }
              }
            }
          }
        }
      }
    }
  }
};

export const salesGateCheckSchema = {
  $id: "https://teamclaw.ai/schemas/sales-gate-check.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "opportunity_id",
    "stage",
    "gate_id",
    "status",
    "evidence_ids",
    "information_gap_ids",
    "recommended_activity_ids",
    "owner_id",
    "updated_at"
  ],
  properties: {
    id: { type: "string", pattern: idPattern },
    opportunity_id: { type: "string", minLength: 1 },
    stage: { type: "string", enum: SALES_STAGE_ORDER },
    gate_id: { type: "string", pattern: "^[DSGVBN]-G\\d+$" },
    status: { type: "string", enum: SALES_GATE_STATUSES },
    evidence_ids: {
      type: "array",
      items: { type: "string", pattern: idPattern }
    },
    information_gap_ids: {
      type: "array",
      items: { type: "string", pattern: idPattern }
    },
    recommended_activity_ids: {
      type: "array",
      items: { type: "string", pattern: idPattern }
    },
    owner_id: { type: "string", minLength: 1 },
    updated_at: { type: "string", pattern: isoDateTimePattern }
  }
};

export const externalFactMirrorSchema = {
  $id: "https://teamclaw.ai/schemas/external-fact-mirror.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "connection_id",
    "system_type",
    "provider",
    "object_type",
    "external_id",
    "external_url",
    "mirrored_at",
    "field_snapshot"
  ],
  properties: {
    id: { type: "string", pattern: idPattern },
    connection_id: { type: "string", pattern: idPattern },
    system_type: { type: "string", enum: EXTERNAL_SYSTEM_TYPES },
    provider: { type: "string", minLength: 1 },
    object_type: { type: "string", minLength: 1 },
    external_id: { type: "string", minLength: 1 },
    external_url: { type: "string", minLength: 1 },
    mirrored_at: { type: "string", pattern: isoDateTimePattern },
    source_updated_at: { type: "string", pattern: isoDateTimePattern },
    field_snapshot: record,
    field_mapping_version: { type: "string" },
    freshness: { type: "string", enum: ["fresh", "stale", "unknown"] }
  }
};

export const externalWritebackIntentSchema = {
  $id: "https://teamclaw.ai/schemas/external-writeback-intent.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "connection_id",
    "system_type",
    "provider",
    "target",
    "operation",
    "payload",
    "source",
    "risk_level",
    "idempotency_key",
    "policy_decision",
    "created_at"
  ],
  properties: {
    id: { type: "string", pattern: idPattern },
    connection_id: { type: "string", pattern: idPattern },
    system_type: { type: "string", enum: EXTERNAL_SYSTEM_TYPES },
    provider: { type: "string", minLength: 1 },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["object_type", "external_id"],
      properties: {
        object_type: { type: "string", minLength: 1 },
        external_id: { type: "string", minLength: 1 }
      }
    },
    operation: {
      type: "string",
      enum: ["create_note", "create_task", "create_comment", "add_link", "update_field", "update_status"]
    },
    payload: record,
    source: {
      type: "object",
      additionalProperties: false,
      required: ["agent_id", "reason"],
      properties: {
        agent_id: { type: "string", minLength: 1 },
        task_id: { type: "string", pattern: idPattern },
        evidence_ids: {
          type: "array",
          items: { type: "string", pattern: idPattern }
        },
        reason: { type: "string", minLength: 1 }
      }
    },
    risk_level: { type: "string", enum: WRITEBACK_RISK_LEVELS },
    idempotency_key: { type: "string", minLength: 8 },
    policy_decision: { type: "string", enum: WRITEBACK_POLICY_DECISIONS },
    created_at: { type: "string", pattern: isoDateTimePattern },
    confirmed_by: { type: "string" },
    confirmed_at: { type: "string", pattern: isoDateTimePattern }
  }
};

export const agentOutputSchema = {
  $id: "https://teamclaw.ai/schemas/agent-output.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "agent_id", "created_at", "payload"],
  properties: {
    id: { type: "string", pattern: idPattern },
    kind: { type: "string", enum: AGENT_OUTPUT_KINDS },
    agent_id: { type: "string", minLength: 1 },
    run_id: { type: "string", pattern: idPattern },
    task_id: { type: "string", pattern: idPattern },
    created_at: { type: "string", pattern: isoDateTimePattern },
    payload: {
      type: "object",
      additionalProperties: true
    }
  }
};

export const managementCommandCenterSchema = {
  $id: "https://teamclaw.ai/schemas/management-command-center.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["id", "version", "active_user_id", "roles", "commands", "execution_tasks", "execution_updates", "projects", "swimlanes"],
  properties: {
    id: { type: "string", pattern: idPattern },
    version: { type: "string", minLength: 1 },
    active_user_id: { type: "string", minLength: 1 },
    roles: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "user_id", "role_type", "permissions", "default_view"],
        properties: {
          id: { type: "string", pattern: idPattern },
          name: { type: "string", minLength: 1 },
          user_id: { type: "string", minLength: 1 },
          role_type: { type: "string", enum: ["executive", "manager", "agent_operator", "specialized_agent", "worker", "admin"] },
          permissions: {
            type: "array",
            minItems: 1,
            items: {
              type: "string",
              enum: [
                "view_management_dashboard",
                "create_command",
                "schedule_command",
                "configure_trigger",
                "delegate_to_agent",
                "approve_high_risk",
                "view_all_projects",
                "view_assigned_work",
                "configure_governance"
              ]
            }
          },
          default_view: { type: "string", enum: ["management_command_center", "assigned_work", "admin_governance"] }
        }
      }
    },
    commands: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "status",
          "trigger_type",
          "created_by_role_id",
          "target_agent_id",
          "objective",
          "task_graph_id",
          "project_id",
          "delegation_chain",
          "created_at"
        ],
        properties: {
          id: { type: "string", pattern: idPattern },
          title: { type: "string", minLength: 1 },
          status: { type: "string", enum: MANAGEMENT_COMMAND_STATUSES },
          trigger_type: { type: "string", enum: MANAGEMENT_TRIGGER_TYPES },
          created_by_role_id: { type: "string", pattern: idPattern },
          target_agent_id: { type: "string", minLength: 1 },
          objective: { type: "string", minLength: 1 },
          task_graph_id: { type: "string", pattern: idPattern },
          project_id: { type: "string", pattern: idPattern },
          generated_task_ids: {
            type: "array",
            minItems: 1,
            items: { type: "string", pattern: idPattern }
          },
          schedule: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "timezone", "next_run_at"],
            properties: {
              kind: { type: "string", enum: ["once", "daily", "weekly", "monthly"] },
              timezone: { type: "string", minLength: 1 },
              next_run_at: { type: "string", pattern: isoDateTimePattern },
              cadence_label: { type: "string" }
            }
          },
          condition: {
            type: "object",
            additionalProperties: false,
            required: ["signal", "operator", "threshold", "evaluation_window"],
            properties: {
              signal: { type: "string", minLength: 1 },
              operator: { type: "string", enum: ["equals", "not_equals", "greater_than", "less_than", "contains", "missing_for"] },
              threshold: { type: "string", minLength: 1 },
              evaluation_window: { type: "string", minLength: 1 }
            }
          },
          delegation_chain: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["order", "actor_type", "actor_id", "responsibility"],
              properties: {
                order: { type: "integer", minimum: 1 },
                actor_type: { type: "string", enum: ["executive", "pm_agent", "sales_agent", "delivery_agent", "worker_agent", "human_twin_agent", "human"] },
                actor_id: { type: "string", minLength: 1 },
                responsibility: { type: "string", minLength: 1 }
              }
            }
          },
          created_at: { type: "string", pattern: isoDateTimePattern },
          last_triggered_at: { type: "string", pattern: isoDateTimePattern }
        }
      }
    },
    execution_tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "command_id",
          "project_id",
          "title",
          "status",
          "owner_actor_type",
          "owner_actor_id",
          "source_agent_id",
          "acceptance_criteria",
          "progress_percent",
          "created_at"
        ],
        properties: {
          id: { type: "string", pattern: idPattern },
          command_id: { type: "string", pattern: idPattern },
          project_id: { type: "string", pattern: idPattern },
          task_graph_id: { type: "string", pattern: idPattern },
          title: { type: "string", minLength: 1 },
          status: { type: "string", enum: MANAGEMENT_PROJECT_STATUSES },
          owner_actor_type: { type: "string", enum: ["pm_agent", "sales_agent", "delivery_agent", "worker_agent", "human_twin_agent", "human"] },
          owner_actor_id: { type: "string", minLength: 1 },
          source_agent_id: { type: "string", minLength: 1 },
          acceptance_criteria: { type: "string", minLength: 1 },
          due_at: { type: "string", pattern: isoDateTimePattern },
          progress_percent: { type: "number", minimum: 0, maximum: 100 },
          latest_update_id: { type: "string", pattern: idPattern },
          result_summary: { type: "string" },
          blocker: { type: "string" },
          evidence_ids: {
            type: "array",
            items: { type: "string", pattern: idPattern }
          },
          created_at: { type: "string", pattern: isoDateTimePattern },
          updated_at: { type: "string", pattern: isoDateTimePattern }
        }
      }
    },
    execution_updates: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "task_id", "actor_type", "actor_id", "update_type", "status", "message", "progress_percent", "created_at"],
        properties: {
          id: { type: "string", pattern: idPattern },
          task_id: { type: "string", pattern: idPattern },
          actor_type: { type: "string", enum: ["pm_agent", "sales_agent", "delivery_agent", "worker_agent", "human_twin_agent", "human"] },
          actor_id: { type: "string", minLength: 1 },
          update_type: { type: "string", enum: ["decomposition", "handoff", "progress", "evidence", "blocker", "result"] },
          status: { type: "string", enum: MANAGEMENT_PROJECT_STATUSES },
          message: { type: "string", minLength: 1 },
          progress_percent: { type: "number", minimum: 0, maximum: 100 },
          evidence_ids: {
            type: "array",
            items: { type: "string", pattern: idPattern }
          },
          created_at: { type: "string", pattern: isoDateTimePattern }
        }
      }
    },
    projects: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "domain", "owner_role_id", "task_graph_id", "status", "health", "command_ids"],
        properties: {
          id: { type: "string", pattern: idPattern },
          name: { type: "string", minLength: 1 },
          domain: { type: "string", enum: ["sales", "delivery", "operations", "governance", "custom"] },
          owner_role_id: { type: "string", pattern: idPattern },
          task_graph_id: { type: "string", pattern: idPattern },
          status: { type: "string", enum: MANAGEMENT_PROJECT_STATUSES },
          health: { type: "string", enum: ["green", "yellow", "red"] },
          command_ids: {
            type: "array",
            minItems: 1,
            items: { type: "string", pattern: idPattern }
          }
        }
      }
    },
    swimlanes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "status", "task_ids"],
        properties: {
          id: { type: "string", pattern: idPattern },
          title: { type: "string", minLength: 1 },
          status: { type: "string", enum: MANAGEMENT_PROJECT_STATUSES },
          task_ids: {
            type: "array",
            items: { type: "string", pattern: idPattern }
          }
        }
      }
    }
  }
};

export const contractSchemas = {
  evidence: evidenceSchema,
  informationGap: informationGapSchema,
  taskGraph: taskGraphSchema,
  salesGateCheck: salesGateCheckSchema,
  externalFactMirror: externalFactMirrorSchema,
  externalWritebackIntent: externalWritebackIntentSchema,
  agentOutput: agentOutputSchema,
  managementCommandCenter: managementCommandCenterSchema
};

export const agentOutputPayloadRules = {
  pm_agent_plan: {
    required: ["task_graph", "information_gaps", "rationale"],
    taskGraphField: "task_graph",
    gapListField: "information_gaps"
  },
  pm_agent_verify: {
    required: ["decision", "task_id", "evidence_ids", "reason"],
    decisionEnum: VERIFY_DECISIONS
  },
  human_twin_collect_prompt: {
    required: ["gap_id", "recipient_id", "message", "required_schema", "deadline"]
  },
  human_twin_collect_result: {
    required: ["gap_id", "collector_actor_id", "evidence", "completeness"]
  },
  management_command_plan: {
    required: ["command_id", "task_graph_id", "delegation_chain", "expected_outcome"]
  },
  scheduled_command_tick: {
    required: ["command_id", "scheduled_for", "next_run_at", "reason"]
  },
  condition_trigger_match: {
    required: ["command_id", "signal", "observed_value", "threshold", "reason"]
  },
  replan: {
    required: ["reason", "trigger_evidence_ids", "affected_task_ids", "new_task_graph"]
  }
};
