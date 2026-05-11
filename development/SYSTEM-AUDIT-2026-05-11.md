# 系统代码审计报告 — 2026-05-11

> 审计范围：`/teamclaw/agent-harness` 主版本（不包含 archive/）
> 审计维度：安全、架构、配置、数据库模式、代码质量
> 审计方式：静态代码分析

---

## 总览

| 严重程度 | 数量 |
|---------|------|
| 🔴 CRITICAL | 4 |
| 🟠 HIGH | 12 |
| 🟡 MEDIUM | 20 |
| 🔵 LOW | 10 |
| ℹ️ INFO | 4 |
| ✅ POSITIVE | 6 |

---

## 一、安全问题

### 🔴 CRITICAL

#### S-01. SQL注入风险 — hermes-adapter
- **文件**: `agent-harness/services/hermes-adapter/src/index.ts`
- **行号**: 71-86, 176-190, 795-801 等多处
- **描述**: 使用 `$${idx++}` 手动递增索引和原始字符串插值构建动态SQL。`fetchSkillsFromDb`（行176）的 `WHERE ${conditions.join(' AND ')}` 拼接方式极易在未来修改中引入注入。`recallMemoryFromDb`（行267）的 `orgCondition` 硬编码 `'$4'` 存在隐患。
- **修复方向**: 全部迁移至 Drizzle ORM 或参数化查询，禁止字符串拼接。

#### S-02. 无内部服务认证 — 全服务
- **文件**: 
  - `agent-harness/services/hermes-adapter/src/index.ts`（11个端点）
  - `agent-harness/services/fact-retrieval/src/index.ts`（11个端点）
  - `agent-harness/services/workflow/src/index.ts`（4个端点）
  - `agent-harness/services/executor-gateway/src/index.ts`（3个端点）
  - `agent-harness/services/skill-library/src/index.ts`（多个端点）
- **描述**: 所有内部微服务端点均无认证中间件。完全依赖Docker网络隔离，一旦网络被突破，所有数据完全暴露。
- **修复方向**: 在共享库中实现认证中间件，所有内部端点强制校验。

#### S-03. 内部认证默认降级为无保护
- **文件**: `agent-harness/libs/shared/src/http/index.ts`, 行96-146
- **描述**: `INTERNAL_AUTH_SECRET` 未设置时，非生产环境自动 `return true`，即允许所有无认证的内部请求。
- **修复方向**: 改为 fail-closed 策略。缺少密钥时拒绝所有请求，不分环境。

#### S-04. docker-compose 默认密码硬编码
- **文件**: `agent-harness/docker-compose.yml`, 行12, 37, 62-63, 141
- **描述**: `POSTGRES_PASSWORD:-dev_password_changeme`、`REDIS_PASSWORD:-redis_changeme`、`MINIO_ROOT_PASSWORD:-minioadmin_changeme`、`CLICKHOUSE_PASSWORD:-clickhouse_changeme`。
- **修复方向**: 所有密码设为必填（`:?` 语法），或通过 `.env` 传入。

### 🟠 HIGH

#### S-05. execSync Docker命令注入风险
- **文件**: `agent-harness/apps/web-portal/src/index.ts`, 行1648-1671
- **描述**: `docker stats ... ${id}` 中 id 来自 docker ps 解析输出。容器名称含shell元字符可导致注入。
- **修复方向**: 使用 Docker Engine API 或 dockerode 库替代 shell 命令。

#### S-06. 会话令牌存localStorage
- **文件**: `agent-harness/apps/web-portal/static/app.js`, 行10-12, 141
- **描述**: Session ID 存储在 localStorage，XSS 可窃取。自定义 `x-session-id` 头无 HttpOnly 保护。
- **修复方向**: 迁移至 HttpOnly + Secure + SameSite Cookie。

#### S-07. 默认密码仍允许登录
- **文件**: `agent-harness/apps/web-portal/src/index.ts`, 行575, 654
- **描述**: 检测到 `admin`/`admin123` 仅设置 `mustChangePassword` 标志，登录仍成功。
- **修复方向**: 默认密码应直接拒绝登录，强制走重置流程。

#### S-08. prod override 不完整
- **文件**: `agent-harness/docker-compose.prod.yml`
- **描述**: 仅覆盖4个数据库/存储密码。未覆盖：`NODE_ENV`（无服务设为production）、`storage.use_ssl`（仍为false）、`LITELLM_MASTER_KEY`、`ADMAIN_PASSWORD`、API keys。
- **修复方向**: 补充所有生产必需的环境变量覆盖。

