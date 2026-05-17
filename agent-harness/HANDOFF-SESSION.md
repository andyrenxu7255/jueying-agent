# JueYing (绝影) — 交接文档

> **更新时间**: 2026-05-17（第十三轮：冒烟测试收口 — 四角色体验闭环 + 高危依赖修复 + 渠道/梦境烟测）
> **当前状态**: ✅ lint/type/test/M0/context/渠道/梦境/评测冒烟已完成，npm high/critical 审计项清零，文档图谱同步到 DEV-17

---

## 零、快速接续（新对话可直接复制此句）

> 请阅读 `D:\teamclaw\agent-harness\HANDOFF-SESSION.md` 了解当前状态。系统当前状态：main 分支面向 `jueying-agent`，本轮已完成冒烟测试、四角色体验故事线、依赖 high/critical 审计收口与文档图谱同步。ARCHITECTURE.md 已更新至第十七轮，context-graph.json v2.1。接手后先运行 `npm run lint && npm run type-check && npm test` 检查基础状态。

---

## 一、当前系统状态

### 运行状态

| 检查项 | 状态 |
|--------|------|
| Docker 容器 | ✅ 18/18 全部 running |
| 数据库迁移 | ✅ 完成 |
| 飞书长连接 | ✅ WebSocket `ws client ready` |
| 企微 Webhook | ✅ 签名验证 + AES 加密解密 |
| LLM 模型 | ✅ MiniMax-M2.7 正常 |
| 身份自动绑定 | ✅ 新用户自动创建 + 绑定 |
| 记忆/上下文 | ✅ Hermes 正常 |
| Chat 对话 | ✅ 飞书+企微双渠道 |
| Task 工作流 | ✅ Plan → Dispatch → Execute → Complete → 结果推送 |
| Knowledge Submit | ✅ 用户提交 → unconfirmed 池 → 审核生命周期 |
| Quick Lookup | ✅ 快速检索 → 短轮询 → chat降级 |
| 企微任务通知 | ✅ 异步轮询结果推送 |
| Supervisor 心跳 | ✅ heartbeat.recorded 正常 |
| Web Portal | ✅ 安全加固 + 知识审核桌面 |
| Skill Library | ✅ 技能注册/候选/版本管理 |
| Resource Scheduler | ✅ 配额检查/巡检 |
| Mobile App | ✅ 推送通知 |
| ClawHub 技能 | ✅ 14 项免费办公技能已预制（镜像站 mirror-cn.clawhub.com） |
| 梦境模式 | ✅ 记忆分层管理 + 技能发现生态已实现 |
| 梦境调度器 | ✅ 每 2 分钟检查，按配置触发分析/审核 |
| 梦境 UI | ✅ 3 个管理页面（记忆分析/技能发现/配置） |

### 已有用户

| 用户 | 角色 |
|------|------|
| `u_admin` | 管理员 |
| `u_feishu_cf6147dc` | 飞书身份（已绑定） |
| `u_engineer_zhang` | 测试工程师 |
| `u_pm_wang` | 测试产品经理 |
| `u_designer_li` | 测试设计师 |

### ClawHub 预制技能（共 14 项，全部免费无需 API Key）

**镜像站**: https://mirror-cn.clawhub.com/

