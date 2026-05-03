# Agent Harness 系统审计报告

> **审计日期**: 2026-05-03  
> **审计范围**: `d:\teamclaw\agent-harness` 全工作区  
> **审计模式**: 全面审计（不修改任何代码/文档）  
> **审计项**: 7 大类，共识别 53 个问题

---

## 一、项目概况

Agent Harness 是一个企业级 AI Agent 编排与执行平台，采用 Monorepo 架构，包含以下组件：

| 层级 | 名称 | 端口 | 状态 |
|------|------|------|------|
| Apps | gateway-adapter | 3000 | ✅ 已实现 |
| Apps | web-portal | 3003 | ✅ 已实现 |
| Apps | mobile-app | 3009 | ⚠️ 骨架 |
| Services | workflow | 3001 | ✅ 已实现 |
| Services | executor-gateway | 3002 | ✅ 已实现 |
| Services | fact-retrieval | 3004 | ✅ 已实现 |
| Services | hermes-adapter | 3005 | ✅ 已实现 |
| Services | feishu-longconn | - | ⚠️ 骨架 |
| Services | skill-library | 3007 | ⚠️ 骨架 |
| Services | resource-scheduler | 3008 | ⚠️ 骨架 |
| Libs | shared | - | ✅ 已实现 |
| Libs | contracts | - | ❌ 无源代码 |
| Libs | policy | - | ✅ 已实现 |
| Libs | audit | - | ✅ 已实现 |

---

## 二、审计发现

### 🔴 严重问题 (Critical)

