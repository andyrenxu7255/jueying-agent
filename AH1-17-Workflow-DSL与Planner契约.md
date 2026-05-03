# 文档 17：Workflow DSL 与 Planner 输出契约 v1.0

## 17.1 文档目的

本文件把《Workflow & State Machine V1》中的概念化描述进一步细化为可验证的 Workflow DSL 与 Planner 输出契约，目标是让：

- Planner 能稳定输出结构化 Workflow 计划。
- Workflow 引擎能校验计划是否合法。
- Executor 能只看阶段契约就执行。
- Checkpoint / Resume / Replay 能绑定稳定计划 hash。

## 17.2 设计原则

1. Planner 输出必须是结构化对象，不允许只有自然语言计划。
2. Workflow DSL 关注“阶段级治理”，不下沉到每一步提示词级别。
3. DSL 必须可 hash、可审计、可回放。
4. 计划输出必须显式写出阶段目标、输入、退出条件、失败转移与检查点策略。

本文件依赖：

- 《文档 16》中的 `policy_snapshot` 与 `scope` 规则
- 《文档 19》中的 checkpoint / replay 约束

## 17.3 顶层对象

### 17.3.1 WorkflowPlan 最小结构

```json
{
  "workflow_id": "wf_123",
  "workflow_type": "development",
  "plan_version": "v1",
  "owner_user_id": "u_123",
  "scope_type": "private",
  "risk_level": "medium",
  "policy_snapshot_hash": "sha256:...",
  "goal": {
    "user_goal": "为 Agent Harness 设计数据库方案",
    "success_definition": ["完成设计文档", "可生成 DDL"]
  },
  "budgets": {
    "time_budget_sec": 3600,
    "retrieval_budget": 30,
    "execution_budget": 120,
    "repair_budget": 3
  },
  "retrieval_profile": "balanced",
  "stage_chain": [],
  "report_policy": {},
  "archive_policy": {},
  "plan_hash": "sha256:..."
}
```

### 17.3.2 必填字段

- `workflow_type`
- `owner_user_id`
- `scope_type`
- `risk_level`
- `policy_snapshot_hash`
- `goal`
- `budgets`
- `stage_chain`
- `plan_hash`

补充说明：

- `workflow_id` 可以在持久化后分配，但不得参与 `plan_hash` 计算。
- `plan_hash` 的权威规则见 17.10。

## 17.4 Stage DSL 结构

### 17.4.1 Stage 最小结构

```json
{
  "stage_id": "st_10",
  "seq": 10,
  "stage_key": "implementation",
  "stage_type": "Implementation",
  "assigned_executor": "code-executor",
  "purpose": "完成最小实现并落盘 patch",
  "inputs": {
    "required_refs": ["spec:doc18", "ep:123"],
    "optional_refs": ["memory:456"]
  },
  "retrieval_plan": {
    "enabled": true,
    "intent_type": "dev-context",
    "profiles": ["structured", "fulltext", "vector"],
    "max_candidates": 40,
    "allow_graph": true,
    "max_graph_hops": 2
  },
  "acceptance": {
    "must_have": ["patch_created", "tests_executed"],
    "pass_rules": ["all_required_tests_pass"],
    "fail_rules": ["repo_inaccessible", "patch_apply_failed"]
  },
  "timeouts": {
    "soft_timeout_sec": 900,
    "hard_timeout_sec": 1800
  },
  "retry_policy": {
    "max_retries": 2,
    "max_repairs": 3,
    "retryable_errors": ["EXECUTOR_TOOL_CHAIN_FAILED", "EXECUTOR_TEST_FAILED"]
  },
  "checkpoint_policy": {
    "on_enter": false,
    "on_progress": true,
    "on_exit": true
  },
  "on_success": "next_stage",
  "on_failure": "repair_or_fail",
  "on_blocked": "blocked",
  "on_waiting_user": "waiting_user"
}
```

## 17.5 Planner 输入契约

Planner 至少应读取以下输入对象：

```json
{
  "request_text": "...",
  "user_id": "u_123",
  "channel_type": "feishu",
  "policy_snapshot_hash": "sha256:...",
  "visible_scopes": ["private:u_123", "public:workflow", "public:skill"],
  "task_type_hint": "development",
  "risk_level": "medium",
  "time_budget_sec": 3600,
  "retrieval_budget": 30,
  "execution_budget": 120,
  "fact_state_refs": [],
  "public_asset_refs": [],
  "user_asset_refs": []
}
```

## 17.6 Planner 输出规则

### 17.6.1 输出必须明确的内容

1. Workflow 类型。
2. 阶段链顺序。
3. 每个阶段使用的 executor。
4. 每个阶段是否需要检索。
5. 每个阶段的验收条件。
6. 超时、重试、修复上限。
7. 需要用户确认或审批的节点。

### 17.6.2 输出禁止缺失的内容

- 不允许缺失 `stage_type`。
- 不允许缺失 `assigned_executor`。
- 不允许缺失 `acceptance`。
- 不允许缺失 `timeouts`。
- 不允许缺失 `retry_policy`。

## 17.7 Workflow 类型模板

### 17.7.1 Development 模板

推荐阶段链：

1. `IntentClarification`
2. `PlanGeneration`
3. `EvidenceRetrieval`
4. `ArchitectureDesign` 或 `SpecGeneration`
5. `Implementation`
6. `Verification`
7. `Repair` 按需循环
8. `ResultReporting`
9. `Archive`
10. 条件满足时追加 `SkillExtraction` / `DreamSummarization`

### 17.7.2 Knowledge 模板

推荐阶段链：

1. `IntentClarification`
2. `EvidenceRetrieval`
3. `ObjectExtraction`
4. `DecisionMaking`
5. `ResultReporting`
6. `Archive`

### 17.7.3 Analysis 模板

推荐阶段链：

1. `IntentClarification`
2. `EvidenceRetrieval`
3. `ArchitectureDesign` 或 `DecisionMaking`
4. `Verification`
5. `ResultReporting`
6. `Archive`

## 17.8 阶段库与 Executor 映射

| Stage Type | 默认 Executor | 说明 |
|---|---|---|
| `IntentClarification` | `generic-executor` | 用于整理目标和缺口 |
| `PlanGeneration` | `generic-executor` | 生成阶段性计划 |
| `EvidenceRetrieval` | `retrieval-aware-executor` | 负责最小必要证据包 |
| `MemoryRetrieval` | `retrieval-aware-executor` | 仅在经验/偏好场景触发 |
| `ObjectExtraction` | `generic-executor` | 结构化抽取 |
| `ArchitectureDesign` | `generic-executor` | 架构、方案、设计文档 |
| `SpecGeneration` | `generic-executor` | 规格文档生成 |
| `DecisionMaking` | `generic-executor` | 综合分析与决策 |
| `Implementation` | `code-executor` | 代码修改、patch、测试 |
| `Verification` | `verification-executor` | 规则校验、测试结果判断 |
| `Repair` | `repair-executor` 或 `code-executor` | 局部修复与再次验证 |
| `Approval` | `generic-executor` + human hook | 明确等待审批 |
| `ResultReporting` | `generic-executor` | 汇报、总结、交付 |
| `SkillExtraction` | `generic-executor` | 提取可复用经验为 Skill |
| `DreamSummarization` | `generic-executor` | 经验总结与归纳 |
| `Archive` | `generic-executor` | 落归档与后处理 |

