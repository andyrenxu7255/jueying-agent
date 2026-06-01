# DEV-31 TaskGraph 与信息缺口最小契约

> 状态：可执行最小契约记录
> 读者：架构、后端、前端、Agent 编排、测试、后续 Agent
> 最近校准：2026-05-31
> 依赖：DEV-23、DEV-26、DEV-29、DEV-30、DEV-32、DEV-33、`src/contracts/schema.mjs`、`src/contracts/validator.mjs`、`fixtures/p1-demo/`、`tests/contracts.test.mjs`
> 核心目的：锁定 TaskGraph、Information Gap、Evidence、SalesGateCheck、External Fact Mirror、External Writeback Intent、Management Command Center 和 Agent Output 的最小可校验结构，并与当前可执行 schema 保持一致。

## 1. 结论

P1 不应先追求完整替代 CRM、完整替代项目管理系统或复杂图算法，而要先让以下契约成立：

| 契约 | 为什么必须先定 |
|---|---|
| TaskGraph | 所有运营推进的事实中心。 |
| Information Gap | Agent 传感器不足的产品化表达。 |
| Evidence | Agent 判断、验收、复盘的证据基础。 |
| SalesGateCheck | 销售六步法阶段质量的控制器。 |
| External Fact Mirror | CRM、项目管理系统等外部事实层的本地镜像。 |
| External Writeback Intent | Agent 写外部系统前必须生成的意图、策略和审计载体。 |
| Management Command Center | 老板/管理层下发经营指令、定时任务、条件触发任务、Agent 委派链和项目泳道的统一契约。 |
| Agent Output | PM Agent、Human Twin Agent、Verifier、Replan 输出必须可解析、可校验、可执行。 |

可执行 schema 权威文件是 `src/contracts/schema.mjs`；导出的 JSON Schema 在 `schemas/`；P1 样例数据在 `fixtures/p1-demo/`；核心语义校验在 `src/contracts/validator.mjs` 和 `tests/contracts.test.mjs`。

## 2. 命名与 ID

| 规则 | 要求 |
|---|---|
| ID | 字符串，使用稳定前缀，例如 `task_001`、`gap_001`、`ev_001`。 |
| 时间 | ISO 8601 字符串，必须带时区，例如 `2026-05-26T10:00:00+08:00`。 |
| 状态 | 使用枚举，不使用自由文本。 |
| 金额 | 不使用浮点；进入 payload 时使用整数分或字符串金额。 |
| 业务引用 | 统一放入 `business_refs` 或外部镜像，不污染 Task 基础字段。 |
| 可选字段 | 无值则省略，避免用 `null` 表达未知。 |
| 外部写入 | 必须有 `idempotency_key`、`risk_level` 和 `policy_decision`。 |

## 3. TaskGraph 最小 JSON

```json
{
  "id": "tg_sales_acme_001",
  "run_id": "run_sales_acme_001",
  "version": 1,
  "status": "active",
  "generated_by": "pm_agent_sales_001",
  "autonomy_level": "L1",
  "business_refs": {
    "opportunity_id": "opp_acme_001",
    "account_id": "acct_acme"
  },
  "tasks": [
    {
      "id": "task_discover_champion",
      "title": "Confirm champion or target champion",
      "status": "needs_info",
      "owner_actor_type": "human_twin_agent",
      "owner_actor_id": "twin_sales_andy",
      "depends_on": [],
      "required_evidence": ["sales_note", "meeting_summary", "customer_quote"],
      "information_gap_ids": ["gap_discover_champion"],
      "evidence_ids": [],
      "acceptance_criteria": "A candidate champion is identified with behavior signal, department, and influence hypothesis.",
      "due_at": "2026-05-27T18:00:00+08:00",
      "external_refs": [
        {
          "system_type": "crm",
          "mirror_id": "mirror_crm_opp_acme_001"
        }
      ]
    }
  ]
}
```

