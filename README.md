# JueYing (绝影) Agent

> 企业级 AI Agent 编排、记忆、工作流与业务结果归因平台。
>
> 当前发布线：v1.5.0 | 更新日期：2026-05-21

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./agent-harness/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker)](https://docs.docker.com/compose/)

JueYing 把企业聊天入口、知识库、工作流、记忆系统和可复用 skill 统一成一套可治理的 Agent 平台。用户可以从飞书、企业微信或 Web Portal 发起请求；系统会检索受权限约束的上下文，优先复用已确认 workflow，必要时自动首跑规划，执行阶段任务，记录审计证据，并把好的业务结果归因回真正起作用的知识和 skill。

“绝影”取快速、可靠、可驾驭之意。在这个项目里，它代表一套让团队从自然语言请求走到可验证结果的 Agent Harness。

## 本版为什么重要

v1.5.0 的主题是 **Dream Hooks and Outcome Attribution**。它把系统从“Agent 能记住东西”推进到“Agent 能知道什么真的有效”。

| 能力 | 这次补齐了什么 |
|---|---|
| 梦境机制 | 低峰期记忆整理不再只是压缩，而是进入运营闭环。 |
| Hook 账本 | 记录 memory/fact/skill 召回、skill 注入、workflow outcome、dream 完成等生命周期事件。 |
| 召回归因 | 知识和 skill 的召回会关联到后续 workflow 结果，能回答“哪些内容带来了好结果”。 |
| Outcome 评估 | 成功、失败、取消的 workflow 都写终态结果，避免只统计成功样本。 |
| 管理端看板 | Web Portal 增加 30 天知识与 skill 业务效果视图。 |
| 图谱同步 | development context graph 已把 dream、hook、outcome 作为明确架构域。 |

## 核心亮点

- 多渠道入口：飞书长连接、企业微信 Webhook、Web Portal、移动端推送。
- Workflow 优先：个人私有、组织、公共 workflow 优先复用，再进入自动首跑。
- 受治理的检索：PostgreSQL 是唯一事实源，向量只提候选，图门控收口，Evidence Pack 可追溯。
- 梦境与记忆系统：用户级记忆隔离、管理员级汇总分析、组织级知识整合。
- Skill 生命周期：搜索、召回、注入、审核、提升、复用和业务贡献归因。
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

v1.5.0 发布线已执行：

```bash
npm run db:migrate
npm run lint
npm run type-check
npm run build
npm test
npm run test:dream-mode
npm audit --audit-level=high
```

结果：迁移、lint、类型检查、构建、8 个 Jest 测试套件 / 81 个用例、14 个 dream-mode 集成用例均通过。依赖审计无 high/critical；剩余 2 个 moderate 传递依赖提示已记录。

## 文档总索引

| 入口 | 内容 |
|---|---|
| [agent-harness/README.md](./agent-harness/README.md) | 应用级快速开始、架构、端口、工作流和开发命令。 |
| [agent-harness/PRODUCT.md](./agent-harness/PRODUCT.md) | 产品说明、角色、功能矩阵和用户价值。 |
| [agent-harness/OPS.md](./agent-harness/OPS.md) | 部署、健康检查、监控、备份和运维手册。 |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | v1.5.0 发布说明，可直接用于 GitHub Release。 |
| [development/DEV-21-梦境Hook与业务归因闭环.md](./development/DEV-21-梦境Hook与业务归因闭环.md) | 梦境、Hook、召回和 Outcome 归因实现说明。 |
| [development/SYSTEM-AUDIT-2026-05-21-DREAM-HOOK.md](./development/SYSTEM-AUDIT-2026-05-21-DREAM-HOOK.md) | 梦境 Hook 归因专项审计。 |
| [development/DEV-00-开发索引.md](./development/DEV-00-开发索引.md) | 开发计划索引和里程碑地图。 |
| [development/context-graph.json](./development/context-graph.json) | 机器可读上下文图谱，当前 v2.7。 |

### AH1 权威文档

AH1 系列仍是架构和实现约束的权威文档。常用入口：

| 文档 | 主题 |
|---|---|
| [AH1-17-Workflow-DSL与Planner契约.md](./AH1-17-Workflow-DSL与Planner契约.md) | Workflow DSL、Planner 契约、生命周期与 skill 提取。 |
| [AH1-20-检索编排与Fact-Write.md](./AH1-20-检索编排与Fact-Write.md) | 检索编排、图门控、Evidence Pack 与事实写入。 |
| [AH1-23-审计日志指标与告警.md](./AH1-23-审计日志指标与告警.md) | 审计、指标、Dashboard 与梦境 Hook 归因视图。 |
| [AH1-14-数据库表设计与索引.md](./AH1-14-数据库表设计与索引.md) | PostgreSQL schema 权威说明与迁移地图。 |
| [AH1-27-部署与运维.md](./AH1-27-部署与运维.md) | 部署和运维架构。 |

## 当前发布：v1.5.0

本次发布补齐 memory/skill recall 到真实业务结果之间的反馈链：

- `hook_event_log`：生命周期事件。
- `knowledge_recall_event` 与 `skill_recall_event`：召回与注入追踪。
- `workflow_outcome_eval`：workflow 终态业务评分。
- `recall_outcome_attribution`：召回事件到 outcome 的贡献归因。
- `skill_business_outcome_daily` 与 `knowledge_business_outcome_daily`：日级报表视图。

详见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。

## License

JueYing 使用 MIT License。详见 [agent-harness/LICENSE](./agent-harness/LICENSE) 和 [agent-harness/LICENSES.md](./agent-harness/LICENSES.md)。
