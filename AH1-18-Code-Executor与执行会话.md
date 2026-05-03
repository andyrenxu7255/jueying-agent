# 文档 18：Code Executor Adapter 与执行会话设计 v1.0

## 18.1 文档目的

本文件把《Code Executor Integration Spec V1》进一步落到可实施的执行会话与 Adapter 设计上，重点回答：

- 平台如何创建开发执行会话。
- 代码仓、分支、worktree 如何隔离。
- 进度、patch、测试、修复、checkpoint 如何回写。
- 哪些开源项目适合作为 backend 候选。

## 18.2 总体定位

Code Executor 是 Workflow 的阶段内执行器，不是平台总控。它只负责：

- 读取阶段目标与上下文
- 规划局部实现动作
- 修改代码
- 运行验证
- 基于失败证据修复
- 回写 patch、artifact、checkpoint、验证结果

它不负责：

- 决定 Workflow 是否继续
- 决定公共发布
- 决定跨阶段调度
- 决定跨用户资源访问

## 18.3 Day 1 backend 策略

### 18.3.1 推荐顺序

1. 主 backend：基于 `opencode` 设计思路做 TypeScript 薄适配。
2. 备选 backend：把 `claw-code` 当独立 CLI backend 接入。
3. 实验 backend：参考 Hermes 的 `code_execution_tool.py` 进行脚本化执行，不进入主链路。

### 18.3.2 选择理由

- `opencode` 与平台主栈更容易统一契约、patch、tool surface 与 server event。
- `claw-code` 适合做隔离更强的外部执行 backend，但 Day 1 不宜引入额外 Rust 集成复杂度。
- Hermes 更适合提供执行经验与 checkpoint 模式参考，不适合作为主执行内核。

## 18.4 执行会话对象模型

### 18.4.1 ExecutionSession 最小结构

```json
{
  "execution_session_id": "exec_123",
  "workflow_instance_id": "wf_123",
  "workflow_stage_id": "st_123",
  "owner_user_id": "u_123",
  "backend_type": "opencode-adapter",
  "status": "created",
  "repo_ref": "repo://agent-harness/main",
  "base_commit_hash": "abc123",
  "branch_ref": "main",
  "worktree_ref": null,
  "stage_goal": "实现 retrieval trace 表与查询接口",
  "acceptance_rules": [],
  "policy_snapshot_hash": "sha256:...",
  "budget": {
    "max_turns": 20,
    "max_repairs": 3,
    "hard_timeout_sec": 1800
  },
  "checkpoint_id": null
}
```

### 18.4.2 状态集合

- `created`
- `preparing`
- `ready`
- `running`
- `verifying`
- `repairing`
- `waiting_workflow`
- `completed`
- `failed`
- `terminated`

## 18.5 Repo / Branch / Worktree 模型

### 18.5.1 基本规则

1. 一个 `execution_session` 只绑定一个 `repo_ref`。
2. 一个 `workflow_stage` 最多同时有一个活动执行会话。
3. Day 1 必须支持 worktree 隔离，避免多个执行会话污染同一工作目录。

### 18.5.2 推荐分支策略

- 基础分支：`base_branch = main` 或用户指定分支
- 执行分支：`wf/<workflow_id>/st/<seq>`
- 若平台不自动创建 git 提交，则至少保留 worktree 与 patch artifact

### 18.5.3 推荐 worktree 路径策略

```text
<executor_root>/worktrees/<workflow_id>/<stage_seq>/
```

说明：

- worktree 生命周期绑定到执行会话。
- 归档后按保留策略清理。

## 18.6 Adapter 操作面

### 18.6.1 创建会话

输入：

- `workflow_instance_id`
- `workflow_stage_id`
- `repo_ref`
- `branch_ref`
- `stage_goal`
- `acceptance_rules`
- `budget`
- `policy_snapshot_hash`

输出：

- `execution_session_id`
- `backend_type`
- `prepared_worktree_ref`
- `status`

### 18.6.2 启动执行

输入：

- `execution_session_id`
- `stage_goal`
- `evidence_pack_ref`
- `constraints`
- `checkpoint_ref` 可选

输出：

- `run_ref`
- 持续流式 `progress_events`

### 18.6.3 请求验证

输入：

- `execution_session_id`
- `verification_rules`
- `test_commands`

输出：

- `verification_refs`
- `PASS | FAIL | PARTIAL`
- `failure_summary`

### 18.6.4 请求修复

输入：

- `execution_session_id`
- `failure_refs`
- `remaining_budget`

输出：

- `repair_attempt_ref`
- 新的 `progress_events`

### 18.6.5 终止与清理

输入：

- `execution_session_id`
- `reason`

输出：

- `status = terminated`
- `cleanup_result`

