# 前端页面审计修改记录

> 审计日期: 2026-05-03
> 审计范围: agent-harness/apps/web-portal 全部前端页面
> 目标浏览器: Google Chrome (最新稳定版)
> 审计人员: AI Assistant

---

## 一、审计发现汇总

| 编号 | 严重级别 | 类别 | 问题描述 | 影响页面 |
|------|----------|------|----------|----------|
| F-01 | **严重** | 功能异常 | `JSON.stringify()` 在 onclick 属性中产生双引号，破坏 HTML 属性解析 | 组织管理、共享知识库、任务分发、我的任务 |
| F-02 | **严重** | 功能异常 | `escapeHtml()` 不转义单引号，在 onclick 的 JS 字符串中导致语法错误 | Workflow 控制台、审批台、身份绑定、知识审核 |
| F-03 | 中等 | 显示错误 | 缺少 `.btn-warning` CSS 类定义，按钮无样式渲染 | 任务分发（暂停按钮）、知识审核（退回按钮） |
| F-04 | 中等 | 功能异常 | Toast 通知堆叠在同一位置，多条通知互相覆盖 | 全局 |
| F-05 | 中等 | 功能异常 | 会话过期后 API 返回 401，前端不自动跳转登录页 | 全局 |
| F-06 | 低 | 功能异常 | `api()` 函数未处理非 JSON 响应，反向代理返回 HTML 错误页时崩溃 | 全局 |
| F-07 | 低 | 性能问题 | 静态文件无 `Cache-Control` 头，每次访问均重新请求 | 全局 |
| F-08 | 低 | 安全问题 | 静态文件缺少 `Referrer-Policy` 响应头 | 全局 |

---

## 二、修改详情

### F-01: 修复 `JSON.stringify()` 在 onclick 属性中的错误使用

**文件**: `apps/web-portal/static/app.js`

**问题根因**:
`JSON.stringify("uuid-string")` 输出 `"uuid-string"`（含双引号），当嵌入 `onclick="func("uuid-string")"` 时，双引号破坏了 HTML 属性的解析，导致 Chrome 报 `SyntaxError`，按钮完全无法点击。

**修复方案**:
新增 `escJsAttr()` 函数，专门用于在 HTML 属性中安全嵌入 JS 字符串字面量。该函数依次执行 JS 转义（`\`、`'`、换行符）和 HTML 实体编码（`&`、`<`、`>`、`"`），确保值在 HTML 解码后仍为合法 JS 字符串。

**修改位置** (共 9 处):

| 行号(原) | 原代码 | 修改后 |
|-----------|--------|--------|
| ~367 | `onclick="showEditOrg(' + JSON.stringify(o.id) + ')"` | `onclick="showEditOrg('" + escJsAttr(String(o.id)) + "')"` |
| ~392 | `onclick="deleteOrg(' + JSON.stringify(o.id) + ',' + JSON.stringify(o.org_name) + ')"` | `onclick="deleteOrg('" + escJsAttr(String(o.id)) + "','" + escJsAttr(o.org_name) + "')"` |
| ~424 | `onclick="doEditOrg(' + JSON.stringify(orgId) + ')"` | `onclick="doEditOrg('" + escJsAttr(String(orgId)) + "')"` |
| ~425 | `onclick="document.getElementById(' + JSON.stringify('org-editor') + ').classList.add(' + JSON.stringify('hidden') + ')"` | `onclick="document.getElementById('org-editor').classList.add('hidden')"` |
| ~472 | `onclick="deleteSharedDoc(' + JSON.stringify(d.id) + ')"` | `onclick="deleteSharedDoc('" + escJsAttr(String(d.id)) + "')"` |
| ~508 | `onchange="document.getElementById(' + JSON.stringify('ot-cron-row') + ')..."` | `onchange="document.getElementById('ot-cron-row')..."` |
| ~513 | `onclick="document.getElementById(' + JSON.stringify('org-task-create') + ')..."` | `onclick="document.getElementById('org-task-create')..."` |
| ~542-544 | `onclick="triggerOrgTask(' + JSON.stringify(t.id) + ')"` 等 3 处 | `onclick="triggerOrgTask('" + escJsAttr(String(t.id)) + "')"` 等 |
| ~620 | `onclick="submitTaskResponse(' + JSON.stringify(a.id) + ')"` | `onclick="submitTaskResponse('" + escJsAttr(String(a.id)) + "')"` |

