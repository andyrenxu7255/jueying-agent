# Agent Harness 全面测试与安全审计报告

**审计日期**: 2026-05-12（全面审计） / 2026-05-08（初版审计）
**审计范围**: `agent-harness/` 全部代码（排除 node_modules、db/migrations、forked 外部项目代码）
**审计标准**: OWASP Top 10 安全实践、Node.js 安全最佳实践、NIST SP 800-63B、TypeScript 最佳实践
**审计方法**: 自动化基线扫描 + 5 个深度审计代理（注入漏洞、认证授权、密钥管理、错误处理、代码质量）

---

## 执行摘要

对 Agent Harness（绝影）v1.3.0 项目进行了覆盖 7 大领域的全面测试与安全审计：

| 审计领域 | 发现数量 | 严重 | 高危 | 中危 | 低危 |
|---------|---------|------|------|------|------|
| 认证与授权 | 13 | 1 | 6 | 3 | 3 |
| 敏感信息与密钥管理 | 12 | 0 | 3 | 4 | 5 |
| 注入漏洞 | 10 | 0 | 0 | 4 | 6 |
| 错误处理与边界条件 | 31 | 0 | 4 | 5 | 22 |
| 代码质量与最佳实践 | 15+ | 0 | 2 | 5 | 8+ |
| 依赖项安全（npm audit） | 9 | 0 | 4 | 5 | 0 |
| 文档完整性 | 7 | 0 | 0 | 3 | 4 |

**总计**: 约 95+ 项发现，其中 1 项严重、19 项高危、29 项中危、48+ 项低危。

### 基线数据

| 指标 | 结果 |
|------|------|
| Jest 单元测试 | **16 suites / 209 tests / 全部通过** |
| TypeScript 类型检查 (tsc --noEmit) | **0 错误，通过** |
| ESLint | **0 错误，12 警告** (均为 `no-explicit-any`) |
| npm audit | **9 漏洞** (4 高危, 5 中危, 0 严重) |
| 测试覆盖缺口 | **约 60-65% 生产代码无单元测试** |

---

## 一、认证与授权审计（最严重领域）

### CRITICAL: AH-SEC-009 — 所有微服务 `/internal/` 端点无内部认证