## 18.7 标准执行循环

1. Workflow 把 `Implementation` 或 `Repair` 阶段派发给 Code Executor。
2. Adapter 解析 `repo_ref`、`branch_ref`、`policy_snapshot_hash`。
3. 准备隔离 worktree。
4. 拉取最小必要上下文：规格、Evidence Pack、当前代码片段、已有 checkpoint。
5. 生成局部实现计划。
6. 修改文件。
7. 产出 patch/diff artifact。
8. 运行测试或验证命令。
9. 若失败，记录失败证据并进入小步修复。
10. 达到阶段验收后回写结果并交还 Workflow。

## 18.8 Executor 智能调度策略

### 问题

4C16G 单机 Code Executor 仅有 4 个并行槽位，20 并发 Workflow 中开发任务可能超过 4 个。

### 调度策略

| 策略 | 说明 |
|------|------|
| 优先级调度 | 开发任务 > 分析任务 > 知识查询，高优先级先执行 |
| 预估时长排序 | 短任务优先（SJE），减少平均等待时间 |
| 资源感知 | 根据当前 CPU/内存负载动态调整并发数 |
| 非开发任务绕行 | 知识查询/分析任务不经过 Code Executor，走 generic-executor |

### 调度实现

```typescript
interface ExecutorScheduler {
  schedule(request: ExecutionRequest): ScheduleDecision;
}

interface ExecutionRequest {
  workflow_instance_id: string;
  stage_type: string;
  priority: "high" | "medium" | "low";
  estimated_duration_sec: number;
  resource_weight: number;
}

type ScheduleDecision =
  | { action: "execute_immediately"; slot_id: string }
  | { action: "queue"; position: number; estimated_wait_sec: number }
  | { action: "redirect"; target_executor: string; reason: string };

class ExecutorSchedulerImpl implements ExecutorScheduler {
  private maxSlots = 4;
  private activeSlots = new Map<string, ExecutionRequest>();

  schedule(request: ExecutionRequest): ScheduleDecision {
    if (request.stage_type !== "Implementation" && 
        request.stage_type !== "Repair") {
      return {
        action: "redirect",
        target_executor: "generic-executor",
        reason: "Non-development task does not require Code Executor"
      };
    }

    if (this.activeSlots.size < this.maxSlots) {
      const slotId = `slot_${this.activeSlots.size + 1}`;
      this.activeSlots.set(slotId, request);
      return { action: "execute_immediately", slot_id: slotId };
    }

    const position = this.estimateQueuePosition(request);
    const waitSec = this.estimateWaitTime(position);
    return { action: "queue", position, estimated_wait_sec: waitSec };
  }

  private estimateQueuePosition(request: ExecutionRequest): number {
    return 1;
  }

  private estimateWaitTime(position: number): number {
    return position * 300;
  }
}
```

### 20 并发场景分析

| 场景 | 开发任务数 | Code Executor 槽位 | 其他任务 | 处理方式 |
|------|-----------|-------------------|----------|----------|
| 典型工作日 | 3-4 | 4 足够 | 16-17 | generic-executor 处理 |
| 开发高峰 | 6-8 | 4 执行 + 2-4 排队 | 12-14 | 排队 < 30s |
| 极端情况 | 10+ | 4 执行 + 6+ 排队 | < 10 | 排队可能 > 1min，触发告警 |

### 排队超限处理

| 等待时间 | 处理方式 |
|----------|----------|
| < 30s | 正常排队 |
| 30s - 2min | 发送进度通知："正在等待执行资源" |
| > 2min | 触发告警，建议用户稍后重试 |
| > 5min | Workflow 进入 `blocked`，等待管理员处理 |

## 18.9 必须回写的对象

以下 artifact 名称应与《文档 22》保持一致。

### 18.9.1 Progress Event

每次显著进度都应回写：

- `summary`
- `changed_files`
- `remaining_budget`
- `next_step`

### 18.9.2 Artifact

必须至少支持以下 artifact：

- `patch`
- `test_result`
- `command_log`
- `verification_report`
- `error_log`
- `checkpoint_payload`

### 18.9.3 Fact / Stage 输出

阶段完成时至少回写：

- `modified_file_list`
- `patch_refs`
- `test_result_refs`
- `verification_result`
- `checkpoint_id`

## 18.10 验证规则

### 18.10.1 验证输入

- 测试命令
- 断言列表
- 文件级验收规则
- 代码风格/静态检查规则

### 18.10.2 验证输出

```json
{
  "result": "PASS",
  "failed_assertions": [],
  "verification_refs": ["art_123"],
  "auto_repair_allowed": true
}
```

### 18.10.3 自动修复边界

- 仅允许基于已记录失败证据修复。
- 每次修复必须小步进行。
- 达到 `max_repairs` 后必须交回 Workflow，不能无限修。