### 3.1 TaskGraph 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | 图谱 ID。 |
| run_id | 是 | 所属 Run。 |
| version | 是 | 整数版本，重规划后递增。 |
| status | 是 | `draft` / `ready_for_confirmation` / `active` / `blocked` / `completed` / `cancelled`。 |
| autonomy_level | 是 | `L0` / `L1` / `L2` / `L3` / `L4`。 |
| generated_by | 否 | 生成图谱的 Agent 或人。 |
| business_refs | 否 | 关联客户、商机、合同、交付范围等业务引用。 |
| tasks | 是 | Task 列表，至少 1 个。 |

### 3.2 Task 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | Task ID。 |
| title | 是 | 可读标题。 |
| status | 是 | `pending` / `ready` / `assigned` / `in_progress` / `needs_info` / `needs_supplement` / `blocked` / `accepted` / `rejected` / `waived` / `cancelled`。 |
| owner_actor_type | 是 | `pm_agent` / `worker_agent` / `human_twin_agent` / `human` / `external_system`。 |
| owner_actor_id | 是 | 执行或负责主体 ID。 |
| depends_on | 否 | 依赖 Task ID 列表。 |
| required_evidence | 否 | 需要的 Evidence 类型。 |
| information_gap_ids | 否 | 关联 Information Gap ID 列表。 |
| evidence_ids | 否 | 关联 Evidence ID 列表。 |
| acceptance_criteria | 是 | 验收规则，必须可读。 |
| due_at | 否 | 截止时间。 |
| replan_reason | 否 | 重规划产生或变更该 Task 的原因。 |
| external_refs | 否 | 外部镜像引用，包含 `system_type` 和 `mirror_id`。 |

### 3.3 TaskGraph 语义红线

- Task ID 不能重复。
- `depends_on` 必须引用同一 TaskGraph 内存在的 Task，且不能形成依赖环。
- `accepted` Task 必须引用至少一个 Evidence；否则只能保持未验收状态或显式 `waived`。
- 外部项目系统的 Done 状态不能直接等同 Agent Task 的 `accepted`。

## 4. Information Gap 最小 JSON

```json
{
  "id": "gap_discover_champion",
  "task_id": "task_discover_champion",
  "status": "collecting",
  "question": "Who interacted most, asked questions, commented, or listened carefully during the meeting?",
  "reason": "D-G1 cannot be confirmed without a champion or target champion signal.",
  "collector_actor_id": "twin_sales_andy",
  "required_schema": {
    "fields": [
      "person_name",
      "department",
      "behavior_signal",
      "influence_hypothesis",
      "original_quote"
    ]
  },
  "expected_evidence_types": ["sales_note", "meeting_summary", "customer_quote"],
  "priority": "high",
  "due_at": "2026-05-27T18:00:00+08:00",
  "created_at": "2026-05-26T09:00:00+08:00",
  "closed_by_evidence_ids": []
}
```

### 4.1 Gap 状态

| 状态 | 含义 |
|---|---|
| open | 已识别，未开始采集。 |
| collecting | 正在采集。 |
| evidence_submitted | 已收到证据，等待 Agent 或人验收。 |
| closed | 缺口关闭。 |
| waived | 人工豁免。 |
| expired | 已过期，需要升级或重规划。 |

### 4.2 Gap 关闭规则

Information Gap 关闭必须满足至少一种条件：

- 收到符合 `required_schema` 的 Evidence，并进入 `closed_by_evidence_ids`。
- Agent 记录替代证据和替代理由。
- 负责人豁免并记录风险。
- 关联 Task 被取消。

## 5. Evidence 最小 JSON