#### S-09. LLM Prompt注入
- **文件**: `agent-harness/services/executor-gateway/src/executor/generic-executor.ts`, 行235-284
- **描述**: 用户输入直接拼入LLM系统提示，无输出过滤。
- **修复方向**: 添加 prompt guardrail 和 output sanitization。

#### S-10. AI幻觉事实注入DB
- **文件**: `agent-harness/services/hermes-adapter/src/index.ts`, 行674-680
- **描述**: `/internal/memory/analyze` 的AI生成事实直接插入 fact 表（`status: 'unconfirmed'`），绕过 `fact/submit` 审核流程。
- **修复方向**: AI生成事实应走同样的审核/验证流程。

#### S-11. 技能库无所有权验证
- **文件**: `agent-harness/services/skill-library/src/index.ts`, 行925-1322
- **描述**: `create/update/publish/archive/promote-to-org` 均无所有权或管理员检查。任何用户可修改任意技能。
- **修复方向**: 每个mutation端点添加 ownership check 或 admin role check。

### 🟡 MEDIUM

#### S-12. 技能审核评分过于简单
- **文件**: `agent-harness/services/skill-library/src/index.ts`, 行1100-1141
- **描述**: 基于长度的启发式评分，未验证安全性。`scope: private` 技能可自动提升为 `org`。
- **修复方向**: 添加实际安全扫描和行为测试。

#### S-13. CORS配置宽松
- **文件**: `agent-harness/apps/web-portal/src/index.ts`, 行510-529
- **描述**: 默认允许 localhost:3003 和 127.0.0.1:3003。生产支持前缀通配符 `*`。
- **修复方向**: 生产环境使用精确域名白名单，移除通配符支持。

#### S-14. 会话验证薄弱
- **文件**: `agent-harness/apps/web-portal/src/index.ts`, 行250-268
- **描述**: 仅检查 session 存在性和 TTL，无 IP 绑定、User-Agent 校验、并发限制。
- **修复方向**: 添加绑定验证和异常检测。

#### S-15. 文件上传路径遍历风险
- **文件**: `agent-harness/services/fact-retrieval/src/index.ts`, 行328-347
- **描述**: 未验证 `original_name` 中的路径穿越字符。
- **修复方向**: 对文件名做 sanitize，仅保留 basename。

#### S-16. 未输入清洗的技能名称
- **文件**: `agent-harness/services/skill-library/src/index.ts`, 行926-954
- **描述**: `skill_name` 直接存储且部分上下文未 HTML 转义。
- **修复方向**: 添加输入清洗和输出编码。

#### S-17. 内部服务无安全头
- **详情**: hermes-adapter、fact-retrieval、executor-gateway、workflow、skill-library 的 JSON 响应未设置 `X-Content-Type-Options`、`X-Frame-Options` 等头。
- **修复方向**: 在共享库 `sendJson` 中统一添加。

#### S-18. BFF信任边界过宽
- **详情**: Web Portal 作为 BFF 代理所有服务，一旦被攻破所有下游暴露。无服务间相互认证。
- **修复方向**: 引入服务网格或 mTLS。

#### S-19. 内存访问日志无认证
- **文件**: `agent-harness/services/hermes-adapter/src/index.ts`, 行841-855
- **描述**: `/internal/memory/access-log` 无需认证。

#### S-20. 详细错误消息泄露
- **详情**: 部分端点返回 `String(error)` 到客户端，可能泄露内部信息。
- **修复方向**: 错误消息脱敏，仅返回 error code。

#### S-21. 内部认证密钥空字符串问题
- **文件**: `agent-harness/libs/shared/src/http/index.ts`, 行96
- **描述**: `|| ''` 导致 HMAC 计算结果可预测（空字符串的 HMAC 是确定值）。

### 🔵 LOW

#### S-22. 日志级别 debug 在开发环境
- **详情**: 开发环境使用 `debug` 级别日志，可能记录敏感请求数据。

#### S-23. 缺少请求速率限制（内部服务）
- **详情**: 除 `libs/shared/src/rate-limit/limiter.ts` 外，大部分端点未启用限流。