**新增函数**:
```javascript
function escJsAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

---

### F-02: 修复 `escapeHtml()` 在 onclick JS 字符串中的错误使用

**文件**: `apps/web-portal/static/app.js`

**问题根因**:
`escapeHtml()` 转义 `&`、`<`、`>`、`"` 但不转义单引号 `'`。在 `onclick="func('VALUE')"` 中，若 VALUE 含单引号，JS 字符串被截断，Chrome 报 `SyntaxError`。

**修复方案**:
将 onclick 属性中的 `escapeHtml()` 替换为 `escJsAttr()`，后者正确转义单引号。

**修改位置** (共 6 处):

| 行号(原) | 原代码 | 修改后 |
|-----------|--------|--------|
| ~234 | `onclick="viewWorkflow(\'... + escapeHtml(w.ref \|\| w.id) + ...)"` | `escJsAttr(w.ref \|\| w.id)` |
| ~279 | `onclick="handleApproval(\'... + escapeHtml(w.ref) + ...)"` (2处) | `escJsAttr(w.ref)` |
| ~701 | `onclick="rebindIdentity(\'... + escapeHtml(i.id) + ...)"` | `escJsAttr(i.id)` |
| ~774-777 | `onclick="reviewAction(\'... + escapeHtml(String(item.fact_id)) + ...)"` (4处) | `escJsAttr(String(item.fact_id))` |

---

### F-03: 添加缺失的 `.btn-warning` CSS 类

**文件**: `apps/web-portal/static/index.html`

**问题根因**:
`app.js` 中任务分发页的「暂停」按钮和知识审核页的「退回」按钮使用了 `btn-warning` 类，但 `index.html` 的 `<style>` 中未定义该类，导致按钮无背景色、无样式。

**修复方案**:
在 CSS 中添加 `.btn-warning{background:var(--warning);color:#fff}`。

**修改位置**: `index.html` 第 35 行附近，在 `.btn-danger` 后新增一行。

---

### F-04: 修复 Toast 通知堆叠问题

**文件**: `apps/web-portal/static/index.html`, `apps/web-portal/static/app.js`

**问题根因**:
原 `.toast` 使用 `position:fixed;top:20px;right:20px`，多条 Toast 定位完全重叠，用户只能看到最后一条。

**修复方案**:
1. 新增 `.toast-container` CSS 类，使用 `flex-direction:column;gap:8px` 实现垂直堆叠
2. 修改 `showToast()` 函数，将 Toast 添加到容器而非直接添加到 body

**CSS 变更** (`index.html`):
```css
/* 原 */
.toast{position:fixed;top:20px;right:20px;padding:12px 20px;...}

/* 新 */
.toast-container{position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{padding:12px 20px;...;pointer-events:auto}
```

**JS 变更** (`app.js` `showToast` 函数):
- 创建或复用 `#toast-container` 容器
- Toast 添加到容器内
- 移除时若容器为空则清理容器

---

### F-05: 添加会话过期自动跳转

**文件**: `apps/web-portal/static/app.js`

**问题根因**:
当用户会话过期后，API 返回 401，但前端仅在 `checkAuth()` 中处理了 401（页面加载时）。用户在使用过程中，其他 API 调用收到 401 后仅显示错误 Toast，不会跳转到登录页，导致用户持续看到错误信息。

**修复方案**:
在 `api()` 函数中增加全局 401 处理：当非登录接口返回 401 时，自动清除会话并跳转到登录页。

**修改位置**: `app.js` `api()` 函数

```javascript
if (res.status === 401 && path !== '/api/auth/login') {
  localStorage.removeItem('ah_session_id');
  currentSession = null;
  renderLogin();
  return { ok: false, status: 401, data: { error: 'session_expired', message: '会话已过期，请重新登录' } };
}
```

---

### F-06: 增强非 JSON 响应处理

**文件**: `apps/web-portal/static/app.js`

**问题根因**:
`api()` 函数直接调用 `res.json()`，若服务端或反向代理返回非 JSON 响应（如 Nginx 502 HTML 页面），`res.json()` 抛出异常，虽然被 catch 捕获但错误信息不明确。