## 17.9 计划校验规则

Workflow 引擎在接收 Planner 输出后必须做静态校验。

### 17.9.1 顶层校验

1. `workflow_type` 合法。
2. `stage_chain` 非空。
3. `policy_snapshot_hash` 存在。
4. `plan_hash` 与规范化 JSON 一致。

### 17.9.2 阶段校验

1. `seq` 连续且唯一。
2. `stage_key` 在同一 Workflow 中唯一。
3. `assigned_executor` 与 `stage_type` 匹配。
4. `soft_timeout_sec < hard_timeout_sec`。
5. `max_repairs <= repair_budget`。
6. 若 `retrieval_plan.allow_graph = true`，则 `max_graph_hops <= 2`。

### 17.9.3 状态机校验

1. 不允许 Planner 直接规划非法状态跳转。
2. `waiting_user`、`blocked`、`paused`、`failed` 只能作为运行期结果，不应被规划为固定成功出口。

## 17.10 计划 hash 规则

`plan_hash` 必须基于规范化后的 WorkflowPlan 生成，不包含：

- `workflow_id`
- `created_at`
- 运行期 checkpoint
- 进度事件

原因：相同逻辑计划在不同实例中应得到可比对的 hash。

## 17.11 运行期可变字段

以下字段不属于 DSL 固化内容，可在运行期更新：

- `status`
- `started_at`
- `finished_at`
- `checkpoint_id`
- `evidence_pack_ref`
- `verification_refs`
- `fact_write_refs`

## 17.12 Development 示例

```json
{
  "workflow_type": "development",
  "goal": {
    "user_goal": "为 Agent Harness 补全文档 13-25",
    "success_definition": [
      "完成所有文档草案",
      "文档编号一致",
      "交叉引用可追踪"
    ]
  },
  "budgets": {
    "time_budget_sec": 7200,
    "retrieval_budget": 20,
    "execution_budget": 80,
    "repair_budget": 2
  },
  "stage_chain": [
    {
      "stage_id": "st_10",
      "seq": 10,
      "stage_type": "PlanGeneration",
      "assigned_executor": "generic-executor"
    },
    {
      "stage_id": "st_20",
      "seq": 20,
      "stage_type": "EvidenceRetrieval",
      "assigned_executor": "retrieval-aware-executor"
    },
    {
      "stage_id": "st_30",
      "seq": 30,
      "stage_type": "Implementation",
      "assigned_executor": "code-executor"
    },
    {
      "stage_id": "st_40",
      "seq": 40,
      "stage_type": "Verification",
      "assigned_executor": "verification-executor"
    },
    {
      "stage_id": "st_50",
      "seq": 50,
      "stage_type": "ResultReporting",
      "assigned_executor": "generic-executor"
    },
    {
      "stage_id": "st_60",
      "seq": 60,
      "stage_type": "Archive",
      "assigned_executor": "generic-executor"
    }
  ]
}
```

## 17.13 Knowledge 完整示例

```json
{
  "workflow_type": "knowledge",
  "goal": {
    "user_goal": "查询项目 Alpha 的当前状态和风险",
    "success_definition": [
      "返回项目当前状态",
      "列出已识别风险",
      "提供相关证据链接"
    ]
  },
  "budgets": {
    "time_budget_sec": 300,
    "retrieval_budget": 15,
    "execution_budget": 20,
    "repair_budget": 0
  },
  "retrieval_profile": "precision-first",
  "stage_chain": [
    {
      "seq": 10,
      "stage_key": "intent_clarification",
      "stage_type": "IntentClarification",
      "assigned_executor": "generic-executor",
      "purpose": "确认查询范围和目标",
      "inputs": {
        "required_refs": [],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["intent_confirmed"],
        "pass_rules": ["user_goal_clear"],
        "fail_rules": ["ambiguous_request"]
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "waiting_user"
    },
    {
      "seq": 20,
      "stage_key": "evidence_retrieval",
      "stage_type": "EvidenceRetrieval",
      "assigned_executor": "retrieval-aware-executor",
      "purpose": "检索项目状态和风险相关证据",
      "inputs": {
        "required_refs": ["intent:st_10"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": true,
        "intent_type": "object-status",
        "profiles": ["structured", "fulltext"],
        "max_candidates": 20,
        "allow_graph": true,
        "max_graph_hops": 2
      },
      "acceptance": {
        "must_have": ["evidence_pack_created"],
        "pass_rules": ["relevant_evidence_found"],
        "fail_rules": ["no_evidence_found"]
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 2,
        "max_repairs": 0,
        "retryable_errors": ["RETRIEVAL_TIMEOUT"]
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": true,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "failed"
    },
    {
      "seq": 30,
      "stage_key": "object_extraction",
      "stage_type": "ObjectExtraction",
      "assigned_executor": "generic-executor",
      "purpose": "从证据中抽取项目状态和风险对象",
      "inputs": {
        "required_refs": ["evidence_pack:st_20"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["objects_extracted"],
        "pass_rules": ["status_extracted", "risks_identified"],
        "fail_rules": ["extraction_failed"]
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "failed"
    },
    {
      "seq": 40,
      "stage_key": "decision_making",
      "stage_type": "DecisionMaking",
      "assigned_executor": "generic-executor",
      "purpose": "综合分析并形成结论",
      "inputs": {
        "required_refs": ["objects:st_30"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["conclusion_formed"],
        "pass_rules": ["answer_complete"],
        "fail_rules": ["insufficient_information"]
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "waiting_user"
    },
    {
      "seq": 50,
      "stage_key": "result_reporting",
      "stage_type": "ResultReporting",
      "assigned_executor": "generic-executor",
      "purpose": "向用户返回查询结果",
      "inputs": {
        "required_refs": ["conclusion:st_40"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["report_delivered"],
        "pass_rules": ["user_received"],
        "fail_rules": []
      },
      "timeouts": {
        "soft_timeout_sec": 30,
        "hard_timeout_sec": 60
      },
      "retry_policy": {
        "max_retries": 2,
        "max_repairs": 0,
        "retryable_errors": ["CHANNEL_DELIVERY_FAILED"]
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "failed"
    },
    {
      "seq": 60,
      "stage_key": "archive",
      "stage_type": "Archive",
      "assigned_executor": "generic-executor",
      "purpose": "归档本次查询记录",
      "inputs": {
        "required_refs": ["workflow:all_stages"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["archived"],
        "pass_rules": [],
        "fail_rules": []
      },
      "timeouts": {
        "soft_timeout_sec": 30,
        "hard_timeout_sec": 60
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "succeeded",
      "on_failure": "succeeded"
    }
  ],
  "report_policy": {
    "on_stage_complete": false,
    "on_waiting_user": true,
    "on_final": true
  },
  "archive_policy": {
    "archive_evidence": true,
    "archive_artifacts": true,
    "retention_days": 90
  }
}
```