```json
{
  "id": "ev_next_meeting_calendar",
  "evidence_type": "calendar_event",
  "source_type": "external",
  "source_actor_id": "crm_hubspot_demo",
  "capture_channel": "api",
  "task_id": "task_discover_next_action",
  "business_refs": {
    "opportunity_id": "opp_acme_001",
    "crm_external_id": "deal_10001"
  },
  "content_ref": {
    "kind": "external_record",
    "value": "hubspot://meeting/mtg_90001",
    "summary": "Next meeting scheduled with ACME IT director on 2026-05-28."
  },
  "quality_score": 0.9,
  "sensitivity": "internal",
  "created_at": "2026-05-26T10:00:00+08:00"
}
```

### 5.1 Evidence 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | Evidence ID。 |
| evidence_type | 是 | 必须来自 `EVIDENCE_TYPES`。 |
| source_type | 是 | `human` / `agent` / `system` / `external`。 |
| source_actor_id | 是 | 人、Agent 或外部系统 ID。 |
| capture_channel | 是 | 来源渠道，例如 meeting、wecom、api。 |
| task_id | 否 | 关联 Task。 |
| gap_id | 否 | 关联 Information Gap。 |
| business_refs | 否 | 关联客户、商机、外部记录等。 |
| content_ref | 是 | 内容引用，包含 `kind` 和 `value`。 |
| quality_score | 否 | 0 到 1。 |
| sensitivity | 否 | `public` / `internal` / `confidential` / `restricted`。 |
| created_at | 是 | 创建时间。 |

### 5.2 Evidence 类型

当前可执行 Evidence 类型包括：

`meeting_summary`、`meeting_minutes`、`customer_quote`、`email`、`chat_screenshot`、`whiteboard_photo`、`sales_note`、`stakeholder_map`、`champion_confirmation`、`eb_confirmation`、`budget_note`、`calendar_event`、`customer_confirmation`、`evaluation_criteria`、`process_note`、`validation_plan`、`business_case`、`quote`、`pricing_model`、`approval_record`、`order_checklist`、`contract_document`、`sow`、`risk_note`、`negotiation_plan`、`contact_record`、`internal_review`、`external_research`、`crm_url`、`crm_snapshot`、`pm_url`、`pm_snapshot`、`delivery_confirmation`、`human_confirmation`、`system_event`。

## 6. SalesGateCheck 最小 JSON

```json
{
  "id": "sgc_acme_d_g1",
  "opportunity_id": "opp_acme_001",
  "stage": "discover",
  "gate_id": "D-G1",
  "status": "missing",
  "evidence_ids": [],
  "information_gap_ids": ["gap_discover_champion"],
  "recommended_activity_ids": ["act_collect_champion_signal"],
  "owner_id": "user_sales_andy",
  "updated_at": "2026-05-26T10:15:00+08:00"
}
```

### 6.1 Gate 状态

| 状态 | 含义 |
|---|---|
| unknown | 未知。 |
| missing | 明确缺失。 |
| collecting | 正在补充。 |
| evidence_submitted | 已提交证据，等待确认。 |
| confirmed | 已确认达成。 |
| needs_supplement | 证据不足。 |
| rejected | 证据不支持。 |
| waived | 人工豁免。 |

### 6.2 SalesGateCheck 语义红线

- `gate_id` 必须存在于 `docs/sales-six-step-gates.json`。
- `stage` 必须与 Gate 所属阶段一致。
- `confirmed` 或 `evidence_submitted` 必须引用 Evidence。
- `missing`、`collecting`、`needs_supplement`、`rejected` 必须引用 Information Gap。
- 销售阶段推进必须基于 D-G1 至 N-G4 的 Gate 质量，而不是 CRM 阶段文本。

## 7. External Fact Mirror 最小 JSON

External Fact Mirror 是外部系统事实的本地快照。CRM Mirror 和 PM Record Mirror 都属于这个模式。它不是 Agent 判断，也不是要替代外部系统。