## 18.11 安全与策略绑定

1. 执行会话创建时必须绑定 `policy_snapshot_hash`。
2. 任何代码上下文读取都只能读取当前授权仓库与工作目录。
3. 任何外部命令执行都要进入审计与 artifact 留痕。
4. 若执行 backend 需要额外权限，必须显式经过 Workflow 阶段策略放行。

## 18.12 与 Git 的边界

Day 1 推荐分两层能力：

- 必需层：读取、修改、生成 patch、查看状态、运行测试。
- 可选层：提交、开分支、worktree 管理、PR 辅助。

Day 1 冻结实现选择：

- 默认不执行自动提交、自动推送、自动 PR 创建。
- 默认启用 worktree 隔离。
- 如需启用“可选层”能力，必须在 Workflow 阶段策略中显式放行，并留审计。

说明：

- 平台不要求 Day 1 自动提交代码。
- 若用户没有授权仓库写入，Code Executor 仍应能输出 patch artifact。

## 18.13 与 Workflow 的边界再确认

Workflow 决定：

- 是否进入开发分支
- 阶段目标是什么
- 是否继续修复
- 是否等待用户
- 是否失败终止

Code Executor 决定：

- 如何阅读代码
- 如何局部规划实现
- 如何组织 patch 与测试顺序
- 如何在预算内完成修复循环

## 18.14 长任务上下文隔离技术手段

### 18.14.1 隔离目标

Code Executor 的长任务执行必须与 OpenClaw 主上下文完全隔离，避免 OpenClaw 混乱的上下文影响开发工作。

### 18.14.2 隔离层级

| 隔离层 | 手段 | 说明 |
|--------|------|------|
| 文件系统 | Git Worktree | 每个执行会话独立工作目录 |
| 上下文窗口 | Subagent 独立上下文 | 不共享 OpenClaw 主上下文 |
| 网络 | 无网络隔离（Day 1） | 依赖权限策略控制 |
| 进程 | 独立进程/容器 | 执行命令在隔离环境中运行 |

### 18.14.3 上下文窗口隔离

```
┌──────────────────────────────────────────────────────┐
│ OpenClaw 主上下文（全局共享）                          │
│ - 渠道消息历史                                        │
│ - 用户身份信息                                        │
│ - 会话状态                                            │
└──────────────────────────────────────────────────────┘
                    │ 只传递阶段契约
                    ▼
┌──────────────────────────────────────────────────────┐
│ Code Executor 上下文（独立隔离）                       │
│ - 阶段目标 + 验收条件                                 │
│ - Evidence Pack（精准检索结果）                        │
│ - 代码文件内容（按需读取）                             │
│ - 最近 3 轮工具交互                                    │
│ - 历史交互摘要（压缩后）                               │
└──────────────────────────────────────────────────────┘
```

### 18.14.4 上下文窗口管理策略

| 策略 | 触发条件 | 动作 |
|------|----------|------|
| 保留 | 始终 | 任务描述 + 验收条件 + 最近 3 轮交互 |
| 按需加载 | 读取文件时 | 只加载当前需要的文件片段，不预加载整个仓库 |
| 压缩 | 上下文使用 > 60% | 对历史交互生成摘要，替换原文 |
| 丢弃 | 上下文使用 > 80% | 丢弃重复/无关的工具输出 |
| 强制截断 | 上下文使用 > 95% | 保留任务描述+最新交互，截断其余 |

### 18.14.5 代码上下文按需加载

```json
{
  "context_loading": {
    "strategy": "on_demand",
    "max_files_in_context": 20,
    "max_lines_per_file": 200,
    "priority_order": [
      "stage_goal_related_files",
      "recently_modified_files",
      "test_files",
      "config_files",
      "dependency_files"
    ],
    "excluded_patterns": [
      "node_modules/**",
      ".git/**",
      "dist/**",
      "*.lock",
      "*.min.*"
    ]
  }
}
```

### 18.14.6 与 OpenClaw 上下文的边界

| 场景 | OpenClaw 上下文 | Code Executor 上下文 |
|------|-----------------|---------------------|
| 用户消息 | ✅ 接收并解析 | ❌ 只接收阶段契约 |
| 检索结果 | ❌ 不进入主上下文 | ✅ Evidence Pack 进入 |
| 代码内容 | ❌ 不进入主上下文 | ✅ 按需加载 |
| 工具调用 | ❌ 不在主上下文执行 | ✅ 在隔离环境执行 |
| 执行结果 | ✅ 接收结构化回写 | ✅ 发送结构化回写 |

### 18.14.7 Evidence Pack 缓存策略

#### 缓存目的