## 17.14 Analysis 完整示例

```json
{
  "workflow_type": "analysis",
  "goal": {
    "user_goal": "分析最近一周的 Workflow 失败原因并给出改进建议",
    "success_definition": [
      "统计失败 Workflow 数量和分布",
      "识别主要失败原因",
      "提供可执行的改进建议"
    ]
  },
  "budgets": {
    "time_budget_sec": 600,
    "retrieval_budget": 25,
    "execution_budget": 40,
    "repair_budget": 0
  },
  "retrieval_profile": "comprehensive",
  "stage_chain": [
    {
      "seq": 10,
      "stage_key": "intent_clarification",
      "stage_type": "IntentClarification",
      "assigned_executor": "generic-executor",
      "purpose": "明确分析范围和时间窗口",
      "inputs": {
        "required_refs": [],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["time_range_confirmed", "scope_confirmed"],
        "pass_rules": [],
        "fail_rules": ["ambiguous_request"]
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "waiting_user"
    },
    {
      "seq": 20,
      "stage_key": "evidence_retrieval",
      "stage_type": "EvidenceRetrieval",
      "assigned_executor": "retrieval-aware-executor",
      "purpose": "检索失败 Workflow 的日志、状态和审计记录",
      "inputs": {
        "required_refs": ["intent:st_10"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": true,
        "intent_type": "object-status",
        "profiles": ["structured", "fulltext"],
        "max_candidates": 100,
        "allow_graph": false,
        "max_graph_hops": 0
      },
      "acceptance": {
        "must_have": ["evidence_pack_created"],
        "pass_rules": ["sufficient_data"],
        "fail_rules": ["no_data_found"]
      },
      "timeouts": {
        "soft_timeout_sec": 120,
        "hard_timeout_sec": 300
      },
      "retry_policy": {
        "max_retries": 2,
        "max_repairs": 0,
        "retryable_errors": ["RETRIEVAL_TIMEOUT", "SYSTEM_DATABASE_ERROR"]
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": true,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "failed"
    },
    {
      "seq": 30,
      "stage_key": "decision_making",
      "stage_type": "DecisionMaking",
      "assigned_executor": "generic-executor",
      "purpose": "分析失败模式并生成改进建议",
      "inputs": {
        "required_refs": ["evidence_pack:st_20"],
        "optional_refs": ["memory:historical_patterns"]
      },
      "retrieval_plan": {
        "enabled": true,
        "intent_type": "similar-case",
        "profiles": ["vector"],
        "max_candidates": 10,
        "allow_graph": false,
        "max_graph_hops": 0
      },
      "acceptance": {
        "must_have": ["analysis_complete", "recommendations_generated"],
        "pass_rules": ["actionable_recommendations"],
        "fail_rules": ["insufficient_data"]
      },
      "timeouts": {
        "soft_timeout_sec": 120,
        "hard_timeout_sec": 300
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": true,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "failed"
    },
    {
      "seq": 40,
      "stage_key": "verification",
      "stage_type": "Verification",
      "assigned_executor": "verification-executor",
      "purpose": "验证分析结果的合理性",
      "inputs": {
        "required_refs": ["analysis:st_30"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["verification_complete"],
        "pass_rules": ["statistics_accurate", "recommendations_valid"],
        "fail_rules": ["data_inconsistency"]
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "repair_or_fail"
    },
    {
      "seq": 50,
      "stage_key": "result_reporting",
      "stage_type": "ResultReporting",
      "assigned_executor": "generic-executor",
      "purpose": "生成分析报告并返回给用户",
      "inputs": {
        "required_refs": ["analysis:st_30", "verification:st_40"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["report_delivered"],
        "pass_rules": [],
        "fail_rules": []
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 2,
        "max_repairs": 0,
        "retryable_errors": ["CHANNEL_DELIVERY_FAILED"]
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "failed"
    },
    {
      "seq": 60,
      "stage_key": "archive",
      "stage_type": "Archive",
      "assigned_executor": "generic-executor",
      "purpose": "归档分析结果",
      "inputs": {
        "required_refs": ["workflow:all_stages"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["archived"],
        "pass_rules": [],
        "fail_rules": []
      },
      "timeouts": {
        "soft_timeout_sec": 30,
        "hard_timeout_sec": 60
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "succeeded",
      "on_failure": "succeeded"
    }
  ],
  "report_policy": {
    "on_stage_complete": false,
    "on_waiting_user": true,
    "on_final": true
  },
  "archive_policy": {
    "archive_evidence": true,
    "archive_artifacts": true,
    "retention_days": 180
  }
}
```

## 17.15 复杂开发任务示例（含审批节点）

