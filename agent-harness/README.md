# Agent Harness V1

> Enterprise Agent Execution Platform

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Git

### 1. Clone and Setup

```bash
git clone <repository>
cd agent-harness
```

### 2. Environment Configuration

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Start Infrastructure

```bash
npm run infra:bootstrap
```

This starts:
- PostgreSQL 16 + pgvector + AGE
- Redis 7
- MinIO (S3-compatible storage)

Optional:

```bash
# Core + LiteLLM
npm run infra:bootstrap:llm

# Core + LiteLLM + SigNoz
npm run infra:bootstrap:full
```

### 4. Verify Health

```bash
npm run health:core
```

### 5. Run Migrations

```bash
npm run db:migrate
```

This applies the checked-in SQL migrations under `db/migrations/` and records them in `_manual_sql_migrations`.

Note: LiteLLM uses a separate PostgreSQL database named `litellm` and must not share the main `agent_harness` application database.

## Development

### Install Dependencies

```bash
npm install
```

### Type Check

```bash
npm run type-check
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Preflight Audit Gate

```bash
npm run preflight:audit
```

## Architecture

```
agent-harness/
├── apps/           # Applications
│   ├── gateway-adapter/   # Channel ingress & intent routing
│   ├── web-portal/        # Web admin UI
│   └── mobile-app/        # Push notification service
├── services/       # Core services
│   ├── workflow/          # Workflow engine
│   ├── fact-retrieval/    # Retrieval & facts & knowledge review
│   ├── executor-gateway/  # Code execution
│   ├── hermes-adapter/    # Memory & skills
│   ├── skill-library/     # Skill registry & candidates
│   └── resource-scheduler/# Resource quota & health checks
├── libs/           # Shared libraries
│   ├── contracts/         # Schemas & types
│   ├── shared/            # Utilities & DB schema
│   ├── policy/            # RBAC/ABAC
│   └── audit/             # Audit logging
└── db/             # Database migrations
```

## Service Overview

| Service | Port | Description |
|---------|------|-------------|
| gateway-adapter | 3000 | Multi-channel ingress, identity mapping, 4-way intent classification (chat/task/knowledge_submit/quick_lookup) |
| workflow-service | 3001 | Workflow planning, supervision, XState state machine |
| executor-gateway | 3002 | Stage dispatch, multi-executor orchestration, dream memory compression |
| web-portal | 3003 | Admin UI: login, policies, org management, knowledge review, audit |
| fact-retrieval | 3004 | Vector search, knowledge graph, fact submission & review, knowledge extraction |
| hermes-adapter | 3005 | Session memory: store, recall, compression |
| skill-library | 3007 | Skill registry, versioning, candidate generation |
| resource-scheduler | 3008 | Org quota checks, resource reclamation, health patrol |
| mobile-app | 3009 | FCM/APNs push notifications, device registration |

## Documentation

| 文档 | 内容 |
|------|------|
| [产品说明](./PRODUCT.md) | 功能特性、使用场景、核心价值 |
| [架构文档](./ARCHITECTURE.md) | 系统架构、数据流、API 端点速查 |
| [运维手册](./OPS.md) | 部署、监控、故障排查、备份恢复 |
| [开源协议](./LICENSES.md) | 第三方依赖许可证清单 |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史、修复记录、当前状态 |

## License

本项目本体采用 **MIT** 许可证。使用的第三方组件许可证见 [LICENSES.md](./LICENSES.md)。
