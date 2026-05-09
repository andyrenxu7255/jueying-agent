# Agent Harness 安全审计报告

**审计日期**: 2026-05-08
**审计范围**: `agent-harness/` 全部代码、 `development/` 文档与图谱
**审计标准**: OWASP 安全实践、Express/Node.js 安全最佳实践、前端安全最佳实践

---

## 执行摘要

对 Agent Harness 项目进行了全面的安全审计，涵盖入口点配置、认证与会话管理、注入类漏洞、XSS 防御、CSRF 防护、CORS 配置、输入验证、命令注入、前端安全、限流机制等 10 个主要领域。共发现 **8 项安全发现**，其中无严重（Critical）级别漏洞，**4 项高风险（High）**、**2 项中风险（Medium）**、**2 项低风险（Low）**。

审计发现项目的安全基础较好（使用 scrypt 密码哈希、timingSafeEqual 常量时间比较、登录限流和账号锁定机制），但在请求体验证、前端 XSS 防御模式、跨服务安全头缺失、以及部分代码中存在不良安全模式等方面需要改进。

---

## 审计发现清单

| ID | 严重级别 | 类别 | 描述 |
|----|---------|------|------|
| AH-SEC-001 | HIGH | 输入验证 | web-portal 未设置请求体大小限制，存在内存耗尽 DoS 风险 |
| AH-SEC-002 | HIGH | XSS | 前端 `showModal` 函数直接注入未转义的 HTML，存在 XSS 风险 |
| AH-SEC-003 | HIGH | 认证安全 | 会话标识符存储在 localStorage，存在 XSS 会话劫持风险 |
| AH-SEC-004 | HIGH | 密码安全 | 密码验证存在弱 SHA256 回退路径，遗留密码不安全 |
| AH-SEC-005 | MEDIUM | 安全头 | executor-gateway 等服务未设置安全响应头（CSP、X-Frame-Options、X-Content-Type-Options） |
| AH-SEC-006 | MEDIUM | 注入 | `sanitizeCypherLiteral` 采用黑名单清洗方式，存在绕过可能 |
| AH-SEC-007 | LOW | 命令注入 | Docker stats 命令使用字符串拼接容器 ID，模式不安全 |
| AH-SEC-008 | LOW | CORS | `Access-Control-Allow-Credentials: true` 无条件设置 |

---

## 详细审计发现

### AH-SEC-001 — web-portal 未设置请求体大小限制

- **严重级别**: HIGH
- **规则 ID**: EXPRESS-BODY-001 (Node.js 等效)
- **位置**: [apps/web-portal/src/index.ts:L178-L189](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L178-L189)
- **证据**:

```typescript
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}
```

- **影响**: 攻击者可以向 `/api/auth/login`、`/api/task/submit` 等接受 JSON 请求体的端点发送超大请求体，导致 Node.js 进程内存耗尽（OOM），触发服务崩溃。在 Docker 环境中可能连锁影响其他容器。
- **修复**: 添加内容长度检查，在读取请求体前验证 `Content-Length` 头不超过合理上限（如 1MB）。
- **缓解措施**: 在反向代理层（Nginx/Traefik）设置 `client_max_body_size` 作为深度防御。
- **误报说明**: 无。这是一个明确的 DoS 向量。

---

### AH-SEC-002 — 前端 `showModal` 函数直接注入未转义的 HTML