**修复方案**:
先检查 `Content-Type` 头，仅对 `application/json` 响应调用 `res.json()`，否则读取文本并尝试 JSON 解析。

**修改位置**: `app.js` `api()` 函数

```javascript
const contentType = res.headers.get('content-type') || '';
var data;
if (contentType.includes('application/json')) {
  data = await res.json();
} else {
  var text = await res.text();
  try { data = JSON.parse(text); } catch { data = { error: 'non_json_response', message: text.substring(0, 200) }; }
}
```

---

### F-07: 添加静态文件缓存头

**文件**: `apps/web-portal/src/index.ts`

**问题根因**:
`sendFile()` 函数未设置 `Cache-Control` 头，Chrome 每次访问均发起完整请求，增加不必要的网络开销。

**修复方案**:
- `index.html`: 设置 `Cache-Control: no-cache`（HTML 可能引用更新的 JS 文件，需每次验证）
- `app.js`: 设置 `Cache-Control: public, max-age=3600`（静态资源缓存 1 小时）

**修改位置**: `index.ts` `sendFile()` 函数

```typescript
const isHtml = contentType.includes('text/html');
const cacheControl = isHtml ? 'no-cache' : 'public, max-age=3600';
res.writeHead(200, {
  'Content-Type': contentType,
  'Content-Length': content.length,
  'Cache-Control': cacheControl,
});
```

---

### F-08: 添加 Referrer-Policy 安全头

**文件**: `apps/web-portal/src/index.ts`

**问题根因**:
静态文件响应缺少 `Referrer-Policy` 头，浏览器默认策略可能在跨域请求中泄露完整 URL（含敏感路径信息）。

**修复方案**:
添加 `Referrer-Policy: strict-origin-when-cross-origin` 头。

**修改位置**: `index.ts` `sendFile()` 函数

```typescript
res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
```

---

## 三、后端依赖影响评估

| 修改项 | 是否影响后端 API 契约 | 是否需要后端适配 | 说明 |
|--------|----------------------|-----------------|------|
| F-01 escJsAttr 替换 JSON.stringify | 否 | 否 | 纯前端 HTML 生成逻辑变更 |
| F-02 escJsAttr 替换 escapeHtml | 否 | 否 | 纯前端 HTML 属性编码变更 |
| F-03 添加 btn-warning CSS | 否 | 否 | 纯前端样式变更 |
| F-04 Toast 容器 | 否 | 否 | 纯前端 UI 变更 |
| F-05 会话过期跳转 | 否 | 否 | 后端已正确返回 401，前端增加客户端处理 |
| F-06 非 JSON 响应处理 | 否 | 否 | 前端容错增强，后端行为不变 |
| F-07 Cache-Control 头 | 否 | 否 | 仅新增响应头，不影响 API 行为 |
| F-08 Referrer-Policy 头 | 否 | 否 | 仅新增安全响应头 |

**结论: 本次所有前端修改均不需要对后端进行额外适配调整。**

---

## 四、修改文件清单

| 文件路径 | 修改类型 | 修改说明 |
|----------|----------|----------|
| `apps/web-portal/static/index.html` | 编辑 | 添加 `.btn-warning` CSS 类；重构 Toast 为容器堆叠模式 |
| `apps/web-portal/static/app.js` | 编辑 | 新增 `escJsAttr()` 函数；修复 15 处 onclick 属性编码错误；重构 `showToast()` 为容器模式；增强 `api()` 函数（401 全局处理 + 非 JSON 容错） |
| `apps/web-portal/src/index.ts` | 编辑 | `sendFile()` 添加 `Cache-Control` 和 `Referrer-Policy` 响应头 |

---

## 五、Chrome 兼容性验证清单