```json
{
  "id": "mirror_crm_opp_acme_001",
  "connection_id": "conn_crm_hubspot_demo",
  "system_type": "crm",
  "provider": "hubspot",
  "object_type": "opportunity",
  "external_id": "deal_10001",
  "external_url": "https://crm.example.test/deals/10001",
  "mirrored_at": "2026-05-26T10:05:00+08:00",
  "source_updated_at": "2026-05-26T09:58:00+08:00",
  "field_snapshot": {
    "stage": "discovery",
    "next_step": "Meet IT director"
  },
  "field_mapping_version": "crm-hubspot-v0.1",
  "freshness": "fresh"
}
```

### 7.1 PM Record Mirror 示例

```json
{
  "id": "mirror_pm_issue_acme_12",
  "connection_id": "conn_pm_jira_demo",
  "system_type": "project_management",
  "provider": "jira",
  "object_type": "issue",
  "external_id": "ACME-12",
  "external_url": "https://jira.example.test/browse/ACME-12",
  "mirrored_at": "2026-05-26T10:10:00+08:00",
  "source_updated_at": "2026-05-26T09:50:00+08:00",
  "field_snapshot": {
    "status": "Done",
    "assignee": "delivery_lead",
    "due_date": "2026-05-30",
    "summary": "Prepare kickoff agenda"
  },
  "field_mapping_version": "pm-jira-v0.1",
  "freshness": "fresh"
}
```

### 7.2 外部事实层红线

- CRM 阶段和项目管理任务状态只能作为输入事实。
- Agent 判断必须回到 Evidence、Information Gap、TaskGraph、SalesGateCheck 或验收规则。
- 外部记录变更后先更新 Mirror，再重新计算 Agent 判断，不静默覆盖关键字段。

## 8. External Writeback Intent 最小 JSON

Agent 对外部系统的写入先生成意图，再由策略判断自动执行、确认、拒绝或人工处理。CRM Writeback Intent 和 PM Writeback Intent 都属于这个模式。

```json
{
  "id": "wbi_crm_note_acme_001",
  "connection_id": "conn_crm_hubspot_demo",
  "system_type": "crm",
  "provider": "hubspot",
  "target": {
    "object_type": "opportunity",
    "external_id": "deal_10001"
  },
  "operation": "create_note",
  "payload": {
    "title": "AI Gate Check Summary",
    "body": "D-G1 is missing champion evidence. D-G7 has a confirmed next meeting."
  },
  "source": {
    "agent_id": "pm_agent_sales_001",
    "task_id": "task_discover_champion",
    "evidence_ids": ["ev_next_meeting_calendar"],
    "reason": "Keep CRM activity notes aligned with Agent gate check."
  },
  "risk_level": "low",
  "idempotency_key": "crm-note-opp-acme-001-d-g1-20260526",
  "policy_decision": "auto_execute",
  "created_at": "2026-05-26T10:20:00+08:00"
}
```

### 8.1 PM Writeback Intent 示例

```json
{
  "id": "wbi_pm_comment_acme_12",
  "connection_id": "conn_pm_jira_demo",
  "system_type": "project_management",
  "provider": "jira",
  "target": {
    "object_type": "issue",
    "external_id": "ACME-12"
  },
  "operation": "create_comment",
  "payload": {
    "body": "Agent sees external status Done, but acceptance evidence is missing. Please attach customer confirmation or kickoff agenda link."
  },
  "source": {
    "agent_id": "pm_agent_delivery_001",
    "evidence_ids": ["ev_pm_snapshot_kickoff"],
    "reason": "External issue status and Agent acceptance evidence are inconsistent."
  },
  "risk_level": "low",
  "idempotency_key": "pm-comment-acme-12-evidence-gap-20260526",
  "policy_decision": "auto_execute",
  "created_at": "2026-05-26T10:25:00+08:00"
}
```

### 8.2 Writeback 红线