| 技能 | 类型 | 用途 |
|------|------|------|
| Document Pro | document | PDF/Word/PPT/Excel/CSV/Markdown 全格式读取解析 |
| Document Generator | document | AI 驱动的 Word/PPT/Excel 报告自动生成 |
| PDF Converter | document | PDF ↔ Word/Excel 格式互转、合并拆分压缩 |
| Multi Search 聚合搜索 | search | DuckDuckGo + Bing + 百度 + 搜狗 多渠道聚合 |
| Deep Search 深度搜索 | search | 多轮递进式研究搜索，自动拆解子问题 |
| 实时资讯 | search | RSS + 微博/知乎/36Kr 热点聚合推送 |
| Summarize 内容总结 | content | 网页/PDF/图片智能内容提炼 |
| WeCom File Bridge | communication | 企业微信文件收发、文档自动解析导入知识库 |
| Weather 免费天气 | utility | 公开气象数据实时查询，七天预报 |
| Agent Browser 网页自动化 | automation | 无头浏览器自动化、数据采集 |
| Ontology 知识图谱 | knowledge | 自动提取实体/关系，构建 AGE 图数据库图谱 |
| Memory Compress 记忆归档 | knowledge | 对话对象化存储，自动构建对象关系图谱 |
| Skill Vetter 安全审查 | security | 技能安装前权限与风险审查 |
| self-improving-agent | learning | 经验记录留存，自我持续优化 |

---

## 二、九轮修复总览

### 第一轮（构建链路 + 逻辑修复）— 6项

| # | 问题 | 文件 |
|---|------|------|
| 1 | `@ts-expect-error` 导致 Docker 构建失败 | `fact-retrieval`, `web-portal` |
| 2 | workflow `.runtime` 目录 EACCES | `Dockerfile` + `docker-compose.yml` |
| 3 | executor-gateway 缺失 `WORKFLOW_URL` | `docker-compose.yml` |
| 4 | planner `LITELLM_URL` `||` vs `?:` 运算符优先级 bug | `planner/planner.ts` |
| 5 | LLM 返回 JSON 被 markdown 代码块包裹 | `planner/planner.ts` |
| 6 | 集成测试硬编码 Approval stage | `integration-test.ts` |

### 第二轮（权限 + 服务通信）— 8项

| # | 问题 | 文件 |
|---|------|------|
| 1 | markdown-archiver 默认路径无权限 | `libs/shared` |
| 2 | executor worktrees 命名卷未 chown | `Dockerfile` |
| 3 | gateway 缺失 `FACT_RETRIEVAL_URL` | `docker-compose.yml` |
| 4 | workflow-service 缺失 `EXECUTOR_URL` | `docker-compose.yml` |
| 5 | fact-retrieval artifacts 无权限 | `Dockerfile` |
| 6 | web-portal `.env` 文件写入无权限 | `Dockerfile` |
| 7 | 🔥 supervisor 心跳超时（executor 无完成回调） | `workflow/index.ts` + `executor/index.ts` |
| 8 | 22 处 `localhost:` 硬编码清理 | 10 个文件 |

### 第三轮（飞书体验 + 数据质量）— 6项

| # | 问题 | 根因 | 文件 |
|---|------|------|------|
| 1 | 飞书无"响应中"图标 | handleFeishuEvent 同步处理超时 | `gateway-adapter/index.ts` |
| 2 | 回复末尾长串字符 | session_ref 泄露到用户消息 | `gateway-adapter/index.ts` |
| 3 | 身份无法绑定 | 新用户只创建 pending 无自动绑定 | `identity-resolver.ts` |
| 4 | 多轮对话无上下文 | LLM 调用未使用 Hermes 记忆 | `gateway-adapter/index.ts` |
| 5 | 执行器收到 `[object Object]` | plan.goal 对象被 String() 错误转换 | `executor-gateway/index.ts` |
| 6 | Workflow 完成后无最终回复 | gateway 只发受理不跟踪完成 | `gateway-adapter/index.ts` |

### 第四轮（模块三视角审查 + 边界修复）— 7项

