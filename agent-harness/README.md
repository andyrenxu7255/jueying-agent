# JueYing (绝影) — Agent Harness

> 版本: 1.6.3 | 更新日期: 2026-05-23

> **企业级 AI Agent 编排与执行平台** — 多渠道接入、`workflow_definition` 优先复用、LLM 任务规划、多阶段工作流自动执行

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker)](https://docs.docker.com/compose/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)

---

## 📖 目录

- [项目简介](#项目简介)
- [快速开始](#快速开始)
- [环境配置](#环境配置)
- [项目架构](#项目架构)
- [服务端口速查](#服务端口速查)
- [文档索引](#文档索引)
- [用户故事线](#用户故事线)
- [开发指南](#开发指南)
- [部署运维](#部署运维)
- [许可证](#许可证)

---

## 项目简介

JueYing（绝影，内部代号 agent-harness）是一个**企业级 AI Agent 编排与执行平台**。

> 💡 *绝影* 是曹操的宝马，取其"追风逐电、一瞬千里"之意。在 Agent Harness 中，一个超级用户通过 AI Agent 带领团队作战——如同将军驾驭绝影，一骑当先。品牌英文名 **JueYing**。GitHub: `jueying-agent`。

### 核心能力

| 能力 | 说明 |
|------|------|
| 🌐 **多渠道接入** | 飞书长连接 WebSocket、企业微信 Webhook、Web Portal、移动端推送 |
| 🧠 **LLM 任务规划** | 先匹配已批准 `workflow_definition`，再回退到 workflow 型 active skill；未命中时走自动任务首跑，再沉淀为可复用 workflow 型 skill |
| ⚙️ **工作流引擎** | 基于 XState 状态机的完整生命周期：plan → execute → verify → repair → report |
| 📈 **销售管理样板** | 支持 B2B 销售晨会、卡单救援、回款风险、折扣审批和周复盘故事线 |
| 🔍 **知识检索** | 宽口候选先用向量和 like 找对象/字段，图门控收口，图内二次召回补证据 |
| 🗃️ **事实与实体管理** | 结构化事实存储、冲突检测、证据溯源、实体关系图谱 |
| 🧠 **记忆与技能** | 会话记忆存储/召回/压缩、技能模板注册与复用 |
| 🌙 **梦境与业务归因** | 低峰记忆整理、hook 事件账本、知识/skill 召回追踪、workflow outcome 贡献归因 |
| 🔁 **确认后复用** | 成功首跑会展示过程和结果，用户回复“确认工作流 wf_xxx”后激活私有 workflow 型 skill 模板；管理员可审核提升为组织模板，高效果路径再候审固化为 `workflow_definition` |
| 📊 **可观测性** | OpenTelemetry + SigNoz 全链路追踪、审计日志、健康检查 |
| 📁 **文件工作区** | 用户隔离存储、双后端(localFS/MinIO)、staging机制、三级scope共享 |
| 🔐 **安全合规** | 用户/组织隔离、RBAC/ABAC 策略、密码 scrypt 哈希、SQL 参数化防护 |

### 技术栈

- **语言**: TypeScript 5.9 + Node.js ≥20
- **数据库**: PostgreSQL 16 + pgvector + Apache AGE（图投影与门控）
- **缓存**: Redis 7
- **对象存储**: MinIO (S3 兼容)
- **LLM 网关**: LiteLLM Proxy (支持 MiniMax / DashScope / OpenAI 等多模型)
- **可观测性**: OpenTelemetry Collector + SigNoz + ClickHouse
- **容器化**: Docker + Docker Compose

---

## 快速开始

### 前置要求

- **Node.js** ≥ 20.0.0
- **Docker** & **Docker Compose** v2+
- **Git**

### 1. 克隆仓库

```bash
git clone https://github.com/andyrenxu7255/jueying-agent.git
cd agent-harness
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入您的 API Key：

```ini
# 必填项
MINIMAX_API_KEY=sk-xxxxxxxxxxxxxxxx
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx
LITELLM_MASTER_KEY=your-master-key

# 飞书渠道（可选）
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
# 长连接模式只需要 App ID 和 App Secret。
# FEISHU_SIGNING_SECRET 仅 webhook 回调验签需要，可留空。
FEISHU_SIGNING_SECRET=

# 企微渠道（可选）
WECOM_TOKEN=xxxxxxxxxxxx
WECOM_CORP_ID=xxxxxxxxxxxx

# ClawHub 管理（可选）
# 用于 Web Portal 管理员导入、下载、升级和后续发布 skills。
# Token 只放本地环境，不提交 GitHub；页面会掩码显示。
CLAWHUB_SITE=https://clawhub.ai
CLAWHUB_ADMIN_TOKEN=
```

Web Portal 的系统配置页支持热加载多数运行时配置。飞书、模型、Embedding、Rerank 等会影响独立进程的配置保存后，会在页面内显示可选重启按钮；长连接飞书通常重启 `feishu-longconn`，消息收发网关配置通常重启 `gateway-adapter`。

模型配置页可以从 LiteLLM/OpenAI 兼容 `/v1/models` 获取模型目录，也支持维护模型优先级、上下文窗口、最大输出、思考模式与思考强度。Embedding/Rerank 同样提供目录选择和测试按钮；测试结果会显示延迟、维度或排序返回数。

技能管理页面向管理员维护：系统会预置低风险办公/搜索/销售技能，包括 ClawHub 上的 `meddic-b2b-sales-review` 和 `customer-research`；管理员可配置 `CLAWHUB_ADMIN_TOKEN` 后从 ClawHub URL 导入技能、上传 `SKILL.md`、检查已安装 ClawHub 技能的新版本，并在查看变更摘要与安全扫描结果后逐个确认升级。

数据库迁移会预置一组可演示的销售管理知识：`MEDDIC销售六步法总览`、`销售六步法Gates检查清单`、`Champion识别标准`、`Discovery探索阶段五道门`、`Business Case商业论证框架`。这些内容作为 public 文档、chunk、实体和关系进入知识层，便于新环境马上测试共享知识检索和图谱投影。

### 4. 启动基础设施

```bash
# 仅核心服务（PostgreSQL + Redis + MinIO）
npm run docker:core:up

# 核心 + LiteLLM 网关
npm run infra:bootstrap:llm

# 核心 + LiteLLM + SigNoz（全量可观测性）
npm run infra:bootstrap:full
```

### 5. 应用数据库迁移

```bash
npm run db:migrate
```

### 6. 启动所有应用服务

```bash
npm run docker:up -- --profile app
```

### 7. 健康检查

```bash
npm run health:core
```

完成后访问：
- **Web Portal**: http://localhost:3003 （登录后在"系统指南"页面查看完整架构说明和使用指南）
- **LiteLLM Dashboard**: http://localhost:4000/ui
- **SigNoz 可观测性**: http://localhost:3301
- **MinIO Console**: http://localhost:9001

---

## 环境配置

### 必需的环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `MINIMAX_API_KEY` | MiniMax API 密钥 | `sk-xxxxxxxxxxxxxxxx` |
| `DASHSCOPE_API_KEY` | DashScope API 密钥 | `sk-xxxxxxxxxxxxxxxx` |
| `LITELLM_MASTER_KEY` | LiteLLM 主密钥 | `your-master-key` |

### 生产环境安全要求

生产部署时，**必须**使用安全配置文件：

```bash
# 使用生产安全覆盖
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` 会强制校验所有密码必须在环境变量中提供，**禁止使用默认弱密码**。

开发环境默认密码（仅限本地开发）：

| 服务 | 用户名 | 默认密码 |
|------|--------|----------|
| PostgreSQL | `agent_harness` | `dev_password_changeme` |
| Redis | — | `redis_changeme` |
| MinIO | `minioadmin` | `minioadmin_changeme` |
| ClickHouse | `clickhouse` | `clickhouse_changeme` |

> ⚠️ **生产环境严禁使用这些默认密码！**

---

## 项目架构

```
agent-harness/
├── apps/                    # 应用层
│   ├── gateway-adapter/     # 多渠道接入网关（飞书/企微/Web/移动端）
│   ├── web-portal/          # Web 管理控制台
│   └── mobile-app/          # 移动端推送服务
├── services/                # 微服务层
│   ├── workflow/            # 工作流引擎（Planner + Supervisor + StateMachine）
│   ├── fact-retrieval/      # 知识检索（向量+全文+图谱+重排序）
│   ├── executor-gateway/    # 执行器网关（多类型 Executor 调度）
│   ├── hermes-adapter/      # 记忆与技能管理
│   ├── skill-library/       # 技能注册中心
│   ├── resource-scheduler/  # 资源配额与健康巡检
│   ├── feishu-longconn/     # 飞书长连接 WebSocket
│   └── ollama/              # 本地 LLM 运行时（可选）
├── libs/                    # 共享库
│   ├── contracts/           # Zod Schema + TypeScript 类型 + API 契约
│   ├── shared/              # 日志/HTTP/DB/配置/限流/监控
│   ├── policy/              # RBAC/ABAC 权限引擎
│   └── audit/               # 审计日志
├── config/                  # 环境配置（YAML）
├── db/                      # 数据库迁移（SQL）
├── docker/                  # Docker 构建文件
├── scripts/                 # 运维脚本
└── tests/                   # 测试（集成测试 + POC 脚本）
```

### 数据流

```
用户 → [飞书/企微/Web] → gateway-adapter
                              │
                 ┌────────────┼────────────┐
                 ↓            ↓            ↓
           知识/对话      长任务/工作流    快速查询
                 │            │            │
                 ↓            ↓            │
          hermes-adapter  workflow-service  │
          fact-retrieval       │           │
                 │             ↓           │
                 │    executor-gateway     │
                 │     (调度执行器)         │
                 └─────────┬───────────────┘
                           ↓
                      结果返回用户
```

---

## 服务端口速查

| 服务 | 端口 | 容器名 | 功能 |
|------|:---:|------|------|
| gateway-adapter | 3000 | ah-gateway | 多渠道入口、意图分类、路由 |
| workflow-service | 3001 | ah-workflow | 工作流规划与状态机 |
| executor-gateway | 3002 | ah-executor | 多执行器调度 |
| web-portal | 3003 | ah-web-portal | Web 管理界面 |
| fact-retrieval | 3004 | ah-fact-retrieval | 知识检索与事实存储 |
| hermes-adapter | 3005 | ah-hermes | 记忆与技能 |
| feishu-longconn | 动态 | ah-feishu-longconn | 飞书长连接 |
| skill-library | 3007 | ah-skill-library | 技能注册中心 |
| resource-scheduler | 3008 | ah-resource-scheduler | 资源配额巡检 |
| mobile-app | 3009 | ah-mobile-app | 移动推送 |
| PostgreSQL | 5432 | ah-postgres | 主数据库 |
| Redis | 6379 | ah-redis | 缓存 |
| MinIO | 9000/9001 | ah-minio | 对象存储 |
| LiteLLM | 4000 | ah-litellm | LLM 网关 |
| SigNoz Frontend | 3301 | ah-signoz-frontend | 可观测性 UI |

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [产品说明](./PRODUCT.md) | 功能特性矩阵、使用场景、角色定义、核心价值 |
| [系统架构](./ARCHITECTURE.md) | 完整架构图、数据流、API 端点矩阵、状态机设计 |
| [运维手册](./OPS.md) | 部署流程、健康检查、资源管理、日志与备份 |
| [用户故事线](./用户故事线.md) | 21 条验收故事线 (AH-1 ~ AH-21)，含梦境模式和 B2B 销售可观测闭环 |
| [发布说明](../RELEASE_NOTES.md) | v1.6.3 管理后台初始化与 ClawHub 维护发布说明 |
| [DEV-21 梦境Hook与业务归因闭环](../development/DEV-21-梦境Hook与业务归因闭环.md) | 梦境、Hook、召回、Outcome 归因实现说明 |
| [修复报告](./FIX-REPORT.md) | 代码审计与修复记录 |
| [前端修改记录](./FRONTEND-AUDIT-CHANGELOG.md) | 前端页面审计修改记录（含15项初始化+梦境模式） |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史、11 轮修复详情、当前系统状态 |
| [审计报告](./AUDIT-REPORT.md) | 7 大类 53 项代码质量/安全审计 |
| [开源协议声明](./LICENSES.md) | 完整 LICENSE 文本 + 第三方依赖许可证清单 |

---

## 用户故事线

完整用户故事线请参阅 [用户故事线.md](./用户故事线.md)。

**21 条故事线速览**：

| 编号 | 故事线 | 涉及服务 |
|:---:|------|------|
| AH-1 | 多渠道消息接入与身份识别 | gateway-adapter |
| AH-2 | 多知识源导入与分块向量化 | fact-retrieval |
| AH-3 | 结构化事实提取与存储 | fact-retrieval |
| AH-4 | 多方事实冲突检测与合并 | fact-retrieval |
| AH-5 | 自然语言知识检索 | fact-retrieval |
| AH-6 | 人类知识审核与审批 | web-portal |
| AH-7 | 意图识别与任务规划 | workflow-service |
| AH-8 | 工作流阶段自动执行 | executor-gateway |
| AH-9 | 微信/飞书长任务异步反馈 | gateway-adapter |
| AH-10 | 记忆存储与上下文压缩 | hermes-adapter |
| AH-11 | 技能库管理与技能提取 | skill-library |
| AH-12 | 用户画像与人设系统 | web-portal |
| AH-13 | 权限策略与数据隔离 | policy |
| AH-14 | AI 代码执行工具 | executor-gateway |
| AH-15 | 制品存储与版本管理 | fact-retrieval |
| AH-16 | 工作流 Checkpoint 与恢复 | workflow-service |
| AH-17 | 审计日志与全链路追踪 | audit |
| AH-18 | 巡检调度与资源回收 | resource-scheduler |
| AH-19 | 移动端消息推送 | mobile-app |
| AH-20 | 梦境模式：记忆分层管理+技能发现生态，并追踪知识/skill 业务归因 | hermes-adapter, skill-library, workflow-service, fact-retrieval, web-portal |
| AH-21 | B2B 销售管理日常与工作流可观测闭环 | gateway-adapter, workflow-service, executor-gateway, fact-retrieval, web-portal |

---

## 开发指南

### 项目结构

本项目为 **npm workspaces monorepo**：

```bash
npm install          # 安装所有 workspace 依赖
npm run type-check   # TypeScript 类型检查
npm run build        # 编译所有包
npm test             # 运行测试
npm run lint         # 代码规范检查
npm run smoke:workflow-observability  # workflow 复用、可观测和确认沉淀烟测
npm run test:dream-mode  # 梦境模式与归因闭环集成测试
```

### 开发模式

开发模式下，应用服务的源代码通过 Docker volume 挂载到容器中：

```yaml
volumes:
  - ./services/workflow/src:/app/src:ro
```

修改源代码后重启容器即可生效：

```bash
docker compose restart workflow-service
```

### 数据库开发

```bash
# 查看 Drizzle Schema
cat db/schema.ts

# 生成迁移（Drizzle Kit）
npm run db:generate

# 推送 Schema 到数据库
npm run db:push

# 执行 SQL 迁移
npm run db:migrate
```

---

## 部署运维

### 生产部署清单

- [ ] 设置所有环境变量（严禁使用默认密码）
- [ ] 使用 `docker-compose.prod.yml` 覆盖文件
- [ ] 配置 HTTPS 反向代理（nginx/Caddy）
- [ ] 配置飞书/企微 Webhook 回调 URL
- [ ] 初始化管理员账号：`node scripts/init-admin.cjs`
- [ ] 运行健康检查：`npm run health:core`
- [ ] 配置日志轮转（见 OPS.md）

### 常用运维命令

```bash
# 查看服务日志
docker compose logs -f gateway-adapter

# 重启单个服务
docker compose restart workflow-service

# 停止所有服务
npm run docker:down

# 数据库备份
docker exec ah-postgres pg_dump -U agent_harness agent_harness > backup.sql
```

详细运维指南请参阅 [运维手册](./OPS.md)。

---

## 许可证

本项目本体采用 **MIT License**。详见 [LICENSE](./LICENSE)。

本项目依赖的第三方组件许可证详见 [LICENSES.md](./LICENSES.md)，涵盖 NPM 包、Docker 镜像的所有开源协议声明。

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/andyrenxu7255">Andy Ren</a></sub>
</p>

---

## English Version / 英文版

# JueYing (绝影) — Agent Harness

> Version: 1.6.3 | Updated: 2026-05-23

> **Enterprise-grade AI Agent Orchestration and Execution Platform** — Multi-channel access, `workflow_definition` priority reuse, LLM task planning, multi-stage workflow auto-execution

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker)](https://docs.docker.com/compose/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)

---

## Table of Contents

- [Project Introduction](#project-introduction)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Project Architecture](#project-architecture)
- [Service Port Quick Reference](#service-port-quick-reference)
- [Document Index](#document-index)
- [User Storylines](#user-storylines)
- [Development Guide](#development-guide)
- [Deployment & Operations](#deployment--operations)
- [License](#license)

---

## Project Introduction

JueYing (绝影, internal codename agent-harness) is an **enterprise-grade AI Agent orchestration and execution platform**.

> 💡 *JueYing* (绝影) was Cao Cao's legendary steed, meaning "swift as wind, fleet as lightning, covering a thousand miles in an instant." In Agent Harness, a super-user leads their team through AI Agents — like a general riding JueYing, charging ahead. The brand's English name is **JueYing**. GitHub: `jueying-agent`.

### Core Capabilities

| Capability | Description |
|------------|-------------|
| 🌐 **Multi-Channel Access** | Feishu long-connection WebSocket, WeCom Webhook, Web Portal, mobile push |
| 🧠 **LLM Task Planning** | First matches approved `workflow_definition`, then falls back to workflow-type active skills; when no match, auto-task first-run then solidifies as reusable workflow-type skill |
| ⚙️ **Workflow Engine** | XState state-machine-based full lifecycle: plan → execute → verify → repair → report |
| 📈 **Sales Management Blueprint** | Supports B2B sales morning briefing, stuck-deal rescue, collection risk, discount approval, and weekly review storylines |
| 🔍 **Knowledge Retrieval** | Wide-candidate vector + like to find objects/fields, graph gating to close the loop, in-graph secondary recall to supplement evidence |
| 🗃️ **Fact & Entity Management** | Structured fact storage, conflict detection, evidence provenance, entity relationship graph |
| 🧠 **Memory & Skills** | Session memory store/recall/compress, skill template registration and reuse |
| 🌙 **Dream & Business Attribution** | Off-peak memory consolidation, hook event ledger, knowledge/skill recall tracking, workflow outcome contribution attribution |
| 🔁 **Confirm-to-Reuse** | Successful first runs display process and results; user replies "confirm workflow wf_xxx" to activate the private workflow-type skill template; admins can review and promote to org template; high-effectiveness paths then undergo review to solidify as `workflow_definition` |
| 📊 **Observability** | OpenTelemetry + SigNoz full-chain tracing, audit logging, health checks |
| 📁 **File Workspace** | User-isolated storage, dual backend (localFS/MinIO), staging mechanism, three-level scope sharing |
| 🔐 **Security & Compliance** | User/org isolation, RBAC/ABAC policies, scrypt password hashing, parameterized SQL |

### Tech Stack

- **Language**: TypeScript 5.9 + Node.js ≥20
- **Database**: PostgreSQL 16 + pgvector + Apache AGE (graph projection and gating)
- **Cache**: Redis 7
- **Object Storage**: MinIO (S3 compatible)
- **LLM Gateway**: LiteLLM Proxy (supports MiniMax / DashScope / OpenAI and other models)
- **Observability**: OpenTelemetry Collector + SigNoz + ClickHouse
- **Containerization**: Docker + Docker Compose

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20.0.0
- **Docker** & **Docker Compose** v2+
- **Git**

### 1. Clone the Repository

```bash
git clone https://github.com/andyrenxu7255/jueying-agent.git
cd agent-harness
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file and fill in your API Keys:

```ini
# Required
MINIMAX_API_KEY=sk-xxxxxxxxxxxxxxxx
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx
LITELLM_MASTER_KEY=your-master-key

# Feishu channel (optional)
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
# Long-connection mode only needs App ID and App Secret.
# FEISHU_SIGNING_SECRET is only needed for webhook signature verification.
FEISHU_SIGNING_SECRET=

# WeCom channel (optional)
WECOM_TOKEN=xxxxxxxxxxxx
WECOM_CORP_ID=xxxxxxxxxxxx
```

The Web Portal system configuration page hot-reloads most runtime settings. When a change affects an independent process, such as Feishu, LLM, Embedding, or Rerank, the page shows optional restart buttons. Feishu long connection usually restarts `feishu-longconn`; message gateway changes usually restart `gateway-adapter`.

The model configuration page can fetch model catalogs from LiteLLM/OpenAI-compatible `/v1/models`, and supports model priority, context window, max output, thinking mode, and thinking strength. You can add a model manually, select a catalog item, test a single model, or test the chat/embedding/rerank provider path. Embedding/Rerank also support catalog selection and test buttons; tests show latency, dimensions, or rerank result count.

Knowledge import now treats manual text and uploaded files as two entry paths into the same ingestion flow: the source field is descriptive rather than a confusing manual/document/chat selector, and TXT, Markdown, PDF, DOCX, XLSX, CSV, JSON uploads are parsed into the review pipeline.

### 4. Start Infrastructure

```bash
# Core services only (PostgreSQL + Redis + MinIO)
npm run docker:core:up

# Core + LiteLLM Gateway
npm run infra:bootstrap:llm

# Core + LiteLLM + SigNoz (full observability)
npm run infra:bootstrap:full
```

### 5. Apply Database Migrations

```bash
npm run db:migrate
```

### 6. Start All Application Services

```bash
npm run docker:up -- --profile app
```

### 7. Health Check

```bash
npm run health:core
```

Once complete, access:
- **Web Portal**: http://localhost:3003 (log in and see the full architecture guide and usage manual on the "System Guide" page)
- **LiteLLM Dashboard**: http://localhost:4000/ui
- **SigNoz Observability**: http://localhost:3301
- **MinIO Console**: http://localhost:9001

---

## Environment Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MINIMAX_API_KEY` | MiniMax API key | `sk-xxxxxxxxxxxxxxxx` |
| `DASHSCOPE_API_KEY` | DashScope API key | `sk-xxxxxxxxxxxxxxxx` |
| `LITELLM_MASTER_KEY` | LiteLLM master key | `your-master-key` |

### Production Security Requirements

For production deployment, you **must** use the secure configuration file:

```bash
# Use production security overlay
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` enforces that all passwords must be provided via environment variables, **prohibiting default weak passwords**.

Development environment default passwords (local dev only):

| Service | Username | Default Password |
|---------|----------|-----------------|
| PostgreSQL | `agent_harness` | `dev_password_changeme` |
| Redis | — | `redis_changeme` |
| MinIO | `minioadmin` | `minioadmin_changeme` |
| ClickHouse | `clickhouse` | `clickhouse_changeme` |

> ⚠️ **Never use these default passwords in production!**

---

## Project Architecture

```
agent-harness/
├── apps/                    # Application layer
│   ├── gateway-adapter/     # Multi-channel access gateway (Feishu/WeCom/Web/Mobile)
│   ├── web-portal/          # Web admin console
│   └── mobile-app/          # Mobile push service
├── services/                # Microservices layer
│   ├── workflow/            # Workflow engine (Planner + Supervisor + StateMachine)
│   ├── fact-retrieval/      # Knowledge retrieval (vector + full-text + graph + rerank)
│   ├── executor-gateway/    # Executor gateway (multi-type Executor dispatch)
│   ├── hermes-adapter/      # Memory & skill management
│   ├── skill-library/       # Skill registry
│   ├── resource-scheduler/  # Resource quota & health inspection
│   ├── feishu-longconn/     # Feishu long-connection WebSocket
│   └── ollama/              # Local LLM runtime (optional)
├── libs/                    # Shared libraries
│   ├── contracts/           # Zod Schema + TypeScript types + API contracts
│   ├── shared/              # Logging/HTTP/DB/Config/Rate-limit/Monitoring
│   ├── policy/              # RBAC/ABAC permission engine
│   └── audit/               # Audit logging
├── config/                  # Environment configuration (YAML)
├── db/                      # Database migrations (SQL)
├── docker/                  # Docker build files
├── scripts/                 # Operations scripts
└── tests/                   # Tests (integration tests + POC scripts)
```

### Data Flow

```
User → [Feishu/WeCom/Web] → gateway-adapter
                                │
                   ┌────────────┼────────────┐
                   ↓            ↓            ↓
             Knowledge/Chat  Long Task/     Quick
                             Workflow      Lookup
                   │            │            │
                   ↓            ↓            │
            hermes-adapter  workflow-service  │
            fact-retrieval       │           │
                   │             ↓           │
                   │    executor-gateway     │
                   │     (dispatch executors) │
                   └─────────┬───────────────┘
                             ↓
                      Result returned to user
```

---

## Service Port Quick Reference

| Service | Port | Container Name | Function |
|---------|:---:|------|------|
| gateway-adapter | 3000 | ah-gateway | Multi-channel entry, intent classification, routing |
| workflow-service | 3001 | ah-workflow | Workflow planning & state machine |
| executor-gateway | 3002 | ah-executor | Multi-executor dispatch |
| web-portal | 3003 | ah-web-portal | Web admin interface |
| fact-retrieval | 3004 | ah-fact-retrieval | Knowledge retrieval & fact storage |
| hermes-adapter | 3005 | ah-hermes | Memory & skills |
| feishu-longconn | dynamic | ah-feishu-longconn | Feishu long connection |
| skill-library | 3007 | ah-skill-library | Skill registry |
| resource-scheduler | 3008 | ah-resource-scheduler | Resource quota inspection |
| mobile-app | 3009 | ah-mobile-app | Mobile push |
| PostgreSQL | 5432 | ah-postgres | Primary database |
| Redis | 6379 | ah-redis | Cache |
| MinIO | 9000/9001 | ah-minio | Object storage |
| LiteLLM | 4000 | ah-litellm | LLM gateway |
| SigNoz Frontend | 3301 | ah-signoz-frontend | Observability UI |

---

## Document Index

| Document | Content |
|----------|---------|
| [Product Description](./PRODUCT.md) | Feature matrix, use cases, role definitions, core value |
| [System Architecture](./ARCHITECTURE.md) | Complete architecture diagram, data flows, API endpoint matrix, state machine design |
| [Operations Manual](./OPS.md) | Deployment process, health checks, resource management, logging & backup |
| [User Storylines](./用户故事线.md) | 21 acceptance storylines (AH-1 ~ AH-21), including Dream Mode and B2B sales observability closed loop |
| [Release Notes](../RELEASE_NOTES.md) | v1.6.3 admin initialization and ClawHub maintenance release notes |
| [DEV-21 Dream Hooks & Business Attribution Closed Loop](../development/DEV-21-梦境Hook与业务归因闭环.md) | Dream, Hook, recall, and Outcome attribution implementation notes |
| [Fix Report](./FIX-REPORT.md) | Code audit and fix records |
| [Frontend Audit Changelog](./FRONTEND-AUDIT-CHANGELOG.md) | Frontend page audit modification records (including 15 initialization items + Dream Mode) |
| [Handoff Document](./HANDOFF-SESSION.md) | Development history, 11 rounds of fix details, current system status |
| [Audit Report](./AUDIT-REPORT.md) | 7 categories, 53 code quality/security audit items |
| [Open Source License Statement](./LICENSES.md) | Complete LICENSE text + third-party dependency license list |

---

## User Storylines

See [用户故事线.md](./用户故事线.md) for the complete user storylines.

**21 Storylines at a Glance**:

| # | Storyline | Services Involved |
|:---:|------|------|
| AH-1 | Multi-channel message intake & identity recognition | gateway-adapter |
| AH-2 | Multi-source knowledge ingestion & chunked vectorization | fact-retrieval |
| AH-3 | Structured fact extraction & storage | fact-retrieval |
| AH-4 | Multi-party fact conflict detection & merging | fact-retrieval |
| AH-5 | Natural language knowledge retrieval | fact-retrieval |
| AH-6 | Human knowledge review & approval | web-portal |
| AH-7 | Intent recognition & task planning | workflow-service |
| AH-8 | Workflow stage auto-execution | executor-gateway |
| AH-9 | WeChat/Feishu long task async feedback | gateway-adapter |
| AH-10 | Memory storage & context compression | hermes-adapter |
| AH-11 | Skill library management & skill extraction | skill-library |
| AH-12 | User profile & persona system | web-portal |
| AH-13 | Permission policies & data isolation | policy |
| AH-14 | AI code execution tool | executor-gateway |
| AH-15 | Artifact storage & version management | fact-retrieval |
| AH-16 | Workflow Checkpoint & recovery | workflow-service |
| AH-17 | Audit logging & full-chain tracing | audit |
| AH-18 | Inspection scheduling & resource reclamation | resource-scheduler |
| AH-19 | Mobile push notifications | mobile-app |
| AH-20 | Dream Mode: hierarchical memory management + skill discovery ecosystem, with knowledge/skill business attribution tracking | hermes-adapter, skill-library, workflow-service, fact-retrieval, web-portal |
| AH-21 | B2B sales management daily routine & workflow observability closed loop | gateway-adapter, workflow-service, executor-gateway, fact-retrieval, web-portal |

---

## Development Guide

### Project Structure

This project is an **npm workspaces monorepo**:

```bash
npm install          # Install all workspace dependencies
npm run type-check   # TypeScript type checking
npm run build        # Compile all packages
npm test             # Run tests
npm run lint         # Code style checks
npm run smoke:workflow-observability  # Workflow reuse, observability, and confirm-to-solidify smoke test
npm run test:dream-mode  # Dream Mode and attribution closed-loop integration tests
```

### Development Mode

In development mode, application service source code is mounted into containers via Docker volumes:

```yaml
volumes:
  - ./services/workflow/src:/app/src:ro
```

After modifying source code, restart the container for changes to take effect:

```bash
docker compose restart workflow-service
```

### Database Development

```bash
# View Drizzle Schema
cat db/schema.ts

# Generate migration (Drizzle Kit)
npm run db:generate

# Push Schema to database
npm run db:push

# Execute SQL migrations
npm run db:migrate
```

---

## Deployment & Operations

### Production Deployment Checklist

- [ ] Set all environment variables (never use default passwords)
- [ ] Use `docker-compose.prod.yml` overlay file
- [ ] Configure HTTPS reverse proxy (nginx/Caddy)
- [ ] Configure Feishu/WeCom Webhook callback URLs
- [ ] Initialize admin account: `node scripts/init-admin.cjs`
- [ ] Run health check: `npm run health:core`
- [ ] Configure log rotation (see OPS.md)

### Common Operations Commands

```bash
# View service logs
docker compose logs -f gateway-adapter

# Restart a single service
docker compose restart workflow-service

# Stop all services
npm run docker:down

# Database backup
docker exec ah-postgres pg_dump -U agent_harness agent_harness > backup.sql
```

For detailed operations guidance, see the [Operations Manual](./OPS.md).

---

## License

This project itself is licensed under the **MIT License**. See [LICENSE](./LICENSE).

Third-party component licenses used by this project are detailed in [LICENSES.md](./LICENSES.md), covering all open-source license statements for NPM packages and Docker images.

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/andyrenxu7255">Andy Ren</a></sub>
</p>