- `risk_level=high` 不得 `auto_execute`。
- `update_status` 不得 `auto_execute`。
- `update_field` 默认需要确认。
- payload 涉及 `amount`、`stage`、`expected_close_date`、`close_date`、`status`、`assignee`、`due_date`、`priority`、`owner`、`budget` 等字段时必须确认。
- `create_note`、`create_task`、`create_comment`、`add_link` 可在低风险且可审计时自动执行。
- 同一 `idempotency_key` 重试不得造成重复任务、评论、纪要或链接。

## 9. Agent Output 最小 JSON

所有 Agent Output 使用统一外层：

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | 输出 ID。 |
| kind | 是 | `pm_agent_plan` / `pm_agent_verify` / `human_twin_collect_prompt` / `human_twin_collect_result` / `management_command_plan` / `scheduled_command_tick` / `condition_trigger_match` / `replan`。 |
| agent_id | 是 | 输出 Agent。 |
| run_id | 否 | 所属 Run。 |
| task_id | 否 | 关联 Task。 |
| created_at | 是 | 输出时间。 |
| payload | 是 | kind 对应的结构。 |

### 9.1 PM Agent Plan

```json
{
  "id": "out_pm_plan_sales_acme_001",
  "kind": "pm_agent_plan",
  "agent_id": "pm_agent_sales_001",
  "run_id": "run_sales_acme_001",
  "created_at": "2026-05-26T10:30:00+08:00",
  "payload": {
    "task_graph": "tg_sales_acme_001",
    "information_gaps": ["gap_discover_champion"],
    "rationale": "Discover cannot be considered complete until D-G1 champion evidence is collected."
  }
}
```

### 9.2 PM Agent Verify

```json
{
  "id": "out_pm_verify_next_action_001",
  "kind": "pm_agent_verify",
  "agent_id": "pm_agent_sales_001",
  "run_id": "run_sales_acme_001",
  "task_id": "task_discover_next_action",
  "created_at": "2026-05-26T10:35:00+08:00",
  "payload": {
    "decision": "accepted",
    "task_id": "task_discover_next_action",
    "evidence_ids": ["ev_next_meeting_calendar"],
    "reason": "The calendar event confirms time, participants, and next meeting objective."
  }
}
```

允许的 `decision`：

| 值 | 含义 |
|---|---|
| accepted | 证据足够，任务通过；必须引用 Evidence。 |
| needs_supplement | 证据不足。 |
| blocked | 外部条件不满足。 |
| rejected | 明确不达标。 |
| escalated | 高风险、低置信度或越权，需要人确认。 |
| waived | 人工豁免。 |

### 9.3 Human Twin Collect Prompt

```json
{
  "id": "out_twin_prompt_champion_001",
  "kind": "human_twin_collect_prompt",
  "agent_id": "twin_sales_andy",
  "run_id": "run_sales_acme_001",
  "task_id": "task_discover_champion",
  "created_at": "2026-05-26T10:40:00+08:00",
  "payload": {
    "gap_id": "gap_discover_champion",
    "recipient_id": "user_sales_andy",
    "message": "Please identify who showed the strongest champion signal in the meeting and provide department, behavior signal, and original quote.",
    "required_schema": {
      "fields": [
        "person_name",
        "department",
        "behavior_signal",
        "influence_hypothesis",
        "original_quote"
      ]
    },
    "deadline": "2026-05-27T18:00:00+08:00"
  }
}
```

### 9.4 Human Twin Collect Result

```json
{
  "id": "out_twin_result_champion_001",
  "kind": "human_twin_collect_result",
  "agent_id": "twin_sales_andy",
  "run_id": "run_sales_acme_001",
  "task_id": "task_discover_champion",
  "created_at": "2026-05-26T11:00:00+08:00",
  "payload": {
    "gap_id": "gap_discover_champion",
    "collector_actor_id": "twin_sales_andy",
    "evidence": {
      "candidate_summary": "Customer IT director asked repeated integration questions and agreed to invite operations stakeholders next time."
    },
    "completeness": 0.8
  }
}
```