| # | 问题 | 根因 | 文件 |
|---|------|------|------|
| 1 | 🔥 Hermes 记忆压缩 404 | LITELLM URL 缺 `/v1/` 前缀 | `hermes-adapter/index.ts` |
| 2 | 🔥 WeCom 回复泄露 session_ref | 第三轮只修了飞书路径 | `gateway-adapter/index.ts` |
| 3 | 🔥 所有渠道用户前缀为 `u_feishu_` | createUserForChannel 硬编码 | `identity-resolver.ts` |
| 4 | 🔥 hermes FACT_RETRIEVAL_URL 端口不匹配 | 默认端口错误 | `hermes-adapter/index.ts` |
| 5 | 🔥 executor-gateway 无效 policy hash | `sha256:auto` 不是合法 sha256 | `executor-gateway/index.ts` |
| 6 | 工作流超时无用户通知 | 180s 后静默退出 | `gateway-adapter/index.ts` |
| 7 | 匿名/未绑定用户记忆失效 | 所有未绑定用户共享同一记忆 | `gateway-adapter/index.ts` |

**总计：27 个问题全部修复** ✅

### 第五轮（全链路审计 + 镜像站预制 + 安全加固）— 8 项

| # | 严重 | 问题 | 根因 | 文件 |
|---|------|------|------|------|
| 1 | 🔥 | Web Portal `channel_identity` 查询列名错误 | `external_user_id`→`external_identity`，`binding_state`→`binding_status`，`owner_user_id`→`user_id` | `web-portal/index.ts` |
| 2 | 🔥 | Web Portal `audit_event` 查询列名错误 | `actor_user_id`→`user_id`，`details`→`detail_json` | `web-portal/index.ts` |
| 3 | 🔥 | Web Portal skill/skill_version 插入缺必填列 | 缺 `owner_user_id`, `scope_type`, `content_hash`, `status` | `web-portal/index.ts` |
| 4 | 🔥 | Web Portal skill 查询引用不存在的列 | `sv.description` 不存在于 skill_version 表 | `web-portal/index.ts` |
| 5 | 🔥 | setup-users.cjs 使用错误 API 路径 | `/api/admin/users`→`/api/users`，密码硬编码 `dev-password`/`test123` | `scripts/setup-users.cjs` |
| 6 | 🔥 | WeCom 不支持 AES 加密消息解密 | 企微回调模式下需 XML+AES 解密 | `gateway-adapter/index.ts` |
| 7 | 🟡 | Web Portal CORS 过于宽松 | `Access-Control-Allow-Origin: *` → 白名单模式 | `web-portal/index.ts` |
| 8 | 🟡 | Web Portal 无密码策略 | 增加长度/复杂度/常见密码校验 | `web-portal/index.ts` |

**本轮新增：8 项修复** ✅

**总计：35 个问题全部修复** ✅

### 第六轮（全面代码审计 + P0/P1/P2 修复）— 19 项

本轮基于 19 条用户故事线 (AH-1~AH-19) 进行全系统代码审计，发现 19 个问题，按优先级逐一修复。

| 优先级 | # | 问题 | 修复位置 |
|--------|---|------|---------|
| **P0** | 1 | 缺少 `knowledge_submit` 意图识别 | `gateway-adapter/index.ts` — 关键词匹配 + LLM 4路分类 |
| **P0** | 2 | 缺少知识审核桌面/API | `fact-retrieval/index.ts` + `service.ts` + `web-portal/index.ts` |
| **P0** | 3 | 缺少定时知识提取调度 | `fact-retrieval/service.ts` — `extractKnowledgeFromMemory()` |
| **P0** | 4 | document_chunk 缺少全文检索索引 | `libs/shared/db/schema.ts` — tsvector GIN 索引 |
| **P1** | 5 | 缺少 `quick_lookup` 路由路径 | `gateway-adapter/index.ts` — 轻量workflow+短轮询+降级 |
| **P1** | 6 | 缺少 Workflow→Skill 候选提取 | `gateway-adapter/index.ts` — `extractWorkflowAsSkillCandidate()` |
| **P1** | 7 | Dream Summarization 缺少压缩检测 | `executor-gateway/generic-executor.ts` — needs_compression |
| **P1** | 8 | AGE 图标签集偏小 | `fact-retrieval/service.ts` — 顶点8→12, 边8→16 |
| **P2** | 9 | 系统人设固定单一 | `db/schema.ts` 新增 user_profile 表, gateway 增强 system prompt |
| **P2** | 10 | Workflow 完成无推送通知 | `gateway-adapter/index.ts` — `sendMobilePushNotification()` |

