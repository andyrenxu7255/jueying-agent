# DEV-31 TaskGraph 与信息缺口最小契约

> 状态：研发前最小契约草案
> 读者：架构、后端、前端、Agent 编排、测试
> 依赖：DEV-23、DEV-26、DEV-29、DEV-30、DEV-32、DEV-33
> 核心目的：在进入代码前，先锁定 TaskGraph、Information Gap、Evidence、SalesGateCheck、External Fact Mirror、Writeback Intent 和 Agent 输出的最小可校验结构。

## 1. 结论

P1 不应先追求完整替代 CRM、完整替代项目管理系统或复杂图算法，而要先让以下六个契约成立：

| 契约 | 为什么必须先定 |
|---|---|
| TaskGraph | 所有运营推进的事实中心。 |
| Information Gap | Agent 传感器不足的产品化表达。 |
| Evidence | Agent 判断、验收、复盘的证据基础。 |
| SalesGateCheck | 销售六步法阶段质量的控制器。 |
| External Fact Mirror / Writeback Intent | 保持 CRM、项目管理系统等外部事实层与 Agent 事实层一致。 |
| Agent Output | PM Agent、Human Twin Agent、Verifier 输出必须可解析、可校验、可执行。 |

如果这些契约不先稳定，后续 UI、Agent、CRM、项目管理系统、交付、旧 workflow 接入都会持续补丁化。

## 2. 命名与 ID

| 规则 | 要求 |
|---|---|
| ID | 字符串，建议使用带前缀的稳定 ID，例如 `task_001`、`gap_001`。 |
| 时间 | ISO 8601 字符串。 |
| 状态 | 使用枚举，不使用自由文本。 |
| 金额 | 不使用浮点，使用整数分或字符串金额。 |
| 业务引用 | 统一放入 `business_refs`，避免销售/交付字段污染 Task。 |
| 可选字段 | 无值则省略，避免用 `null` 表达未知。 |

## 3. TaskGraph 最小 JSON

```json
{
  "id": "graph_demo_001",
  "run_id": "run_demo_001",
  "version": 1,
  "status": "draft",
  "autonomy_level": "L1",
  "generated_by": "agent_pm_sales_001",
  "tasks": [
    {
      "id": "task_discover_gate_check",
      "title": "检查 Discover 阶段 Gate",
      "status": "ready",
      "assignee_type": "pm_agent",
      "assignee_id": "agent_pm_sales_001",
      "required_evidence": ["meeting_summary", "customer_quote"],
      "acceptance_criteria": [
        "D-G1 至 D-G7 均为 confirmed 或 waived",
        "每个 confirmed gate 至少引用一个 evidence_id"
      ],
      "business_refs": {
        "opportunity_id": "opp_demo_001"
      }
    }
  ],
  "dependencies": [],
  "information_gaps": [],
  "evidence": []
}
```

### 3.1 TaskGraph 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | 图谱 ID。 |
| run_id | 是 | 所属 Run。 |
| version | 是 | 整数版本，重规划后递增。 |
| status | 是 | draft / awaiting_confirmation / running / replanning / completed / archived。 |
| autonomy_level | 是 | L0 / L1 / L2 / L3 / L4。 |
| generated_by | 是 | Agent 或人。 |
| tasks | 是 | Task 列表。 |
| dependencies | 是 | 依赖列表，可为空。 |
| information_gaps | 是 | 缺口列表，可为空。 |
| evidence | 是 | 证据列表，可为空。 |

### 3.2 Task 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| id | 是 | Task ID。 |
| title | 是 | 可读标题。 |
| status | 是 | draft / ready / assigned / in_progress / needs_info / submitted / verifying / completed / blocked / failed / escalated。 |
| assignee_type | 是 | pm_agent / worker_agent / human_twin / human / external_system。 |
| assignee_id | 是 | 执行主体 ID。 |
| required_evidence | 否 | 需要的证据类型。 |
| acceptance_criteria | 否 | 验收规则。 |
| business_refs | 否 | 关联客户、商机、合同、交付范围等。 |
| due_at | 否 | 截止时间。 |
| risk_level | 否 | low / medium / high / critical。 |

## 4. Information Gap 最小 JSON

