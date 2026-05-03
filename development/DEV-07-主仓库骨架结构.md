# 主仓库骨架结构

> **版本**: v1.0 | **状态**: 已冻结

---

## 1. 目录结构

```
agent-harness/
├── apps/
│   ├── gateway-adapter/          # 接入层：渠道消息标准化、身份解析、Session映射
│   │   ├── src/
│   │   │   ├── channels/        # 渠道适配器（企业微信/飞书/Webhook）
│   │   │   ├── auth/           # 认证中间件（JWT/OAuth）
│   │   │   ├── middleware/      # 限流、日志、错误处理
│   │   │   ├── routes/         # API路由定义
│   │   │   ├── services/       # 业务逻辑层
│   │   │   └── utils/           # 工具函数
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web-portal/               # Web前端（Day 1最小化）
│       ├── src/
│       └── package.json
│
├── services/
│   ├── workflow/                 # Workflow治理：Planner、状态机、Checkpoint、进度汇报
│   │   ├── src/
│   │   │   ├── engine/         # XState状态机
│   │   │   ├── planner/        # LLM Planner调用
│   │   │   ├── retrieval/       # 检索编排器
│   │   │   ├── stages/          # Stage执行器
│   │   ├── checkpoint/         # Checkpoint管理
│   │   ├── events/            # 事件发布/订阅
│   │   │   └── types/          # 类型定义
│   │   └── tests/
│   │
│   ├── fact-retrieval/          # 事实与检索：结构化、全文、向量、图增强、Evidence Pack、Fact Write
│   │   ├── src/
│   │   │   ├── structured/     # 结构化查询
│   │   │   ├── fulltext/       # 全文检索
│   │   │   ├── vector/         # 向量召回
│   │   │   ├── graph/          # 图增强（AGE）
│   │   │   ├── rerank/         # 重排序
│   │   │   └── evidence/       # Evidence Pack
│   │   └── tests/
│   │
│   ├── executor-gateway/         # 执行层：通用Executor、Code Executor Adapter、调度
│   │   ├── src/
│   │   │   ├── session/        # 会话生命周期管理
│   │   │   ├── sandbox/        # 沙箱环境
│   │   │   ├── adapter/        # Code Executor适配器
│   │   │   ├── collector/        # 执行结果收集器
│   │   │   └── security/        # 安全策略执行
│   │   └── tests/
│   │
│   └── hermes-adapter/           # Hermes适配：memory/dream/skill候选治理
│       ├── src/
│       └── tests/
│
├── libs/
│   ├── contracts/                 # 稳定JSON schema、事件字典、错误码、DTO
│   │   ├── schemas/
│   │   ├── events/
│   │   ├── errors/
│   │   └── types/
│   │
│   ├── policy/                   # Policy Snapshot生成、校验、scope过滤
│   │   ├── src/
│   │   └── tests/
│   │
│   ├── audit/                    # 审计写入、审计查询
│   │   ├── src/
│   │   └── tests/
│   │
│   └── shared/                    # 配置管理、日志、指标、错误处理、降级、限流
│       ├── src/
│       │   ├── config/          # 配置加载与验证
│       │   ├── logging/          # 结构化日志
│       │   ├── metrics/         # 指标埋点
│       │   ├── retry/           # 重试策略
│       │   └── rate-limit/        # 限流
│       └── tests/
│
├── db/
│   ├── migrations/                # PostgreSQL DDL迁移脚本（按序编号）
│   │   ├── 001_init_extensions.sql
│   │   ├── 002_identity_policy.sql
│   │   ├── 003_workflow_core.sql
│   │   ├── 004_document_evidence.sql
│   │   ├── 005_entity_fact.sql
│   │   ├── 006_artifact.sql
│   │   ├── 007_retrieval_audit.sql
│   │   └── 008_memory_skill.sql
│   │
│   ├── queries/                  # 常用SQL查询模板
│   │   ├── structured/
│   │   ├── fulltext/
│   │   └── vector/
│   │
│   └── age/                      # AGE图投影脚本
│       └── projections/
│
├── config/
│   ├── default.yaml              # 默认配置
│   ├── development.yaml           # 开发环境
│   ├── test.yaml                # 测试环境
│   ├── production.yaml           # 生产环境
│   └── schemas/
│       └── config.schema.json    # JSON Schema验证
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── pocs/                          # PoC验证脚本
├── tests/
│   ├── fixtures/                 # 测试数据
│   ├── helpers/                  # 测试工具
│   └── setup/
│
├── docs/                          # 开发文档
│
├── scripts/                       # 运维脚本
│   ├── backup/
│   ├── health-check.sh
│   └── init-db.sh
│
├── package.json                    # 根workspace配置
├── tsconfig.json                   # 根TypeScript配置
├── package-lock.json
└── README.md
```

---

## 2. 核心依赖

| 包名 | 版本 | 来源 | 用途 |
|------|------|------|------|
| xstate | ^5.x | npm | Workflow状态机 |
| ai | ^4.x | npm | Vercel AI SDK |
| @effect/* | ^5.x | npm | 函数式运行时 |
| drizzle-orm | ^1.x | npm | PostgreSQL ORM |
| bullmq | ^5.x | npm | 任务队列 |
| node-casbin | ^5.x | npm | 权限引擎 |
| zod | ^4.x | npm | Schema校验 |
| @opentelemetry/* | latest | npm | 可观测性 |
| @types/node | ^20.x | npm | Node类型 |

---

## 3. 服务间API

### 3.1 Gateway Adapter -> Workflow Service

```typescript
// POST /internal/workflows/plan
POST http://workflow-service:3001/internal/workflows/plan
Authorization: Bearer <jwt>
X-Trace-Id: <trace_id>
```

### 3.2 Workflow Service -> Fact-Retrieval

```typescript
// POST /internal/retrieval/query
POST http://fact-retrieval:3002/internal/retrieval/query
```

### 3.3 Workflow Service -> Executor Gateway

```typescript
// POST /internal/code-executor/sessions
POST http://executor-gateway:3003/internal/code-executor/sessions
```

---

## 4. 数据库连接

```typescript
// Docker网络内连接
DATABASE_URL=postgresql://user:pass@postgres:5432/agent_harness

// Redis连接
REDIS_URL=redis://redis:6379
```

---

## 5. 环境变量模板

```bash
# .env.example
NODE_ENV=development
DATABASE_URL=postgresql://agent_harness:dev_password@localhost:5432/agent_harness
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
COHERE_API_KEY=xxx
LOG_LEVEL=debug
```

---

## 6. 开发命令

```bash
# 安装依赖
npm install

# 类型检查
npm run type-check

# 测试
npm test

# 构建
npm run build

# 启动所有服务
docker-compose up -d

# 运行迁移
npm run db:migrate

# 数据库推送（开发用）
npm run db:push
```