### 9.5 Management Command Outputs

老板通过管理指挥中心下发任务后，Agent 输出必须能记录指令、委派链和触发原因：

```json
{
  "id": "out_management_command_plan_001",
  "kind": "management_command_plan",
  "agent_id": "pm_agent_ops_001",
  "run_id": "run_sales_acme_001",
  "task_id": "task_discover_champion",
  "created_at": "2026-05-31T18:24:30+08:00",
  "payload": {
    "command_id": "cmd_manual_competitor_response",
    "task_graph_id": "tg_sales_acme_001",
    "delegation_chain": [
      "executive:user_exec_lina",
      "pm_agent:pm_agent_ops_001",
      "sales_agent:sales_agent_001",
      "worker_agent:worker_agent_docs_001",
      "human:user_sales_andy"
    ],
    "expected_outcome": "补齐客户事实、竞品应对材料草稿和人工确认。"
  }
}
```

`scheduled_command_tick` 必须记录 `command_id`、`scheduled_for`、`next_run_at` 和 `reason`。`condition_trigger_match` 必须记录 `command_id`、`signal`、`observed_value`、`threshold` 和 `reason`。

## 10. Management Command Center 最小 JSON

```json
{
  "id": "mcc_exec_ops_001",
  "version": "v0.1",
  "active_user_id": "user_exec_lina",
  "roles": [
    {
      "id": "role_exec_lina",
      "name": "林总 / 经营负责人",
      "user_id": "user_exec_lina",
      "role_type": "executive",
      "permissions": [
        "view_management_dashboard",
        "create_command",
        "schedule_command",
        "configure_trigger",
        "delegate_to_agent",
        "view_all_projects"
      ],
      "default_view": "management_command_center"
    }
  ],
  "commands": [
    {
      "id": "cmd_weekly_pipeline_review",
      "title": "每周一自动巡检销售与交付风险",
      "status": "scheduled",
      "trigger_type": "scheduled",
      "created_by_role_id": "role_exec_lina",
      "target_agent_id": "pm_agent_ops_001",
      "objective": "让运营 PM Agent 每周汇总销售 Gate 缺口、交付阻塞和需要升级的事项。",
      "task_graph_id": "tg_sales_acme_001",
      "project_id": "proj_revenue_delivery_ops",
      "generated_task_ids": ["mtask_weekly_sales_gate_check"],
      "schedule": {
        "kind": "weekly",
        "timezone": "Asia/Shanghai",
        "next_run_at": "2026-06-01T09:00:00+08:00"
      },
      "delegation_chain": [
        {
          "order": 1,
          "actor_type": "executive",
          "actor_id": "user_exec_lina",
          "responsibility": "定义经营目标、节奏和升级阈值。"
        },
        {
          "order": 2,
          "actor_type": "pm_agent",
          "actor_id": "pm_agent_ops_001",
          "responsibility": "拆解成销售、交付、信息补采和外部同步任务。"
        },
        {
          "order": 3,
          "actor_type": "sales_agent",
          "actor_id": "sales_agent_001",
          "responsibility": "检查商机 Gate、CRM 事实和下一步销售动作。"
        },
        {
          "order": 4,
          "actor_type": "human_twin_agent",
          "actor_id": "twin_sales_andy",
          "responsibility": "向销售同事追问缺失证据并收集反馈。"
        }
      ],
      "created_at": "2026-05-31T18:20:00+08:00"
    }
  ],
  "execution_tasks": [
    {
      "id": "mtask_weekly_sales_gate_check",
      "command_id": "cmd_weekly_pipeline_review",
      "project_id": "proj_revenue_delivery_ops",
      "task_graph_id": "tg_sales_acme_001",
      "title": "销售 Agent 巡检 ACME Gate 缺口",
      "status": "needs_info",
      "owner_actor_type": "sales_agent",
      "owner_actor_id": "sales_agent_001",
      "source_agent_id": "pm_agent_ops_001",
      "acceptance_criteria": "输出缺口、负责人、下一步动作和需要人工补采的问题。",
      "progress_percent": 55,
      "latest_update_id": "mupd_sales_gate_progress",
      "blocker": "D-G1 Champion 证据仍需销售同事确认。",
      "created_at": "2026-05-31T18:25:00+08:00"
    }
  ],
  "execution_updates": [
    {
      "id": "mupd_sales_gate_progress",
      "task_id": "mtask_weekly_sales_gate_check",
      "actor_type": "sales_agent",
      "actor_id": "sales_agent_001",
      "update_type": "progress",
      "status": "needs_info",
      "message": "已完成 D-G7 下一步动作核验，D-G1 Champion 证据需要 Human Twin 追问。",
      "progress_percent": 55,
      "created_at": "2026-05-31T18:43:00+08:00"
    }
  ],
  "projects": [
    {
      "id": "proj_revenue_delivery_ops",
      "name": "收入与交付经营节奏",
      "domain": "operations",
      "owner_role_id": "role_exec_lina",
      "task_graph_id": "tg_sales_acme_001",
      "status": "in_progress",
      "health": "yellow",
      "command_ids": ["cmd_weekly_pipeline_review"]
    }
  ],
  "swimlanes": [
    {
      "id": "lane_needs_info",
      "title": "缺信息",
      "status": "needs_info",
      "task_ids": ["mtask_weekly_sales_gate_check"]
    }
  ]
}
```