```json
{
  "id": "gap_discover_champion_001",
  "task_id": "task_discover_gate_check",
  "run_id": "run_demo_001",
  "gap_type": "sales_gate",
  "gate_id": "D-G1",
  "question": "这次互动里，谁提问或点评最多？谁听得最认真？谁更像未来会推动这件事的人？",
  "reason": "Discover 阶段必须识别 champion 或目标 champion，否则机会质量不足。",
  "required_schema": {
    "candidate_name": "string",
    "department": "string",
    "observed_behavior": "string",
    "evidence_summary": "string"
  },
  "suggested_collector": {
    "assignee_type": "human_twin",
    "assignee_id": "twin_sales_andy"
  },
  "priority": "high",
  "status": "open"
}
```

### 4.1 Gap 状态

| 状态 | 含义 |
|---|---|
| open | 已识别，未派发。 |
| assigned | 已分配采集人。 |
| collecting | 正在采集。 |
| submitted | 已收到反馈，等待验收。 |
| closed | 缺口关闭。 |
| waived | 人工豁免。 |

### 4.2 Gap 关闭规则

Information Gap 关闭必须满足至少一种条件：

- 收到符合 `required_schema` 的 Evidence。
- Agent 记录替代证据和替代理由。
- 负责人豁免并记录风险。
- 关联 Task 被取消。

## 5. Evidence 最小 JSON

```json
{
  "id": "ev_meeting_001",
  "source_type": "human",
  "source_actor_id": "user_sales_001",
  "capture_channel": "wecom",
  "task_id": "task_discover_gate_check",
  "gap_id": "gap_discover_champion_001",
  "evidence_type": "meeting_summary",
  "summary": "销售反馈客户信息中心张经理在会议中多次追问数据治理价值，并主动提出下周拉业务部门参与。",
  "quality_score": 0.82,
  "sensitivity": "internal",
  "business_refs": {
    "opportunity_id": "opp_demo_001",
    "account_id": "acct_demo_001",
    "crm_mirror_id": "mirror_opp_001",
    "crm_external_id": "crm_opp_abc123"
  },
  "created_at": "2026-05-26T09:00:00+08:00"
}
```

### 5.1 Evidence 类型

| 类型 | 说明 |
|---|---|
| meeting_summary | 会议纪要。 |
| meeting_minutes | 会议纪要或正式会议记录。 |
| customer_quote | 客户原话。 |
| email | 邮件确认。 |
| chat_screenshot | 微信/企微截图。 |
| whiteboard_photo | 现场板书照片。 |
| sales_note | 销售补充记录。 |
| stakeholder_map | 客户角色、组织分工、决策链图谱。 |
| champion_confirmation | Champion 对收益、时间、预算、验证标准、报告的确认。 |
| eb_confirmation | EB 对痛点、优先级、预算、流程、评估标准、方案的确认。 |
| budget_note | 预算、预算来源、预算区间或付款预期记录。 |
| calendar_event | 日程、会议邀请或约定时间。 |
| customer_confirmation | 客户对下一步、责任、会议或结论的确认。 |
| evaluation_criteria | 供应商评估标准、评分规则或采购标准。 |
| process_note | 业务流程、IT 流程、验证流程或采购流程记录。 |
| validation_plan | 验证计划。 |
| business_case | 商业价值报告。 |
| quote | 报价。 |
| pricing_model | 定价模型、折扣、付款条件或价格测算。 |
| approval_record | 内部审批、授权或例外批准记录。 |
| order_checklist | 订单检查。 |
| contract_document | 合同正文、合同附件或订单文件。 |
| sow | SOW。 |
| risk_note | 风险说明、风险评估或缓解动作。 |
| negotiation_plan | 谈判计划、底线、交换条件和推进路径。 |
| contact_record | 采购、法务、客户联系人或内部角色联系记录。 |
| internal_review | 内部评审、销售复盘或谈判评审记录。 |
| external_research | 外部调研、竞品公开资料、采购历史或伙伴信息。 |
| crm_url | CRM 机会链接。 |
| crm_snapshot | CRM 状态快照。 |
| pm_url | 外部项目管理系统项目或任务链接。 |
| pm_snapshot | 外部项目管理系统状态快照。 |
| delivery_confirmation | 交付确认。 |
| human_confirmation | 人工确认。 |
| system_event | 系统事件，例如发送、签收、审批、付款或同步状态变化。 |

## 6. SalesGateCheck 最小 JSON

