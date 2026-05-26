import {
  AGENT_OUTPUT_KINDS,
  ACTOR_TYPES,
  AUTONOMY_LEVELS,
  EVIDENCE_TYPES,
  EXTERNAL_SYSTEM_TYPES,
  INFORMATION_GAP_STATUSES,
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

export const contractSchemas = {
  evidence: evidenceSchema,
  informationGap: informationGapSchema,
  taskGraph: taskGraphSchema,
  salesGateCheck: salesGateCheckSchema,
  externalFactMirror: externalFactMirrorSchema,
  externalWritebackIntent: externalWritebackIntentSchema,
  agentOutput: agentOutputSchema
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
  replan: {
    required: ["reason", "trigger_evidence_ids", "affected_task_ids", "new_task_graph"]
  }
};
