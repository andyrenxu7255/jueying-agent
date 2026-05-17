# JueYing (绝影) — Agent Harness 🐎

> 版本: 1.3.0 | 更新日期: 2026-05-17

> **企业级 AI Agent 编排与执行平台** — 多渠道接入、既有 workflow 优先复用、LLM 任务规划、多阶段工作流自动执行

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
| 🧠 **LLM 任务规划** | 先匹配个人/组织/公共 workflow，未命中时再自动拆解为多阶段工作流 |
| ⚙️ **工作流引擎** | 基于 XState 状态机的完整生命周期：plan → execute → verify → repair → report |
| 📈 **销售管理样板** | 支持 B2B 销售晨会、卡单救援、回款风险、折扣审批和周复盘故事线 |
| 🔍 **知识检索** | 向量搜索 + 全文检索 + 图检索 + 重排序，多维度知识获取 |
| 🗃️ **事实与实体管理** | 结构化事实存储、冲突检测、证据溯源、实体关系图谱 |
| 🧠 **记忆与技能** | 会话记忆存储/召回/压缩、技能模板注册与复用 |
| 🔁 **确认后复用** | 成功首跑会展示过程和结果，用户回复“确认工作流 wf_xxx”后沉淀为私有 workflow |
| 📊 **可观测性** | OpenTelemetry + SigNoz 全链路追踪、审计日志、健康检查 |
| 📁 **文件工作区** | 用户隔离存储、双后端(localFS/MinIO)、staging机制、三级scope共享 |
| 🔐 **安全合规** | 用户/组织隔离、RBAC/ABAC 策略、密码 scrypt 哈希、SQL 参数化防护 |

### 技术栈

- **语言**: TypeScript 5.9 + Node.js ≥20
- **数据库**: PostgreSQL 16 + pgvector + Apache AGE (图数据库)
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
FEISHU_SIGNING_SECRET=xxxxxxxxxxxxxxxx

# 企微渠道（可选）
WECOM_TOKEN=xxxxxxxxxxxx
WECOM_CORP_ID=xxxxxxxxxxxx
```

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
| [用户故事线](./用户故事线.md) | 20 条验收故事线 (AH-1 ~ AH-20)，含梦境模式 |
| [修复报告](./FIX-REPORT.md) | 代码审计与修复记录 |
| [前端修改记录](./FRONTEND-AUDIT-CHANGELOG.md) | 前端页面审计修改记录（含15项初始化+梦境模式） |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史、11 轮修复详情、当前系统状态 |
| [审计报告](./AUDIT-REPORT.md) | 7 大类 53 项代码质量/安全审计 |
| [开源协议声明](./LICENSES.md) | 完整 LICENSE 文本 + 第三方依赖许可证清单 |

---

## 用户故事线

完整用户故事线请参阅 [用户故事线.md](./用户故事线.md)。

**20 条故事线速览**：

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
| AH-20 | 梦境模式：记忆分层管理+技能发现生态 | hermes-adapter, skill-library, web-portal |

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