```json
{
  "workflow_type": "development",
  "goal": {
    "user_goal": "重构 Workflow 状态机核心模块",
    "success_definition": [
      "完成核心模块重构",
      "所有测试通过",
      "性能不下降",
      "代码审查通过"
    ]
  },
  "risk_level": "high",
  "budgets": {
    "time_budget_sec": 14400,
    "retrieval_budget": 50,
    "execution_budget": 200,
    "repair_budget": 5
  },
  "retrieval_profile": "comprehensive",
  "stage_chain": [
    {
      "seq": 10,
      "stage_key": "intent_clarification",
      "stage_type": "IntentClarification",
      "assigned_executor": "generic-executor",
      "purpose": "明确重构范围和目标",
      "inputs": {
        "required_refs": [],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["scope_defined", "success_criteria_confirmed"],
        "pass_rules": [],
        "fail_rules": ["ambiguous_request"]
      },
      "timeouts": {
        "soft_timeout_sec": 300,
        "hard_timeout_sec": 600
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "waiting_user"
    },
    {
      "seq": 20,
      "stage_key": "plan_generation",
      "stage_type": "PlanGeneration",
      "assigned_executor": "generic-executor",
      "purpose": "生成详细重构计划",
      "inputs": {
        "required_refs": ["intent:st_10"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": true,
        "intent_type": "dev-context",
        "profiles": ["structured", "fulltext", "vector"],
        "max_candidates": 30,
        "allow_graph": true,
        "max_graph_hops": 2
      },
      "acceptance": {
        "must_have": ["plan_generated", "milestones_defined"],
        "pass_rules": ["plan_reviewed"],
        "fail_rules": ["plan_generation_failed"]
      },
      "timeouts": {
        "soft_timeout_sec": 600,
        "hard_timeout_sec": 1200
      },
      "retry_policy": {
        "max_retries": 2,
        "max_repairs": 0,
        "retryable_errors": ["INTEGRATION_LLM_ERROR"]
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": true,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "waiting_user"
    },
    {
      "seq": 30,
      "stage_key": "approval_plan",
      "stage_type": "Approval",
      "assigned_executor": "generic-executor",
      "purpose": "等待用户确认重构计划",
      "inputs": {
        "required_refs": ["plan:st_20"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["user_approved"],
        "pass_rules": [],
        "fail_rules": ["user_rejected"]
      },
      "timeouts": {
        "soft_timeout_sec": 86400,
        "hard_timeout_sec": 172800
      },
      "retry_policy": {
        "max_retries": 0,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": true,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "cancelled"
    },
    {
      "seq": 40,
      "stage_key": "implementation_phase1",
      "stage_type": "Implementation",
      "assigned_executor": "code-executor",
      "purpose": "实现核心状态机重构",
      "inputs": {
        "required_refs": ["plan:st_20", "approval:st_30"],
        "optional_refs": ["memory:historical_patterns"]
      },
      "retrieval_plan": {
        "enabled": true,
        "intent_type": "dev-context",
        "profiles": ["structured", "fulltext", "vector"],
        "max_candidates": 50,
        "allow_graph": true,
        "max_graph_hops": 2
      },
      "acceptance": {
        "must_have": ["code_modified", "patch_created"],
        "pass_rules": ["syntax_valid", "tests_pass"],
        "fail_rules": ["repo_inaccessible", "patch_apply_failed"]
      },
      "timeouts": {
        "soft_timeout_sec": 1800,
        "hard_timeout_sec": 3600
      },
      "retry_policy": {
        "max_retries": 3,
        "max_repairs": 5,
        "retryable_errors": ["EXECUTOR_TOOL_CHAIN_FAILED", "EXECUTOR_TEST_FAILED", "INTEGRATION_LLM_ERROR"]
      },
      "checkpoint_policy": {
        "on_enter": true,
        "on_progress": true,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "repair_or_fail"
    },
    {
      "seq": 50,
      "stage_key": "verification",
      "stage_type": "Verification",
      "assigned_executor": "verification-executor",
      "purpose": "全面验证重构结果",
      "inputs": {
        "required_refs": ["patch:st_40"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["all_tests_pass", "no_regression"],
        "pass_rules": ["performance_acceptable", "coverage_maintained"],
        "fail_rules": ["test_failures", "performance_regression"]
      },
      "timeouts": {
        "soft_timeout_sec": 900,
        "hard_timeout_sec": 1800
      },
      "retry_policy": {
        "max_retries": 2,
        "max_repairs": 0,
        "retryable_errors": ["TEST_RUNNER_ERROR"]
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": true,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "repair_or_fail"
    },
    {
      "seq": 60,
      "stage_key": "approval_merge",
      "stage_type": "Approval",
      "assigned_executor": "generic-executor",
      "purpose": "等待代码审查和合并审批",
      "inputs": {
        "required_refs": ["verification:st_50"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["code_review_approved"],
        "pass_rules": [],
        "fail_rules": ["review_rejected"]
      },
      "timeouts": {
        "soft_timeout_sec": 172800,
        "hard_timeout_sec": 345600
      },
      "retry_policy": {
        "max_retries": 0,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": true,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "repair_or_fail"
    },
    {
      "seq": 70,
      "stage_key": "result_reporting",
      "stage_type": "ResultReporting",
      "assigned_executor": "generic-executor",
      "purpose": "汇报重构完成情况",
      "inputs": {
        "required_refs": ["workflow:all_stages"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["report_delivered"],
        "pass_rules": [],
        "fail_rules": []
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 2,
        "max_repairs": 0,
        "retryable_errors": ["CHANNEL_DELIVERY_FAILED"]
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "succeeded"
    },
    {
      "seq": 80,
      "stage_key": "skill_extraction",
      "stage_type": "SkillExtraction",
      "assigned_executor": "generic-executor",
      "purpose": "提取可复用的重构经验为 Skill",
      "inputs": {
        "required_refs": ["workflow:all_stages"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["skill_candidate_created"],
        "pass_rules": ["skill_quality_acceptable"],
        "fail_rules": []
      },
      "timeouts": {
        "soft_timeout_sec": 300,
        "hard_timeout_sec": 600
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "next_stage",
      "on_failure": "next_stage"
    },
    {
      "seq": 90,
      "stage_key": "archive",
      "stage_type": "Archive",
      "assigned_executor": "generic-executor",
      "purpose": "归档重构记录",
      "inputs": {
        "required_refs": ["workflow:all_stages"],
        "optional_refs": []
      },
      "retrieval_plan": {
        "enabled": false
      },
      "acceptance": {
        "must_have": ["archived"],
        "pass_rules": [],
        "fail_rules": []
      },
      "timeouts": {
        "soft_timeout_sec": 60,
        "hard_timeout_sec": 120
      },
      "retry_policy": {
        "max_retries": 1,
        "max_repairs": 0,
        "retryable_errors": []
      },
      "checkpoint_policy": {
        "on_enter": false,
        "on_progress": false,
        "on_exit": true
      },
      "on_success": "succeeded",
      "on_failure": "succeeded"
    }
  ],
  "report_policy": {
    "on_stage_complete": true,
    "on_waiting_user": true,
    "on_blocked": true,
    "on_final": true,
    "progress_interval_sec": 300
  },
  "archive_policy": {
    "archive_evidence": true,
    "archive_artifacts": true,
    "archive_checkpoints": true,
    "retention_days": 365
  }
}
```

## 17.16 自主规划与决策循环（Roo Code 机制）

### 17.16.1 自主决策循环

Planner 不是一个一次性输出工具，而是一个持续决策循环。Workflow 引擎在每个阶段完成后，将结果反馈给 Planner，由 Planner 决定下一步动作。

```
用户请求
    │
    ▼
┌─────────────┐
│ Planner     │ ← 生成初始 WorkflowPlan
│ 自主规划    │
└─────────────┘
    │
    ▼
┌─────────────┐     阶段完成
│ Stage 执行  │ ──────────────▶ ┌─────────────┐
│ (Executor)  │                 │ Planner     │ ← 评估结果，决定下一步
└─────────────┘                 │ 重新规划    │
    │                           └─────────────┘
    │ 需要修复                      │
    ▼                               │
┌─────────────┐                     │ 继续下一阶段
│ Repair      │ ◀──────────────────┘
│ 自修复循环  │
└─────────────┘
    │ 修复成功
    ▼
┌─────────────┐
│ Planner     │ ← 评估修复结果，决定继续/停止
│ 决策        │
└─────────────┘
```