```json
{
  "id": "sgc_opp_demo_001_d_g1",
  "opportunity_id": "opp_demo_001",
  "stage": "discover",
  "gate_id": "D-G1",
  "status": "missing",
  "evidence_ids": [],
  "information_gap_ids": ["gap_discover_champion_001"],
  "recommended_activity_ids": ["act_find_target_champion_001"],
  "owner_id": "user_sales_001",
  "updated_at": "2026-05-26T09:00:00+08:00"
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

### 6.2 SalesActivityRecommendation

```json
{
  "id": "act_find_target_champion_001",
  "gate_id": "D-G1",
  "title": "补充目标 Champion 线索",
  "recommended_for": "user_sales_001",
  "activity_type": "ask_sales_after_meeting",
  "prompt": "请回忆本次互动里谁提问、点评或认真听得最多，并补充他的部门、角色和可能动机。",
  "expected_evidence_types": ["sales_note", "meeting_summary"],
  "priority": "high"
}
```

## 7. PM Agent Plan 输出契约

```json
{
  "result_type": "taskgraph_plan",
  "confidence": 0.76,
  "taskgraph": {
    "id": "graph_demo_001",
    "run_id": "run_demo_001",
    "version": 1,
    "status": "draft",
    "autonomy_level": "L1",
    "generated_by": "agent_pm_sales_001",
    "tasks": [],
    "dependencies": [],
    "information_gaps": [],
    "evidence": []
  },
  "requires_human_confirmation": true,
  "uncertainties": [
    "尚未确认 EB",
    "Champion 只是候选人，未测试 EB access"
  ]
}
```

## 7A. External Fact Mirror 最小 JSON

External Fact Mirror 是外部系统事实的本地快照。CRM Mirror 和 PM Record Mirror 都属于这个模式。它不是 Agent 判断，也不是要替代外部系统。

```json
{
  "id": "mirror_opp_001",
  "connection_id": "crm_conn_001",
  "system_type": "crm",
  "object_type": "opportunity",
  "external_id": "crm_opp_abc123",
  "external_url": "https://crm.example.com/opportunity/crm_opp_abc123",
  "source_updated_at": "2026-05-26T09:30:00+08:00",
  "mirrored_at": "2026-05-26T09:31:00+08:00",
  "version_token": "etag_7788",
  "normalized_refs": {
    "opportunity_id": "opp_demo_001",
    "account_id": "acct_demo_001"
  },
  "field_snapshot": {
    "name": "ACME 数据智能项目",
    "stage": "Discovery",
    "amount": "500000",
    "close_date": "2026-06-30",
    "next_step": "待确认下一次会议"
  }
}
```

### 7A.1 PM Record Mirror 示例

```json
{
  "id": "pm_mirror_issue_001",
  "connection_id": "pm_conn_001",
  "system_type": "project_management",
  "provider": "jira",
  "object_type": "issue",
  "external_id": "ACME-128",
  "external_url": "https://pm.example.com/browse/ACME-128",
  "source_updated_at": "2026-05-26T10:20:00+08:00",
  "mirrored_at": "2026-05-26T10:21:00+08:00",
  "version_token": "etag_9911",
  "normalized_refs": {
    "project_id": "delivery_project_001",
    "task_id": "task_env_access_check"
  },
  "field_snapshot": {
    "title": "确认客户测试环境 VPN 权限",
    "status": "In Progress",
    "assignee": "li_si",
    "priority": "High",
    "due_date": "2026-05-29"
  }
}
```

## 7B. External Writeback Intent 最小 JSON

Agent 对外部系统的写入先生成意图，再由策略判断自动执行、确认或拒绝。CRM Writeback Intent 和 PM Writeback Intent 都属于这个模式。

```json
{
  "id": "crm_wbi_001",
  "connection_id": "crm_conn_001",
  "system_type": "crm",
  "target": {
    "object_type": "opportunity",
    "external_id": "crm_opp_abc123"
  },
  "operation": "create_task",
  "payload": {
    "title": "补充 Discover Gate：确认目标 Champion",
    "due_at": "2026-05-27T18:00:00+08:00",
    "description": "请补充本次互动中谁提问或点评最多、所在部门、是否可能帮助约 EB。"
  },
  "source": {
    "agent_id": "agent_pm_sales_001",
    "task_id": "task_discover_gate_check",
    "gap_id": "gap_discover_champion_001",
    "gate_id": "D-G1",
    "evidence_ids": ["ev_meeting_001"]
  },
  "risk_level": "low",
  "requires_confirmation": false,
  "idempotency_key": "opp_demo_001:D-G1:create_task:2026-05-26"
}
```

### 7B.1 PM Writeback Intent 示例

```json
{
  "id": "pm_wbi_001",
  "connection_id": "pm_conn_001",
  "system_type": "project_management",
  "target": {
    "object_type": "issue",
    "external_id": "ACME-128"
  },
  "operation": "create_comment",
  "payload": {
    "body": "Agent 验收发现仍缺客户 VPN 测试账号截图。请补充账号申请单、VPN 登录成功截图和客户 IT 确认人。"
  },
  "source": {
    "agent_id": "agent_pm_delivery_001",
    "task_id": "task_env_access_check",
    "gap_id": "gap_vpn_access_evidence_001",
    "evidence_ids": ["ev_kickoff_minutes_001"]
  },
  "risk_level": "low",
  "requires_confirmation": false,
  "idempotency_key": "delivery_project_001:ACME-128:gap_vpn_access:create_comment:2026-05-26"
}
```

## 8. PM Agent Verify 输出契约

```json
{
  "result_type": "verification_result",
  "task_id": "task_discover_gate_check",
  "decision": "needs_supplement",
  "confidence": 0.64,
  "evidence_ids": ["ev_meeting_001"],
  "failed_criteria": ["D-G4 缺少 EB 判断", "D-G7 缺少明确下一步"],
  "new_information_gaps": ["gap_discover_eb_001", "gap_discover_next_step_001"],
  "new_tasks": ["task_collect_eb_hypothesis", "task_confirm_next_step"],
  "requires_human_confirmation": false
}
```

允许的 `decision`：

| 值 | 含义 |
|---|---|
| accepted | 证据足够，任务通过。 |
| needs_supplement | 证据不足。 |
| blocked | 外部条件不满足。 |
| failed | 明确不达标。 |
| escalated | 高风险、低置信度或越权，需要人确认。 |

## 9. Human Twin Collect 输出契约

```json
{
  "result_type": "human_twin_collect_result",
  "gap_id": "gap_discover_champion_001",
  "message_sent": "这次客户沟通里，谁提问或点评最多、听得最认真？请补充姓名/部门/表现，我用来判断是否有目标 Champion。",
  "raw_feedback": "信息中心张经理问了数据治理价值，还说下周可以拉业务一起聊。",
  "structured_evidence_id": "ev_meeting_001",
  "completeness": "needs_supplement",
  "follow_up_question": "张经理是否能帮忙约更高层或 EB？"
}
```

## 10. P1 Demo 数据

P1 至少内置：

| 数据 | 内容 |
|---|---|
| 组织 | TeamClaw Demo Co. |
| 人员 | 负责人、销售经理、销售、交付 PM、张三、李四。 |
| Human Twin | 销售分身、交付分身、张三分身、李四分身。 |
| 销售机会 | ACME 数据智能项目，当前 Discover。 |
| 销售 Gates | D-G1 missing、D-G5 evidence_submitted、D-G7 missing。 |
| 交付项目 | ACME 数据智能 PoC 交付，当前需求采集。 |
| 外部项目任务 | Jira/禅道/TAPD/飞书项目或自研系统中的 ACME-128 权限任务镜像。 |
| Routine | 每周办公室卫生检查。 |
| Evidence | 会议纪要、客户原话、现场照片、CRM 链接占位、项目管理任务链接占位。 |
| External Mirrors | CRM 机会镜像、项目管理任务镜像。 |

## 11. 最小测试

| 测试 | 断言 |
|---|---|
| TaskGraph 校验 | 缺 id/run_id/status/tasks 时拒绝启动。 |
| Information Gap 校验 | 缺 question/reason/required_schema 时拒绝派发。 |
| Evidence 校验 | completed gate 引用不存在 Evidence 时失败。 |
| SalesGateCheck 校验 | confirmed gate 无 evidence 或 waiver 时失败。 |
| External Fact Mirror 校验 | 外部记录必须有 system_type、object_type、external_id、mirrored_at 和来源连接。 |
| External Writeback Intent 校验 | 写 CRM 或项目管理系统必须有 source、risk_level、idempotency_key 和策略结果。 |
| Verify 契约 | Agent 输出只能使用允许的 decision。 |
| Human Twin 契约 | 默认权限不得直接替真人确认 Gate。 |
| Replan 契约 | 新增任务必须记录 replan_reason 和版本变化。 |

## 12. 后续文件

后续编码前建议继续补：

| 文件 | 目的 |
|---|---|
| JSON Schema 文件 | 把本文契约落成可执行 schema。 |
| Demo Fixture | 固化 P1 演示数据。 |
| Agent Contract Tests | 校验 PM Agent、Verifier、Human Twin 输出。 |
| UI Acceptance Checklist | 对照 DEV-28/30/31 验收界面。 |
