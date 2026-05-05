# Agent Harness V1 - 系统性开发维护审计报告

> **审计日期**: 2026-05-05
> **审计范围**: `d:\teamclaw\` 全工作区（文档 + 知识图谱 + agent-harness 代码库）
> **审计方法**: 逐章节文档-代码比对 + 全量代码静态分析 + 测试套件验证
> **前置参考**: ARCHITECTURE.md (第十三轮), AUDIT-REPORT.md (2026-05-04), FIX-REPORT.md (2026-05-03)

---

## 一、执行摘要

| 维度 | 评分 | 说明 |
|------|------|------|
| 文档完整性 | 7/10 | AH1 系列设计文档齐全，但部分内容与代码脱节 |
| 代码质量 | 7/10 | TypeScript 编译零错误，但存在大量重复代码和 TODO |
| 测试覆盖 | 3/10 | **5个测试套件全部失败**，无法运行 |
| 安全性 | 7/10 | 已修复多项安全问题，内部认证机制就绪但未在服务中启用 |
| 知识图谱 | 6/10 | context-graph.json 结构完整但缺少新建文件的引用 |

### 关键发现
- **🔴 JEST 测试全部失败**: 5个测试套件因 ts-jest ESM 转换问题全部报错，0个测试通过运行
- **🟠 代码重复严重**: 4个服务各自实现 `readJson`/`sendJson`/`postJson`，未复用 `@agent-harness/shared`
- **🟠 5个 TODO 未解决**: web-portal (3个), executor-gateway (1个), hermes-adapter (1个)
- **🟡 npm audit**: 5个漏洞 (4 moderate, 1 high) - esbuild 和 xlsx
- **🟡 文档-代码不一致**: 多处实现偏离 AH1 设计文档定义

---

## 二、Phase 2: 文档与知识图谱审核

### 2.1 知识图谱审核 (context-graph.json v1.5)

#### ✅ 一致项

| 项目 | 状态 | 说明 |
|------|------|------|
| L0_authority 文档引用 | ✅ 正确 | 13个权威文档路径均存在 |
| L1_execution 文档引用 | ✅ 正确 | 7个执行文档路径均存在 |
| L2_governance 文档引用 | ✅ 正确 | 8个治理文档路径均存在 |
| authority_map 映射 | ✅ 正确 | 9个领域-文档映射准确 |
| task_profiles 定义 | ✅ 正确 | M1/M2/M3 任务配置合理 |
| invalidation_triggers | ✅ 正确 | 失效触发器语义明确 |

#### ⚠️ 需更新项

| 问题 | 严重度 | 说明 |
|------|--------|------|
| KG-01: 缺少新建文件引用 | 🟡 Low | `context-graph.json` 未引用 DEV-14、DEV-15、DEV-16 三个新增开发文档 |
| KG-02: DEV-08 引用陈旧 | 🟡 Low | 文件内容与依赖对象图谱描述的文件结构与实际代码部分不匹配 |

### 2.2 AH1 设计文档逐章审核

#### AH1-14: 数据库表设计与索引

| 检查项 | 文档定义 | 代码实现 | 匹配 |
|--------|---------|----------|------|
| 主键策略 UUID | `gen_random_uuid()` | `uuid('id').primaryKey().defaultRandom()` | ✅ |
| 时间字段 | `created_at/updated_at timestamptz` | `timestamp('created_at', {withTimezone})` | ✅ |
| 向量维度 | 1536 | `vector(1536)` | ✅ |
| `entity` 不启硬唯一约束 | 仅保留索引 | 仅 `canonicalNameIdx` 索引 | ✅ |
| `workflow_instance.scope_type` | 固定 `private` | 字段为 `text('scope_type')` 无 check 约束 | ⚠️ D1 |
| `artifact_object.scope_type` | 固定 `private` | 字段为 `text('scope_type')` 无 check 约束 | ⚠️ D2 |

> **D1 (DOC-CODE-01)**: `workflow_instance.scope_type` 字段缺少 `check (scope_type = 'private')` 约束。设计文档 14.5.0 明确要求"通过 check 约束落地"，但 schema.ts 中仅有 `notNull()`。
>
> **D2 (DOC-CODE-02)**: `artifact_object.scope_type` 同理缺少 check 约束。

#### AH1-15: 核心接口与事件契约

| 检查项 | 文档定义 | 代码实现 | 匹配 |
|--------|---------|----------|------|
| 统一信封结构 | `request_id, trace_id, actor, policy_snapshot_hash` | 未在代码中实现统一信封 | ❌ D3 |
| 错误码分层 | 11类错误前缀 | 代码中仅有字符串错误信息，未使用标准错误码 | ❌ D4 |
| 响应信封格式 | `ok, error, payload, meta` | 部分接口遵循，部分不遵循 | ⚠️ D5 |
| `policy_snapshot_hash` 必填规则 | 进入 Workflow 后必须存在 | 部分检查了（如 executor-gateway L132），部分未检查 | ⚠️ |

> **D3 (DOC-CODE-03)**: 代码中未实现文档 15 §15.2 定义的统一信封结构。各服务使用自定义请求/响应格式，缺乏标准化。
>
> **D4 (DOC-CODE-04)**: 错误码未遵循文档 15 §15.3 定义的标准错误码格式 (`code, message, retryable, detail`)。实际代码中使用简单的字符串错误。
>
> **D5 (DOC-CODE-05)**: 响应格式不统一。部分接口返回 `{ok, data}`，部分返回纯对象。

#### AH1-16: 权限 Scope-Policy-Snapshot

| 检查项 | 文档定义 | 代码实现 | 匹配 |
|--------|---------|----------|------|
| scope 模型 | `private:{user_id}`, `public:workflow`, `public:skill` | 代码中使用 `private`/`shared`/`public` 字符串 | ⚠️ D6 |
| 资源类型列表 | 17种资源类型 | schema 中包括 26+ 表，比文档多 | ⚠️ |
| 操作类型 | `read/write/update/delete/execute/publish/approve/govern/archive` | 代码中操作类型不一致 | ⚠️ |

> **D6 (DOC-CODE-06)**: scope 模型不一致。文档定义 scope 格式为 `private:{user_id}`，但 user_file 表的 scope 字段使用 `private/shared/public` 枚举。需要统一。

#### AH1-17: Workflow DSL 与 Planner 契约

| 检查项 | 文档定义 | 代码实现 | 匹配 |
|--------|---------|----------|------|
| WorkflowPlan 最小结构 | 9个必填字段 | planner.ts 输出不完整 | ⚠️ D7 |
| Stage DSL 结构 | 包含 `retrieval_plan`, `acceptance`, `timeouts` 等 | 代码中 stage 结构简化版 | ⚠️ D8 |
| 16种 stage_type | 定义了16种 | schema 中 `stage_type` 仅为 text 字段，无校验 | ⚠️ |
| `plan_hash` 计算规则 | 不包含 `workflow_id` | 未发现独立 plan_hash 计算逻辑 | ⚠️ |

> **D7 (DOC-CODE-07)**: Planner 输出未包含文档定义的完整 WorkflowPlan 字段（缺少 `budgets`, `retrieval_profile`, `report_policy`, `archive_policy`）。
>
> **D8 (DOC-CODE-08)**: Stage 结构简化。文档定义 Stage 包含 `retrieval_plan`, `acceptance`, `timeouts`, `retry_policy`, `checkpoint_policy`，但实际代码中 stage 仅使用基础字段。

#### AH1-18: Code Executor 与执行会话

| 检查项 | 文档定义 | 代码实现 | 匹配 |
|--------|---------|----------|------|
| ExecutionSession 状态集 | 10种状态 | `execution_session` 表有 `status` 字段但无 check 约束 | ⚠️ |
| worktree 隔离 | `/worktrees/{wf_id}/{stage_seq}/` | 文档定义但代码中 `worktree_ref` 字段可为 null | ⚠️ |
| backend 策略 | opencode > claw-code > Hermes | 代码中使用 `backend_type` 字段但未看到实际 backend 实现 | ⚠️ |

#### AH1-31: 错误处理与降级策略

| 检查项 | 文档定义 | 代码实现 | 匹配 |
|--------|---------|----------|------|
| 错误分类 | TransientError / PermanentError / SystemError | 代码中无错误类层次结构 | ❌ D9 |
| HTTP 状态码映射 | 8种映射规则 | 代码中状态码使用不一致 | ⚠️ |
| 重试策略 | 指数退避 + jitter | executor-gateway 有指数退避，其他服务部分有 | ⚠️ |
| 熔断与限流 | 定义了策略 | shared 库中有 rate-limit/limiter.ts 和 retry/strategy.ts，但未在服务中使用 | ⚠️ |

> **D9 (DOC-CODE-09)**: 缺少错误类层次结构。文档定义了 `TransientError`, `PermanentError`, `SystemError` 三级分类，但代码中均使用普通 `Error` 对象。

### 2.3 文档示例代码准确性

| 文档 | 示例代码 | 准确性 |
|------|---------|--------|
| AH1-17 §17.3.1 | WorkflowPlan JSON | ✅ 结构正确 |
| AH1-17 §17.4.1 | Stage JSON | ✅ 结构正确 |
| AH1-31 §31.3.3 | ErrorHandler 示例 | ⚠️ 是 TypeScript 伪代码，未在代码库中实现 |

---

## 三、Phase 3: 基于文档的代码审计

### 3.1 严重问题 (Critical)

#### [TEST-01] 🔴 全部测试套件失败 - Jest 配置损坏

- **影响**: 5个测试套件，0个测试通过
- **根本原因**: `ts-jest` 的 ESM 模块转换失败。`jest.config.cjs` 使用 `isolatedModules: true` 但 ts-jest 无法处理 TypeScript ESM imports
- **详细错误**:
  - `workflow/src/persistence/db.test.ts` — `SyntaxError: Cannot use import statement outside a module`
  - `fact-retrieval/src/support.test.ts` — 同上
  - `workflow/src/engine/workflow-machine.test.ts` — 同上
  - `gateway-adapter/src/services/gateway-state.test.ts` — TypeScript 类型注解语法错误（Babel 而非 ts-jest 在处理）
  - `libs/shared/src/http/index.test.ts` — `import type` 语法不被 Babel 识别
- **建议**: 重新配置 Jest，统一使用 ts-jest 转换器，或迁移到 Vitest。验证 `tsconfig.json` 的 `module` 设置与 ts-jest 兼容。

#### [CODE-DUP-01] 🔴 严重代码重复 - HTTP 工具函数

- **影响范围**: gateway-adapter, workflow-service, executor-gateway, hermes-adapter
- **问题**: 4个服务各自实现了 `readJson()`, `sendJson()`, `postJson()` 函数，但 `@agent-harness/shared` 库已提供这些工具
- **具体位置**:
  - [gateway-adapter/src/index.ts:L60-L80](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) — `readBody()`, `parseJson()`, `sendJson()`
  - [workflow/src/index.ts:L30-L81](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts) — `readJson()`, `sendJson()`, `postJson()`
  - [executor-gateway/src/index.ts:L43-L65](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts) — `readJson()`, `sendJson()`
  - [hermes-adapter/src/index.ts:L88-L109](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts) — `readJson()`, `sendJson()`
- **共享库已有实现**: [libs/shared/src/http/index.ts](file:///d:/teamclaw/agent-harness/libs/shared/src/http/index.ts) — `readJson()`, `sendJson()`, `postJson()` 均可用
- **风险**: 改一处需改四处，bug 修复不一致，功能差异累积
- **建议**: 统一使用 `@agent-harness/shared` 的 `readJson`/`sendJson`/`postJson`

### 3.2 高优先级问题 (High)

#### [TODO-01] 🟠 web-portal 引用不存在的 gateway 端点

- **位置**: [web-portal/src/index.ts:L850](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts) (3处 TODO)
- **问题**: web-portal 尝试调用 `gateway-adapter` 的 `/users` 和 `/admin/organizations` 端点，但这些端点在 gateway-adapter 中不存在
- **建议**: 要么在 gateway-adapter 中添加这些端点，要么让 web-portal 直接查询数据库

#### [TODO-02] 🟠 executor-gateway 会话操作为占位实现

- **位置**: [executor-gateway/src/index.ts:L190](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts)
- **问题**: `/internal/executor/sessions/{id}` 的 terminate/status/cancel/pause/resume 操作仅有骨架代码，不执行实际操作
- **建议**: 实现真正的执行会话生命周期管理

#### [TODO-03] 🟠 hermes-adapter 缺少 proper fact validation

- **位置**: [hermes-adapter/src/index.ts:L667](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts)
- **问题**: 梦境模式的 fact extraction 直接写 facts 表，绕过了 fact-retrieval 的验证流程
- **建议**: 通过 fact-retrieval `/internal/fact/submit` 进行 proper validation

#### [PERF-01] 🟠 gateway-adapter 在请求处理链中重复创建 policyManager

- **位置**: [gateway-adapter/src/index.ts:L147-L154](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts)
- **问题**: 每次 `resolveIdentity` 都执行 `await import('@agent-harness/policy')` + `await policyManager.initialize()`，产生不必要的动态导入开销
- **建议**: 在服务启动时初始化一次，复用 policyManager 实例

#### [SEC-INTERNAL-01] 🟠 内部认证机制已实现但未在服务中启用

- **位置**: [libs/shared/src/http/index.ts:L96-L129](file:///d:/teamclaw/agent-harness/libs/shared/src/http/index.ts)
- **问题**: `verifyInternalAuth()` 函数已实现并通过单元测试，但没有任何服务在实际端点中调用此函数
- **影响**: 所有 `/internal/*` 端点仍然无认证保护
- **建议**: 在生产环境启用 `INTERNAL_AUTH_SECRET` 环境变量，并在所有 `/internal/*` 端点中使用 `verifyInternalAuth(req)`

### 3.3 中优先级问题 (Medium)

#### [CODE-QUAL-01] 🟡 `any` 类型使用

即使 `tsc --noEmit` 通过，仍有类型不安全的代码：
- [gateway-adapter/src/index.ts:L326](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) — `JSON.parse(jsonContent) as Partial<IntentClassification>`
- [executor-gateway/src/index.ts:L165](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts) — `stage as unknown as import('@agent-harness/contracts').Stage`

#### [CODE-QUAL-02] 🟡 静默 catch 块

多处 catch 块不记录任何日志：
- [gateway-adapter/src/index.ts:L360-L361](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) — `catch { logger.warn(...) }` - 已改进
- [gateway-adapter/src/index.ts:L391-L393](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) — `catch { return null }` - 静默
- [gateway-adapter/src/index.ts:L604-L606](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts) — `catch { }` - 完全静默

#### [INFRA-01] 🟡 npm audit 漏洞

- **xlsx** (high): Prototype Pollution + ReDoS，无修复版本
- **esbuild** (moderate): 开发服务器任意请求读取，修复需要 breaking change (drizzle-kit)

#### [DOC-ARCH-01] 🟡 ARCHITECTURE.md 声称测试全绿但实际全红

- ARCHITECTURE.md 声明 "52 测试全绿"
- 实际: 5个测试套件全部失败，0个测试运行

### 3.4 代码质量总结

| 类型 | 数量 | 严重度 |
|------|------|--------|
| Jest 配置损坏 | 1 (影响5套件) | 🔴 Critical |
| 代码重复 (HTTP工具) | 4处 | 🔴 Critical |
| TODO 未完成 | 5处 | 🟠 High |
| 内部认证未启用 | 1项 | 🟠 High |
| `any` 类型 | 多处 | 🟡 Medium |
| 静默 catch | 3处 | 🟡 Medium |
| npm 漏洞 | 5个 | 🟡 Medium |
| 文档-代码不一致 | 9处 (D1-D9) | 🟡 Medium-Low |

---

## 四、Phase 4: 修复计划

### 4.1 修复优先级排序

| 优先级 | 任务 ID | 描述 | 预计工时 | 依赖 |
|--------|---------|------|----------|------|
| P0 | FIX-TEST | 修复 Jest 配置，恢复测试运行 | 2h | 无 |
| P0 | FIX-DUP | 统一 HTTP 工具函数到 shared 库 | 3h | 无 |
| P1 | FIX-TODO-WEB | web-portal 添加直连 DB 或补充 gateway 端点 | 2h | 无 |
| P1 | FIX-TODO-EXEC | executor-gateway 实现真实会话操作 | 2h | 无 |
| P1 | FIX-INTERNAL-AUTH | 在所有 `/internal/*` 端点启用认证 | 3h | FIX-DUP |
| P2 | FIX-DOC-CODE | 修复文档-代码不一致（D1-D9） | 4h | FIX-DUP 部分 |
| P2 | FIX-PERF | gateway-adapter policyManager 预初始化 | 1h | 无 |
| P2 | FIX-CATCH | 所有静默 catch 添加日志 | 1h | 无 |
| P3 | FIX-KG | 更新知识图谱引用 | 0.5h | 无 |
| P3 | FIX-NPM | 评估 npm audit 漏洞修复可行性 | 1h | 无 |

### 4.2 修复执行顺序

```
FIX-TEST → FIX-DUP → [FIX-TODO-WEB, FIX-TODO-EXEC, FIX-INTERNAL-AUTH] → FIX-DOC-CODE → [FIX-PERF, FIX-CATCH, FIX-KG, FIX-NPM]
```

---

## 五、具体修复实施

以下开始执行 P0 和 P1 修复任务。