#### S-24. 未配置 Helmet.js 或等效安全头中间件
- **详情**: web-portal 手动设置安全头，不够全面。

---

## 二、架构与配置问题

### 🔴 CRITICAL

#### A-01. Config Schema 严重脱节
- **文件**: `agent-harness/config/schemas/config.schema.json`
- **缺失字段**: 
  - `workflow` 全部子字段（max_repairs, poll_interval_sec, plan_budget_sec, supervisor_budget_sec）
  - `llm` 的 provider-specific 配置（minimax, dashscope）
  - `storage.use_ssl`
  - `logging.format/output`
  - `FEISHU` 配置段
  - `CORS` 配置
  - `JWT_SECRET`/`SESSION_SECRET`
- **字段名不匹配**: `fallback_model` vs `fallback_models`, `worktree_base` vs `worktree_root`, `litellm_api_key` vs `litellm_master_key`, `key_prefix` vs `prefix`
- **影响**: Schema 验证基本失效，任何不符合预期的配置都能通过。

#### A-02. 文档-代码不一致
- **描述**: AH1-28 定义5层配置优先级，未验证实际代码实现一致性。AH1-15 统一信封协议未见强制。

### 🟠 HIGH

#### A-03. Litellm 无资源限制
- **文件**: `agent-harness/docker-compose.yml`, 行83-110
- **描述**: LLM网关暴露端口4000，无 `deploy.resources` 限制，潜在DoS面。

#### A-04. SigNoz 组件缺失健康检查
- **文件**: `agent-harness/docker-compose.yml`, 行113-185
- **描述**: otel-collector、clickhouse、signoz-frontend、signoz-query-service 均无健康检查。`depends_on` 对 otel-collector 永不真正验证。

#### A-05. 生产 SSL 禁用
- **文件**: `agent-harness/config/default.yaml:28`, `agent-harness/config/production.yaml:22`
- **描述**: `storage.use_ssl: false` 在生产配置中仍为 false。生产使用 S3 时应启用。

#### A-06. 平坦网络拓扑
- **文件**: `agent-harness/docker-compose.yml`
- **描述**: 所有服务在单一 `agent-harness-net` 网桥中，数据库/Redis/ClickHouse 可从任意容器直接访问。
- **修复方向**: 分离 frontend-facing 和 backend-only 服务到不同网络。

#### A-07. 依赖版本使用范围符
- **文件**: `agent-harness/package.json`
- **描述**: 所有依赖使用 `^` 范围而非精确版本（除 overrides 外），可能导致依赖漂移。

### 🟡 MEDIUM

#### A-08. OTel 收集器重复数据
- **文件**: `agent-harness/docker/otel-collector-config.yaml`, 行19-20
- **描述**: 定义了 `otlphttp` 导出器但 pipeline 未引用，可能导致数据重复或丢失。

#### A-09. OTel 端点无认证
- **文件**: `agent-harness/docker/otel-collector-config.yaml`
- **描述**: OTLP 接收器绑定 `0.0.0.0` 无认证。

#### A-10. 加密卷缺失
- **详情**: Docker 命名卷无加密驱动配置。

#### A-11. ESLint 缺少安全插件
- **文件**: `agent-harness/.eslintrc.cjs`
- **描述**: 未配置 `eslint-plugin-security` 或 `eslint-plugin-security-node`。

#### A-12. axios override 到已知风险版本
- **文件**: `agent-harness/package.json`, 行73
- **描述**: `"axios": "1.15.2"` 不是最新版本，axios 1.x 有已知安全问题。

#### A-13. sourceMap 生产风险
- **文件**: `agent-harness/tsconfig.json`, 行16
- **描述**: `sourceMap: true` 全局启用，需验证生产构建是否剥离。

### 🔵 LOW

#### A-14. 无回滚迁移脚本
- **详情**: `db/migrations/` 仅含 up 迁移，无 down/rollback。

#### A-15. 双迁移系统
- **详情**: 同时存在 `drizzle-kit migrate` 和 `apply-sql-migrations.js`，两套系统可能导致 schema 不一致。

---

## 三、数据库模式问题

### 🟠 HIGH

#### D-01. users 表缺少认证关键字段
- **文件**: `agent-harness/libs/shared/src/db/schema.ts`, 行303-315
- **缺失**: `email`、`password_hash`、`last_login_at`、`failed_login_attempts`、`mfa_secret` 等。
- **影响**: 认证数据可能分散在其他微服务中，导致认证逻辑不集中。

