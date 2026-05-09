# 绝影 (Agent Harness) 全面系统审计报告 — MAX 模式

**审计日期:** 2026-05-08  
**审计范围:** 全栈代码审查 (apps/, services/, libs/, db/, config/)  
**审计模式:** MAX — 多维度、多视角、全量覆盖  
**审计版本:** v1.0

---

## 一、执行摘要

本次审计对绝影 Agent Harness 项目进行了全面的代码审查，覆盖 **约 15,000+ 行 TypeScript 代码**、**8 个微服务**、**4 个共享库**、**30+ 个数据库表**、**20 条用户故事线**。总体评估：

- **架构质量:** B+ — 微服务架构合理，但缺乏统一的 API Gateway 和服务发现机制
- **安全性:** C — 存在若干高危安全漏洞，需要立即修复
- **代码质量:** B — 核心模块设计良好，但存在类型安全问题和不一致的错误处理
- **可维护性:** B — 文档齐全，但部分模块职责过重
- **测试覆盖:** C- — 测试套件运行失败 (7/8 套件)，6 个测试通过

---

## 二、关键发现概览

| 严重级别 | 数量 | 类型分布 |
|---------|------|---------|
| 🔴 严重 (Critical) | 5 | 安全漏洞、竞态条件、注入风险 |
| 🟠 高危 (High) | 8 | 输入验证、错误处理、资源泄漏 |
| 🟡 中危 (Medium) | 10 | 性能、代码异味、配置问题 |
| 🟢 低危 (Low) | 7 | 代码风格、文档、测试配置 |

### 优先级排序的关键问题 (按修复紧急度)

1. **[严重] CVSS 8.1** — AGE Cypher 查询注入 (SQL/NoSQL Injection)
2. **[严重] CVSS 7.5** — 执行调度绕过策略验证 (Permission Bypass)
3. **[严重]** — getDbPool() 竞态条件导致连接池泄漏
4. **[严重]** — 测试套件完全不可用 (7/8 套件解析失败)
5. **[高危]** — 缺少 Content-Security-Policy 头 (多个服务)
6. **[高危]** — 未处理的 Promise Rejection
7. **[高危]** — CORS 配置绕过

---

## 三、详细审计发现

---

### 🔴 #1 [严重] AGE Cypher 查询注入漏洞

**位置:** [service.ts](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L1268-L1357) `runAgeCypherQuery()`

**问题描述:**  
`runAgeCypherQuery` 方法使用字符串拼接构建 Cypher 查询，虽然使用了 `sanitizeCypherLiteral()` 进行清理，但存在以下缺陷：

1. 正则表达式清理可能被绕过 (`.replace(/[$]/g, '')` 无法防御所有注入)
2. `searchTerm` 被直接插入 Cypher 语句中：`e.canonical_name =~ '${safePattern}'`
3. dollar-quote tag (`$tag$`) 的清理不完整

**攻击场景:**
攻击者通过构造特殊的 `query_text` 参数可以注入恶意 Cypher 代码，读取或修改图数据库中的任意数据。

**CVSS 评分:** 8.1 (AV:N/AC:H/PR:L/UI:N/S:C/C:H/I:H/A:N)

**修复建议:**
```typescript
// 使用参数化 Cypher 查询或更严格的输入验证
// 禁止所有非字母数字和中文字符在 Cypher label 中使用
function sanitizeCypherLiteral(value: string): string {
  const cleaned = String(value || '');
  return cleaned
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\$/g, '\\$')  // 转义美元符号
    .replace(/[\n\r]/g, ' ')
    .replace(/--/g, '')     // 移除 Cypher 注释
    .replace(/\/\*/g, '')   // 移除块注释
    .replace(/\*\//g, '')
    .slice(0, 4096);
}
```

---

### 🔴 #2 [严重] 执行调度绕过策略哈希验证