### 10.1 Management Command 红线

- 管理指挥中心必须至少有一个具备 `create_command` 权限的 `executive` 角色。
- 每条指令必须能表达老板/管理层 -> PM Agent -> 专门 Agent -> 下属、人类分身或 Worker Agent 的委派链。
- `trigger_type=scheduled` 必须有 `schedule`；`trigger_type=condition` 必须有 `condition`。
- 每条管理指令必须有 `generated_task_ids`，这些任务来自 PM Agent 对老板意图的自动拆解。
- `execution_tasks` 是泳道承载的执行工作项，必须回指 `command_id`、`project_id`、责任人、来源 Agent、验收标准和进度。
- `execution_updates` 是人员或 Agent 的进展/阻塞/结果回流；进行中任务必须能看到进度，完成任务必须有结果摘要。
- 项目泳道必须引用 `execution_tasks` 中存在的任务，不允许成为孤立看板或只展示静态 TaskGraph。
- 管理指令必须回到 TaskGraph、Agent Output、org_task 桥接和审计路径。

### 10.2 网页端入口

统一 Ops Console 的“管理指挥”视图消费 `managementCommandCenter`，并通过：

- `/api/management/command-center` 展示登录角色、权限、指令、项目组合、自动拆解任务、执行进展/结果和泳道。
- `/api/management/dispatch-preview` 将老板输入的经营意图预览成指令、委派链、TaskGraph 任务和 legacy 桥接路由。
- `/api/state` 的 `views.operating_console.role_action_queue` 按当前登录角色聚合 Management Execution Task、Information Gap、SalesGateCheck、External Fact Mirror 和 External Writeback Intent，给出下一步、目标视图和优先级，避免用户只看到指标后自行猜测操作路径。

### 10.3 适用范围

该契约不是销售专用。`projects.domain` 可为 `sales`、`delivery`、`operations`、`governance` 或 `custom`，所有组织管理事项都按 Project / Task / Agent delegation 模式进入系统。

### 9.6 Replan

```json
{
  "id": "out_replan_pm_gap_001",
  "kind": "replan",
  "agent_id": "pm_agent_delivery_001",
  "run_id": "run_delivery_acme_001",
  "created_at": "2026-05-26T11:10:00+08:00",
  "payload": {
    "reason": "External PM issue is Done but acceptance evidence is missing.",
    "trigger_evidence_ids": ["ev_pm_snapshot_kickoff"],
    "affected_task_ids": ["task_delivery_acceptance_check"],
    "new_task_graph": "tg_delivery_acme_002"
  }
}
```

