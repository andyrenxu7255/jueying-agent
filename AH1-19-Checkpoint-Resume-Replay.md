# 文档 19：Checkpoint / Resume / Replay 细化设计 v1.0

## 19.1 文档目的

本文件把“长任务治理必须基于 Workflow、Checkpoint、结构化状态与审计”的原则细化为运行规则，明确：

- 什么可以 checkpoint
- 何时写 checkpoint
- 如何恢复
- 如何回放
- 什么绝不能作为恢复依据

## 19.2 总原则

1. Checkpoint 必须是结构化、可校验、可重建的状态边界。
2. 恢复只能基于已落盘对象，不允许恢复隐式思维链。
3. 恢复必须保持 `policy_snapshot_hash` 一致。
4. 回放用于审计和问题复现，不用于替代业务恢复。
5. 回放默认只读，不得直接写主事实、公共资产或用户侧消息回执。

## 19.3 Checkpoint 分层

### 19.3.1 Workflow Checkpoint

记录内容：

- 当前 `workflow_instance_id`
- 当前 `workflow_stage_id`
- 当前 Workflow 状态
- 已完成阶段列表
- 下一个待执行动作
- 关联 `policy_snapshot_hash`

### 19.3.2 Stage Checkpoint

记录内容：

- 当前阶段输入 hash
- 当前阶段输出 refs
- `evidence_pack_hash`
- `artifact_refs`
- `verification_refs`
- `fact_write_refs`

### 19.3.3 Execution Checkpoint

记录内容：

- `execution_session_id`
- `repo_ref`
- `branch_ref`
- `worktree_ref`
- `base_commit_hash`
- 最近一次 patch ref
- 最近一次 test result ref
- 后续恢复提示

### 19.3.4 Waiting User Checkpoint

记录内容：

- 缺失信息说明
- 等待问题列表
- 超时策略
- 最近可交付物 refs

## 19.4 Checkpoint 最小结构

```json
{
  "checkpoint_id": "ck_123",
  "workflow_instance_id": "wf_123",
  "workflow_stage_id": "st_123",
  "checkpoint_type": "stage-exit",
  "status_snapshot": {
    "workflow_status": "paused",
    "stage_status": "verifying"
  },
  "metadata": {
    "tool_call_refs": ["tool_1"],
    "notes": "waiting for user repo credential"
  },
  "policy_snapshot_hash": "sha256:...",
  "state_hash": "sha256:...",
  "resume_token": "resume_123",
  "artifact_refs": ["art_1"],
  "fact_write_refs": ["fact_1"],
  "verification_refs": ["ver_1"],
  "evidence_pack_hash": "sha256:...",
  "next_action": "resume_verification"
}
```

> 注：`tool_call_refs` 和 `notes` 在物理存储中位于 checkpoint 记录的 `metadata` JSONB 字段内（见文档14 §14.5.2），而非顶层列。

## 19.5 Checkpoint 触发规则

### 19.5.1 必触发场景

1. 进入 `waiting_user` 前。
2. 进入 `blocked` 前。
3. 进入 `paused` 前。
4. 阶段成功完成后。
5. Code Executor 完成关键 patch 与测试后。
6. 发生可恢复失败且准备重试前。

### 19.5.2 可选触发场景

1. 长阶段执行超过软超时。
2. 重要 artifact 写入完成。
3. 大规模检索结果构建完成。

### 19.5.3 禁止过度 checkpoint

- 不要每个 tool call 都写一次完整 checkpoint。
- 不要在还没有稳定输出 refs 时就写伪 checkpoint。

## 19.6 恢复规则

### 19.6.1 恢复前检查

恢复前必须校验：

1. `checkpoint_id` 存在。
2. `policy_snapshot_hash` 一致。
3. 所有关联 artifact ref 可读。
4. 关联 repo / worktree / document / evidence 仍可访问。
5. `resume_token` 未过期。

### 19.6.2 恢复动作顺序

1. 装载 Workflow 与 Stage 结构化状态。
2. 装载关联 artifact / evidence / verification refs。
3. 若有执行会话，则尝试恢复 worktree 或重新挂载执行环境。
4. 根据 `next_action` 恢复到最近稳定边界。
5. 写入恢复审计事件。

### 19.6.3 允许恢复到的边界

- 阶段开始边界
- 上一个已提交 checkpoint 边界
- 等待用户边界
- 修复循环边界

### 19.6.4 不允许恢复到的边界

- 未落盘的中间推理状态
- 未生成 artifact ref 的内存态 patch
- 未保存的终端输出缓存

## 19.7 Replay 规则

### 19.7.1 回放目标

回放用于：

- 调试为什么失败
- 审计某次检索/写入是否越权
- 复盘某个阶段为什么进入 `failed`

### 19.7.2 回放最小集合

- `workflow_plan_hash`
- `policy_snapshot_hash`
- `checkpoint_id`
- `evidence_pack_hash`
- `tool_call_refs`
- `artifact_refs`
- `fact_write_refs`
- `verification_refs`
- `workflow_event` 序列

### 19.7.3 回放模式

| 模式 | 说明 |
|---|---|
| 审计回放 | 只重建事件链，不触发外部动作 |
| 调试回放 | 在隔离环境重演步骤，但不写真实事实 |
| 对比回放 | 用于比较新旧 planner / retrieval / executor 行为差异 |

## 19.8 State Hash 规则

`state_hash` 建议包含：

- `workflow_status`
- `stage_status`
- `stage_input_hash`
- `artifact_refs`
- `fact_write_refs`
- `verification_refs`
- `evidence_pack_hash`

不包含：

- 临时时钟时间
- 随机 token
- 日志行号

## 19.9 幂等与重复恢复

1. 同一个 `resume_token` 重放恢复请求时，必须返回同一恢复决策。
2. 若恢复动作已经完成，重复请求不得重复写事实、重复发消息、重复生成公共发布。
3. 对需要再执行的动作，应依赖 `idempotency_key` 和 artifact existence 做幂等保护。

## 19.10 Code Executor 恢复细则

### 19.10.1 优先恢复项

- 已存在的隔离 worktree
- 最近成功 patch artifact
- 最近成功 test result
- 最近一次失败日志

### 19.10.2 降级恢复项

若 worktree 不可恢复，可执行以下降级：

1. 从 `base_commit_hash` 重新准备 worktree。
2. 重新应用最近成功 patch artifact。
3. 重新执行必要验证。

### 19.10.3 失败转移

若执行恢复失败：

- 可进入 `blocked`，等待管理员修复仓库或环境。
- 若超出恢复预算，转 `failed`。

## 19.11 审计要求

以下动作必须写审计：

- `checkpoint.created` — checkpoint 创建
- `checkpoint.resumed` — checkpoint 恢复
- `checkpoint.hash_mismatch` — snapshot hash 不一致导致拒绝恢复
- `replay.started` — replay 启动
- replay 模式与范围

## 19.12 Day 1 验证用例

1. Workflow 在 `waiting_user` 前成功落 checkpoint，并能在用户回复后继续。
2. Code Executor 在 patch 已产出、测试未完成时中断，恢复后能继续验证。
3. `policy_snapshot_hash` 被篡改后，恢复被拒绝。
4. replay 能还原某次检索的 `retrieval_trace` 与 `evidence_pack_hash`。
5. 同一个 `resume_token` 连续调用两次，不会产生重复事实写入。
