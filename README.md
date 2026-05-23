# JueYing (绝影) Agent

> 企业级 AI Agent 编排、记忆、工作流与业务结果归因平台。
>
> 当前发布线：v1.6.2 | 更新日期：2026-05-22

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./agent-harness/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker)](https://docs.docker.com/compose/)

JueYing 把企业聊天入口、知识库、工作流、记忆系统和可复用 skill 统一成一套可治理的 Agent 平台。用户可以从飞书、企业微信或 Web Portal 发起请求；系统会检索受权限约束的上下文，优先复用已批准的 `workflow_definition`，再回退到已激活的 workflow 型 skill 模板，必要时自动首跑规划，执行阶段任务，记录审计证据，并把好的业务结果归因回真正起作用的知识和 skill。

“绝影”取快速、可靠、可驾驭之意。在这个项目里，它代表一套让团队从自然语言请求走到可验证结果的 Agent Harness。

## 本版为什么重要

v1.6.2 发布线以 **Dream Hooks, Outcome Attribution, Workflow Reviews, Bilingual UX, and Audit Hardening** 为主题。它延续 v1.6.0 的业务结果归因闭环，补齐 v1.6.1 的中英文双语体验，并在本轮完成依赖、图谱、文档和前端安全渲染审计收口。

| 能力 | 这次补齐了什么 |
|---|---|
| 梦境机制 | 低峰期记忆整理不再只是压缩，而是进入运营闭环。 |
| Hook 账本 | 记录 memory/fact/skill 召回、skill 注入、workflow outcome、dream 完成等生命周期事件。 |
| 召回归因 | 知识和 skill 的召回会关联到后续 workflow 结果，能回答“哪些内容带来了好结果”。 |
| Outcome 评估 | 成功、失败、取消的 workflow 都写终态结果，避免只统计成功样本。 |
| 管理端看板 | Web Portal 增加 30 天知识与 skill 业务效果视图。 |
| 契约固化 | 高频、高评分、被真实注入且业务结果良好的 workflow 型 skill 会进入 workflow_definition 候审，管理员批准后成为 Planner 优先使用的执行契约。 |
| 图谱同步 | development context graph 已把 dream、hook、outcome 和 workflow_definition review 作为明确架构域。 |

## 核心亮点

- 多渠道入口：飞书长连接、企业微信 Webhook、Web Portal、移动端推送。
- 复用优先：已批准 `workflow_definition` 优先，其次复用个人私有、组织、公共 active workflow 型 skill 模板，未命中时再首跑规划。
- 受治理的检索：PostgreSQL 是唯一事实源，向量只提候选，图门控收口，Evidence Pack 可追溯。
- 梦境与记忆系统：用户级记忆隔离、管理员级汇总分析、组织级知识整合。
- Skill 生命周期：搜索、召回、注入、审核、归因；高频高贡献 workflow 型 skill 会进入 `workflow_definition_review`，管理员批准后固化为 `workflow_definition`。
- B2B 销售样板：晨会、卡单救援、折扣审批、回款风险、周复盘等日常管理路径。
- 企业控制面：组织隔离、RBAC/ABAC、审计、Checkpoint/Resume/Replay、生产密码加固。
- 可观测运营：OpenTelemetry、SigNoz、结构化日志、健康检查、归因看板。

## 仓库结构

```text
.
├── agent-harness/              # 可运行 TypeScript monorepo
│   ├── apps/                   # gateway-adapter, web-portal, mobile-app
│   ├── services/               # workflow, retrieval, executor, hermes, skills
│   ├── libs/                   # contracts, shared DB/config/logging, policy, audit
│   ├── db/migrations/          # SQL migrations
│   ├── scripts/                # bootstrap, health, migration, smoke helpers
│   └── tests/                  # unit and integration tests
├── development/                # 执行计划、图谱、审计、专题实现说明
├── AH1-*.md                    # 架构与实施权威文档
├── RELEASE_NOTES.md            # 当前版本发布说明
└── README.md                   # GitHub 默认入口
```

## 快速开始

```bash
git clone https://github.com/andyrenxu7255/jueying-agent.git
cd jueying-agent/agent-harness
npm install
cp .env.example .env
npm run docker:core:up
npm run db:migrate
npm run docker:up -- --profile app
```

启动后访问：

| 界面 | 地址 |
|---|---|
| Web Portal | http://localhost:3003 |
| LiteLLM Dashboard | http://localhost:4000/ui |
| SigNoz | http://localhost:3301 |
| MinIO Console | http://localhost:9001 |

生产环境请使用 `docker-compose.prod.yml`，并通过环境变量提供所有密钥。不要在生产环境使用本地开发密码。

## 验证记录

v1.6.2 发布线已执行：

```bash
npm run lint
npm run type-check
npm run build
npm test
npm run context:audit
npm audit --audit-level=moderate
```

结果：lint、类型检查、构建、8 个 Jest 测试套件 / 82 个用例、M1/M2/M3 图谱门控均通过；依赖审计 0 个漏洞。

## 文档总索引

| 入口 | 内容 |
|---|---|
| [agent-harness/README.md](./agent-harness/README.md) | 应用级快速开始、架构、端口、工作流和开发命令。 |
| [agent-harness/PRODUCT.md](./agent-harness/PRODUCT.md) | 产品说明、角色、功能矩阵和用户价值。 |
| [agent-harness/OPS.md](./agent-harness/OPS.md) | 部署、健康检查、监控、备份和运维手册。 |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | v1.6.2 发布说明，可直接用于 GitHub Release。 |
| [development/HANDOFF-2026-05-22-i18n.md](./development/HANDOFF-2026-05-22-i18n.md) | 双语化交接、关键文件和已知限制。 |
| [development/SYSTEM-AUDIT-2026-05-22-COMPREHENSIVE.md](./development/SYSTEM-AUDIT-2026-05-22-COMPREHENSIVE.md) | 本轮文档、图谱、架构、代码与安全审计记录。 |
| [development/DEV-21-梦境Hook与业务归因闭环.md](./development/DEV-21-梦境Hook与业务归因闭环.md) | 梦境、Hook、召回和 Outcome 归因实现说明。 |
| [development/SYSTEM-AUDIT-2026-05-21-DREAM-HOOK.md](./development/SYSTEM-AUDIT-2026-05-21-DREAM-HOOK.md) | 梦境 Hook 归因专项审计。 |
| [development/DEV-00-开发索引.md](./development/DEV-00-开发索引.md) | 开发计划索引和里程碑地图。 |
| [development/context-graph.json](./development/context-graph.json) | 机器可读上下文图谱，当前 v2.11。 |
| [development/context-routing.json](./development/context-routing.json) | 任务路由配置，和上下文图谱同步。 |

### AH1 权威文档

AH1 系列仍是架构和实现约束的权威文档。常用入口：

| 文档 | 主题 |
|---|---|
| [AH1-17-Workflow-DSL与Planner契约.md](./AH1-17-Workflow-DSL与Planner契约.md) | Workflow DSL、Planner 契约、生命周期与 skill 提取。 |
| [AH1-20-检索编排与Fact-Write.md](./AH1-20-检索编排与Fact-Write.md) | 检索编排、图门控、Evidence Pack 与事实写入。 |
| [AH1-23-审计日志指标与告警.md](./AH1-23-审计日志指标与告警.md) | 审计、指标、Dashboard 与梦境 Hook 归因视图。 |
| [AH1-14-数据库表设计与索引.md](./AH1-14-数据库表设计与索引.md) | PostgreSQL schema 权威说明与迁移地图。 |
| [AH1-27-部署与运维.md](./AH1-27-部署与运维.md) | 部署和运维架构。 |

## 当前发布：v1.6.2

本次发布补齐 memory/skill recall 到真实业务结果之间的反馈链：

- `hook_event_log`：生命周期事件。
- `knowledge_recall_event` 与 `skill_recall_event`：召回与注入追踪。
- `workflow_outcome_eval`：workflow 终态业务评分。
- `recall_outcome_attribution`：召回事件到 outcome 的贡献归因。
- `skill_business_outcome_daily` 与 `knowledge_business_outcome_daily`：日级报表视图。

Skill 是可召回、可注入的能力资产；workflow 是多阶段执行契约。当前实现里，成功路径会先提取为 `skill_type=workflow` 的 draft skill，用户确认后变为 private active 模板；当它多次被召回、注入并取得良好 outcome，skill-library 会提交 `workflow_definition_review`，管理员批准后固化为 `workflow_definition`，之后 Planner 会优先使用这个更稳定的执行契约。

v1.6.2 额外完成发布前硬化：前端动态属性输出统一转义，敏感本地文件加入 `.gitignore` 防误提交，npm 传递依赖漏洞清零，发布入口和上下文图谱同步到双语化后的真实文件结构。

详见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。

## License

JueYing 使用 MIT License。详见 [agent-harness/LICENSE](./agent-harness/LICENSE) 和 [agent-harness/LICENSES.md](./agent-harness/LICENSES.md)。

---

## English Version / 英文版

# JueYing (绝影) Agent

> Enterprise-grade AI Agent orchestration, memory, workflow, and business outcome attribution platform.
>
> Current release line: v1.6.2 | Updated: 2026-05-22

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./agent-harness/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker)](https://docs.docker.com/compose/)

JueYing unifies enterprise chat entry points, knowledge bases, workflows, memory systems, and reusable skills into a governable Agent platform. Users can initiate requests from Feishu, WeCom, or the Web Portal; the system retrieves permission-constrained context, prioritizes approved `workflow_definition` records, falls back to active workflow-type skill templates, auto-runs first-time planning when necessary, executes stage tasks, records audit evidence, and attributes good business outcomes back to the knowledge and skills that really worked.

"JueYing" (绝影) means fast, reliable, and steerable. In this project, it represents an Agent Harness that takes a team from natural language requests to verifiable results.

## Why This Release Matters

The v1.6.2 release line is themed around **Dream Hooks, Outcome Attribution, Workflow Reviews, Bilingual UX, and Audit Hardening**. It continues the v1.6.0 business-outcome attribution loop, completes the v1.6.1 Chinese/English experience, and closes this round of dependency, graph, documentation, and frontend rendering security audit work.

| Capability | What Was Added |
|---|---|
| Dream Mode | Off-peak memory consolidation is no longer just compression — it enters the operational feedback loop. |
| Hook Ledger | Records lifecycle events such as memory/fact/skill recall, skill injection, workflow outcome, and dream completion. |
| Recall Attribution | Knowledge and skill recalls are linked to subsequent workflow results, answering "which content led to good outcomes." |
| Outcome Evaluation | Successful, failed, and cancelled workflows all record terminal state results, avoiding sampling bias toward successes only. |
| Admin Dashboard | Web Portal adds 30-day knowledge and skill business effectiveness views. |
| Contract Solidification | High-frequency, high-scoring, genuinely injected workflow-type skills with good business outcomes enter `workflow_definition` review; upon admin approval they become execution contracts that the Planner prioritizes. |
| Graph Sync | The development context graph has incorporated dream, hook, outcome, and workflow_definition review as explicit architectural domains. |

## Core Highlights

- Multi-channel entry: Feishu long-connection, WeCom Webhook, Web Portal, mobile push.
- Reuse-first: Approved `workflow_definition` takes priority, then personal private / org / public active workflow-type skill templates, with first-run planning only when no match is found.
- Governed retrieval: PostgreSQL is the single source of truth, vectors only provide candidates, graph gating closes the loop, and the Evidence Pack is traceable.
- Dream and memory system: User-level memory isolation, admin-level aggregate analysis, org-level knowledge integration.
- Skill lifecycle: Search, recall, injection, audit, attribution; high-frequency high-contribution workflow-type skills enter `workflow_definition_review` and become `workflow_definition` upon admin approval.
- B2B sales blueprint: Morning briefing, stuck-deal rescue, discount approval, collection risk, weekly review, and other daily management paths.
- Enterprise control plane: Organization isolation, RBAC/ABAC, audit, Checkpoint/Resume/Replay, production credential hardening.
- Observable operations: OpenTelemetry, SigNoz, structured logging, health checks, attribution dashboard.

## Repository Structure

```text
.
├── agent-harness/              # Runnable TypeScript monorepo
│   ├── apps/                   # gateway-adapter, web-portal, mobile-app
│   ├── services/               # workflow, retrieval, executor, hermes, skills
│   ├── libs/                   # contracts, shared DB/config/logging, policy, audit
│   ├── db/migrations/          # SQL migrations
│   ├── scripts/                # bootstrap, health, migration, smoke helpers
│   └── tests/                  # unit and integration tests
├── development/                # Execution plans, graphs, audits, topic implementation notes
├── AH1-*.md                    # Authoritative architecture and implementation documents
├── RELEASE_NOTES.md            # Current release notes
└── README.md                   # GitHub default entry point
```

## Quick Start

```bash
git clone https://github.com/andyrenxu7255/jueying-agent.git
cd jueying-agent/agent-harness
npm install
cp .env.example .env
npm run docker:core:up
npm run db:migrate
npm run docker:up -- --profile app
```

After startup, access:

| Interface | URL |
|---|---|
| Web Portal | http://localhost:3003 |
| LiteLLM Dashboard | http://localhost:4000/ui |
| SigNoz | http://localhost:3301 |
| MinIO Console | http://localhost:9001 |

In production, use `docker-compose.prod.yml` and provide all secrets via environment variables. Never use local development passwords in production.

## Verification Records

The v1.6.2 release line has executed:

```bash
npm run lint
npm run type-check
npm run build
npm test
npm run context:audit
npm audit --audit-level=moderate
```

Results: lint, type checking, build, 8 Jest test suites / 82 cases, and M1/M2/M3 context graph gates all passed. Dependency audit reports 0 vulnerabilities.

## Document Index

| Entry | Content |
|---|---|
| [agent-harness/README.md](./agent-harness/README.md) | Application-level quick start, architecture, ports, workflows, and dev commands. |
| [agent-harness/PRODUCT.md](./agent-harness/PRODUCT.md) | Product description, roles, feature matrix, and user value. |
| [agent-harness/OPS.md](./agent-harness/OPS.md) | Deployment, health checks, monitoring, backup, and operations manual. |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | v1.6.2 release notes, ready for GitHub Release. |
| [development/HANDOFF-2026-05-22-i18n.md](./development/HANDOFF-2026-05-22-i18n.md) | Bilingual handoff, key files, and known limitations. |
| [development/SYSTEM-AUDIT-2026-05-22-COMPREHENSIVE.md](./development/SYSTEM-AUDIT-2026-05-22-COMPREHENSIVE.md) | This round's documentation, graph, architecture, code, and security audit record. |
| [development/DEV-21-梦境Hook与业务归因闭环.md](./development/DEV-21-梦境Hook与业务归因闭环.md) | Dream, Hook, recall, and Outcome attribution implementation notes. |
| [development/SYSTEM-AUDIT-2026-05-21-DREAM-HOOK.md](./development/SYSTEM-AUDIT-2026-05-21-DREAM-HOOK.md) | Dream Hook attribution special audit. |
| [development/DEV-00-开发索引.md](./development/DEV-00-开发索引.md) | Development plan index and milestone map. |
| [development/context-graph.json](./development/context-graph.json) | Machine-readable context graph, current v2.11. |
| [development/context-routing.json](./development/context-routing.json) | Task routing configuration, synced with context graph. |

### AH1 Authoritative Documents

The AH1 series remains the authoritative source for architecture and implementation constraints. Common entry points:

| Document | Topic |
|---|---|
| [AH1-17-Workflow-DSL与Planner契约.md](./AH1-17-Workflow-DSL与Planner契约.md) | Workflow DSL, Planner contracts, lifecycle, and skill extraction. |
| [AH1-20-检索编排与Fact-Write.md](./AH1-20-检索编排与Fact-Write.md) | Retrieval orchestration, graph gating, Evidence Pack, and fact writing. |
| [AH1-23-审计日志指标与告警.md](./AH1-23-审计日志指标与告警.md) | Audit, metrics, Dashboard, and Dream Hook attribution views. |
| [AH1-14-数据库表设计与索引.md](./AH1-14-数据库表设计与索引.md) | PostgreSQL schema authoritative description and migration map. |
| [AH1-27-部署与运维.md](./AH1-27-部署与运维.md) | Deployment and operations architecture. |

## Current Release: v1.6.2

This release completes the feedback chain from memory/skill recall to real business outcomes:

- `hook_event_log`: Lifecycle events.
- `knowledge_recall_event` and `skill_recall_event`: Recall and injection tracking.
- `workflow_outcome_eval`: Workflow terminal state business scoring.
- `recall_outcome_attribution`: Contribution attribution from recall events to outcomes.
- `skill_business_outcome_daily` and `knowledge_business_outcome_daily`: Daily report views.

Skills are recallable, injectable capability assets; workflows are multi-stage execution contracts. In the current implementation, successful paths are first extracted as `skill_type=workflow` draft skills, which become private active templates upon user confirmation; when a skill is recalled, injected, and achieves good outcomes multiple times, skill-library submits a `workflow_definition_review`, and the Planner will thereafter prioritize this more stable execution contract once approved by the admin.

v1.6.2 also adds release hardening: dynamic frontend attribute output is consistently escaped, sensitive local files are covered by `.gitignore`, npm transitive dependency vulnerabilities are cleared, and release entry points plus the context graph now reflect the bilingual file structure.

See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for details.

## License

JueYing is licensed under the MIT License. See [agent-harness/LICENSE](./agent-harness/LICENSE) and [agent-harness/LICENSES.md](./agent-harness/LICENSES.md).