#### D-02. 无外键约束
- **详情**: 全表无任何外键约束（如 `fact_evidence.fact_id` → `facts.id`, `workflow_stages.workflow_instance_id` → `workflow_instances.id`），完全依赖应用层维护引用完整性。

#### D-03. 无软删除模式
- **详情**: 大部分表无 `deleted_at` 或 `is_deleted` 列，无法做软删除。

### 🟡 MEDIUM

#### D-04. 类型不一致
- **详情**: `hermes_memories.ownerUserId` 是 `text`，`user_files.userId` 也是 `text`，但其他表是 `uuid`。应统一。

#### D-05. 缺少 updated_by 审计字段
- **详情**: 所有表有 `createdAt` 但无 `updated_by` 或 `updated_by_user_id`。

### 🔵 LOW

#### D-06. 缺少附加索引
- `fact_conflicts` 缺失 `incoming_fact_id` 的独立索引
- `org_task_assignments` 缺失 `status` 的独立索引

---

## 四、代码质量问题

### 🟡 MEDIUM

#### C-01. 迁移版本号连续性需验证
- **文件**: `agent-harness/db/migrations/`
- **描述**: 命名从 `002` 到 `023`，需确认编号连续且与 Drizzle schema 同步。

#### C-02. 沙箱隔离有效性待验证
- **文件**: `agent-harness/services/executor-gateway/src/sandbox/`
- **描述**: 代码执行沙箱的 worktree 隔离机制需详细审查。

### 🔵 LOW

#### C-03. TODO/FIXME 清理
- **详情**: 需要全局搜索 `TODO`、`FIXME`、`HACK`、`XXX`、`BUG` 标签并清理。

#### C-04. 部分文件缺少 JSDoc 注释
- **详情**: 公共 API 缺少文档注释，影响可维护性。

---

## 五、✅ 积极发现（做得好的地方）

1. **无 eval/Function 使用**: 生产代码中未发现不安全的动态代码执行。
2. **无原型污染**: 未发现原型污染向量。
3. **Drizzle ORM 使用**: fact-retrieval 服务正确使用 ORM 防止注入。
4. **安全头设置**: web-portal 的 HTML 响应设置了 X-Content-Type-Options、X-Frame-Options 等。
5. **Dockerfile 最佳实践**: 多阶段构建、非 root 用户、Alpine 基础镜像。
6. **`.env` 未提交**: `.env.example` 使用占位符，无真实凭据泄露。

---

## 六、修复优先级矩阵

| 优先级 | 编号 | 问题摘要 | 预计工作量 |
|-------|------|---------|-----------|
| **P0-立即** | S-02, S-03 | 内部服务无认证 + 认证默认降级 | 2-3天 |
| **P0-立即** | S-01 | hermes-adapter SQL注入模式 | 1-2天 |
| **P0-立即** | S-04 | docker-compose 默认弱密码 | 0.5天 |
| **P1-本周** | S-05 | execSync 替换为 Docker API | 1天 |
| **P1-本周** | S-06 | 会话迁移至 HttpOnly Cookie | 0.5天 |
| **P1-本周** | S-07 | 默认密码拒绝登录 | 0.5天 |
| **P1-本周** | A-01 | Config Schema 同步修复 | 1-2天 |
| **P1-本周** | S-08 | prod override 补充 | 0.5天 |
| **P1-本周** | A-03 | Litellm 资源限制 | 0.5天 |
| **P2-本月** | S-09~S-13 | Prompt注入/AI事实注入/技能所有权/CORS/会话加固 | 3-5天 |
| **P2-本月** | D-01~D-03 | 用户表认证字段/外键/软删除 | 2-3天 |
| **P3-下月** | C-01~C-04 | 迁移统一/沙箱审查/TODO清理/文档补充 | 持续改进 |

---

## 七、建议下一步

1. 请负责安全的 agent 优先修复 P0 问题（尤其是 **内部服务认证** 和 **SQL注入**）
2. 请负责后端或 DevOps 的 agent 处理 P1 的配置和基础设施问题
3. P2/P3 可作为迭代任务排入下个开发周期
4. 建议修复后重新运行代码审计 agent 验证

---

*报告生成时间: 2026-05-11*
*审计工具: 静态代码分析 + 多轮 agent 深度检查*