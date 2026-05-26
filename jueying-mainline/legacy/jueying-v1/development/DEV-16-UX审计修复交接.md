# DEV-16 UX审计修复交接

更新时间: 2026-05-02
范围: M1/M2/M3 主链路 + Web Portal 管理视图 + app-graph 同步

## 1. 本轮完成项

### 1.1 图谱先行同步

- 更新 `development/app-graph/hotpaths.json`
  - 对齐 M1/M3 关键边 evidence 行号
- 更新 `development/app-graph/edge-confidence.json`
  - 对齐 A 级边 evidence 行号
- 更新 `development/app-graph/diagnostic-queries.md`
  - 对齐 DQ-01 / DQ-02 / DQ-04 行号
  - 为 DQ-07 增加 retrieval_trace 字段投影检查
- 更新 `development/app-graph/incident-response-mapping.json`
  - IR-007 增补 `result_summary.item_count` 核查项
- 更新 `development/app-graph/graph-changelog.md`
  - 追加 v1.7 变更记录

### 1.2 M1 修复（接入/受理/记忆/进度）

文件: `agent-harness/apps/gateway-adapter/src/index.ts`

- 修复任务“假受理”:
  - 新增 `plan.ok` / `dispatch.ok` 失败分支
  - 失败时返回可行动文案，不再统一返回成功受理
- 修复多轮上下文静默降级:
  - `recallContext` 返回 `{ context, degraded, reason }`
  - recall 降级时在用户回复前附加提示
- 修复记忆写入静默失败:
  - memory persist 非 2xx 和异常写 warn 日志
- 增加任务中间进度可感知:
  - Feishu/WeCom 轮询期间在关键状态变化时推送最多 3 次进度消息

### 1.3 M2 修复（检索错误语义/管理台可观测）

文件:
- `agent-harness/services/executor-gateway/src/executor/retrieval-aware-executor.ts`
- `agent-harness/apps/web-portal/src/index.ts`

- 检索失败错误细化:
  - 优先返回 `retrieval_query_http_<status>`
  - 其次返回降级原因首项
- 管理台 retrieval traces 修复:
  - 由不存在的 `items_count` 物理列改为 `result_summary->>'item_count'` 投影

### 1.4 M3 修复（回调可靠性/完成守卫）

文件:
- `agent-harness/services/executor-gateway/src/index.ts`
- `agent-harness/services/workflow/src/index.ts`

- 增加 workflow 回调重试:
  - 新增 `postWorkflowWithRetry`（默认 3 次，500ms 递增退避）
  - stage dispatch / workflow complete 全部通过重试调用
- 增加 completion 状态守卫:
  - 若存在未决 stage，则拒绝 complete（409）
  - 写入 `workflow.complete.rejected` 审计事件

### 1.5 Hermes 端点一致性修复

文件: `agent-harness/services/hermes-adapter/src/index.ts`

- 将持久化事实端点从 `/internal/facts` 修正为 `/internal/facts/write`
- 非 2xx 增加明确告警日志

## 2. 自检结果

### 2.1 通过

- `npm run type-check --workspace @agent-harness/executor-gateway`
- `npm run type-check --workspace @agent-harness/workflow-service`
- `npm run type-check --workspace @agent-harness/hermes-adapter`

### 2.2 受历史环境问题影响（非本轮引入）

- `npm run type-check --workspace @agent-harness/gateway-adapter`
  - 失败: `Cannot find module 'officeparser'`
- 全量 `npm run type-check` 仍包含既有依赖缺失问题（如 web-portal/fact-retrieval 的 redis 类型依赖）

## 3. 回归建议（按图谱）

- RC-001-gateway-ingress
- RC-005-memory-continuity
- RC-003-executor-callback
- RC-002-workflow-core
- RC-004-retrieval-data-layer

## 4. 风险与后续

- 任务进度推送为“状态变化触发 + 上限 3 次”，若需要更强实时性可改为阶段事件驱动推送。
- completion 守卫会把部分“模糊完成”转为显式 409，前端/机器人若依赖旧行为需同步处理该错误码。
- 建议下一轮补充自动化回归：
  - `workflow_not_ready_to_complete` 场景测试
  - retrieval traces SQL 投影字段测试