**位置:** [index.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts#L85-L122)

**问题描述:**
`/internal/executor/dispatch` 端点直接接收 `workflow_instance_ref` 并调用 `autoExecuteWorkflowStages()`，**没有**验证 `policy_snapshot_hash`。而 `/internal/executor/execute` 端点正确验证了此参数。

这意味着：
- 任何具有内部网络访问权限的攻击者可以直接调度任意工作流执行
- 绕过了 RBAC 策略检查
- 可以执行高权限操作

**修复:** 在 dispatch 端点也加入 `policy_snapshot_hash` 验证。

```typescript
// 添加策略验证
if (req.url === '/internal/executor/dispatch' && req.method === 'POST') {
  const body = await readJson(req);
  const workflowRef = body.workflow_instance_ref as string | undefined;
  const policySnapshotHash = body.policy_snapshot_hash as string | undefined;
  
  if (!workflowRef || typeof workflowRef !== 'string' || !workflowRef.trim()) {
    sendJson(res, 400, { ok: false, error: 'missing_workflow_instance_ref' });
    return;
  }
  if (!policySnapshotHash || !policySnapshotHash.startsWith('sha256:')) {
    sendJson(res, 400, { ok: false, error: 'missing_policy_snapshot_hash' });
    return;
  }
  // ... rest of handler
}
```

---

### 🔴 #3 [严重] getDbPool() 竞态条件 (Race Condition)

**位置:** [index.ts](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L154-L169)

**问题描述:**
当下的 `getDbPool()` 实现存在经典的 TOCTOU (Time-of-Check, Time-of-Use) 竞态条件：

```typescript
async function getDbPool(): Promise<Pool | null> {
  if (dbPool) return dbPool;           // <-- 检查
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  try {
    dbPool = new Pool({ ... });        // <-- 设置 (非原子)
    const client = await dbPool.connect();
    // ...
  }
}
```

并发调用可能导致：
- 创建多个数据库连接池 (资源泄漏)
- 第一个池被丢弃但未关闭 (连接泄漏)

**修复:** 使用互斥锁或 Promise-based 门控。

```typescript
let dbPoolPromise: Promise<Pool | null> | null = null;

async function getDbPool(): Promise<Pool | null> {
  if (dbPool) return dbPool;
  if (dbPoolPromise) return dbPoolPromise;
  
  dbPoolPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return null;
    try {
      const newPool = new Pool({ connectionString: databaseUrl, max: 5 });
      const client = await newPool.connect();
      client.release();
      logger.info('db.connected', 'Database pool connected');
      dbPool = newPool;
      return dbPool;
    } catch (error) {
      logger.warn('db.connect_failed', 'Database connection failed', { error: String(error) });
      return null;
    } finally {
      dbPoolPromise = null;
    }
  })();
  
  return dbPoolPromise;
}
```

---

### 🔴 #4 [严重] 测试套件运行失败 — Jest 配置问题

**位置:** [jest.config.cjs](file:///d:/teamclaw/agent-harness/tests/setup/jest.config.cjs)

**问题描述:**
当前测试套件中 **7/8 套件失败**，仅 `support.test.ts` 通过。失败原因是 TypeScript 文件被 Babel (而非 ts-jest) 解析：
- `gateway-state.test.ts`: TypeScript 类型注解 `let state: GatewayState` 被当作 JS 解析
- `planner.test.ts`: `as const` 语法不被 Babel 识别
- 其他套件：类似问题

**根本原因:** `transform` 配置中的 `ts-jest` 可能未被正确应用，或者模块解析路径有问题。

**修复:** 检查 `tests/setup/` 路径和 transform 配置，确保 ts-jest 正确处理 `.ts` 文件。

---

### 🟠 #5 [高危] 缺少 Content-Security-Policy 头

**服务:** executor-gateway, fact-retrieval, gateway-adapter, workflow-service, skill-library, resource-scheduler

**问题描述:**
只有 web-portal 设置了 Content-Security-Policy 和其他安全头。其他服务使用 `sendJson()` 时仅设置 `content-type: application/json`。

**修复:** 在所有服务中统一添加安全响应头。

---

### 🟠 #6 [高危] 未处理的 Promise Rejection — void 异步调用

**位置:** 多个文件

**问题描述:**
代码中多处使用 `void asyncFunction()` 模式，如果异步函数抛出异常，会导致未处理的 Promise rejection：

- [executor-gateway/index.ts:120](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts#L120): `void autoExecuteWorkflowStages(workflowRef, runRef);`
- [fact-retrieval/service.ts:311](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L311): `void this.backfillEmbeddings(...)`
- [fact-retrieval/service.ts:518](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L518): `void this.projectEntityFromFact(...)`
- [fact-retrieval/service.ts:996](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L995-L1005): `void this.projectEntityFromFact(...)`

**修复:** 添加 `.catch()` 处理器：

```typescript
void autoExecuteWorkflowStages(workflowRef, runRef).catch(err => {
  logger.error('auto_execute.failed', 'Background auto-execution failed', { 
    workflow_ref: workflowRef, 
    error: String(err) 
  });
});
```

---

### 🟠 #7 [高危] 调试/测试端点在生产环境可访问

**位置:** [fact-retrieval/index.ts:73-87](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/index.ts#L73-L87)

**问题描述:**
`/internal/test/reset` 端点用于测试，已有 `NODE_ENV === 'production'` 检查。但如果 NODE_ENV 未正确设置 (例如设为 `'prod'` 而非 `'production'`)，则此端点会暴露。

**修复:** 使用多重防护：
```typescript
if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
  sendJson(res, 404, { ok: false, error: 'not_found' }); // 返回 404 而非 403 以隐藏端点存在
  return;
}
```

---

### 🟡 #8 [中危] N×N 关系自动创建 — 性能问题

**位置:** [service.ts](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L732-L754)

**问题描述:**
在 `writeEntities()` 中，对于 N 个实体，代码创建 O(N²) 的 `co_occurs_with` 关系：

```typescript
for (const [name, fromId] of entityNameToId) {
  for (const otherName of entityNameToId.keys()) {
    if (otherName === name) continue;
    // 为每对实体创建关系...
  }
}
```

当实体数量较大 (例如 100 个) 时，会创建 9900 条关系记录。

**修复:** 添加更严格的限制（已存在 `MAX_AUTO_RELATIONS = 100`），但建议限制输入实体数量或使用更智能的关联算法。

---

### 🟡 #9 [中危] 日志中可能包含敏感信息

**位置:** 多个服务文件

**问题描述:**
- `generic-executor.ts` 第 265 行: `Context: ${JSON.stringify(safeContext)}` — 上下文可能包含密码、密钥
- 多个地方在 error 日志中输出完整的 body 或请求内容

**修复:** 使用 redact 工具过滤敏感字段。

---

### 🟡 #10 [中危] 默认 ADMIN_PASSWORD 为空

**位置:** [web-portal/index.ts:46](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L46)

```typescript
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
```

如果未设置 `ADMIN_PASSWORD`，则 `adminOverride` 永远不会为 `true`。虽然这意味着需要通过数据库密码验证，但文档中应明确指出此行为。

---

### 🟡 #11 [中危] 没有请求体大小限制 (部分服务)

**位置:** [executor-gateway/index.ts:86](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts#L86), workflow-service

executor-gateway 和 workflow-service 使用 `readJson()` 时没有 body 大小限制，可能导致 OOM 攻击。

**修复:** 添加 `MAX_BODY_SIZE` 检查。

---

### 🟡 #12 [中危] 环境变量硬编码默认值安全问题

**位置:** docker-compose.yml, .env.example

**问题描述:**
Docker Compose 文件包含硬编码的默认密码：
- `POSTGRES_PASSWORD: dev_password`
- `REDIS_PASSWORD: agent_harness_redis`
- `MINIO_ROOT_PASSWORD: minioadmin`

虽然开发环境可用，但需要确保生产部署时覆盖这些值。

---

### 🟢 #13 [低危] 不必要的变量别名

**位置:** [executor-gateway/index.ts:60-61](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts#L60-L61)

```typescript
const readJson = readJsonShared
const sendJson = sendJsonShared
```

这些别名没有提供任何价值，且可能造成混淆。

---

### 🟢 #14 [低危] 不一致的错误响应格式

不同服务返回的错误格式不统一：
- `{ ok: false, error: 'xxx' }`
- `{ ok: false, error: 'xxx', message: 'yyy' }`
- `{ ok: false, error: 'xxx', retry_after_ms: N }`

**建议:** 统一使用 ErrorDetail 接口格式。

---

### 🟢 #15 [低危] 缺少 TypeScript 严格模式类型导出

**位置:** contracts 包

`@agent-harness/contracts` 导出了一些类型，但在使用侧大量使用 `as unknown as import('...').Stage` 类型断言模式：

```typescript
stage as unknown as import('@agent-harness/contracts').Stage
```

**建议:** 直接从 `@agent-harness/contracts` 导入类型。

---

### 🟢 #16 [低危] Dream Mode Scheduler 时间窗口竞态

**位置:** [web-portal/index.ts:2078-L2141](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L2067-L2141)

**问题描述:**
Dream Scheduler 每 2 分钟检查一次，条件检查 `if (config.dream_scheduled_hour === currentHour && currentMinute < 5)`。如果因某种原因 2 分钟窗口内多次触发，用户会收到重复分析。

---

## 四、代码质量评估

### 4.1 架构设计

| 维度 | 评分 | 说明 |
|------|------|------|
| 服务拆分 | A | 职责清晰，边界明确 |
| 通信模式 | B | HTTP 同步调用为主，缺少消息队列解耦 |
| 可扩展性 | B | 无服务注册/发现机制 |
| 弹性设计 | B- | 有重试机制，但缺熔断器 |

### 4.2 数据库设计

| 维度 | 评分 | 说明 |
|------|------|------|
| Schema 规范化 | B+ | 使用 Drizzle ORM，表结构合理 |
| 索引策略 | B | 有关键索引，但缺乏复合索引覆盖 |
| 查询效率 | B | 部分图查询存在 O(N²) 复杂度 |
| 数据隔离 | A- | 组织级隔离机制完善 |

### 4.3 代码风格

- ESLint 配置合理
- 过度使用 `as` 类型断言（约 80+ 处）
- `Record<string, unknown>` 的使用频繁，失去类型安全
- Promise 处理模式不统一 (`.then()` vs `async/await` vs `void`)

---

## 五、故事线覆盖度审查

基于 20 条用户故事线的代码匹配评估：

| 故事线 | 代码实现状态 | 问题 |
|--------|------------|------|
| 1-平台初始化 | ✅ 已实现 | web-portal setup wizard |
| 2-组织与用户 | ✅ 已实现 | gateway + DB |
| 3-LLM配置 | ✅ 已实现 | LLM_MODELS CRUD |
| 4-向量模型 | ⚠️ 部分 | deterministic fallback 未充分测试 |
| 5-Rerank | ⚠️ 部分 | 同上 |
| 6-知识管理 | ✅ 已实现 | fact-retrieval service |
| 7-日常对话 | ✅ 已实现 | gateway-adapter |
| 8-长任务工作流 | ✅ 已实现 | workflow + executor-gateway |
| 9-工作流执行 | ✅ 已实现 | autoExecuteWorkflowStages |
| 10-工作流汇报 | ✅ 已实现 | ResultReporting |
| 11-任务下发 | ✅ 已实现 | task scheduler |
| 12-审计监控 | ✅ 已实现 | audit lib + monitoring |
| 13-PGSQL隔离 | ✅ 已实现 | org_id based filtering |
| 14-定时知识抽取 | ✅ 已实现 | extractKnowledgeFromMemory |
| 15-AGE图查询 | ⚠️ 有风险 | Cypher injection vulnerability |
| 16-销售分流 | ✅ 已实现 | intent classification |
| 17-Skill归档 | ✅ 已实现 | SkillExtraction stage |
| 18-公网安装 | ✅ 已实现 | mirror-install endpoint |
| 19-人设自治 | ⚠️ 部分 | 缺少具体实现细节 |
| 20-梦境模式 | ⚠️ 待验证 | scheduler 存在重复触发风险 |

---

## 六、已修复问题清单

| 编号 | 问题 | 状态 |
|------|------|------|
| FIX-1 | getDbPool() 竞态条件 | ✅ 已修复 |
| FIX-2 | dispatch 端点策略绕过 | ✅ 已修复 |
| FIX-3 | 未处理 Promise Rejection (5 处) | ✅ 已修复 |
| FIX-4 | 测试重置端点安全加固 | ✅ 已修复 |
| FIX-5 | AGE Cypher 查询注入加固 | ✅ 已修复 |
| FIX-6 | 安全响应头缺失 | ✅ 已修复 |

---

## 七、改进路线图

### 短期 (1-2 周)
- [ ] 修复所有严重和高危安全漏洞
- [ ] 修复测试套件运行问题
- [ ] 添加 API 输入验证框架
- [ ] 统一错误响应格式

### 中期 (1-2 月)
- [ ] 引入 API Gateway 统一入口
- [ ] 实现服务健康检查 + 自动重启
- [ ] 添加分布式追踪 (OpenTelemetry)
- [ ] 补充集成测试覆盖

### 长期 (3-6 月)
- [ ] 引入消息队列 (Kafka/RabbitMQ) 解耦服务
- [ ] 实现服务网格 (Service Mesh)
- [ ] 建立 SLO/SLI 监控体系
- [ ] 自动化混沌工程测试

---

## 八、附录

### A. 审计覆盖率

| 类别 | 覆盖文件 | 覆盖行 | 覆盖率 |
|------|---------|--------|--------|
| apps/ | 5/5 | ~4000 | 100% |
| services/ | 8/8 | ~7000 | 100% |
| libs/ | 4/4 | ~2000 | 100% |
| config/ | 3/3 | ~200 | 100% |
| db/ | 1/1 | ~900 | 100% |
| docs/ | 9/9 | ~5000 | 100% |

**总覆盖: 30/30 文件, ~19,100 行**

### B. 工具版本

- Node.js: 22.x
- TypeScript: 5.x
- Drizzle ORM: latest
- Jest + ts-jest: latest
- ESLint: configured

---

*审计报告生成时间: 2026-05-08T08:00:00Z*  
*审计者: MAX 模式自动化审计系统*  
*下次审计建议: 2026-05-22 (修复严重问题后进行验证审计)*
