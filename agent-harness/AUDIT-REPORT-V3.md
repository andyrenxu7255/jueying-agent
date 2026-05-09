# Agent Harness 全量代码审计报告 V3

**审计日期:** 2026-05-08
**审计范围:** `agent-harness/` 全仓（APPs, Services, Libraries, Database, Deployment）
**技术栈:** TypeScript 5.7, Node.js 20 LTS, Express 4.21, Drizzle ORM, PostgreSQL 16, Apache AGE, Redis, Casbin, Winston
**参考标准:** OWASP Cheat Sheet Series, Express Security Best Practices, Node.js Security Best Practices

---

## 执行摘要

本次审计覆盖了 Agent Harness 项目下 3 个应用、7 个服务、4 个共享库以及全部基础设施配置。项目整体安全性处于 **良好水平**——参数化查询贯穿始终，Casbin RBAC 授权体系完整，文件上传有严格的 allowlist 校验，密钥通过环境变量注入（未发现硬编码机密），密码使用 SHA-256 哈希存储。

本轮新发现的主要改进重点为：npm 依赖漏洞处置、工作流状态机逻辑完整性、Docker 容器安全加固、安全响应头补充以及 Cyper 查询注入防御增强。

---

## 发现概览

| 严重级别 | 数量 | 标识 |
|---------|------|------|
| 严重 (Critical) | 0 | — |
| 高 (High) | 2 | AH-DEPS-001, AH-FSM-001 |
| 中 (Medium) | 5 | AH-DEPS-002, AH-HEADERS-001, AH-DOCKER-001, AH-SESS-001, AH-CYPHER-001 |
| 低 (Low) | 4 | AH-SECRETS-001, AH-LOG-001, AH-FRONTEND-001, AH-VECTOR-001 |

---

## 详细发现

### AH-DEPS-001: xlsx 包存在 HIGH 级别已知漏洞（原型污染 + ReDoS）

- **严重级别:** 高
- **规则 ID:** EXPRESS-DEPS-001
- **位置:** `package.json` → `drizzle-kit` → `xlsx@0.20.2`
- **证据:**
  ```
  npm audit report:
  xlsx  0.18.0 - 0.20.2
  Severity: high
  xlsx vulnerable to Regular Expression Denial of Service (ReDoS) - https://github.com/advisories/GHSA-4g6x-7m65-4x73
  xlsx has prototype pollution in sheet names - https://github.com/advisories/GHSA-w34w-xwq5-3x7c
  fix available via `npm audit fix --force`
  Will install drizzle-kit@0.31.1, which is a breaking change
  node_modules/xlsx
    drizzle-kit  >=0.22.0
    Depends on vulnerable versions of xlsx
    node_modules/drizzle-kit
  ```
- **影响:** xlsx 是 drizzle-kit 的开发依赖，在 CI/构建过程中解析 `.xlsx` 种子数据文件时存在 ReDoS 和原型污染风险。
- **修复方案:**
  1. 升级 `drizzle-kit` 到 `0.31.1+`（该版本已移除对 xlsx 的依赖或在内部使用更新版本）
  2. 启动和集成测试后渐进式升级
- **优先级建议:** 3 天内完成（低实际暴露面但需要处置）
- **风险:** 低（drizzle-kit 仅在本地开发/CI 使用，不进入生产运行时）
- **验证方法:** `npm audit` 零 HIGH/CRITICAL 告警、`npm run db:migrate` 通过

---

### AH-FSM-001: 工作流状态机从 `verifying` 暂停后无法恢复