- **严重级别**: **严重 (CRITICAL)**
- **位置**: 全部 7 个微服务的 `/internal/*` 端点
  - [workflow/src/index.ts](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts) (~12 端点)
  - [executor-gateway/src/index.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts) (~4 端点)
  - [fact-retrieval/src/index.ts](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/index.ts) (~12 端点)
  - [skill-library/src/index.ts](file:///d:/teamclaw/agent-harness/services/skill-library/src/index.ts) (~15 端点)
  - [resource-scheduler/src/index.ts](file:///d:/teamclaw/agent-harness/services/resource-scheduler/src/index.ts) (~8 端点)
  - [mobile-app/src/index.ts](file:///d:/teamclaw/agent-harness/services/mobile-app/src/index.ts) (~6 端点)
  - [gateway-adapter/src/index.ts](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) (`/admin/*`, `/internal/*`)
- **证据**: 项目已实现 `verifyInternalAuth()` 机制（HMAC-SHA256 签名 + 时间戳 + nonce），但该机制**仅在 hermes-adapter 的 2 个端点中使用**。其余所有服务的内部端点均无任何认证检查。
- **影响**: 任何获得 Docker 网络访问权的攻击者（如通过容器逃逸、供应链攻击获得任一容器 shell）可以自由调用所有微服务的全部内部 API，包括创建工作流、写入事实、管理技能、调度资源等。
- **修复**: 在所有 `/internal/` 端点入口处统一添加 `verifyInternalAuth()` 调用；在 `docker-compose.yml` 中注入默认 `INTERNAL_AUTH_SECRET` 环境变量。

### AH-SEC-010 — policy_snapshot_hash 绕过漏洞

- **严重级别**: HIGH
- **位置**: [services/workflow/src/index.ts:L252-L268](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts#L252-L268)
- **证据**:
```typescript
function validateWorkflowAccess(..., policySnapshotHash?: string): boolean {
  if (policySnapshotHash && policySnapshotHash.startsWith('sha256:')) {
    return true;  // 接受任意以 "sha256:" 为前缀的字符串
  }
}
```
- **影响**: 任何以 `sha256:` 开头的字符串都被接受为有效策略快照，无需验证是否对应实际生成的策略。攻击者传入 `sha256:any` 即可绕过工作流访问控制。
- **修复**: 引入快照注册表（Map），在验证时与已生成的快照进行匹配。

### AH-SEC-011 — workflow stage dispatch/complete 无权限检查

- **严重级别**: HIGH
- **位置**: 
  - [services/workflow/src/index.ts:L509-L612](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts#L509-L612) (stage dispatch)
  - [services/workflow/src/index.ts:L615-L706](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts#L615-L706) (complete)
- **影响**: 攻击者可以注入任意阶段执行结果、操控工作流状态。
- **修复**: 添加 `verifyInternalAuth()` 检查，验证调用方身份。

### AH-SEC-012 — pause/resume/cancel 信任调用方提供的 role

- **严重级别**: HIGH
- **位置**: [services/workflow/src/index.ts:L708-L905](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts#L708-L905)
- **证据**: 仅检查 `actingRole !== 'admin'`，而 `actingRole` 由调用方在请求体中提供。
- **影响**: 攻击者传入 `acting_role: 'admin'` 即可获得任意工作流的完全控制权（暂停/恢复/取消/标记失败）。
- **修复**: 不要信任调用方传入的角色。改为通过验证通道传递的服务身份进行鉴权。

### AH-SEC-013 — web-portal `/internal/tasks/*` 端点无认证

- **严重级别**: HIGH
- **位置**: [apps/web-portal/src/index.ts:L1444-L1456](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L1444-L1456)
- **证据**: `/internal/tasks/assign` 和 `/internal/tasks/notify` 端点不检查 session，直接转发到 gateway-adapter。
- **影响**: 若 web-portal 端口对外暴露，任何人均可在未经认证的情况下触发任务分配和通知。
- **修复**: 添加 `requireSession()` 或 `requireAdmin()` 中间件。

### AH-SEC-014 — gateway-adapter 管理 API 完全无认证

- **严重级别**: HIGH
- **位置**: [apps/gateway-adapter/src/index.ts:L1969-L2289](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L1969-L2289)
- **证据**: 所有 `/admin/*` 和 `/internal/*` 端点没有任何认证检查。
- **影响**: 任何能直接访问 gateway 端口（3000）的实体均可完全控制组织、任务、渠道等管理操作。
- **修复**: 添加 `verifyInternalAuth()` 调用。

### AH-SEC-015 — 无 JWT / API Key 认证机制

- **严重级别**: MEDIUM
- **位置**: [apps/web-portal/src/index.ts](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts)
- **证据**: 仅通过 `x-session-id` header 进行 session 识别，无签名/加密 token。`.env.example` 声明了 `JWT_SECRET` 但代码中从未使用。
- **影响**: 任何持有有效 session ID 的用户即可冒充该用户。
- **修复**: 实现 JWT 或签名 session token 机制。

### AH-SEC-016 — 默认策略缺少 `workflow_instance:own` 的 delete 操作

- **严重级别**: LOW
- **位置**: [libs/policy/src/manager.ts:L57-L76](file:///d:/teamclaw/agent-harness/libs/policy/src/manager.ts#L57-L76)
- **影响**: 用户即使对自己拥有的工作流也无法执行删除操作。功能缺口，非安全漏洞。

---

## 二、敏感信息与密钥管理

### AH-SEC-017 — 企业微信 CorpSecret 通过 URL Query String 传输

- **严重级别**: HIGH
- **位置**: [apps/gateway-adapter/src/index.ts:L1453](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L1453)
- **证据**:
```typescript
const response = await fetch(
  `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`
);
```
- **影响**: `corpsecret` 以 URL 查询参数传递，可能被服务器访问日志、代理日志、HTTP 客户端历史记录泄露。
- **修复**: 改用 POST + Body 方式传参（企业微信官方推荐）。

### AH-SEC-018 — docker-compose.yml 中存在 6 个硬编码默认密码

- **严重级别**: HIGH
- **位置**: [docker-compose.yml](file:///d:/teamclaw/agent-harness/docker-compose.yml)
- **证据**: PostgreSQL (`dev_password_changeme`)、Redis (`redis_changeme`)、MinIO (`minioadmin_changeme`)、ClickHouse (`clickhouse_changeme`) 等服务的默认密码。
- **影响**: 若开发者忘记设置环境变量，所有服务以可预测的弱密码启动。
- **现有缓解**: `docker-compose.prod.yml` 使用 `${VAR:?error}` 强制生产环境设置密码。
- **修复**: 开发环境生成随机密码并在首次启动时写入 `.env`。

### AH-SEC-019 — 调试脚本硬编码密码

- **严重级别**: HIGH
- **位置**: 
  - [scripts/debug-auth.cjs:L21](file:///d:/teamclaw/agent-harness/scripts/debug-auth.cjs#L21) — 明文密码 `dev-password`
  - [scripts/check-state.cjs:L15-L20](file:///d:/teamclaw/agent-harness/scripts/check-state.cjs#L15-L20) — session token 明文输出
  - [scripts/check-admin.cjs:L2](file:///d:/teamclaw/agent-harness/scripts/check-admin.cjs#L2) — 数据库密码嵌入命令
- **修复**: 从环境变量读取密码；对 session token 进行脱敏处理。

### AH-SEC-020 — setup-users.cjs 明文打印生成的密码

- **严重级别**: MEDIUM
- **位置**: [scripts/setup-users.cjs:L80-L87](file:///d:/teamclaw/agent-harness/scripts/setup-users.cjs#L80-L87)
- **影响**: CI/CD 构建日志可能泄露用户密码。
- **修复**: 输出到单独的文件并设置严格权限（0600）。

### AH-SEC-021 — INTERNAL_AUTH_SECRET 未设置时回退为空字符串

- **严重级别**: MEDIUM
- **位置**: [libs/shared/src/http/index.ts:L97-L99](file:///d:/teamclaw/agent-harness/libs/shared/src/http/index.ts#L97-L99)
- **影响**: 虽然未设置时 fail-closed（拒绝所有请求），但空 secret 本身存在边界条件风险。
- **修复**: 启动时若未设置则输出 warning 日志并生成随机值。

### AH-SEC-022 — config schema 中包含 admin_password 字段

- **严重级别**: MEDIUM
- **位置**: [config/schemas/config.schema.json:L177](file:///d:/teamclaw/agent-harness/config/schemas/config.schema.json#L177)
- **修复**: 从 schema 中移除或标注 "禁止配置文件注入，仅支持环境变量"。

### AH-SEC-023 — 内部微服务使用 HTTP 通信

- **严重级别**: LOW
- **位置**: 全局 — Docker 内部网络
- **评估**: Docker compose 内网已设置 `internal: true`，阻止外部直接访问。风险可接受。

---

## 三、注入漏洞审计

### AH-SEC-024 — Cypher 查询字符串拼接（3 处）

- **严重级别**: MEDIUM（沿用 AH-SEC-006）
- **位置**: [services/fact-retrieval/src/service.ts](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts)
  - [L907-L914](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L907-L914) — 实体创建
  - [L917-L925](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L917-L925) — 关系创建
  - [L1262-L1300](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L1262-L1300) — 图遍历查询
- **证据**: 自定义 `sanitizeCypherLiteral` 使用黑名单方式清洗，值被直接拼接到 Cypher 查询字符串中。
- **现有缓解**: `sanitizeCypherLiteral` 转义了反斜杠、引号、美元符号，去除了分号、注释语法、换行符，截断至 4096 字符。`sanitizeCypherLabel` 使用白名单验证标签。
- **修复**: 增强 sanitizer，添加反引号转义；扩展自动化注入测试用例。

### AH-SEC-025 — SSRF 风险（服务间 fetch）

- **严重级别**: LOW-MEDIUM
- **位置**: 
  - [apps/gateway-adapter/src/index.ts](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) (多行)
  - [services/executor-gateway/src/executor/generic-executor.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/executor/generic-executor.ts) (L80, L504, L541)
- **评估**: 所有 fetch 目标 URL 来自环境变量（服务端控制），攻击者无法控制目标主机。飞书 API 基础 URL 硬编码为白名单域名。
- **修复**: 对环境变量来源的 URL 添加格式验证，拒绝 `@` 字符（防止凭证注入）。

### AH-SEC-026 — Docker stats 命令字符串拼接

- **严重级别**: LOW（沿用 AH-SEC-007）
- **位置**: [apps/web-portal/src/index.ts:L1679-L1699](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L1679-L1699)
- **评估**: 容器 ID 来自 `docker ps` 输出并通过正则 `/^[a-fA-F0-9]{6,64}$/` 校验；端点需要 admin 权限。
- **修复**: 考虑使用 Dockerode SDK 替代 shell 命令。

---

## 四、错误处理与边界条件

### AH-SEC-027 — hermes-adapter LLM fetch 调用无超时保护（3 处）

- **严重级别**: HIGH
- **位置**: [services/hermes-adapter/src/index.ts](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts)
  - L114 (`compressMemory`)
  - L583 (梦境模式压缩)
  - L631 (梦境模式知识提取)
- **影响**: LLM 服务无响应时，请求将无限挂起，阻塞端点。
- **修复**: 添加 `signal: AbortSignal.timeout(60000)`。

### AH-SEC-028 — feishu-longconn forwardToGateway 无超时

- **严重级别**: MEDIUM
- **位置**: [services/feishu-longconn/src/index.ts:L21-L55](file:///d:/teamclaw/agent-harness/services/feishu-longconn/src/index.ts#L21-L55)
- **修复**: 添加超时保护。

### AH-SEC-029 — 8 处吞没异常（空 catch 块无日志）

- **严重级别**: MEDIUM
- **位置**:
  - [services/workflow/src/persistence/db.ts:L568-L574](file:///d:/teamclaw/agent-harness/services/workflow/src/persistence/db.ts#L568-L574) — `closeWorkflowDbPool`
  - [services/workflow/src/supervisor/manager.ts:L593-L595](file:///d:/teamclaw/agent-harness/services/workflow/src/supervisor/manager.ts#L593-L595) — 数据恢复跳过损坏记录
  - [services/workflow/src/supervisor/manager.ts:L628-L630](file:///d:/teamclaw/agent-harness/services/workflow/src/supervisor/manager.ts#L628-L630) — 删除操作失败忽略
  - [services/fact-retrieval/src/artifact-storage.ts:L203](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/artifact-storage.ts#L203) — 临时文件清理忽略
  - [services/hermes-adapter/src/index.ts:L404-L417](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts#L404-L417) — DB 删除操作忽略
  - [libs/policy/src/manager.ts:L234](file:///d:/teamclaw/agent-harness/libs/policy/src/manager.ts#L234) — 角色插入失败忽略
- **修复**: 为每个空 catch 块添加 `logger.warn()` 级别日志。

### AH-SEC-030 — 3 处 fire-and-forget 调用无 .catch()

- **严重级别**: MEDIUM
- **位置**:
  - [services/workflow/src/checkpoint/manager.ts:L92](file:///d:/teamclaw/agent-harness/services/workflow/src/checkpoint/manager.ts#L92)
  - [services/workflow/src/supervisor/manager.ts:L218](file:///d:/teamclaw/agent-harness/services/workflow/src/supervisor/manager.ts#L218)
  - [services/fact-retrieval/src/service.ts:L298-L300](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L298-L300)
- **影响**: Node.js v15+ 中 unhandled rejection 会终止进程。
- **修复**: 添加 `.catch(err => logger.error(...))`。

### AH-SEC-031 — hermes-adapter 优雅关闭缺少 DB 池清理

- **严重级别**: MEDIUM
- **位置**: [services/hermes-adapter/src/index.ts:L876-L886](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts#L876-L886)
- **修复**: 补充 `closeDbPool()` 调用。

### AH-SEC-032 — hermes-adapter 输入验证不足

- **严重级别**: MEDIUM
- **位置**: [services/hermes-adapter/src/index.ts:L296-L306](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts#L296-L306)
- **问题**: `ownerUserId` 无格式验证；`role` 未验证枚举值；`content` 无长度上限。
- **修复**: 添加 Zod schema 验证。

---

## 五、代码质量与最佳实践

### AH-SEC-033 — console.error 在安全关键路径中

- **严重级别**: HIGH
- **位置**: [libs/shared/src/http/index.ts:L116](file:///d:/teamclaw/agent-harness/libs/shared/src/http/index.ts#L116)
- **证据**: `console.error('[SECURITY] INTERNAL_AUTH_SECRET not set - rejecting all internal requests')`
- **修复**: 改用结构化日志 `logger.error('security.internal_auth_secret_missing', ...)`。

### AH-SEC-034 — 8 个服务层入口点无测试覆盖

- **严重级别**: HIGH
- **未测试的服务**: web-portal、mobile-app、gateway-adapter（主入口）、executor-gateway（6 个 executor + 主入口）、hermes-adapter、resource-scheduler、skill-library、feishu-longconn
- **未测试的库**: libs/audit、libs/policy、libs/contracts、libs/shared: ai/embedding、libs/shared: config
- **评估**: 约 60-65% 的生产代码无单元测试覆盖。

### AH-SEC-035 — callLiteLLM 在 5 个文件中重复实现

- **严重级别**: MEDIUM
- **位置**:
  - [generic-executor.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/executor/generic-executor.ts)
  - [code-executor.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/executor/code-executor.ts)
  - [verification-executor.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/executor/verification-executor.ts)
  - [repair-executor.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/executor/repair-executor.ts)
  - [planner.ts](file:///d:/teamclaw/agent-harness/services/workflow/src/planner/planner.ts)
- **修复**: 提取为共享库函数。

### AH-SEC-036 — getDbPool() 在 5 个服务中重复实现

- **严重级别**: MEDIUM
- **位置**: web-portal、mobile-app、hermes-adapter、skill-library、resource-scheduler
- **修复**: 提取为 `@agent-harness/shared` 公共工具函数。

### AH-SEC-037 — 响应体捕获样板在 8 个文件中重复

- **严重级别**: MEDIUM
- **位置**: 所有微服务入口文件
- **修复**: 统一使用 `@agent-harness/shared` 提供的 `readJson`/`sendJson`。

### AH-SEC-038 — 26 处 `as unknown as` 类型绕过

- **严重级别**: LOW
- **位置**: 10 个文件中，最集中在 [gateway-adapter/index.ts](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) 和 [executor-gateway/index.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts)
- **修复**: 逐步替换为 Zod 解析或类型守卫。

### AH-SEC-039 — 魔法数字/字符串分散在各服务

- **严重级别**: LOW
- **问题**: 各服务的 `MAX_BODY_SIZE`（1MB/2MB/5MB/10MB 不一致）、超时值（5000/10000/15000/30000/60000/120000 混合使用）、压缩阈值等。
- **修复**: 统一到配置模块或共享常量。

---

## 六、已有安全发现（2026-05-08 初版，保留）

| ID | 级别 | 描述 | 状态 |
|----|------|------|------|
| AH-SEC-001 | HIGH | web-portal 未设置请求体大小限制 | 持续关注 |
| AH-SEC-002 | HIGH | 前端 showModal 直接注入未转义 HTML（架构风险） | 持续关注 |
| AH-SEC-003 | HIGH | 会话标识符存储在 localStorage | 持续关注 |
| AH-SEC-004 | HIGH | 密码验证存在弱 SHA256 回退路径 | 持续关注 |
| AH-SEC-005 | MEDIUM | 跨服务安全响应头缺失 | 持续关注 |
| AH-SEC-006 | MEDIUM | sanitizeCypherLiteral 黑名单清洗 | 持续关注 |
| AH-SEC-007 | LOW | Docker stats 命令字符串拼接 | 持续关注 |
| AH-SEC-008 | LOW | CORS Allow-Credentials 无条件设置 | 持续关注 |

---

## 七、依赖项安全扫描（npm audit）

审计发现 **9 个安全漏洞**：

| 依赖包 | 级别 | 漏洞 | CVSS | 可修复 |
|--------|------|------|------|:---:|
| @opentelemetry/auto-instrumentations-node | **HIGH** | Prometheus exporter 进程崩溃 (GHSA-q7rr-3cgh-j5r3) | 7.5 | 升级至 0.75.0+ |
| @opentelemetry/sdk-node | **HIGH** | 同上 (GHSA-q7rr-3cgh-j5r3) | 7.5 | 升级至 0.217.0+ |
| protobufjs | **HIGH** | 原型注入 + 代码注入 (GHSA-75px-5xx7-5xc7 等) | 8.1 | 升级 |
| fast-xml-builder | **HIGH** | XML 属性注入 (GHSA-5wm8-gmm8-39j9) | N/A | 升级 |
| drizzle-kit | MODERATE | esbuild 开发服务器 SSRF (级联) | 5.3 | 升级 |
| esbuild | MODERATE | 开发服务器任意请求 (GHSA-67mh-4wv8-2f99) | 5.3 | 级联修复 |
| @esbuild-kit/core-utils | MODERATE | 同上（级联） | 5.3 | 级联修复 |
| @esbuild-kit/esm-loader | MODERATE | 同上（级联） | 5.3 | 级联修复 |
| @protobufjs/utf8 | MODERATE | UTF-8 解码过长 (GHSA-q6x5-8v7m-xcrf) | 5.3 | 升级 |

**建议**: 运行 `npm audit fix` 修复可自动修复的；手动升级 OpenTelemetry 和 drizzle-kit。

---

## 八、文档完整性评估

| 检查项 | 评分 | 说明 |
|--------|:---:|------|
| README.md | 85/100 | 内容完整，但缺少 API 端点章节 |
| .env.example | 90/100 | 覆盖全面（缺 mobile-app 推送 4 变量） |
| API 文档 | 30/100 | **无 OpenAPI/Swagger 文档**；contracts 包自承为"占位实现" |
| 数据库 Schema 文档 | 80/100 | .md 设计文档 + Drizzle + SQL 迁移链路完整 |
| Docker Compose 注释 | 90/100 | 服务级注释良好，生产覆盖文件安全策略正确 |
| JSDoc 覆盖率 | 20/100 | **~15-20%**，核心服务（fact-retrieval 等）几乎无注释 |
| 项目规则文件 | 存在 | 位于 `.trae/rules/project_rules.md` |

---

## 九、安全优势（已正确实施）

以下安全措施已正确实施，值得肯定：

- ✅ 密码使用 **scrypt** 哈希存储（N=16384，32 字节密钥，16 字节随机盐）
- ✅ 使用 **timingSafeEqual** 常量时间密码比较，防止时序攻击
- ✅ 登录限流机制（5 次失败锁定，30s-15min 递增）
- ✅ 账号锁定机制：过期锁定自动清理
- ✅ 密码强度验证 + 常见弱密码拦截（admin, admin123 等）
- ✅ web-portal 基础 CSP 头、X-Content-Type-Options、X-Frame-Options、Referrer-Policy
- ✅ CORS 有 origin 验证逻辑和 wildcard production 拦截
- ✅ 结构化日志自动脱敏（password/secret/token/api_key/authorization/credential 键）
- ✅ 审计日志记录全部关键操作
- ✅ 生产环境强制安全检查（`security-check.ts` 启动时验证密码强度）
- ✅ `docker-compose.prod.yml` 使用 `${VAR:?error}` 强制设置环境变量
- ✅ 所有外部 API 调用使用 HTTPS（飞书、企业微信、MiniMax、DashScope、硅基流动）
- ✅ 文件路径清洗（`sanitizePathComponent` + `validateSecurePath` 双重防护）
- ✅ 前端 HTML 渲染使用 `escapeHtml()` 转义
- ✅ 优雅关闭流程（SIGTERM/SIGINT），大部分服务有 10s 强制退出兜底
- ✅ PostgreSQL 查询全部使用参数化（`$1`, `$2`）
- ✅ 不存在 `eval()` 或 `new Function()` 在生产代码中

---

## 十、修复优先级总表

### P0 — 立即修复（1-3 天）

| ID | 描述 | 复杂度 |
|----|------|:---:|
| AH-SEC-009 | 所有 `/internal/` 端点添加内部认证 | 中 (需全局改动) |
| AH-SEC-010 | policy_snapshot_hash 绕过修复 | 中 |
| AH-SEC-011 | workflow stage dispatch/complete 添加认证 | 低 |
| AH-SEC-012 | pause/resume/cancel 移除调用方 role 信任 | 中 |
| AH-SEC-017 | 企业微信 CorpSecret 改用 POST + Body | 低 (5 行) |
| AH-SEC-019 | 清理调试脚本中的硬编码密码 | 低 |

### P1 — 本周修复

| ID | 描述 | 复杂度 |
|----|------|:---:|
| AH-SEC-013 | web-portal `/internal/tasks/*` 添加认证 | 低 |
| AH-SEC-014 | gateway-adapter 管理 API 添加认证 | 中 |
| AH-SEC-027 | hermes-adapter LLM fetch 添加超时保护 | 低 |
| AH-SEC-033 | console.error 改为结构化日志 | 低 (3 行) |
| AH-SEC-020 | setup-users.cjs 密码脱敏输出 | 低 |
| AH-SEC-029 | 空 catch 块添加日志 | 低 (8 处) |
| AH-SEC-030 | fire-and-forget 添加 .catch() | 低 (3 处) |
| AH-SEC-031 | hermes-adapter 优雅关闭补充 DB 池清理 | 低 |

### P2 — 本月修复

| ID | 描述 | 复杂度 |
|----|------|:---:|
| AH-SEC-034 | 为 8 个未测试服务添加基础单元测试 | 高 (持续工作) |
| AH-SEC-005 | 跨服务安全响应头统一下发 | 低 |
| AH-SEC-006 | Cypher 清洗增强 | 中 |
| AH-SEC-024 | 扩展 Cypher 注入测试用例 | 中 |
| AH-SEC-035 | callLiteLLM 去重提取 | 中 |
| AH-SEC-036 | getDbPool 去重提取 | 中 |
| AH-SEC-018 | docker-compose.yml 默认密码策略改进 | 中 |
| AH-SEC-022 | config schema 移除 admin_password | 低 |
| npm audit | 升级 protobufjs、OpenTelemetry、drizzle-kit | 中 |

### P3 — 后续迭代

| ID | 描述 | 复杂度 |
|----|------|:---:|
| AH-SEC-015 | 实现 JWT 认证机制 | 高 |
| AH-SEC-032 | hermes-adapter 添加 Zod 输入验证 | 中 |
| AH-SEC-038 | 替换 `as unknown as` 类型绕过 | 中 (26 处) |
| AH-SEC-037 | 统一 readJson/sendJson 引用 | 中 |
| AH-SEC-039 | 魔法数字统一到配置模块 | 低 |
| AH-SEC-025 | SSRF URL 格式验证 | 低 |

---

## 十一、测试覆盖改进建议

### 优先添加测试的模块

1. **apps/web-portal/src/index.ts** (2200 行) — 认证、CRUD、调度器的核心
2. **apps/gateway-adapter/src/index.ts** (2350 行) — 主网关
3. **services/executor-gateway/src/** (全部 executor)
4. **services/fact-retrieval/src/service.ts** (核心检索逻辑)
5. **services/hermes-adapter/src/index.ts** (记忆管理与 LLM 交互)
6. **services/resource-scheduler/src/index.ts** (资源调度)
7. **services/skill-library/src/index.ts** (技能管理)

### 建议的测试策略

- **单元测试**: 使用 Jest + ts-jest，为每个公共服务函数添加测试
- **集成测试**: 扩展 `tests/integration/` 自定义测试套件
- **安全测试**: 为 Cypher 注入、XSS、认证绕过编写专门的 fuzzing 测试
- **CI 集成**: 将 `npm test` + `npm run lint` + `npm run type-check` 加入 CI pipeline

---

*报告基于 Security Best Practices for Express in Production、OWASP Cheat Sheets、OWASP Top 10、Node.js Security Best Practices、NIST SP 800-63B、TypeScript 最佳实践 以及项目知识图谱。*
