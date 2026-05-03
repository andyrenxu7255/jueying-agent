# M0：开发准备与基线冻结

> **工期**: 1天 | **前置条件**: 无 | **阻塞条件**: 无

## M0.1 任务清单

### M0.1.1 仓库骨架初始化

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M0-01 | 创建主仓库 | 创建`agent-harness`仓库，按标准目录结构创建目录 | 仓库骨架 | 目录结构完整 | DEV-07主仓库骨架 §1 |
| M0-02 | 初始化TypeScript项目 | 在根目录和各services/libs下初始化package.json、tsconfig.json，统一使用Node 20+TypeScript 5.x | package.json | `npm install`无错误 | AH1-02 §D.0 §M0-2 |
| M0-03 | 安装核心依赖 | 安装xstate、ai（Vercel AI SDK）、drizzle-orm、effect、bullmq、casbin、zod、@opentelemetry/* | package.json | 所有依赖安装成功 | AH1-02 §D.0 §M0-3 |
| M0-04 | 初始化配置管理 | 创建`config/default.yaml`，实现5层配置优先级（代码默认<配置文件<环境特定<环境变量<命令行），使用Zod验证 | 配置加载器 | 缺失必填配置时启动失败 | AH1-28 §28.2 |

### M0.1.2 数据库与基础设施

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M0-05 | 初始化数据库迁移框架 | 使用Drizzle ORM迁移管理，创建`db/migrations/`目录，编号格式`001_init_extensions.sql` | 迁移框架 | 可执行空迁移 | AH1-14 §14.10 |
| M0-06 | 初始化Docker Compose | 创建`docker-compose.yml`，包含PostgreSQL 16+pgvector+AGE+Redis 7+MinIO+LiteLLM+SigNoz | docker-compose.yml | `docker-compose up`所有服务健康 | AH1-27 §27.3 |
| M0-07 | 初始化LiteLLM配置 | 创建`config/litellm_config.yaml`，配置OpenAI GPT-4o（主）和Claude 3.5 Sonnet（备），启用成本追踪和熔断 | LiteLLM配置 | LiteLLM代理可转发LLM请求 | AH1-26 §26.3 |
| M0-08 | 初始化SigNoz | 配置OpenTelemetry SDK导出端点，验证trace可在SigNoz中查看 | 遥测配置 | 一次测试请求的trace可在SigNoz中查看 | AH1-23 §23.6 |

### M0.1.3 核心库初始化

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M0-09 | 初始化libs/contracts | 定义统一信封结构（请求/响应/事件）、错误码前缀常量、核心DTO TypeScript类型 | contracts包 | 类型可被其他包导入 | AH1-15 §15.2 |
| M0-10 | 初始化libs/shared | 实现结构化日志（JSON格式、含trace_id/workflow_instance_id，通过OpenTelemetry SDK自动注入）、错误分类（Transient/Permanent/System） | shared包 | 日志可输出到stdout并被SigNoz采集 | AH1-23 §23.5 |
| M0-11 | 初始化libs/policy | 使用node-casbin定义RBAC模型（普通用户/admin/系统主体），实现Policy Snapshot序列化（sha256规范化JSON）、scope过滤SQL生成 | policy包 | casbin可判定权限，生成hash稳定可复现 | AH1-16 §16.3 |
| M0-12 | 初始化libs/audit | 实现audit_event写入接口、必审计动作常量、审计最小字段校验 | audit包 | 可写入审计事件 | AH1-23 §23.4 |

### M0.1.4 状态机与契约冻结

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M0-13 | 定义XState Workflow状态图 | 使用XState定义Workflow状态机：13种状态（draft/planned/running/waiting_user/blocked/verifying/repairing/reporting/paused/failed/succeeded/cancelled/archived）和14条迁移规则，配置持久化 | XState状态图 | 非法迁移被XState拒绝，合法迁移写入事件 | AH1-17 §17.21 |
| M0-14 | 冻结契约schema | 冻结文档15中定义的6类核心schema（Channel Ingress、Workflow Planning、Retrieval、Fact Write、Code Executor Session、事件schema） | JSON Schema文件 | schema可用于运行时校验 | AH1-15 §15.4 |

---

## M0.2 验收门槛

### M0.2.1 必须通过的检查项

- [ ] 仓库结构完整（DEV-07定义的所有目录）
- [ ] `docker-compose up`所有基础设施健康（含LiteLLM、SigNoz）
- [ ] contracts/policy/audit/shared包可编译导入
- [ ] XState状态图可运行，非法迁移被拒绝
- [ ] LiteLLM代理可转发LLM请求
- [ ] SigNoz可查看测试trace
- [ ] node-casbin权限判定正确
- [ ] 配置缺失时启动失败
- [ ] 6类核心schema冻结

---

## M0.3 关键代码规范（来源：AH1-01 §15.2）

### M0.3.1 TypeScript规范

```typescript
// tsconfig.json 核心配置
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### M0.3.2 错误码前缀规范（来源：AH1-15 §15.3）

| 前缀 | 类别 |
|------|------|
| `CHANNEL_*` | 渠道接入 |
| `IDENTITY_*` | 身份绑定 |
| `POLICY_*` | 权限策略 |
| `WORKFLOW_*` | Workflow治理 |
| `STAGE_*` | 阶段执行 |
| `EXECUTOR_*` | 执行器 |
| `RETRIEVAL_*` | 检索 |
| `FACT_*` | 事实写入 |
| `ARTIFACT_*` | 对象存储 |
| `INTEGRATION_*` | 外部集成 |
| `SYSTEM_*` | 系统级 |

### M0.3.3 必须禁止的模式

- [ ] 禁止使用空`catch {}`块
- [ ] 禁止手写裸SQL（迁移脚本除外）
- [ ] 禁止绕过LiteLLM直接调用Provider
- [ ] 禁止手写权限if-else（使用node-casbin）
- [ ] 禁止使用ts-node运行Worker

---

## M0.4 环境变量清单（来源：AH1-28 §28.3）

### M0.4.1 必填配置

```bash
# 数据库
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_URL=redis://host:6379

# LLM Provider
OPENAI_API_KEY=sk-xxx
```

### M0.4.2 选填配置

```bash
# Anthropic (备选)
ANTHROPIC_API_KEY=sk-ant-xxx

# Rerank
COHERE_API_KEY=xxx

# 对象存储
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
```

---

## M0.5 docker-compose服务清单（来源：AH1-27 §27.3）

```yaml
services:
  postgres:      # PostgreSQL 16 + pgvector + AGE
  redis:         # Redis 7
  minio:         # 对象存储
  litellm:       # LLM Gateway
  signoz-otel:   # OpenTelemetry Collector
  signoz:        # SigNoz前端
  signoz-clickhouse: # SigNoz存储
```

---

## M0.6 下一步

验收通过后，进入 **[M1：接入层+Workflow主链路](./DEV-02-M1接入层Workflow主链路.md)**

---
