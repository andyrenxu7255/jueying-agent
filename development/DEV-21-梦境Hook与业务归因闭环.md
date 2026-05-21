# DEV-21 梦境 Hook 与业务归因闭环

## 背景

Claude / Hermes 的新口径把梦境与 hook 从“辅助能力”推进到生命周期治理层：

1. Claude Managed Agents 的 Dream 是独立异步过程，用于在任务之间重整记忆；不会与正在执行的任务并发运行，完成后会保存并替换旧记忆。
2. Claude Code Hook 已覆盖工具前/后、通知、停止、子代理停止、用户提示提交、会话启动、会话结束、压缩前后等生命周期点；新 Hook 还支持输出 JSON 决策、HTTP endpoint 和 agent hook。
3. Claude 的 outcomes 把“任务成功”显式化为可评估目标，是后续 skill/知识归因的评分锚点。
4. Hermes Agent 的内存是固定容量滚动记忆，会在会话启动时注入上下文；容量满时需要调用模型合并与压缩，hook 机制分为全局、项目、代理三层。

JueYing 已有梦境模式、技能审核和记忆压缩，但缺少“召回了什么 -> 是否注入上下文 -> 是否带来好结果”的归因链。

## 联网资料要点

| 来源 | 要点 | 对 JueYing 的设计含义 |
|---|---|---|
| Claude Managed Agents Dream | Dream 是异步记忆整理，目标是整合任务反馈、补齐推断、巩固记忆，不与任务并发执行 | 保持低峰批处理，不进入用户请求同步链路 |
| Claude Code Hooks | Hook 覆盖 session、tool、subagent、notification、stop、compact 等事件；可返回 JSON 决策，也可由 HTTP endpoint/agent hook 执行 | JueYing 先做旁路事件账本，避免 hook 失败阻断主流程 |
| Claude outcomes | outcome 是 agent 目标定义和后续评估口径 | 业务结果必须落表，作为召回贡献归因的锚点 |
| Hermes Agent Memory / Hooks | memory 启动注入、容量上限、自动合并；hooks 分 global/project/agent 三层 | JueYing 需要同时记录 memory/fact/skill 的召回与注入来源 |

## 本轮升级目标

1. 修复梦境调度器的字段与时间窗口问题。
2. 增加 hook-style 事件账本。
3. 增加知识与 skill 召回账本。
4. 增加 workflow outcome 评分与归因表。
5. 在 Web Portal 展示 30 天内 skill / 知识的业务效果。
6. 更新上下文图谱，让 dream/hook/outcome 成为明确领域。

## 数据库新增

迁移文件：`agent-harness/db/migrations/026_recall_outcome_attribution.sql`

新增表：

- `hook_event_log`
- `knowledge_recall_event`
- `skill_recall_event`
- `workflow_outcome_eval`
- `recall_outcome_attribution`

新增视图：

- `skill_business_outcome_daily`
- `knowledge_business_outcome_daily`

## 事件口径

推荐事件名：

- `memory.recalled`
- `fact.recalled`
- `skill.recalled`
- `skill.injected`
- `skill.audit.completed`
- `skill.promoted`
- `workflow.confirmed`
- `outcome.evaluated`
- `dream.completed`

事件写入必须旁路化，失败不阻断主链路。

## 代码落点

| 模块 | 改动 |
|---|---|
| `libs/shared/src/db/attribution.ts` | 统一归因写入工具 |
| `services/hermes-adapter/src/index.ts` | 记忆召回、技能搜索、梦境完成事件 |
| `services/fact-retrieval/src/index.ts` | Evidence Pack 召回归因 |
| `services/workflow/src/persistence/db.ts` | Workflow outcome 评分与归因 |
| `services/executor-gateway/src/index.ts` | 透传 org/stage 检索上下文 |
| `services/skill-library/src/index.ts` | 技能审核/提升 hook 事件 |
| `apps/web-portal/src/index.ts` | 管理端归因 API 与梦境调度修复 |
| `apps/web-portal/static/app.js` | 梦境页展示归因结果 |

## 已修复问题

1. Web Portal 梦境调度器调用个人梦境时传 `user_id`，Hermes 端点实际需要 `owner_user_id`。
2. 组织梦境分析判断在 `currentMinute < 5` 分支内再检查 `currentMinute >= 55`，导致永远不会运行。
3. 2 分钟调度窗口会在同一小时重复触发，本轮加入按天/小时去重 key。
4. 梦境配置读取错误地调用不存在的 `/internal/query`，改为 Web Portal 直查数据库。
5. Workflow 成功、失败、取消都会写入 outcome，避免归因看板只统计成功样本。

## 验收关注点

1. `npm run type-check`
2. `npm test`
3. `npm run test:dream-mode`
4. 管理端「梦境模式/记忆分析」能看到归因区域。
5. 成功、失败、取消 workflow 后 `workflow_outcome_eval` 有记录，且 `recall_outcome_attribution` 能关联到对应召回事件。

## 后续建议

1. 引入独立 LLM grader，把 heuristic outcome 评分升级为 rubric 评分。
2. 将低贡献 skill 自动打上 `needs_revision`，进入技能审核队列。
3. 为 hook_event_log 增加保留策略，超过热数据周期归档到 artifact/object storage。