| 验证项 | 预期结果 | 状态 |
|--------|----------|------|
| 登录页面正常渲染 | 显示登录表单，输入框可交互 | 待验证 |
| 登录后仪表盘加载 | 显示系统概览统计和服务状态 | 待验证 |
| Workflow 控制台 - 详情按钮 | 点击「详情」正确跳转，无 JS 错误 | 待验证 |
| 审批台 - 批准/驳回按钮 | 点击按钮正确触发审批操作 | 待验证 |
| 组织管理 - 编辑/删除按钮 | 点击按钮正确打开编辑表单或确认删除 | 待验证 |
| 组织管理 - 编辑保存/取消 | 保存和取消按钮功能正常 | 待验证 |
| 共享知识库 - 移除按钮 | 点击移除正确删除文档 | 待验证 |
| 任务分发 - 调度方式切换 | 切换到 Cron 时显示 Cron 输入框 | 待验证 |
| 任务分发 - 创建/取消按钮 | 创建和取消按钮功能正常 | 待验证 |
| 任务分发 - 立即分发/暂停/归档 | 三个操作按钮均可正常点击 | 待验证 |
| 我的任务 - 提交反馈 | 点击提交反馈正确提交内容 | 待验证 |
| 身份绑定 - 绑定按钮 | 点击绑定正确触发重新绑定 | 待验证 |
| 知识审核 - 批准/共享/退回/拒绝 | 四个操作按钮均可正常点击 | 待验证 |
| Toast 通知堆叠 | 多条通知垂直排列，不重叠 | 待验证 |
| 会话过期自动跳转 | 会话过期后自动跳转到登录页 | 待验证 |
| 暂停/退回按钮样式 | 按钮显示橙色背景 | 待验证 |
| 静态文件缓存 | app.js 响应包含 Cache-Control 头 | 待验证 |

---

## 六、Docker 环境更新说明

由于修改涉及:
1. **前端静态文件** (`index.html`, `app.js`) — Docker 镜像中通过 `COPY` 指令打包
2. **后端 TypeScript 源码** (`index.ts`) — 需要重新编译并打包到 Docker 镜像

需要重新构建 `web-portal` Docker 镜像:

```bash
docker compose build web-portal
docker compose --profile app up -d web-portal
```

---

## 七、第二轮修复：系统初始化15项问题 (2026-05-04)

> 修复日期: 2026-05-04
> 修复范围: 系统初始化过程中发现的15项功能/体验问题
> 修改文件: `apps/web-portal/src/index.ts`, `apps/web-portal/static/app.js`, `apps/web-portal/static/index.html`

### 修改总览

| 编号 | 问题 | 修复内容 | 影响文件 |
|------|------|----------|----------|
| I-01 | 登录流程优化 | 默认密码提示、首次登录强制改密、密码强度验证（6分制） | index.ts, app.js |
| I-02 | Workflow控制台 | 区分空状态与加载异常，提供重试和创建引导 | app.js |
| I-03 | 任务接入 | 目标执行者选择、LUI对话模式、功能说明文档 | app.js |
| I-04 | 审批台 | 修复列表加载、区分空状态/异常、操作指引 | app.js |
| I-05 | 渠道配置 | 精简飞书/企微配置项，仅保留必要ID和Secret，自动长连接 | app.js |
| I-06 | 大模型配置 | 多模型管理API+UI、优先级排序、fallback机制 | index.ts, app.js |
| I-07 | Rerank配置 | 精简配置项，仅保留必填参数，添加说明 | app.js |
| I-08 | 用户组织关联 | 用户-组织关联API、管理界面分配组织 | index.ts, app.js |
| I-09 | 技能管理 | 镜像站搜索/安装API、来源标识、归档功能 | index.ts, app.js |
| I-10 | 知识导入 | 手动输入+文件上传、权限控制（私有/公开） | app.js |
| I-11 | 身份绑定 | 功能说明、绑定流程优化、状态标识 | app.js |
| I-12 | 资源监控 | Docker容器级指标采集（CPU/内存/网络/磁盘）、15秒自动刷新 | index.ts, app.js |
| I-13 | 用户身份展示 | 侧边栏用户头像+下拉菜单+个人设置入口 | app.js |
| I-14 | UI/UX一致性 | 行高、字号、输入框焦点、占位符、Toast限宽 | index.html |
| I-15 | 服务状态监控 | 15秒实时轮询、状态变化Toast提醒 | app.js |