**本轮新增：10 项修复** ✅

**总计：45 个问题全部修复** ✅

### 第七轮（梦境模式实现 — AH-20）— 10 项新增功能

本轮实现故事线 AH-20「梦境模式：记忆分层管理 + 技能发现生态」，新增 9 张数据库表、14 个 API 端点、3 个 Web Portal 页面和自动调度器。

| # | 新增功能 | 实现位置 |
|---|----------|----------|
| 1 | 数据库迁移 021_dream_mode.sql（9 张新表） | `db/migrations/021_dream_mode.sql` |
| 2 | 个人梦境分析端点 `POST /internal/memory/analyze` | `services/hermes-adapter/src/index.ts` |
| 3 | 组织级记忆整合端点 `POST /internal/memory/analyze/org` | `services/hermes-adapter/src/index.ts` |
| 4 | 记忆汇总/运行历史/压缩日志/访问日志查询（4 个 GET 端点） | `services/hermes-adapter/src/index.ts` |
| 5 | 单技能四维审核端点 `POST /internal/skills/audit` | `services/skill-library/src/index.ts` |
| 6 | 批量技能审核端点 `POST /internal/skills/audit/batch` | `services/skill-library/src/index.ts` |
| 7 | 技能提升/注册表/审核记录/使用统计/场景评估（5 个端点） | `services/skill-library/src/index.ts` |
| 8 | 梦境模式 API 代理（14 个端点） | `apps/web-portal/src/index.ts` |
| 9 | 梦境模式自动调度器（每 2 分钟检查） | `apps/web-portal/src/index.ts` |
| 10 | 梦境模式 UI 页面（3 个：记忆分析/技能发现/配置） | `apps/web-portal/static/app.js` |

**本轮新增：10 项功能** ✅

**总计：45 个问题修复 + 10 项新功能** ✅

### 第八轮（全面系统审计修复）— 2026-05-06，9 项

本轮基于 SYSTEM-AUDIT-2026-05-06.md 对全工作区进行7路并行深度审计，覆盖40+ TS源文件、8个MD文档、3个JSON图谱、22个SQL迁移、7个YAML配置、1个前端JS，发现104个问题（含前轮9项遗留），重点修复9项。

| 优先级 | # | 问题 | 修复位置 |
|--------|---|------|---------|
| **P0** | 1 | `.env` 含5组明文API密钥 + 3组默认密码 | `.env` — 全部替换为 `<CHANGE_ME>` |
| **P0** | 2 | `safeCompareSignature` padding可被时序分析利用 | `gateway-adapter/index.ts` — 移除padding，直接 `timingSafeEqual` |
| **P0** | 3 | artifact-storage 路径遍历风险 | `fact-retrieval/artifact-storage.ts` — `validateSecurePath()` + bucket正则校验 |
| **P1** | 4 | gateway-adapter 40处逗号后缺空格 | `gateway-adapter/index.ts` — `fireAndForget(...), 'tag'` |
| **P1** | 5 | identity-resolver 无输入校验 + catch吞错误 | `identity-resolver.ts` — 类型/长度校验 + console.error |
| **P1** | 6 | approval-executor 无审批人上限 + 日志泄密 | `approval-executor.ts` — MAX_APPROVERS=20 + 隐私脱敏 |
| **P1** | 7 | app.js 全文 `var` + `\|\|` 旧式写法 | `app.js` — `var`→`const`/`let`, `\|\|`→`??` |
| **P2** | 8 | context-graph.json 缺少6个文档 + 3处映射不准 | `context-graph.json` v1.7 — 补全 DEV-14/15/16 + AH1-36，修正 authority_map |
| **P2** | 9 | 文档图谱版本未同步 | `context-routing.json` v1.3, `object-relationship-graph.md` v2.2, `ARCHITECTURE.md` 第十五轮 |