### 17.16.2 自主决策触发条件

| 触发点 | Planner 动作 | 说明 |
|--------|-------------|------|
| Workflow 创建 | 生成初始 WorkflowPlan | 分析用户意图，规划阶段链 |
| 阶段成功完成 | 评估是否继续下一阶段 | 可跳过、合并或拆分后续阶段 |
| 阶段失败 | 决定修复/重试/降级/等待用户 | 根据错误类型和修复预算决策 |
| 修复成功 | 评估是否恢复原计划 | 可能调整后续阶段 |
| 修复失败 | 决定是否降级或等待用户 | 超出修复预算时升级处理 |
| 检索结果不足 | 补充检索或调整策略 | 精准召回不足时重新规划 |
| 用户中途输入 | 重新评估并调整计划 | 响应用户变更需求 |

### 17.16.3 自主决策输出

每次 Planner 决策后输出一个 `DecisionRecord`：

```json
{
  "decision_id": "dec_123",
  "workflow_instance_id": "wf_123",
  "trigger": "stage_completed",
  "trigger_stage_id": "st_30",
  "evaluation": {
    "stage_result": "success",
    "quality_score": 0.85,
    "deviation_from_plan": false
  },
  "decision": "proceed_next_stage",
  "next_stage_id": "st_40",
  "plan_modifications": [],
  "reasoning": "Implementation stage completed with high quality, proceeding to verification."
}
```

### 17.16.4 自主决策约束

1. Planner 不得跳过 `Approval` 阶段（必须等待用户确认）。
2. Planner 不得自行修改 `policy_snapshot`。
3. Planner 不得超出 `budgets` 限制（超出时必须进入 `waiting_user`）。
4. 每次决策必须写入 `workflow_event`，确保可审计。
5. Planner 不得将 `failed` 状态改为其他状态（只能由用户手动恢复）。

### 17.16.5 自修复决策逻辑

自修复不是无脑重试，而是有明确决策树的受控行为：

```
阶段执行失败
    │
    ▼
┌─────────────────────────┐
│ 1. 分类错误              │
│    Transient / Permanent │
│    / System              │
└─────────────────────────┘
    │
    ├── Transient（可重试）
    │   ├── 重试次数 < max_retries → 重试
    │   └── 重试次数 ≥ max_retries → 进入修复评估
    │
    ├── Permanent（不可重试）
    │   └── 直接进入修复评估
    │
    └── System（系统级）
        └── 进入 blocked，等待系统恢复
    │
    ▼
┌─────────────────────────┐
│ 2. 修复评估              │
│    能否自动修复？         │
└─────────────────────────┘
    │
    ├── 可修复（代码错误、测试失败等）
    │   ├── 修复次数 < max_repairs → 进入 Repair 阶段
    │   ├── 修复次数 ≥ max_repairs → 进入 waiting_user
    │   └── 连续 3 次修复失败 → 进入 waiting_user（不浪费资源）
    │
    ├── 需要用户输入
    │   └── 进入 waiting_user
    │
    └── 不可修复（权限不足、资源不可用等）
        └── 进入 failed
    │
    ▼
┌─────────────────────────┐
│ 3. 修复后评估            │
│    修复是否成功？         │
└─────────────────────────┘
    │
    ├── 成功 → 继续原计划
    ├── 部分成功 → 调整后续计划
    └── 失败 → 回到步骤 2
```

### 17.16.6 主动汇报触发条件

| 触发条件 | 汇报类型 | 汇报内容 | 汇报渠道 |
|----------|----------|----------|----------|
| 阶段完成 | 进度汇报 | 阶段结果、下一步计划 | 原渠道 |
| 阶段失败 | 异常汇报 | 失败原因、修复计划 | 原渠道 + 告警 |
| 进入 waiting_user | 等待汇报 | 等待原因、需要用户做什么 | 原渠道 |
| 进入 blocked | 异常汇报 | 阻塞原因、预计恢复时间 | 原渠道 + 告警 |
| 修复循环开始 | 进度汇报 | 修复目标、预估时间 | 原渠道 |
| 修复成功 | 进度汇报 | 修复内容、继续计划 | 原渠道 |
| 修复失败 | 异常汇报 | 失败原因、需要用户决策 | 原渠道 + 告警 |
| 预算使用超 50% | 资源汇报 | 已用预算、剩余预算 | 原渠道 |
| 预算使用超 80% | 资源告警 | 已用预算、建议调整 | 原渠道 + 告警 |
| 长任务每 5 分钟 | 定期进度 | 已完成步骤、剩余步骤 | 原渠道 |
| Executor 排队等待 | 等待汇报 | 排队位置、预估等待时间 | 原渠道 |
| 检索结果不足 | 异常汇报 | 召回数量、质量评估、调整策略 | 原渠道 |
| Workflow 完成 | 最终汇报 | 完整结果、Skill 封装情况 | 原渠道 |

### 17.16.7 汇报格式

```json
{
  "report_type": "progress|exception|resource|final",
  "workflow_instance_id": "wf_123",
  "current_stage": "st_30",
  "summary": "Implementation completed, 2 test failures found",
  "detail": {
    "completed_steps": ["file_modified", "patch_created"],
    "remaining_steps": ["fix_test_failures", "verification"],
    "budget_used_pct": 45,
    "estimated_completion_sec": 300
  },
  "requires_user_action": false,
  "timestamp": "2026-04-20T10:00:00Z"
}
```

## 17.17 自主选择智能体（动态 Executor 选择）

### 17.17.1 动态选择机制

Planner 在生成阶段计划时，根据任务特征动态选择最合适的 Executor，而非硬编码固定映射。

### 17.17.2 Executor 能力声明

每个 Executor 在注册时声明自己的能力矩阵：

```json
{
  "executor_id": "code-executor",
  "capabilities": {
    "stage_types": ["Implementation", "Repair"],
    "tools": ["file_read", "file_write", "shell_exec", "git_ops", "test_runner"],
    "languages": ["typescript", "python", "go", "rust"],
    "max_context_tokens": 128000,
    "supports_streaming": true,
    "supports_parallel_tools": true,
    "resource_requirements": {
      "cpu_weight": 2,
      "memory_mb": 1536,
      "timeout_range_sec": [60, 7200]
    }
  }
}
```

### 17.17.3 选择决策逻辑