### 新增后端API端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/change-password` | 修改密码（含强度验证） |
| GET | `/api/auth/session` | 获取当前会话信息 |
| GET | `/api/admin/llm-models` | 获取LLM模型列表 |
| POST | `/api/admin/llm-models` | 添加LLM模型 |
| POST | `/api/admin/llm-models/reorder` | 调整模型优先级 |
| DELETE | `/api/admin/llm-models/:id` | 删除备用模型 |
| GET | `/api/admin/container-stats` | Docker容器资源指标 |
| GET | `/api/admin/skills/mirror-search` | 搜索镜像站技能 |
| POST | `/api/admin/skills/mirror-install` | 安装镜像站技能 |
| GET | `/api/admin/service-status-history` | 服务状态变更历史 |
| GET | `/api/admin/users-orgs` | 用户-组织关联查询 |
| PUT | `/api/admin/users-orgs` | 更新用户-组织关联 |

### 新增前端功能

| 功能 | 说明 |
|------|------|
| 系统指南页面 | 4个Tab：架构总览、核心能力、场景故事、快速上手 |
| LLM多模型管理 | 添加/删除/排序模型，主模型+备用模型fallback |
| Docker容器监控 | 实时CPU/内存/网络/磁盘指标，15秒自动刷新 |
| 镜像站技能搜索 | 搜索+一键安装，来源标识（镜像站/手动创建） |
| 密码强度指示器 | 6分制评分，实时颜色反馈 |
| 服务状态变化提醒 | 状态变更时自动弹出Toast通知 |

### Docker更新命令

```bash
cd agent-harness
docker compose --profile app build web-portal
docker compose --profile app up -d web-portal
```

---

## 第三轮：梦境模式 (2026-05-04)

### D-01（新增）：梦境模式——记忆分层管理系统
- **影响范围**: hermes-adapter, web-portal, 数据库迁移 021
- **变更说明**:
  - 新增 hermes-adapter 6 个内部 API 端点：
    - `POST /internal/memory/analyze` - 个人梦境分析（收集→压缩→抽取）
    - `POST /internal/memory/analyze/org` - 组织级记忆整合
    - `GET /internal/memory/summary` - 组织级记忆汇总查询
    - `GET /internal/memory/analysis-runs` - 分析运行历史
    - `GET /internal/memory/compression-logs` - 压缩日志查询
    - `GET /internal/memory/access-log` - 记忆访问审计日志
  - 新增 4 张数据库表：`memory_analysis_run`, `org_memory_summary`, `memory_access_log`, `memory_compression_log`
  - Web Portal 新增「梦境模式」菜单组 + 3 个 UI 页面

### D-02（新增）：技能发现与管理生态
- **影响范围**: skill-library, web-portal, 数据库迁移 021
- **变更说明**:
  - 新增 skill-library 8 个 API 端点：
    - `POST /internal/skills/audit` - 单技能四维审核（功能/安全/性能/适配）
    - `POST /internal/skills/audit/batch` - 每日批量自动化审核
    - `POST /internal/skills/:id/promote-to-org` - 提升为组织级技能
    - `GET /internal/skills/org-registry` - 组织技能注册表查询
    - `GET /internal/skills/audit-records` - 审核记录查询
    - `GET /internal/skills/usage-stats` - 技能使用统计
    - `GET /internal/skills/scene-assessments` - 场景价值评估
  - 新增 5 张数据库表：`scene_value_assessment`, `skill_audit_record`, `skill_usage_stats`, `org_skill_registry`, `dream_mode_config`
  - 修复路由冲突：具名路径与 UUID 路由竞争

### D-03（新增）：梦境模式自动调度器
- **影响范围**: web-portal src/index.ts
- **变更说明**:
  - 每 2 分钟检查一次是否需要触发梦境分析
  - 支持配置：梦境分析时间 / 技能审核时间 / 压缩阈值 / 冷却窗口
  - 管理员可手动触发 / 通过 Web Portal 配置

### D-04（新增）：Web Portal 前端 UI
- **影响范围**: static/app.js
- **变更说明**:
  - 新增 `renderDreamMemory()` - 记忆分析页面（运行记录 + 汇总 + 压缩日志 + 访问日志）
  - 新增 `renderDreamSkills()` - 技能发现页面（组织库 + 审核记录 + 场景评估）
  - 新增 `renderDreamConfig()` - 梦境配置页面（参数配置 + 手动触发）
  - 导航新增「梦境模式」菜单组（3 个子菜单，仅管理员可见）

### 测试覆盖
- 14 项集成测试（`npm run test:dream-mode`），全部通过
- 覆盖记忆分析 / 组织整合 / 技能审核 / 注册表查询 / 错误路径