Evidence Pack 是检索阶段产出的结构化证据集合，包含多源检索结果。为避免重复检索和减少数据库压力，Code Executor 在读取 Evidence Pack 时应使用缓存策略。

#### 缓存架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Code Executor                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 请求 Evidence Pack                                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 1. 检查本地内存缓存 (LRU, max=10)                             ││
│  │    hit → 直接返回                                            ││
│  │    miss → 继续                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 2. 检查 Redis 缓存 (TTL=10min)                               ││
│  │    hit → 写入本地缓存，返回                                   ││
│  │    miss → 继续                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 3. 从 PostgreSQL 读取                                        ││
│  │    - 验证 policy_snapshot_hash 权限                          ││
│  │    - 读取 evidence_pack 表                                   ││
│  │    - 写入 Redis 缓存                                         ││
│  │    - 写入本地缓存                                            ││
│  │    - 返回                                                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### 缓存 Key 设计

```
Redis Key: evidence_pack:{workflow_instance_id}:{stage_seq}:{evidence_pack_hash}
Local Key: {workflow_stage_id}:{evidence_pack_hash}
```

#### 缓存配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 本地缓存大小 | 10 个 | 每个 Code Executor 进程最多缓存 10 个 Evidence Pack |
| 本地缓存淘汰 | LRU | 最近最少使用淘汰 |
| Redis TTL | 10 分钟 | Evidence Pack 在 Redis 中缓存 10 分钟 |
| Redis 最大内存 | 100MB | Evidence Pack 缓存专用内存配额 |

#### 缓存失效条件

| 条件 | 失效动作 | 说明 |
|------|----------|------|
| Evidence Pack 更新 | 删除 Redis + 本地缓存 | 新的检索结果产生时 |
| Workflow 状态变更 | 删除该 Workflow 所有缓存 | 进入新阶段或终态时 |
| policy_snapshot_hash 变更 | 拒绝缓存命中 | 权限变化时必须重新读取 |
| 缓存 TTL 到期 | Redis 自动删除 | 10 分钟后自动失效 |

#### 权限校验规则

缓存命中时仍需校验权限：

```typescript
async function getEvidencePack(
    workflowStageId: string,
    evidencePackHash: string,
    policySnapshotHash: string
): Promise<EvidencePack> {
    // 1. 尝试从缓存获取
    const cached = await this.cache.get(workflowStageId, evidencePackHash);
    
    if (cached) {
        // 2. 缓存命中时，仍需校验权限
        const stage = await this.getWorkflowStage(workflowStageId);
        if (stage.policy_snapshot_hash !== policySnapshotHash) {
            // 权限变更，缓存失效，重新读取
            return await this.loadFromDatabase(workflowStageId, evidencePackHash, policySnapshotHash);
        }
        return cached;
    }
    
    // 3. 缓存未命中，从数据库读取
    return await this.loadFromDatabase(workflowStageId, evidencePackHash, policySnapshotHash);
}
```

#### 缓存监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| `evidence_pack_cache_hit_rate` | 缓存命中率 | < 50% |
| `evidence_pack_cache_memory_bytes` | 缓存内存使用 | > 80MB |
| `evidence_pack_load_duration_ms` | 加载耗时 | p95 > 500ms |
| `evidence_pack_cache_invalidation_count` | 缓存失效次数 | > 100/min |

#### 缓存降级策略

| 场景 | 降级动作 | 影响 |
|------|----------|------|
| Redis 不可用 | 只使用本地缓存 | 缓存命中率下降 |
| 本地缓存满 | LRU 淘汰 | 老数据被淘汰 |
| 数据库读取超时 | 返回错误，不使用缓存 | 每次都从数据库读取 |
| 缓存内存超限 | 清空本地缓存 | 缓存命中率归零 |

#### 缓存预热

对于高优先级 Workflow，可在阶段开始前预热缓存：

```typescript
async function preheatEvidencePack(
    workflowInstanceId: string,
    stageSeq: number
): Promise<void> {
    // 1. 预测下一阶段可能需要的 Evidence Pack
    const predictedPack = await this.predictEvidencePack(workflowInstanceId, stageSeq);
    
    // 2. 提前加载到 Redis
    await this.cache.set(predictedPack.key, predictedPack.data, { ttl: 600 });
    
    // 3. 记录预热事件
    this.metrics.increment('evidence_pack_preheat_count');
}
```

## 18.15 Day 1 contract test 清单

1. 创建执行会话成功并生成 worktree。
2. 会话可回写 patch、日志、测试结果。
3. 验证失败时可进入修复循环。
4. 超过修复次数后正确返回 Workflow。
5. 会话恢复时可以从 checkpoint 继续，而不是从头重跑。
6. 未携带有效 `policy_snapshot_hash` 时执行被拒绝。