**本轮新增：9 项修复** ✅

**总计：54 个问题修复 + 10 项新功能** ✅

### 第九轮（冒烟测试 + 四角色体验闭环）— 2026-05-17，9 项

本轮按开发、运维、Admin、普通用户四类角色重新走查现有工程，先完成 smoke/test/audit，再把发现的问题收口到代码、脚本、依赖和文档中。

| 优先级 | # | 问题 | 修复位置 |
|--------|---|------|---------|
| **P0** | 1 | `validate:m0` 引用不存在的 Jest 配置 | `scripts/validate-m0.js` |
| **P0** | 2 | SQL 迁移脚本不读取 `.env`，默认密码与 Compose 不一致 | `scripts/apply-sql-migrations.js` |
| **P0** | 3 | LiteLLM 固定镜像标签不可拉取 | `docker-compose.yml` |
| **P1** | 4 | 渠道烟测签名密钥与 Compose 默认值不一致，且未兼容异步 ACK | `docker-compose.yml`、`scripts/channel-webhook-smoke.mjs` |
| **P1** | 5 | `smoke:eval` 使用 SigNoz 历史健康路径 | `scripts/smoke-eval.js` |
| **P1** | 6 | Quick Lookup 未携带 `org_id` | `apps/gateway-adapter/src/index.ts` |
| **P1** | 7 | 梦境分析测试用户缺少组织/用户记录，Admin 手动分析外键失败 | `services/hermes-adapter/src/index.ts` |
| **P1** | 8 | 组织记忆与技能接口缺少强制 `org_id` 和可读业务结果字段 | `services/hermes-adapter/src/index.ts`、`services/skill-library/src/index.ts` |
| **P1** | 9 | `pdf-parse` 与旧 OpenTelemetry 依赖存在 high 风险 | `package.json`、`package-lock.json`、`apps/gateway-adapter/src/index.ts` |

**本轮新增：9 项修复 + 1 条四角色体验故事线** ✅

---

## 三、关键设计机制

### 身份绑定流程
```
新用户发消息（飞书/企微）
  → gateway resolveIdentity()
  → 查 channel_identity 表
  → 无记录或有 pending 记录
  → 自动创建 user + 立即绑定为 bound
  → 用户前缀按渠道区分: u_feishu_/u_wecom_/u_web_
  → 后续消息直接复用
```

### 消息异步处理
```
收到消息事件 → 立即返回 200 OK → setImmediate 异步处理:
  ├─ resolveIdentity (DB查绑)
  ├─ classifyIntentWithLLM (LiteLLM 4路分类: chat/task/knowledge_submit/quick_lookup)
  ├─ [chat] recallContext → LLM生成回复 → rememberContext → 渠道推送
  ├─ [task] plan → dispatch → 渠道推送受理 → 后台轮询 → 渠道推送结果
  ├─ [knowledge_submit] submitKnowledge → fact-retrieval → 返回确认
  └─ [quick_lookup] quickLookup → 轻量workflow → 短轮询 → 渠道推送结果 (失败降级到chat)
```

### 知识审核全流程
```
用户发"记录一下 XXX" → classifyIntentWithLLM → knowledge_submit
  → submitKnowledge → POST fact-retrieval /internal/fact/submit
  → 写入 unconfirmed 池 (自动提取 subject/predicate)
  → 返回 "知识已提交，等待审核"
  
管理员 Web Portal「知识审核」页面
  → 查看 unconfirmed 列表 → 逐条审核
  ├─ 批准: status→active
  ├─ 共享: status→active + scope_type→shared
  ├─ 退回: status→unconfirmed + review_note
  └─ 拒绝: status→rejected + review_note
```

