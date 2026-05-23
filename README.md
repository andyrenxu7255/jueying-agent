# JueYing (绝影) Agent

> 企业级 AI Agent 编排、记忆、工作流、主动运营与业务结果归因平台。
>
> 当前主版本：v1.7.0 | 更新日期：2026-05-23

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./agent-harness/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker)](https://docs.docker.com/compose/)

JueYing 把企业聊天入口、知识库、工作流、记忆系统、可复用 skill 和主动运营规则统一成一套可治理的 Agent 平台。用户可以从飞书、企业微信或 Web Portal 发起请求；系统会检索受权限约束的上下文，优先复用已批准的 `workflow_definition`，再回退到已激活的 workflow 型 skill 模板，必要时自动首跑规划，执行阶段任务，记录审计证据，并把业务结果归因回真正起作用的知识和 skill。

## 本版为什么重要

v1.7.0 把智能体从“被动响应”推进到“主动洞察和督促执行”：Admin 可以制定规则，`proactive-orchestrator` 定期检查事实、组织记忆、技能和任务状态，生成带证据的洞察；默认先进入 Admin 审核，再复用现有 `org_task` / `org_task_assignment` 派给具体用户执行，最后汇总到管理员汇报看板。

| 能力 | 本版补齐 |
|---|---|
| 主动运营规则 | Admin 在 Web Portal 维护规则、调度、证据策略和路由策略。 |
| 事实层扫描 | Agent 扫描 document、fact、org memory、ClawHub skill、task assignment 等信号。 |
| 审核后派单 | 默认 `review_first`，洞察经 Admin 批准后才生成 mission 并派给用户。 |
| 任务看板复用 | 派单复用既有组织任务表，避免和现有任务模块冲突。 |
| 去重与汇报 | 按 `rule_id + insight_type + evidence_pack_hash` 去重，并生成可发布的 Admin report。 |
| 真实验证 | 增加主动运营集成测试、前端 hash 直达回归和 95% 覆盖率门禁。 |

## 核心亮点

- 多渠道入口：飞书长连接、企业微信 Webhook、Web Portal、移动端推送。
- 复用优先：已批准 `workflow_definition` 优先，其次复用个人私有、组织、公共 active workflow 型 skill 模板。
- 受治理的检索：PostgreSQL 是唯一事实源，向量只提候选，图门控收口，Evidence Pack 可追溯。
- 主动运营：Admin 规则驱动 Agent 定期洞察、审核派单、督促普通用户执行并汇报。
- 梦境与归因：记忆、知识、skill 召回和 workflow outcome 进入可审计的业务反馈链。
- ClawHub 维护：支持 admin token、技能导入、升级检查、变更解读和安全审查。
- B2B 销售样板：预置 MEDDIC 销售知识、基础图谱、复盘技能和客户调研技能。
- 企业控制面：组织隔离、RBAC/ABAC、审计、Checkpoint/Resume/Replay、生产密码加固。

## 仓库结构

```text
.
├── agent-harness/              # 可运行 TypeScript monorepo
│   ├── apps/                   # gateway-adapter, web-portal, mobile-app
│   ├── services/               # workflow, retrieval, executor, hermes, skills, proactive
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
| 主动运营页 | http://localhost:3003/#proactive |
| Proactive Orchestrator 健康检查 | http://localhost:3010/health/ready |
| LiteLLM Dashboard | http://localhost:4000/ui |
| SigNoz | http://localhost:3301 |
| MinIO Console | http://localhost:9001 |

生产环境请使用 `docker-compose.prod.yml`，并通过环境变量提供所有密钥。不要在生产环境使用本地开发密码。

## 验证记录

v1.7.0 发布线已执行：

```bash
npm run test:portal-static
npm run test:proactive
npm test -- --coverage --runInBand
npm run type-check
npm run lint
npm run build
npm run db:migrate
npm run context:audit
npm audit --audit-level=moderate
```

验证结果：19 个测试套件 / 204 个用例通过；覆盖率 statements 98.74%、branches 95.49%、functions 96.21%、lines 99.24%；SQL 迁移、图谱审计、依赖安全审计均通过。本地 Docker 已验证 `ah-web-portal` 与 `ah-proactive-orchestrator` 健康，浏览器验证 `http://127.0.0.1:3003/#proactive` 可直达主动运营页。

## 文档总索引

| 入口 | 内容 |
|---|---|
| [agent-harness/README.md](./agent-harness/README.md) | 应用级快速开始、架构、端口、工作流和开发命令。 |
| [agent-harness/PRODUCT.md](./agent-harness/PRODUCT.md) | 产品说明、角色、功能矩阵和用户价值。 |
| [agent-harness/ARCHITECTURE.md](./agent-harness/ARCHITECTURE.md) | 系统架构、数据流、API 端点和主动运营链路。 |
| [agent-harness/OPS.md](./agent-harness/OPS.md) | 部署、健康检查、监控、备份和运维手册。 |
| [agent-harness/用户故事线.md](./agent-harness/用户故事线.md) | 22 条验收故事线，含主动运营编排。 |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | v1.7.0 发布说明，可直接用于 GitHub Release。 |
| [development/context-graph.json](./development/context-graph.json) | 机器可读上下文图谱，当前 v2.13。 |
| [development/context-routing.json](./development/context-routing.json) | 任务路由配置，当前 v1.13。 |

### AH1 权威文档

| 文档 | 主题 |
|---|---|
| [AH1-14-数据库表设计与索引.md](./AH1-14-数据库表设计与索引.md) | PostgreSQL schema 权威说明与迁移地图。 |
| [AH1-15-核心接口与事件契约.md](./AH1-15-核心接口与事件契约.md) | API、事件、主动运营接口契约。 |
| [AH1-16-权限Scope-Policy-Snapshot.md](./AH1-16-权限Scope-Policy-Snapshot.md) | 权限、scope、主动运营写入边界。 |
| [AH1-17-Workflow-DSL与Planner契约.md](./AH1-17-Workflow-DSL与Planner契约.md) | Workflow DSL、Planner 契约、生命周期与 skill 提取。 |
| [AH1-20-检索编排与Fact-Write.md](./AH1-20-检索编排与Fact-Write.md) | 检索编排、图门控、Evidence Pack 与事实写入。 |
| [AH1-27-部署与运维.md](./AH1-27-部署与运维.md) | 部署和运维架构。 |

## 当前发布：v1.7.0

本次发布新增 `services/proactive-orchestrator`、`029_proactive_orchestration.sql`、Web Portal 主动运营页和后端代理、Docker Compose 服务与完整功能测试。旧版本 release 已保留为历史版本，`v1.7.0` 作为当前主版本发布。

详见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。

## License

JueYing 使用 MIT License。详见 [agent-harness/LICENSE](./agent-harness/LICENSE) 和 [agent-harness/LICENSES.md](./agent-harness/LICENSES.md)。

---

## English Version / 英文版

# JueYing Agent

> Enterprise-grade AI Agent orchestration, memory, workflow, proactive operations, and business attribution platform.
>
> Current main release: v1.7.0 | Updated: 2026-05-23

JueYing unifies enterprise chat entry points, knowledge bases, workflows, memory systems, reusable skills, and proactive operating rules into one governed Agent platform. Users can start work from Feishu, WeCom, or the Web Portal; the system retrieves permission-scoped context, prioritizes approved `workflow_definition` contracts, falls back to active workflow skills, runs first-time planning when needed, executes staged tasks, records audit evidence, and attributes outcomes back to the knowledge and skills that worked.

## Why This Release Matters

v1.7.0 moves the agent from passive response to proactive insight and execution follow-up. Admins define rules, `proactive-orchestrator` scans facts, org memory, skills, and task state, creates evidence-backed insights, waits for admin review by default, dispatches approved missions through existing organization tasks, and summarizes progress for admin reporting.

## Highlights

- Multi-channel entry: Feishu long connection, WeCom webhook, Web Portal, mobile push.
- Reuse-first workflow planning through approved `workflow_definition` records and active workflow skills.
- Governed retrieval with PostgreSQL as source of truth, vector candidates, graph gating, and traceable Evidence Packs.
- Proactive operations: admin rules drive agent insight, reviewed dispatch, human follow-up, and reporting.
- Dream and attribution: memory, knowledge, skill recall, and workflow outcome are tied into an auditable feedback loop.
- ClawHub maintenance: admin token, import, upgrade checks, version summaries, and safety review.
- B2B sales demo: MEDDIC knowledge, demo graph, review skill, and customer research skill.

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

After startup:

| Interface | URL |
|---|---|
| Web Portal | http://localhost:3003 |
| Proactive page | http://localhost:3003/#proactive |
| Proactive Orchestrator health | http://localhost:3010/health/ready |
| LiteLLM Dashboard | http://localhost:4000/ui |
| SigNoz | http://localhost:3301 |
| MinIO Console | http://localhost:9001 |

## Verification

v1.7.0 has passed portal static tests, proactive functional integration tests, full Jest coverage, type check, lint, build, SQL migrations, context graph audit, and dependency audit. Coverage is above the 95% gate across statements, branches, functions, and lines.

See [RELEASE_NOTES.md](./RELEASE_NOTES.md) for details.