```
输入：stage_type + task_context + available_executors

1. 过滤：只保留支持该 stage_type 的 executor
2. 匹配：根据 task_context 中的语言/工具需求进一步过滤
3. 评分：按以下维度评分
   - 能力匹配度（工具/语言覆盖）
   - 当前负载（优先选择空闲 executor）
   - 历史成功率（优先选择历史表现好的）
4. 选择：取评分最高的 executor
5. 降级：若无合适 executor，选择最接近的并标记需要降级
```

### 17.17.4 选择评分公式

```
score = capability_match × 0.4
      + (1 - current_load / max_capacity) × 0.3
      + historical_success_rate × 0.3
```

### 17.17.5 运行时切换

若阶段执行中发现当前 Executor 不适合：

1. Executor 发出 `EXECUTOR_MISMATCH` 事件。
2. Planner 评估是否需要切换。
3. 若切换，创建 checkpoint 保存当前进度。
4. 新 Executor 从 checkpoint 恢复执行。
5. 切换事件写入审计日志。

## 17.18 Subagent 机制

### 17.18.1 Subagent 定义

Subagent 是 Executor 内部的自治执行单元，负责在单个阶段内完成具体的子任务循环。与 Workflow 阶段（跨阶段治理）不同，Subagent 在阶段内部自治运行。

```
Workflow Stage (阶段级治理)
└── Subagent Loop (阶段内自治)
    ├── 理解任务
    ├── 选择工具
    ├── 执行动作
    ├── 观察结果
    ├── 判断是否完成
    │   ├── 是 → 输出结果
    │   └── 否 → 继续循环
    └── 达到上限 → 输出部分结果 + 需要修复
```

### 17.18.2 Subagent 类型

| Subagent 类型 | 绑定 Executor | 职责 | 说明 |
|---------------|---------------|------|------|
| `code-subagent` | `code-executor` | 代码开发 | 类似 roo code 的自主编码循环 |
| `retrieval-subagent` | `retrieval-aware-executor` | 检索增强 | 自主多轮检索直到召回足够 |
| `verification-subagent` | `verification-executor` | 验证检查 | 自主运行测试并分析结果 |
| `repair-subagent` | `repair-executor` | 修复循环 | 自主分析失败原因并修复 |
| `generic-subagent` | `generic-executor` | 通用任务 | 规划、分析、汇报等 |

### 17.18.3 Subagent 执行循环

```json
{
  "subagent_id": "sa_123",
  "subagent_type": "code-subagent",
  "execution_session_id": "exec_123",
  "loop_state": {
    "iteration": 3,
    "max_iterations": 10,
    "context_window_used_pct": 45,
    "tools_called": ["file_read", "file_write", "shell_exec"],
    "last_observation": "Tests passed for module A, module B has 2 failures",
    "next_action": "fix_module_b_failures"
  },
  "output": {
    "status": "in_progress",
    "artifacts_created": ["patch_001"],
    "tests_passed": 8,
    "tests_failed": 2
  }
}
```

### 17.18.4 Subagent 上下文隔离

1. 每个 Subagent 拥有独立的上下文窗口，不与 OpenClaw 主上下文共享。
2. Subagent 只接收阶段契约中定义的 `inputs`，不继承上游全部上下文。
3. Subagent 的输出通过 `execution_session` 结构化回写，不直接写入 OpenClaw 上下文。
4. 上下文窗口使用策略：
   - 保留：任务描述 + 最近 3 轮交互 + 关键工具输出
   - 压缩：历史交互摘要（由 LLM 生成）
   - 丢弃：重复/无关的工具输出

### 17.18.5 Subagent 与 OpenClaw 的边界

| 职责 | OpenClaw | Subagent (via Executor) |
|------|----------|-------------------------|
| 渠道消息收发 | ✅ | ❌ |
| 身份解析 | ✅ | ❌ |
| 任务分发 | ✅ | ❌ |
| 阶段内自主执行 | ❌ | ✅ |
| 工具调用 | ❌ | ✅ |
| 上下文管理 | 全局共享 | 独立隔离 |
| 结果回传 | ✅ 接收 | ✅ 发送 |

### 17.18.6 Subagent 停止条件

| 条件 | 动作 |
|------|------|
| `acceptance.must_have` 全部满足 | 正常退出，输出结果 |
| `max_iterations` 达到上限 | 输出部分结果，标记 `needs_repair` |
| 上下文窗口使用 > 90% | 压缩上下文后继续，若仍超限则退出 |
| `hard_timeout_sec` 到期 | 强制退出，输出已有结果 |
| LLM 连续 3 次返回无效响应 | 退出，标记 `needs_repair` |

## 17.19 Skill 自动封装触发条件

### 17.19.1 触发条件

Skill Extraction 阶段在以下条件满足时触发：

| 条件 | 说明 |
|------|------|
| Workflow 成功完成（`succeeded`） | 只有成功的 Workflow 才有封装价值 |
| 至少一个阶段产生了可复用的模式 | 如重复的检索策略、修复模式、代码模板 |
| 用户未明确拒绝 Skill 封装 | 尊重用户选择 |

### 17.19.2 Skill 质量标准

| 维度 | 最低标准 | 说明 |
|------|----------|------|
| 可复用性 | ≥ 3 次类似任务出现相同模式 | 避免一次性经验封装 |
| 完整性 | 包含完整的输入/输出/步骤描述 | 不封装半成品 |
| 准确性 | 验证通过率 ≥ 80% | 不封装低质量经验 |
| 独立性 | 不依赖特定用户私有数据 | 公共 Skill 必须通用 |

### 17.19.3 Skill 封装流程

```
Workflow succeeded
    │
    ▼
┌─────────────────────┐
│ 1. 提取阶段模式      │  识别可复用的阶段链片段
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ 2. 生成 Skill 候选   │  包含输入/输出/步骤/约束
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ 3. 质量评估          │  检查可复用性/完整性/准确性
└─────────────────────┘
    │
    ├── 不达标 → 丢弃，写入审计
    │
    ▼ 达标
┌─────────────────────┐
│ 4. 创建 Skill        │  写入 skill + skill_version
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ 5. 默认私有          │  Day 1 默认私有，admin 可发布到公共区
└─────────────────────┘
```

### 17.19.4 Skill 封装审计

所有 Skill 封装事件必须记录审计：

```json
{
  "action": "skill.candidate.created",
  "workflow_instance_id": "wf_123",
  "skill_candidate_id": "sk_cand_123",
  "quality_score": 0.85,
  "reusability_score": 0.9,
  "source_stages": ["st_30", "st_40"],
  "decision": "accepted"
}
```

## 17.20 稳定开发量化标准

### 17.20.1 "稳定开发"定义

"稳定开发"指 Code Executor 在长任务中持续产出高质量代码，不因上下文混乱、修复死循环或资源限制而失败。