### 企微加密消息处理
```
收到企微 POST 请求
  → verifyWecomSignature(token, timestamp, nonce, raw_body)
  → 若 encrypt_type=aes: tryDecryptWecomMessage()
    ├─ Base64 解码 encrypt 字段
    ├─ AES-256-CBC 解密（key=WECOM_ENCODING_AES_KEY）
    ├─ 去除 16 字节随机前缀 + 4 字节消息长度
    └─ 解析 XML: FromUserName, Content, MsgType
  → 若明文 JSON: 直接 parseJson(rawBody)
  → normalizeMessage → resolveIdentity → processIncomingText
```

### 工作流自动完成
```
executor-gateway 执行全部阶段
  → POST /workflows/{ref}/complete
  → workflow 状态机: running → verifying → reporting → succeeded
  → 注销 supervisor
  → gateway 后台轮询检测到 succeeded → 双渠道推送结果
```

### 上下文记忆
```
每轮对话:
  gateway 调 hermes /internal/memory/recall → 获取压缩上下文
  LLM 请求带 context → 生成有上下文的回复
  存储 user + assistant 消息到 hermes /internal/memory
```

### Web Portal 安全机制
```
认证: Session Cookie (ah.sid) + Redis 持久化（24h TTL）
授权: requireAdmin() / requireSession() 中间件
密码: scrypt(N=16384) 哈希，≥8位 + 字母数字混用 + 常见密码黑名单
CORS: 白名单模式（默认 localhost:3003），支持凭证传递
审计: audit_event 表记录 login/create/edit 操作
```

---

## 四、服务架构与端口

| 服务 | 容器名 | 主机端口 | 容器内端口 | 职责 |
|------|--------|---------|-----------|------|
| Gateway Adapter | ah-gateway | 3000 | 3000 | 多渠道入口，身份绑定，意图路由 |
| Workflow Service | ah-workflow | 3001 | 3000 | 工作流规划/监督/状态机 |
| Executor Gateway | ah-executor | 3002 | 3000 | 多执行器调度 |
| Web Portal | ah-web-portal | 3003 | 3000 | Web 管理界面 |
| Fact Retrieval | ah-fact-retrieval | 3004 | 3000 | 向量/图检索 |
| Hermes Adapter | ah-hermes | 3005 | 3000 | 记忆/上下文管理 |
| Skill Library | ah-skill-library | 3007 | 3000 | 技能注册/候选/版本 |
| Resource Scheduler | ah-resource-scheduler | 3008 | 3000 | 配额/巡检 |
| Mobile App | ah-mobile-app | 3009 | 3000 | 推送通知 |
| Feishu Longconn | ah-feishu-longconn | — | — | 飞书 WS 长连接 |
| PostgreSQL+AGE | ah-postgres | 5432 | 5432 | 主数据库 |
| Redis | ah-redis | 6379 | 6379 | 会话缓存 |
| MinIO | ah-minio | 9000 | 9000 | 对象存储 |
| LiteLLM | ah-litellm | 4000 | 4000 | LLM 代理 |
| SigNoz × 3 | ah-signoz-* | 3301 | — | 可观测性 |

> 注：容器间通信使用 `http://<容器名>:3000`；主机访问使用 `http://localhost:<主机端口>`

---

## 五、启动与验证

```bash
# 位置: D:\teamclaw\agent-harness

# 1. 启动所有服务
docker compose --profile app up -d --build

# 2. 数据库迁移
npm run db:migrate

# 3. 初始化管理员账号（非交互式）
node scripts/init-admin.cjs <your-admin-password>

# 4. 创建测试用户
node scripts/setup-users.cjs <your-admin-password>

# 5. 预制 JueYing 办公技能
node scripts/seed-clawhub-skills.cjs

# 6. 全链路回归审计
node scripts/final-audit.cjs

# 7. 手动验证：飞书/企微给机器人发消息即可测试全链路
```

---

## 六、已知问题 (None-critical)

1. **飞书长连接需要真实凭据**: Webhook 冒烟已覆盖签名、去重和异步 ACK；生产态 Feishu Longconn 仍依赖正式 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 和发布后的事件订阅配置。