## 11. P1 Demo 数据

P1 内置样例数据：

| 数据 | 内容 |
|---|---|
| TaskGraph | `fixtures/p1-demo/task-graph.sales-discover.json`。 |
| Information Gap | D-G1 Champion 缺口，状态为 `collecting`。 |
| Evidence | CRM 日历、CRM 快照、PM 快照。 |
| Sales Gates | D-G1 `missing`，D-G7 `confirmed`；运行 Gate 引擎后 Discover 阶段会生成 7 个 Gate 检查。 |
| External Mirrors | HubSpot opportunity 镜像、Jira issue 镜像。 |
| Writeback Intents | CRM low-risk Note、PM low-risk Comment。 |
| Management Command Center | 老板登录视角、即时下发、定时任务、条件触发、项目组合和泳道。 |
| Agent Outputs | PM plan、PM verify、Human Twin prompt/result、management command plan、scheduled command tick、condition trigger match、replan。 |
| Runtime Bridge | TaskGraph 可转 legacy workflow plan，Gap 可转 org_task，Evidence 可转 legacy fact write。 |

## 12. 最小测试

| 测试 | 断言 |
|---|---|
| TaskGraph schema | 缺 `id` / `run_id` / `status` / `tasks` 时拒绝。 |
| TaskGraph dependency | 不存在依赖或依赖环必须失败。 |
| Task evidence | `accepted` Task 无 Evidence 必须失败。 |
| Information Gap schema | 缺 `question` / `reason` / `required_schema` 时拒绝。 |
| Evidence schema | 缺 `content_ref`、时间格式错误、quality_score 越界时失败。 |
| SalesGateCheck schema | Gate stage 不匹配必须失败。 |
| SalesGateCheck evidence | `confirmed` 或 `evidence_submitted` 无 Evidence 必须失败。 |
| SalesGateCheck gap | `missing`、`collecting`、`needs_supplement`、`rejected` 无 Gap 必须失败。 |
| External Fact Mirror schema | 外部记录必须有 `system_type`、`provider`、`object_type`、`external_id`、`external_url`、`mirrored_at`、`field_snapshot`。 |
| External Writeback Intent schema | 写 CRM 或项目管理系统必须有 source、risk_level、idempotency_key 和 policy_decision。 |
| Writeback policy | 高风险、字段更新、状态更新必须确认；低风险 Note/Comment/Link 可自动。 |
| Agent Output kind | kind 必须来自允许枚举，并满足对应 payload 必填字段。 |
| Management Command Center | 必须有 executive 权限、定时任务、条件触发、委派链和泳道任务。 |
| Management Dispatch Preview | 老板输入必须能预览成 PM Agent 任务、专门 Agent 委派、下属/Worker 执行和 bridge routes。 |
| PM Agent Verify | `accepted` 必须引用 Evidence。 |
| Human Twin Collect Result | `completeness` 必须是 0 到 1 的数字。 |
| Replan | 必须给出 reason、trigger_evidence_ids、affected_task_ids、new_task_graph。 |

## 13. 后续文件

后续变更必须同步以下资产：

| 文件 | 目的 |
|---|---|
| `src/contracts/schema.mjs` | 契约结构权威。 |
| `src/contracts/constants.mjs` | 状态、类型、kind、stage、risk、policy 枚举权威。 |
| `src/contracts/validator.mjs` | 跨字段语义校验。 |
| `docs/sales-six-step-gates.json` | 销售 Gate、Evidence 类型和推荐动作权威。 |
| `fixtures/p1-demo/` | P1 演示和测试数据。 |
| `tests/contracts.test.mjs` | 契约、桥接、故事线和红线测试。 |
| `schemas/*.json` | 导出的 JSON Schema。 |