### 17.20.2 量化指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 阶段完成率 | ≥ 90% | 10 个阶段中至少 9 个成功完成 |
| 修复成功率 | ≥ 80% | 修复循环中 80% 的修复尝试成功 |
| 测试通过率 | ≥ 85% | 生成的代码测试通过率 |
| 上下文隔离率 | 100% | Code Executor 上下文与 OpenClaw 完全隔离 |
| Checkpoint 恢复率 | ≥ 95% | 从 checkpoint 恢复后可继续执行 |
| 长任务完成率 | ≥ 85% | 超过 30 分钟的开发任务完成率 |
| 主动汇报率 | 100% | 每个阶段完成/失败/等待时都主动汇报 |

### 17.20.3 不稳定信号与处理

| 信号 | 阈值 | 处理方式 |
|------|------|----------|
| 修复循环超过 max_repairs | - | 停止修复，进入 `waiting_user` |
| 连续 3 次修复失败 | - | 暂停，请求用户指导 |
| 上下文窗口使用 > 90% | - | 压缩上下文，若仍超限则 checkpoint 后暂停 |
| 同一文件反复修改 > 5 次 | - | 标记为"不稳定文件"，请求用户审查 |
| 测试通过率持续 < 50% | - | 回退到上一个 checkpoint，调整策略 |

## 17.21 Workflow 实例完整生命周期管理

### 17.21.1 生命周期阶段

```
draft → planned → running → verifying → reporting → running（继续下一阶段）
                ↘              ↘ repairing → verifying（修复循环）
                ↘                           ↘ reporting → succeeded
                ↘ waiting_user → running
                ↘ blocked → running
                ↘ paused → running
                                                    ↘ failed
                                                    ↘ cancelled
                                                    ↘ archived
```

### 17.21.2 各阶段定义

| 状态 | 触发条件 | 持续时间限制 | 说明 |
|------|----------|-------------|------|
| `draft` | 用户发起请求 | ≤ 30s | 等待 Planner 生成计划 |
| `planned` | Planner 输出 WorkflowPlan | ≤ 60s | 等待用户确认（若需审批） |
| `running` | 阶段执行中 | 由 budgets 控制 | 正常执行状态 |
| `verifying` | 验证阶段 | 由 stage timeouts 控制 | 验证阶段结果 |
| `repairing` | 修复阶段 | 由 repair_budget 控制 | 修复失败结果 |
| `reporting` | 汇报阶段 | 由 stage timeouts 控制 | 主动汇报与结果交付 |
| `waiting_user` | 需要用户输入/审批 | ≤ 7 天 | 等待用户响应 |
| `blocked` | 外部依赖不可用 | ≤ 24h | 等待依赖恢复 |
| `paused` | 用户主动暂停 | ≤ 30 天 | 用户可随时恢复 |
| `succeeded` | 所有阶段完成 | - | 终态 |
| `failed` | 不可恢复的失败 | - | 终态 |
| `cancelled` | 用户取消 | - | 终态 |
| `archived` | 归档 | 永久 | 归档后只读 |

### 17.21.3 状态迁移规则

> 注意：本节定义了完整的 Workflow 状态机迁移规则，是系统状态管理的权威规范。

| 从 | 到 | 触发条件 | 审计事件 |
|----|----|----------|----------|
| `draft` | `planned` | Planner 输出计划 | `workflow.planned` |
| `planned` | `running` | 用户确认/自动开始 | `workflow.started` |
| `running` | `verifying` | 进入验证阶段 | `workflow.verifying` |
| `verifying` | `repairing` | 验证失败需修复 | `workflow.repairing` |
| `repairing` | `verifying` | 修复后重新验证 | `workflow.re-verifying` |
| `verifying` | `reporting` | 验证通过进入汇报 | `workflow.reporting` |
| `reporting` | `running` | 汇报完成继续下一阶段 | `workflow.continued` |
| `reporting` | `succeeded` | 所有阶段完成 | `workflow.succeeded` |
| `running` | `waiting_user` | 需要用户输入 | `workflow.waiting_user` |
| `running` | `blocked` | 外部依赖不可用 | `workflow.blocked` |
| `running\|verifying\|repairing\|reporting` | `paused` | 用户暂停 | `workflow.paused` |
| `paused` | `running` | 用户恢复 | `workflow.resumed` |
| `planned\|running\|waiting_user\|blocked\|paused` | `cancelled` | 用户取消 | `workflow.cancelled` |
| `planned\|running\|waiting_user\|blocked\|paused\|verifying\|repairing` | `failed` | 不可恢复失败 | `workflow.failed` |
| `succeeded\|failed\|cancelled` | `archived` | 归档策略触发 | `workflow.archived` |

### 17.21.4 归档策略

| 规则 | 说明 |
|------|------|
| 归档时机 | 终态（succeeded/failed/cancelled）后 24 小时 |
| 归档内容 | Evidence Pack、Artifact、Checkpoint、审计日志 |
| 归档存储 | PostgreSQL（元数据）+ MinIO（大对象） |
| 保留期 | 知识查询 90 天，开发任务 365 天，可配置 |
| 归档后访问 | 只读查询，不可修改 |
| 删除 | 超过保留期后自动删除（可配置为手动确认） |

### 17.21.5 生命周期审计

所有状态迁移必须记录审计：

```json
{
  "action": "workflow.state_changed",
  "workflow_instance_id": "wf_123",
  "from_state": "running",
  "to_state": "waiting_user",
  "trigger": "stage_approval_required",
  "trigger_stage_id": "st_30",
  "actor": "system",
  "timestamp": "2026-04-20T10:00:00Z"
}
```

## 17.22 用户交互处理机制

### 17.22.1 用户取消 Workflow

#### 取消触发条件

| 触发方式 | 说明 | 审计要求 |
|----------|------|----------|
| 用户主动取消 | 用户通过渠道发送取消指令 | 必须审计 |
| 管理员取消 | admin 强制取消他人 Workflow | 必须审计 + 原因记录 |
| 超时自动取消 | waiting_user 超过最大等待时间 | 必须审计 |

#### 取消流程

```
用户发送取消指令
    │
    ▼
┌─────────────────┐
│ 1. 验证权限      │  只有 owner 或 admin 可取消
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 2. 检查当前状态  │  只有非终态可取消
└─────────────────┘
    │
    ├── 终态 ──▶ 返回错误：已完成的 Workflow 不可取消
    │
    ▼ 非终态
┌─────────────────┐
│ 3. 停止执行      │  中断当前 Executor，保存 checkpoint
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 4. 状态迁移      │  当前状态 → cancelled
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 5. 清理资源      │  清理 worktree、临时文件
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 6. 写入审计      │  记录取消原因、执行者、时间
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 7. 通知用户      │  返回取消确认
└─────────────────┘
```