2. **supervisor.heartbeat.missed**: LLM 调用较长时可能偶发，supervisor 有 grace period 兜底，不影响本轮核心冒烟。

3. **微信个人版未接入**: 当前仅支持企业微信（WeCom）和飞书，个人微信/公众号/小程序尚未实现。

4. **user_profile 表已建但未完全动态注入 LLM prompt**: 表结构和基础 prompt 已就绪，后续可把用户画像摘要按组织策略注入对话。

5. **npm audit 仍有 moderate 开发依赖提示**: high/critical 已清零；剩余主要来自 `drizzle-kit` 的开发依赖链 `esbuild`，不进入生产运行时。若要清零 moderate，需要单独评估 Drizzle 工具链兼容性。

6. **gateway-adapter/index.ts 仍为巨型单文件**: 建议后续拆分为 routes、channel handlers、file handlers、workflow client 等模块。

7. **Cypher 查询仍使用受控字符串拼接**: `fact-retrieval/service.ts` 通过 `sanitizeCypherLiteral()` 防护，长期建议迁移到 AGE 支持的参数化模式（若可用）。

---

## 七、有用脚本

| 脚本 | 用途 |
|------|------|
| `scripts/final-audit.cjs` | 全链路回归审计（Chat + Task 双路径） |
| `scripts/init-admin.cjs` | 初始化管理员账号（支持在线/离线两种模式） |
| `scripts/setup-users.cjs` | 批量创建测试用户（自动生成强密码） |
| `scripts/seed-clawhub-skills.cjs` | 从 mirror-cn.clawhub.com 预制 14 项免费办公技能 |
| `scripts/e2e-full.cjs` | 较早的综合测试脚本 |
| `scripts/upgrade-bind-db.cjs` | 数据库身份绑定升级 |
| `scripts/upgrade-bind.sql` | 绑定升级 SQL |

---

## 八、改动文件清单（全部八轮）

### gateway-adapter（第六轮新增：5路意图分类 + 知识提交/快速查询/Skill提取/推送）
- `apps/gateway-adapter/src/index.ts` — 异步处理、去泄露、记忆集成、完成轮询、超时通知、匿名回退、企微AES加密解密、WeCom任务完成轮询推送、**5路意图分类(chat/task/knowledge_submit/quick_lookup/task_dispatch)**、**submitKnowledge()**、**quickLookup()**、**extractWorkflowAsSkillCandidate()**、**sendMobilePushNotification()**、**增强system prompt**
- `apps/gateway-adapter/src/services/identity-resolver.ts` — 自动绑定 + 多渠道路由前缀纠正
- `apps/gateway-adapter/Dockerfile` — 权限修复

### web-portal（第五轮新增：6 处 SQL 列名 + CORS + 密码策略）
- `apps/web-portal/src/index.ts` — 设置向导、管理 API、**channel_identity/audit_event/skill 6 处列名修复**、**CORS 白名单模式**、**密码策略校验**、**知识审核桌面(renderKnowledgeReview + reviewAction)**
- `apps/web-portal/Dockerfile` — 权限修复

### workflow-service
- `services/workflow/src/index.ts` — API 端点、**restoreMachine 暂停恢复增强**
- `services/workflow/src/planner/planner.ts` — LLM 规划修复
- `services/workflow/src/supervisor/manager.ts` — 心跳重试机制
- `services/workflow/Dockerfile` — 权限修复

### executor-gateway
- `services/executor-gateway/src/index.ts` — user_goal 提取 + 完成回调 + policy hash 修复
- 5 个 executor 文件 — localhost 清理
- `services/executor-gateway/Dockerfile` — 权限修复

### hermes-adapter
- `services/hermes-adapter/src/index.ts` — LiteLLM URL `/v1/` + FACT_RETRIEVAL_URL 端口修正