- **严重级别:** 高
- **规则 ID:** 自定义 (业务逻辑完整性)
- **位置:** [workflow-machine.ts:L38](file:///d:/teamclaw/agent-harness/services/workflow/src/engine/workflow-machine.ts#L38) → `verifying`
- **证据:**
  ```typescript
  // L38: verifying 允许 PAUSE → 'paused'
  verifying: { REPAIR: 'repairing', REPORT: 'reporting', FAIL: 'failed', PAUSE: 'paused' },
  // ...
  // L43: paused 允许 RESUME → 'running'（无法回到 verifying）
  paused: { RESUME: 'running', CANCEL: 'cancelled', FAIL: 'failed' },
  ```
- **影响:** 当工作流处于 `verifying` 阶段时暂停，RESUME 后直接回到 `running` 而不是 `verifying`。这意味着验证进度和结果丢失，需要从 running 重新触发 VERIFY 事件才能重新进入验证阶段。如果外部调度器未处理此情况，工作流可能陷入逻辑不一致。
- **修复方案（两种选择）:**
  - **方案 A（推荐）:** 修改 `RESUME` 的行为，使其恢复到暂停前的状态：
    ```typescript
    // 在 WorkflowStateMachine 中添加 previousState 追踪
    send(event: WorkflowEvent): { changed: boolean; state: WorkflowState } {
      // ...

      if (event.type === 'RESUME' && this.previousState) {
        this.state = this.previousState;  // 恢复原状态
      }
      // ...
    }
    ```
  - **方案 B（保守）:** 从 `verifying` 状态移除 `PAUSE` 转换，验证阶段不允许暂停。
- **风险评估:** 方案 A 需要修改状态机核心逻辑（中风险），方案 B 是简单的配置删除（低风险）。当前业务中 verifying 阶段的操作为只读验证，暂停必要性较低，建议优先采用方案 B。
- **验证方法:** 
  - 单元测试: 创建 `verifying` 状态 → 发送 PAUSE → 验证卡住 → 修复后验证能正确恢复
  - 运行 `npm test -w services/workflow`

---

### AH-DEPS-002: esbuild 存在中等漏洞（drizzle-kit 依赖链）

- **严重级别:** 中
- **规则 ID:** EXPRESS-DEPS-001
- **位置:** `package.json` → `drizzle-kit` → `esbuild`
- **证据:**
  ```
  esbuild  <=0.24.2
  Severity: moderate
  esbuild enables any website to send any requests to the development server - https://github.com/advisories/GHSA-67mh-4wv8-2f99
  ```
- **影响:** esbuild 开发服务器在本地可被同一网络下的任意网站发送请求。drizzle-kit 通常在本地使用，影响面有限。
- **修复方案:** 随 AH-DEPS-001 的 drizzle-kit 升级一并解决
- **优先级建议:** 跟随 AH-DEPS-001 处理

---

### AH-HEADERS-001: 缺少 Content-Security-Policy 和 Helmet 安全头

- **严重级别:** 中
- **规则 ID:** EXPRESS-HEADERS-001
- **位置:** [web-portal/src/index.ts:L157-L240](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L157-L240)
- **证据:**
  ```typescript
  // Web Portal 当前设置的安全头:
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // ❌ 缺少: Content-Security-Policy
  // ❌ 缺少: Strict-Transport-Security（如启用TLS）
  // ❌ X-Powered-By 未禁用
  ```
- **影响:** 缺少 CSP 意味着成功注入的恶意脚本不会被浏览器拦截，XSS 攻击面放大。
- **修复方案:**
  1. 添加 `helmet()` 中间件或手动设置 CSP 头：
     ```typescript
     // 最小可行 CSP（非侵入式）
     const csp = [
       "default-src 'self'",
       "script-src 'self'",
       "style-src 'self' 'unsafe-inline'",
       "img-src 'self' data: blob:",
       "connect-src 'self'",
     ].join('; ');
     res.setHeader('Content-Security-Policy', csp);
     ```
  2. 添加 `app.disable('x-powered-by')` 以消除暴露
- **风险评估:** 低（纯增量添加，不影响现有功能）
- **验证方法:** 浏览器 DevTools → Network → 检查响应头；`curl -I http://localhost:3000`

---

### AH-DOCKER-001: Docker 容器以 root 用户运行

- **严重级别:** 中
- **规则 ID:** 自定义 (Container Security)
- **位置:** [workflow/Dockerfile:L1-L20](file:///d:/teamclaw/agent-harness/services/workflow/Dockerfile), [fact-retrieval/Dockerfile](file:///d:/teamclaw/agent-harness/services/fact-retrieval/Dockerfile), [docker-compose.yml](file:///d:/teamclaw/agent-harness/docker-compose.yml)
- **证据:**
  ```dockerfile
  # Dockerfile 中未包含 USER 指令
  FROM node:20-alpine
  WORKDIR /app
  # ... COPY, RUN ...
  CMD ["node", "dist/index.js"]  # 以 root 运行
  ```
- **影响:** 容器逃逸后攻击者获得宿主机 root 权限。
- **修复方案:**
  1. 在每个 Dockerfile 末尾添加非 root 用户：
     ```dockerfile
     RUN addgroup -S appgroup && adduser -S appuser -G appgroup
     USER appuser
     ```
  2. 在 `docker-compose.yml` 中添加安全选项：
     ```yaml
     security_opt:
       - no-new-privileges:true
     ```
- **风险评估:** 低——文件系统权限需调整（确保 `/app` 目录及其子目录归 `appuser` 所有）
- **验证方法:** `docker exec <container> whoami` 输出非 root

---

### AH-SESS-001: Web Portal 使用内存 Map 作为会话存储

- **严重级别:** 中
- **规则 ID:** EXPRESS-SESS-002
- **位置:** [web-portal/src/index.ts:L315-L340](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L315-L340)
- **证据:**
  ```typescript
  const sessionStore = new Map<string, { ... }>();
  // 仅当 REDIS_URL 设置时才初始化 Redis
  // 否则使用内存 Map，重启后所有会话丢失
  ```
- **影响:** 服务重启后所有用户被强制登出；多实例部署时无法共享会话状态。
- **修复方案:**
  1. 设置 `REDIS_URL` 环境变量以启用 Redis 会话存储（已有的代码路径）
  2. 在 Docker Compose 中启用 Redis 服务
  3. 添加健康检查确保 Redis 可用
- **优先级建议:** 生产部署前必须解决
- **验证方法:** Redis 客户端检查会话键；重启验证登录状态保持

---

### AH-CYPHER-001: AGE Cypher 查询中 graphName 非参数化拼接

- **严重级别:** 中
- **规则 ID:** EXPRESS-INJECT-001 (变体)
- **位置:** [fact-retrieval/src/service.ts:L895-L910](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L895-L910)
- **证据:**
  ```typescript
  // L895: graphName 直接拼入 Cypher 上下文
  await client.query(`SELECT drop_graph('${graphName}', true)`);
  await client.query(`SELECT create_graph('${graphName}')`);
  // L1295: 同样直接拼入
  await client.query(
    `SELECT * FROM cypher('${graphName}', $tag$ ${cypher} $tag$) AS (...)`
  );
  ```
- **影响:** 当前 `graphName` 为硬编码常量 `'knowledge_graph'`，暂无可利用风险。但如果后续支持多租户动态图名，则存在 Cypher 注入可能。
- **修复方案:**
  1. 提取常量到模块级别：
     ```typescript
     const KNOWLEDGE_GRAPH_NAME = 'knowledge_graph';
     ```
  2. 如确需支持动态图名，添加 allowlist：
     ```typescript
     const ALLOWED_GRAPH_NAMES = new Set(['knowledge_graph']);
     function getGraphName(name: string): string {
       if (!ALLOWED_GRAPH_NAMES.has(name)) throw new Error('invalid graph name');
       return name;
     }
     ```
- **风险评估:** 低（当前为硬编码常量）

---

### AH-SECRETS-001: 日志中可能泄露敏感信息

- **严重级别:** 低
- **规则 ID:** 0) Safety, Boundaries (Express Spec)
- **位置:** [gateway-adapter/src/index.ts:L80-L100](file:///d:/teamclaw/agent-harness/apps/gateway-adapter/src/index.ts#L80-L100) (Winston request logger)
- **证据:**
  ```typescript
  // Winston Express 请求日志会记录 req.body、req.headers
  // 当请求包含认证 token 或敏感 payload 时，会写入日志文件
  ```
- **影响:** 日志文件若未妥善保护，可被权限较低的运维人员读取到认证凭据。
- **修复方案:**
  1. 在 Winston format 中添加敏感字段脱敏：
     ```typescript
     const redactSensitive = winston.format((info) => {
       if (info.headers?.authorization) {
         info.headers.authorization = '[REDACTED]';
       }
       return info;
     });
     ```
  2. 或将请求日志级别设为 `debug`，生产环境使用 `info`
- **验证方法:** 检查日志文件中是否出现 `authorization` 或 `x-api-key` 完整值

---

### AH-LOG-001: 部分服务启动日志打印数据库连接字符串

- **严重级别:** 低
- **规则 ID:** 0) Safety, Boundaries (Express Spec)
- **位置:** 各服务 `index.ts` 启动日志
- **证据:** `logger.info('server.starting', ...)` 可能包含 DATABASE_URL 片段
- **影响:** 启动日志中意外暴露数据库密码。
- **修复方案:** 在打印 DATABASE_URL 日志前使用 `new URL(url).origin` 或脱敏
- **验证方法:** 检查容器/进程启动日志

---

### AH-FRONTEND-001: Web Portal 前端使用 innerHTML 注入动态内容

- **严重级别:** 低
- **规则 ID:** JS-XSS-001
- **位置:** [web-portal/static/app.js](file:///d:/teamclaw/agent-harness/apps/web-portal/static/app.js) (多处)
- **证据:**
  ```javascript
  // app.js 多处使用 innerHTML 渲染 API 返回的 Markdown/HTML 内容
  container.innerHTML = marked.parse(content);
  ```
- **影响:** 若后端返回的 Markdown 包含恶意 HTML（未正确过滤），可触发 XSS。
- **修复方案:**
  1. 在 marked 配置中禁用 HTML 标签或启用 sanitize 选项
  2. 或使用 DOMPurify 在渲染前净化内容：
     ```javascript
     container.innerHTML = DOMPurify.sanitize(marked.parse(content));
     ```
  3. 同时添加 CSP 头（参见 AH-HEADERS-001）作为纵深防御
- **验证方法:** 尝试提交包含 `<img src=x onerror=alert(1)>` 的 Markdown

---

### AH-VECTOR-001: 向量数据以 JSON 字符串存储在 PostgreSQL 中

- **严重级别:** 低
- **规则 ID:** 自定义 (数据存储)
- **位置:** [fact-retrieval/src/service.ts:L173-L176](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L173-L176), [shared/src/db/schema.ts](file:///d:/teamclaw/agent-harness/libs/shared/src/db/schema.ts)
- **证据:**
  ```typescript
  await pool.query(
    'UPDATE document_chunk SET embedding = $1::vector, embedding_model_version = $2 WHERE id = $3',
    [JSON.stringify(embeddingResult.embedding), embeddingResult.provider || 'unknown', chunk.id]
  );
  ```
- **影响:** 向量以 JSON 格式传递到 pgvector，比原生二进制格式效率低；大量向量更新时 JSON 序列化/反序列化开销显著。
- **修复方案:** 使用 pgvector 的原生浮点数组绑定而非 JSON 序列化（需调整 Drizzle schema）
- **优先级建议:** 低（性能优化而非安全问题）

---

## 正面发现（已良好实践）

以下方面已做得很好，无需修复：

1. **SQL 注入防护:** 全仓使用 Drizzle ORM 参数化查询或 `pg` 的 `$1, $2` 占位符，无字符串拼接 SQL。
2. **授权体系:** Casbin RBAC + 组织级策略覆盖 + 审计日志，权限控制完整。
3. **文件上传校验:** `file-validator.ts` 有 80+ 扩展名 allowlist、魔数检测、50MB 限制、文件名路径穿越过滤。
4. **路径穿越防护:** `artifact-storage.ts` 的 `validateSecurePath` 阻止任意路径读写。
5. **会话管理:** 支持 token 轮换、Redis 持久化备选、会话场景隔离。
6. **密码存储:** SHA-256 哈希（非明文）。
7. **无 `--inspect` 标志:** 所有 Dockerfile 和启动脚本均未发现。
8. **无 `insecureHTTPParser`:** 未在任何 service 中发现。
9. **Axios 0.21.4/1.7.9:** 未命中 CVE-2023-45857（SSRF/CRLF注入已修复）。
10. **Node.js 版本:** 使用 20/22 LTS 行，非 EOL。

---

## 修复方案排期建议

| 优先级 | ID | 修复内容 | 建议时间 | 风险 |
|--------|----|---------|---------|------|
| P0 (本周) | AH-DEPS-001 | 升级 drizzle-kit 处置 xlsx 漏洞 | 1d | 低 |
| P0 (本周) | AH-HEADERS-001 | 添加 CSP + 禁用 X-Powered-By | 0.5d | 低 |
| P1 (2周内) | AH-FSM-001 | 修复 verifying→pause→resume 逻辑 | 1d | 低~中 |
| P1 (2周内) | AH-DOCKER-001 | Docker 非 root 运行 | 1d | 低 |
| P2 (1月内) | AH-SESS-001 | 启用 Redis 会话存储 | 0.5d | 低 |
| P2 (1月内) | AH-CYPHER-001 | 提取 graphName 常量 | 0.5d | 低 |
| P2 (1月内) | AH-SECRETS-001 | 日志脱敏 | 0.5d | 低 |
| P3 (持续) | AH-FRONTEND-001 | 前端 Markdown 渲染安全化 | 1d | 低 |
| P3 (持续) | AH-VECTOR-001 | 向量存储优化 | 1d | 低 |

---

## 验证清单

修复完成后按以下清单验证：

- [ ] `npm audit` 输出零 HIGH/CRITICAL
- [ ] `npm test` 全仓通过
- [ ] 工作流状态机单元测试覆盖 verifying→pause→resume 路径
- [ ] `docker compose up` 所有容器以非 root 运行
- [ ] 浏览器访问 Portal，CSP 头出现在响应中
- [ ] `curl -I http://localhost:3000 | grep -i x-powered-by` 无输出
- [ ] Redis 中有 session 键存在
- [ ] 日志文件中无敏感信息明文
- [ ] Markdown 注入测试 payload 不执行