#### 取消确认机制

为防止误操作，建议实现以下确认机制：

| 场景 | 确认要求 | 说明 |
|------|----------|------|
| 轻量任务（< 5min） | 无需确认 | 知识查询类 |
| 中等任务（5-30min） | 简单确认 | 分析类任务 |
| 重量任务（> 30min） | 详细确认 + 进度摘要 | 开发类任务 |

**取消确认消息示例：**

```json
{
  "message_type": "cancel_confirmation",
  "workflow_instance_id": "wf_123",
  "current_progress": {
    "completed_stages": 3,
    "total_stages": 8,
    "current_stage": "Implementation",
    "elapsed_time_sec": 1200
  },
  "warning": "取消将丢失当前进度，已修改的代码将保留在 patch 中",
  "confirmation_required": true,
  "confirmation_timeout_sec": 60
}
```

#### 取消后的资源处理

| 资源类型 | 处理方式 | 说明 |
|----------|----------|------|
| Checkpoint | 保留 | 可用于后续恢复或分析 |
| Patch Artifact | 保留 | 用户可选择手动应用 |
| Test Result | 保留 | 可用于问题分析 |
| Worktree | 清理 | 释放磁盘空间 |
| 临时文件 | 清理 | 释放磁盘空间 |
| Fact 写入 | 不回滚 | 已写入的事实保留 |

### 17.22.2 用户修改需求

#### 需求修改触发条件

| 触发方式 | 当前状态要求 | 说明 |
|----------|-------------|------|
| 用户补充信息 | waiting_user | 响应系统提问 |
| 用户调整目标 | running/paused | 修改任务目标 |
| 用户变更约束 | running/paused | 修改预算、时间限制等 |
| 用户切换方案 | running/paused | 选择不同的执行路径 |

#### 需求修改流程

```
用户发送修改请求
    │
    ▼
┌─────────────────┐
│ 1. 解析修改内容  │  识别修改类型：目标变更/约束变更/方案选择
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 2. 评估影响范围  │  判断是否需要重新规划
└─────────────────┘
    │
    ├── 小范围修改 ──────────────────┐
    │   (约束调整、方案选择)          │
    │                               ▼
    │                    ┌─────────────────┐
    │                    │ 直接更新当前阶段 │  不触发重规划
    │                    └─────────────────┘
    │
    ├── 大范围修改 ──────────────────┐
    │   (目标变更、新增需求)          │
    │                               ▼
    │                    ┌─────────────────┐
    │                    │ 触发 Planner    │  重新生成 WorkflowPlan
    │                    │ 重新规划        │
    │                    └─────────────────┘
    │                               │
    │                               ▼
    │                    ┌─────────────────┐
    │                    │ 生成新 stage_chain │
    │                    └─────────────────┘
    │                               │
    │                               ▼
    │                    ┌─────────────────┐
    │                    │ 保留已完成阶段   │  复用已有成果
    │                    └─────────────────┘
    │
    ▼
┌─────────────────┐
│ 3. 更新 Workflow │  更新 goal、budgets、stage_chain
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 4. 写入审计      │  记录修改内容、原因、影响
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ 5. 继续执行      │  从当前阶段继续
└─────────────────┘
```

#### 需求修改影响评估

| 修改类型 | 影响范围 | 是否重规划 | 说明 |
|----------|----------|-----------|------|
| 补充输入参数 | 当前阶段 | 否 | 直接注入上下文 |
| 调整预算 | 全局 | 否 | 更新 budget_json |
| 选择方案分支 | 当前阶段 | 否 | 更新 next_action |
| 修改任务目标 | 全局 | 是 | 重新生成 stage_chain |
| 新增子任务 | 后续阶段 | 是 | 追加 stage |
| 取消部分需求 | 后续阶段 | 是 | 裁剪 stage_chain |
| 修改验收条件 | 当前/后续阶段 | 可能 | 更新 acceptance |

#### 需求修改审计

```json
{
  "action": "workflow.requirement_modified",
  "workflow_instance_id": "wf_123",
  "modification_type": "goal_change",
  "previous_goal": {
    "user_goal": "实现用户登录功能",
    "success_definition": ["登录成功", "session 有效"]
  },
  "new_goal": {
    "user_goal": "实现用户登录和注册功能",
    "success_definition": ["登录成功", "注册成功", "session 有效"]
  },
  "impact_assessment": {
    "requires_replanning": true,
    "affected_stages": ["st_30", "st_40"],
    "new_stages_added": ["st_35"],
    "estimated_delay_sec": 600
  },
  "actor": "user",
  "timestamp": "2026-04-20T10:00:00Z"
}
```

### 17.22.3 需求变更时的状态保持

#### 已完成阶段的保留策略

| 策略 | 适用场景 | 说明 |
|------|----------|------|
| 完全复用 | 小范围修改 | 已完成阶段直接复用 |
| 部分复用 | 中等修改 | 已完成阶段可能需要微调 |
| 重新执行 | 大范围修改 | 已完成阶段可能需要重跑 |

#### Checkpoint 复用规则

```
需求变更触发重规划
    │
    ▼
┌─────────────────────────────┐
│ 检查已完成阶段的 checkpoint   │
└─────────────────────────────┘
    │
    ├── checkpoint 与新目标兼容 ──▶ 复用 checkpoint，跳过已完成阶段
    │
    ├── checkpoint 部分兼容 ──▶ 复用部分结果，补充执行
    │
    └── checkpoint 不兼容 ──▶ 从头执行，保留旧 checkpoint 作为参考
```

### 17.22.4 用户交互事件

| 事件 | 触发时机 | payload |
|------|----------|---------|
| `workflow.cancel.requested` | 用户请求取消 | user_id, reason |
| `workflow.cancel.confirmed` | 取消确认 | workflow_id, checkpoint_id |
| `workflow.cancel.completed` | 取消完成 | workflow_id, cleanup_result |
| `workflow.modify.requested` | 用户请求修改 | modification_type, content |
| `workflow.modify.assessed` | 影响评估完成 | impact_assessment |
| `workflow.modify.applied` | 修改已应用 | new_plan_hash |
| `workflow.replan.triggered` | 触发重规划 | trigger_reason |

## 17.23 Day 1 必须先冻结的 Planner 输出字段

- `workflow_type`
- `goal.success_definition`
- `budgets`
- `stage_chain[*].stage_type`
- `stage_chain[*].assigned_executor`
- `stage_chain[*].acceptance`
- `stage_chain[*].timeouts`
- `stage_chain[*].retry_policy`
- `stage_chain[*].checkpoint_policy`

这些字段一旦稳定，Workflow 引擎、Executor 与 Checkpoint 系统就可以并行开发。