- **严重级别**: HIGH
- **规则 ID**: JS-XSS-001
- **位置**: [apps/web-portal/static/app.js:L83-L97](file:///d:/teamclaw/agent-harness/apps/web-portal/static/app.js#L83-L97)
- **证据**:

```javascript
function showModal(title, bodyHtml, onClose) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><h3>' + escapeHtml(title) + '</h3>' + bodyHtml + '</div>';
  ...
}
```

- **影响**: 标题使用 `escapeHtml()` 进行了转义，但 `bodyHtml` 参数未经任何转义直接拼接到 `innerHTML`。虽然在代码审查中当前所有 10 个调用点传入的都是硬编码 HTML 字符串（或静态模板），但这一函数签名隐含地信任所有调用者传入安全的 HTML，是一个危险的架构模式。任何未来开发者添加包含用户输入或 API 返回数据的 `showModal` 调用都可能直接引入 XSS 漏洞。

- **修复**: 
  1. 将函数签名改为 `showModal(title, bodyText)`，使用 `textContent` 替代 `innerHTML`
  2. 将现有的富 HTML 调用点重构为独立函数（如 `showChangePasswordModal`、`showAddLLMModel` 等），在函数内部安全构建 HTML
  3. 或者添加明确的函数文档注释警告此函数不做 HTML 转义

- **缓解措施**: 部署严格的 CSP 作为防御层（当前 web-portal 已有基础 CSP）。

- **误报说明**: 当前所有调用点传入的是硬编码 HTML，暂无已知活跃 XSS 路径。但函数设计模式存在风险，应修复以防未来引入漏洞。

---

### AH-SEC-003 — 会话标识符存储在 localStorage

- **严重级别**: HIGH
- **规则 ID**: JS-STORAGE-001
- **位置**: 
  - [apps/web-portal/static/app.js:L11](file:///d:/teamclaw/agent-harness/apps/web-portal/static/app.js#L11)
  - [apps/web-portal/static/app.js:L136](file:///d:/teamclaw/agent-harness/apps/web-portal/static/app.js#L136)
- **证据**:

```javascript
function getSessionId() {
  return localStorage.getItem('ah_session_id') || '';
}

// 登录成功后:
localStorage.setItem('ah_session_id', r.data.session_id);
```

- **影响**: 会话标识符（session_id）存储在 `localStorage` 中，任何成功的 XSS 攻击都可以直接读取并窃取该值，导致会话劫持。相比 `HttpOnly` cookie，`localStorage` 完全暴露给所有同源 JavaScript 代码。
- **修复**: 将会话标识符改为服务端设置的 `HttpOnly` cookie，使 JavaScript 无法直接读取。或添加 session token rotation 机制（但成本较高）。
- **缓解措施**: 加强 XSS 防御（修复 AH-SEC-002），确保 CSP 严格限制 `script-src`。
- **误报说明**: 无。OWASP 明确建议不要将敏感 token 存储在 Web Storage 中。

---

### AH-SEC-004 — 密码验证存在弱 SHA256 回退路径

- **严重级别**: HIGH
- **规则 ID**: NIST SP 800-63B (密码存储标准)
- **位置**: [apps/web-portal/src/index.ts:L59-L93](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L59-L93)
- **证据**:

```typescript
function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith('scrypt:')) {
    // 使用 scrypt 验证 (安全)
    ...
  }
  if (storedHash.startsWith('sha256:')) {
    // 回退到 SHA256 验证 (不安全)
    const plain = storedHash.slice(7);
    const computed = createHash('sha256').update(password).digest('hex');
    return timingSafeEqual(Buffer.from(plain), Buffer.from(computed));
  }
  // 最终回退到裸 SHA256
  const computed = createHash('sha256').update(password).digest('hex');
  return timingSafeEqual(Buffer.from(storedHash), Buffer.from(computed));
}
```

- **影响**: SHA256 不是适合密码存储的哈希函数——它缺乏盐值、缺乏迭代成本，且极快计算，使得彩虹表攻击和 GPU 暴力破解可行。如果数据库中的旧用户密码仍以 SHA256 格式存储，这些账户的密码极易被离线破解。
- **修复**: 
  1. 移除 SHA256 回退路径
  2. 对于遗留 SHA256 密码，在用户下次成功登录时自动迁移到 scrypt 格式
- **缓解措施**: 无。遗留路径应尽早移除。
- **误报说明**: 无。

---

### AH-SEC-005 — 跨服务安全响应头缺失

- **严重级别**: MEDIUM
- **规则 ID**: EXPRESS-HEADERS-001, EXPRESS-FINGERPRINT-001
- **位置**: 
  - [services/executor-gateway/src/index.ts](file:///d:/teamclaw/agent-harness/services/executor-gateway/src/index.ts)
  - [services/fact-retrieval/src/index.ts](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/index.ts)
  - [services/workflow/src/index.ts](file:///d:/teamclaw/agent-harness/services/workflow/src/index.ts)
  - [services/skill-library/src/index.ts](file:///d:/teamclaw/agent-harness/services/skill-library/src/index.ts)
  - [services/hermes-adapter/src/index.ts](file:///d:/teamclaw/agent-harness/services/hermes-adapter/src/index.ts)
  - [services/resource-scheduler/src/index.ts](file:///d:/teamclaw/agent-harness/services/resource-scheduler/src/index.ts)
- **证据**: 这些微服务未设置 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy` 或 CSP 头。web-portal 是唯一设置了这些头部的服务。
- **影响**: 缺少安全头降低了深度防御能力。X-Content-Type-Options 缺失可能允许 MIME 类型嗅探攻击。X-Frame-Options 缺失允许点击劫持。
- **修复**: 在 shared 库中创建统一的 `applySecurityHeaders(res)` 辅助函数，所有服务在响应中调用。
- **缓解措施**: 如果反向代理在边缘层统一下发安全头，则修复紧迫性降低。需在运维层面确认。
- **误报说明**: 这些服务是内部微服务，不直接面向浏览器用户。如果反向代理统一下发安全头，此发现可能为误报。

---

### AH-SEC-006 — sanitizeCypherLiteral 使用黑名单清洗

- **严重级别**: MEDIUM
- **规则 ID**: EXPRESS-INJECT-001 (通用原则)
- **位置**: [services/fact-retrieval/src/service.ts:L119-L127](file:///d:/teamclaw/agent-harness/services/fact-retrieval/src/service.ts#L119-L127)
- **证据**:

```typescript
function sanitizeCypherLiteral(value: string): string {
  const cleaned = String(value || '');
  return cleaned
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\$/g, '')
    .replace(/[\n\r]/g, ' ')
    .slice(0, 4096);
}
```

- **影响**: 黑名单清洗方法本质上容易存在绕过。虽然当前处理了最常见的注入字符，但攻击者可能利用其他未处理的特殊字符（如 Unicode 变体、AGE 特有的语法元素）绕过清洗。该值后续会被直接拼接进 Cypher 查询（如 `CREATE (n:Entity {canonical_name: '${entityName}'}...)`）。
- **修复**: 
  1. 优先使用参数化查询 / 预处理语句
  2. 如果 AGE 不支持参数化查询，采用白名单方法（仅允许字母数字和中文字符）而非黑名单过滤
  3. 添加严格的字符集验证在业务层
- **缓解措施**: 目前的清洗覆盖了主要注入向量，暂无已知绕过。作为深度防御措施加强。
- **误报说明**: 无。

---

### AH-SEC-007 — Docker stats 命令使用字符串拼接

- **严重级别**: LOW
- **规则 ID**: EXPRESS-CMD-001
- **位置**: [apps/web-portal/src/index.ts:L1627](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L1627)
- **证据**:

```typescript
const statsOutput = execSync(
  `docker stats --no-stream --format "{{.CPUPerc}}|{{.MemPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}" ${id}`,
  { timeout: 10000, encoding: 'utf8' }
);
```

- **影响**: 容器 ID (`id`) 来源于 `docker ps` 命令的输出，是系统内部数据，不受外部用户控制。该端点需要 admin 权限。攻击面极小——攻击者需要先获取 admin 权限，然后还需要能够控制 Docker 引擎的容器列表输出才能注入命令。实际利用可能性很低。
- **修复**: 添加容器 ID 格式验证（确保只包含十六进制字符），然后进行拼接，作为最佳实践。
- **缓解措施**: 当前缓解措施（admin 权限 + 内部数据源）已足够。
- **误报说明**: 实际风险很低。此发现更多是提醒：在安全敏感上下文中应避免将变量直接拼接到 shell 命令中。

---

### AH-SEC-008 — CORS Access-Control-Allow-Credentials 无条件设置

- **严重级别**: LOW
- **规则 ID**: EXPRESS-CORS-001
- **位置**: [apps/web-portal/src/index.ts:L503-L505](file:///d:/teamclaw/agent-harness/apps/web-portal/src/index.ts#L503-L505)
- **证据**:

```typescript
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

- **影响**: 即使 origin 不在允许列表中，`Access-Control-Allow-Credentials: true` 头部仍然会被设置。如果后续 CORS 逻辑被修改为更宽松的策略，这个硬编码的 credentials 头部可能导致凭据泄露给不可信来源。
- **修复**: 条件性设置 credentials 头部——仅在 origin 通过验证且确实需要凭据时设置。
- **缓解措施**: 当前 origin 验证逻辑正确（allowlist + wildcard 检查），暂无实际风险。
- **误报说明**: 无实际攻击向量。作为防御性修复建议。

---

## 安全优势（已正确实施）

以下安全措施已正确实施，值得肯定：

- ✅ 密码使用 **scrypt** 哈希存储（cost=16384，32 字节密钥，16 字节随机盐）
- ✅ 使用 **timingSafeEqual** 进行常量时间密码比较，防止时序攻击
- ✅ 登录接口有**限流机制**（5 次失败锁定，30s-15min 递增锁定时间）
- ✅ **账号锁定机制**：过期锁定自动清理
- ✅ web-portal 设置了基础的 **CSP 头**（`default-src 'self'; script-src 'self'`）
- ✅ web-portal 设置了 `X-Content-Type-Options: nosniff`
- ✅ web-portal 设置了 `X-Frame-Options: DENY`
- ✅ web-portal 设置了 `Referrer-Policy: strict-origin-when-cross-origin`
- ✅ CORS 有 origin 验证逻辑和 **wildcard production 拦截**
- ✅ 审计日志记录全部关键操作
- ✅ 结构化错误响应，不泄露堆栈信息
- ✅ 优雅关闭流程（SIGTERM/SIGINT）

---

## 修复优先级建议

| 优先级 | 发现 ID | 描述 | 修复复杂度 |
|--------|---------|------|-----------|
| P0 (立即) | AH-SEC-001 | 请求体大小限制 | 低 (约 5 行) |
| P0 (立即) | AH-SEC-004 | SHA256 密码回退移除 | 低 (约 15 行) |
| P1 (本周) | AH-SEC-003 | 会话 localStorage 迁移 | 中 (需前后端配合) |
| P1 (本周) | AH-SEC-002 | showModal XSS 重构 | 中 (约 30 行改动) |
| P2 (本月) | AH-SEC-005 | 跨服务安全头统一下发 | 低 (约 20 行) |
| P2 (本月) | AH-SEC-006 | Cypher 清洗白名单化 | 中 (需数据库验证) |
| P3 (后续) | AH-SEC-007 | Docker 命令参数验证 | 低 (约 5 行) |
| P3 (后续) | AH-SEC-008 | CORS credentials 条件化 | 低 (约 3 行) |

---

*报告基于 Security Best Practices for Express in Production、OWASP Cheat Sheets、Node.js Security Best Practices 及项目 context-graph.json v1.9 知识图谱。*