### fact-retrieval（第六轮新增：知识审核 + 提取 + AGE图扩展）
- `services/fact-retrieval/src/index.ts` — **新增 4 端点: /internal/fact/submit, /internal/fact/review (GET/POST), /internal/knowledge/extract**
- `services/fact-retrieval/src/service.ts` — **submitUserFact(), listFactsForReview(), reviewFact(), extractKnowledgeFromMemory(), AGE标签扩展(顶点8→12, 边8→16)**

### skill-library（第六轮新增）
- `services/skill-library/src/index.ts` — 技能注册/列表/详情/候选生成

### resource-scheduler（第六轮新增）
- `services/resource-scheduler/src/index.ts` — 配额检查/资源回收/巡检调度

### mobile-app（第六轮新增）
- `apps/mobile-app/src/index.ts` — FCM/APNs推送/设备注册/通知模板

### 脚本文件（第五轮新增/更新）
- `scripts/init-admin.cjs` — **支持 CLI 密码参数 + 离线 DB 模式**
- `scripts/setup-users.cjs` — **API 路径纠正 + 自动生成强密码**
- `scripts/seed-clawhub-skills.cjs` — **新增：JueYing 14 项免费办公技能种子脚本（mirror-cn.clawhub.com）**

### 配置文件（第六轮更新）
- `docker-compose.yml` — 环境变量补全、**新增 skill-library/resource-scheduler/mobile-app 3 服务（3007/3008/3009）**
- `.env.example` — 新增 WeCom 完整环境变量、**新增 SKILL_LIBRARY_URL/RESOURCE_SCHEDULER_URL/MOBILE_APP_URL**
- `ARCHITECTURE.md` — 端口文档纠正、**第四轮修复文档、5路意图分类/知识审核/AGE扩展等架构更新**
- `PRODUCT.md` — **知识管理功能、快速查询、5路意图分类**
- `OPS.md` — **18容器、新服务健康检查/资源限制**
- `README.md` — **新服务端口速查、目录树更新**
- `libs/shared/src/db/schema.ts` — **user_profiles 表（三层人设体系）、document_chunk GIN 索引**

### 其他
- 其余 10+ 个文件的 localhost 清理、Dockerfile 权限修复

### 第八轮（2026-05-06：安全凭据清理 + 代码风格统一 + 文档图谱同步）
- `.env` — **移除全部5组明文API密钥 + 3组默认密码，替换为 `<CHANGE_ME>`**
- `apps/gateway-adapter/src/index.ts` — **`safeCompareSignature` 移除padding时序泄露 + 40处 `fireAndForget` 空格 + `sharedDbPool` 类型改为 `Pool` + `getFeishuApiBase` 未知domain降级**
- `apps/gateway-adapter/src/services/identity-resolver.ts` — **`resolve()` 添加类型/长度校验 + catch块错误日志**
- `services/fact-retrieval/src/artifact-storage.ts` — **新增 `validateSecurePath()` 路径遍历防护 + MinIO bucket名字正则校验**
- `services/executor-gateway/src/executor/approval-executor.ts` — **`MAX_APPROVERS=20` 审批人上限 + 日志隐私脱敏(approver_count)**
- `apps/web-portal/static/app.js` — **全文 `var`→`const`/`let` + `\|\|`→`??`**
- `libs/shared/src/metrics/metrics.ts` — **`evaluateAlerts` 扩展支持 histogram 平均值对比**
- `development/context-graph.json` — **v1.6→v1.7 补全6个文档 + 修正3处authority_map**
- `development/context-routing.json` — **v1.2→v1.3 添加 `types/**` 路径**
- `development/app-graph/object-relationship-graph.md` — **v2.1→v2.2 补全L1/L2层**
- `ARCHITECTURE.md` — **第十四轮→第十五轮 + 新增第八轮修复内容章节**
- `HANDOFF-SESSION.md` — **第十一轮→第十二轮 + 第八轮修复清单 + 已知问题更新**