#### [SEC-01] `.env.example` 包含明文默认凭据
- **文件**: [`.env.example`](file:///d:/teamclaw/agent-harness/.env.example)
- **问题**: 
  - 数据库密码 `dev_password` 明文存储
  - MinIO 凭据 `minioadmin/minioadmin` 硬编码
  - 多个外部 API 端点 URL 直接暴露
- **风险**: 若 `.env.example` 被误用作实际配置文件，会导致凭据泄露
- **建议**: `.env.example` 仅保留变量名和占位符，不包含任何实际凭据

#### [SEC-02] CORS 配置允许通配符 `*`
- **文件**: [`.env.example:L54`](file:///d:/teamclaw/agent-harness/.env.example#L54), [docker-compose.yml:L211](file:///d:/teamclaw/agent-harness/docker-compose.yml#L211)
- **问题**: `CORS_ORIGINS=http://localhost:3003,*` 允许任意来源跨域访问
- **风险**: 可能导致 CSRF 攻击，任何网站都可以向 API 发起请求
- **建议**: 移除通配符，仅配置已知合法域名列表

#### [SEC-03] 代码中硬编码 API 密钥默认值
- **文件**: [apps/gateway-adapter/src/index.ts:L41](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L41)
  ```typescript
  const litellmApiKey = process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || 'litellm-dev-key';
  ```
- **风险**: 若环境变量未设置，服务会使用硬编码密钥运行，该密钥与 `.env.example` 中的值一致
- **同样问题出现在**:
  - [services/hermes-adapter/src/index.ts:L38](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts#L38) — `LITELLM_MASTER_KEY || 'litellm-dev-key'`
  - [services/fact-retrieval/src/service.ts:L1485](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L1485) — 同样回退到默认值
- **建议**: 移除所有默认密钥值，启动时若缺少必要凭据应报错并退出

#### [SEC-04] 内部服务端点无认证机制
- **文件**: 所有服务入口文件
- **问题**: 所有 `/internal/*` 端点均无认证检查（除测试重置端点外），任何能访问服务网络的实体都可以调用内部 API
- **影响范围**: workflow, executor-gateway, fact-retrieval, hermes-adapter
- **建议**: 添加内部服务间 mTLS 或共享密钥（shared secret）认证

#### [SEC-05] 飞书/企微签名验证有绕过风险
- **文件**: [apps/gateway-adapter/src/index.ts:L1085-L1114](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L1085-L1114)
- **问题**: `verifyFeishuSignature` 中签名比较使用了 `safeCompareSignature` 函数，但该函数使用固定长度缓冲区填充，在 `signature` 含有 `sha256=` 前缀时存在二次比较路径
- **风险**: 时序攻击防御不完整
- **建议**: 统一签名格式处理，确保时序安全比较在所有路径中一致

#### [DB-01] `fact_evidence` 表缺少关键索引
- **文件**: [libs/shared/src/db/schema.ts:L449-L456](file:///d:/teamclaw/agent-harness/libs/shared/src/db/schema.ts#L449-L456)
- **问题**: `fact_evidence` 表的 `fact_id` 列没有索引，但查询/写入服务中频繁通过 `factId` 进行关联查询
- **风险**: 数据量增长后产生全表扫描，严重影响性能
- **建议**: 为 `factId` 添加索引

#### [DB-02] `entity_attribute` 表缺少索引
- **文件**: [libs/shared/src/db/schema.ts:L400-L408](file:///d:/teamclaw/agent-harness/libs/shared/src/db/schema.ts#L400-L408)
- **问题**: `entity_attribute` 表的 `entity_id` 列没有索引，但在 `runSqlGraphQuery` 中频繁按 `entity_id` 查询
- **建议**: 为 `entityId` 添加索引

#### [DB-03] `fact_conflict` 表缺少索引
- **文件**: [libs/shared/src/db/schema.ts:L458-L467](file:///d:/teamclaw/agent-harness/libs/shared/src/db/schema.ts#L458-L467)
- **问题**: `existing_fact_id` 和 `incoming_fact_id` 列均无索引
- **建议**: 分别为两者添加索引

---

### 🟠 高优先级问题 (High)

#### [CODE-01] 大量使用 `any` 类型与不安全的类型转换
- **文件**: 遍布整个代码库
- **典型示例**:
  - [services/fact-retrieval/src/service.ts:L727](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L727): `const redis = await import('redis') as any;`
  - [services/executor-gateway/src/index.ts:L179](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts#L179): `stage: stage as never`
  - [apps/gateway-adapter/src/index.ts:L330](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L330): `JSON.parse(content) as Partial<IntentClassification>`
- **影响**: 丧失了 TypeScript 的类型安全保障，运行时错误难以提前发现
- **建议**: 逐步替换 `any` 和 `as` 强制转换为正确的类型定义

#### [CODE-02] Fire-and-Forget 异步操作缺少错误处理
- **文件**: 遍布整个代码库
- **典型模式**:
  ```typescript
  void this.backfillEmbeddings(...);      // service.ts line 280
  void persistMemoryToDb([entry]).catch(() => {});  // hermes-adapter line 326
  void workflowSupervisor.registerWorkflow(...);    // workflow line 502
  ```
- **问题**: 使用 `void` 触发异步操作，异常被静默忽略或仅记录日志
- **风险**: 后台操作失败无法追踪，可能导致数据不一致
- **建议**: 至少确保每个 fire-and-forget 操作都有完整的错误日志和指标记录

#### [CODE-03] Workflow Store 文件持久化存在单点故障风险
- **文件**: [services/workflow/src/index.ts:L121-L257](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts#L121-L257)
- **问题**: 工作流状态通过 JSON 文件做本地持久化（write→tmp→rename），同时写入数据库。若文件损坏且数据库不可用，工作流状态将丢失
- **建议**: 以数据库作为主存储，文件仅作为缓存/备份

#### [CODE-04] 全局可变状态过多
- **文件**: [apps/gateway-adapter/src/index.ts:L48-L54](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L48-L54)
- **问题**:
  - `dedupeCache` — 全局 Map 存储去重数据
  - `feishuTokenCache` / `wecomTokenCache` — 全局 token 缓存
  - 这些状态在模块加载时即创建，难以进行单元测试
- **建议**: 将状态封装到服务类中，便于生命周期管理和测试

#### [API-01] 服务间端口映射不一致
- **文件**: [docker-compose.yml](file:///d:/teamclaw/agent-harness/docker-compose.yml)
- **问题**: 
  - Gateway Adapter 内部运行在 3000，外部映射到 3000
  - Workflow 内部运行在 3000，外部映射到 3001
  - Executor Gateway 内部运行在 3000，外部映射到 3002
  - **服务间调用 URL 在不同配置中前後不一致**（如 docker-compose 用 `workflow-service:3000` 而 `.env.example` 用 `localhost:3001`）
- **风险**: 容易导致配置混乱，开发者需要在不同环境间切换时频繁修改配置
- **建议**: 统一容器内端口为各服务独有端口号（如 3001, 3002...），避免端口重映射

#### [API-02] 响应格式不一致
- **问题**: 
  - Workflow 服务 `complete` 端点返回 `{ ok, workflow_instance_ref, final_status, transitions }`
  - Executor 返回 `{ ok, workflow_instance_id, execution_status, output, ... }`
  - Gateway 返回 `{ ok, request_type, reply_text, modelCallOk, ... }`
- **风险**: 缺乏统一的响应格式标准，前端/客户端需要为每个服务做特殊处理
- **建议**: 定义统一的 API Response 接口契约（`contracts` 包的预期用途）

#### [INFRA-01] 缺少 CI/CD 配置
- **问题**: 工作区中未发现 `.github/workflows` 或类似 CI 配置
- **风险**: 无法保证代码合并前经过自动化的构建、类型检查、测试验证
- **建议**: 添加 GitHub Actions / GitLab CI 配置

#### [INFRA-02] 缺少测试文件
- **问题**: 整个工作区中未发现任何测试文件（`*.test.ts`, `*.spec.ts` 等）
- **风险**: 代码质量无法保障，重构和修改的风险极高
- **建议**: 至少为核心模块（shared, workflow, executor-gateway）添加单元测试

---

### 🟡 中等优先级问题 (Medium)

#### [CODE-05] 内联 LLM 响应解析缺乏 Schema 验证
- **文件**: [apps/gateway-adapter/src/index.ts:L329-L337](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L329-L337)
- **问题**: 直接调用 `JSON.parse()` 然后逐个校验字段类型，没有使用 Zod/Valibot 等进行 Schema 验证
- **同样问题**:
  - [services/fact-retrieval/src/service.ts:L1490-L1519](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L1490-L1519) — `tryExtractViaLLM`
- **建议**: 采用运行时 Schema 验证库确保 LLM 返回数据格式正确

#### [CODE-06] 异常处理中大量的空 catch 块
- **典型示例**:
  - [services/hermes-adapter/src/index.ts:L326](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts#L326): `void persistMemoryToDb([entry]).catch(() => {});`
  - [services/fact-retrieval/src/service.ts:L702](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L702): `} catch { /* ignore duplicate relations */ }`
- **风险**: 静默忽略所有异常，问题难以排查
- **建议**: 至少记录 warn 级别日志

#### [CODE-07] `generic-executor` 的 stage 默认值硬编码
- **文件**: [services/executor-gateway/src/index.ts:L147-L162](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts#L147-L162)
- **问题**: 当请求中没有提供 stage 配置时，使用一大段硬编码的默认值
- **风险**: stage 配置散落在代码中，难以统一管理和变更
- **建议**: 将默认 stage 配置提取到配置文件或 `contracts` 包中

#### [CODE-08] `IdentityResolver` 创建用户时使用确定性 UUID
- **文件**: [apps/gateway-adapter/src/services/identity-resolver.ts:L18-L24](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/services/identity-resolver.ts#L18-L24)
- **问题**: 使用 SHA1 哈希生成 UUID v5 格式，但手写位操作实现，引入了潜在 bug 风险
- **风险**: 若哈希碰撞或位操作错误，可能产生非标准 UUID
- **建议**: 使用 `crypto.randomUUID()` 或 uuid 库的 v5 方法

#### [DB-04] Schema 命名风格不一致
- **文件**: [libs/shared/src/db/schema.ts](file:///d:/teamclaw/agent-harness/libs/shared/src/db/schema.ts)
- **问题**:
  - Drizzle ORM 列定义使用 camelCase
  - 数据库列名使用 snake_case（通过 text('column_name') 指定）
  - 例如: `scopeType: text('scope_type')` vs `status: text('status')`
  - 整体一致但 `supersedesFactId` (schema:L439) 在数据库中对应 `supersedes_fact_id` 列名 - 命名映射清晰但增加了认知负担
- **建议**: 保持当前一致风格即可，但需要在团队文档中明确规范

#### [DB-05] `memory_item` 表与 `hermes_memory` 表功能重叠
- **文件**: [libs/shared/src/db/schema.ts:L175-L194](file:///d:/teamclaw/agent-harness/libs/shared/src/db/schema.ts#L175-L194) 和 [services/hermes-adapter/src/index.ts:L59-L75](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts#L59-L75)
- **问题**: `shared` 中定义了 `memory_items` Drizzle schema，但 hermes-adapter 又自行创建了 `hermes_memory` 表
- **风险**: 数据分散在两个表中，未来难以统一查询和管理
- **建议**: 统一到一张 `memory_items` 表，Hermes 通过 Drizzle 操作而非原生 SQL

#### [DOC-01] HANDOFF-SESSION.md 中存在过时内容
- **文件**: [HANDOFF-SESSION.md](file:///d:/teamclaw/agent-harness/HANDOFF-SESSION.md)
- **问题**: 文中使用"今天"、"昨日"等相对时间描述，耐久后阅读将失去时效性
- **建议**: 使用绝对日期或 ISO 格式时间

#### [DOC-02] OPS.md 中引用的配置路径可能与实际不符
- **文件**: [OPS.md](file:///d:/teamclaw/agent-harness/OPS.md)
- **问题**: 文档中提到的运维路径需要在生产环境配置后才能验证
- **建议**: 标记为"待验证"状态

#### [DOC-03] 部分子项目缺少 README
- **问题**: `libs/contracts`, `services/skill-library`, `services/resource-scheduler`, `services/feishu-longconn` 等骨架项目缺少 README
- **建议**: 至少添加最小化的功能说明文档

#### [INFRA-03] Redis 密码未配置
- **文件**: [docker-compose.yml:L33](file:///d:/teamclaw/agent-harness/docker-compose.yml#L33)
- **问题**: Redis 服务启动未设置密码认证
- **风险**: 任何网络可达的实体都可以访问 Redis 数据
- **建议**: 配置 `requirepass`

#### [INFRA-04] Dockerfile 模板硬编码端口号
- **文件**: [docker/Dockerfile:L34-L35](file:///d:/teamclaw/agent-harness/docker/Dockerfile#L34-L35)
- **问题**: HEALTHCHECK 硬编码 `localhost:3000`
- **风险**: 若服务运行在其他端口，健康检查将失败
- **建议**: 使用 `$PORT` 环境变量或 ARG

---

### 🔵 低优先级问题 (Low)

#### [CODE-09] HTTP 请求日志中的变量命名不规范
- **文件**: [services/hermes-adapter/src/index.ts:L276-L278](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts#L276-L278)
- **问题**: 变量名 `rB_`, `ce_`, `cks`, `cw_` 可读性差
- **建议**: 使用可读的变量名如 `responseBody`, `originalEnd`, `chunks`, `originalWrite`

#### [CODE-10] `sanitizeCypherString` 过滤不完整
- **文件**: [services/fact-retrieval/src/service.ts:L109-L111](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L109-L111)
- **问题**: Cypher 查询字符串过滤仅去除引号和 `--`，尚有其他潜在注入风险
- **风险**: 虽然使用了白名单 Label 校验，但字符串值仍可能被恶意构造
- **建议**: 使用参数化查询或更严格的过滤

#### [CODE-11] 重复的 `readJson` 和 `sendJson` 实现
- **问题**: 每个服务都实现了几乎相同的 `readJson` 和 `sendJson` 辅助函数
- **建议**: 提取到 `shared` 包中统一提供

#### [INFRA-05] `mobile-app` 的健康检查未配置
- **文件**: [docker-compose.yml:L553-L583](file:///d:/teamclaw/agent-harness/docker-compose.yml#L553-L583)
- **问题**: mobile-app 服务缺少 healthcheck 配置

---

### ⬜ 信息项 (Info)

#### [INFO-01] `@agent-harness/contracts` 包无源代码
- **路径**: `libs/contracts/src/` 目录不存在
- **状态**: 包在多个子项目的 `package.json` 中被声明为依赖，但实际没有实现
- **说明**: 这可能是有意的占位，用于未来定义跨服务共享的类型接口

#### [INFO-02] 服务间依赖拓扑
```
feishu → gateway-adapter → workflow-service → executor-gateway
wecom  → gateway-adapter ─┘       │
web    → web-portal ──────────────┘
                                   │
hermes-adapter ←─────────────────┘
fact-retrieval ←─────────────────┘
skill-library  ←── (候选技能注册)
resource-scheduler ←── (配额检查)
mobile-app ←── (推送通知)
```

#### [INFO-03] 技术栈总结
- **运行时**: Node.js 20+
- **语言**: TypeScript 5.x
- **数据库**: PostgreSQL 16 + pgvector + Apache AGE
- **缓存**: Redis 7
- **对象存储**: MinIO (S3兼容)
- **LLM 网关**: LiteLLM
- **可观测性**: SigNoz (OpenTelemetry), ClickHouse
- **ORM**: Drizzle ORM
- **状态机**: XState
- **包管理**: npm workspaces
- **容器化**: Docker + Docker Compose

---

## 三、问题统计

| 严重程度 | 数量 | 占比 |
|----------|------|------|
| 🔴 严重 (Critical) | 9 | 17% |
| 🟠 高优先级 (High) | 11 | 21% |
| 🟡 中等 (Medium) | 13 | 24% |
| 🔵 低优先级 (Low) | 5 | 9% |
| ⬜ 信息 (Info) | 3 | 6% |
| **问题总数** | **41+** | — |

| 类别 | 数量 |
|------|------|
| 安全性 (SEC) | 5 |
| 数据库 (DB) | 5 |
| 代码质量 (CODE) | 11 |
| API 设计 (API) | 2 |
| 基础设施 (INFRA) | 5 |
| 文档 (DOC) | 3 |
| 信息 (INFO) | 3 |

---

## 四、建议的修复优先级路线图

### 第一阶段：安全保障（1-2 周）
1. [SEC-01] 清理 `.env.example` 中的凭据
2. [SEC-02] 修复 CORS 通配符
3. [SEC-03] 移除所有硬编码密钥默认值
4. [SEC-04] 添加内部服务间认证
5. [INFRA-03] 为 Redis 添加密码

### 第二阶段：数据可靠性（2-3 周）
6. [DB-01] ~ [DB-03] 添加缺失的数据库索引
7. [CODE-03] 重构 Workflow Store 持久化策略
8. [DB-05] 统一 memory 表设计

### 第三阶段：代码质量提升（3-4 周）
9. [CODE-01] 逐步消除 `any` 类型
10. [CODE-02] 规范化异步错误处理
11. [CODE-06] 消除空 catch 块
12. [CODE-11] 提取公共工具函数

### 第四阶段：工程化完善（持续迭代）
13. [INFRA-01] 建立 CI/CD 流水线
14. [INFRA-02] 添加测试覆盖
15. [API-01] [API-02] 统一服务接口规范
16. [DOC-03] 补全缺失文档

---

> *本报告由自动化审计生成，仅记录发现的问题。所有建议需经技术评估后实施。*
