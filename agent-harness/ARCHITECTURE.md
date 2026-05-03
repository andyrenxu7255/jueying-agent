# agent-harness 系统架构文档

> 版本: 2026-05-03 (第七轮修复后 — 45 个问题全部修复 + 发布前安全检查)
> 当前状态: **全链路验证通过，可投产使用**

---

## 一、系统概述

agent-harness（品牌名 TeamClaw）是一个 AI Agent 编排与执行平台。用户通过飞书/企微等 IM 渠道与系统交互，系统使用 LLM 将用户意图规划为多阶段工作流，自动调度执行器完成各阶段任务，最终汇报结果。系统支持多租户、用户隔离、策略控制、记忆管理。

核心能力:
- **多渠道接入**: 飞书长连接 WebSocket、企微 Webhook、Web Portal
- **LLM 任务规划**: 根据用户目标自动拆解为 knowledge / development 类型阶段链
- **工作流引擎**: 基于 XState 状态机的完整生命周期管理
- **多种执行器**: generic-executor、code-executor、retrieval-aware-executor、verification-executor、repair-executor
- **记忆系统**: 基于 Hermes 的会话记忆，支持压缩上下文召回
- **策略控制**: 基于 user_goal + policy 的细粒度权限检查
- **事实检索**: 基于 pgvector 的向量检索 + 可选 Apache AGE 图检索
- **可观测性**: SigNoz（OpenTelemetry）全链路追踪

---

## 二、服务架构图

```
                  ┌─────────────┐
                  │   飞书 App   │
                  │  (长连接WS)  │
                  └──────┬──────┘
                         │ WebSocket
                  ┌──────▼──────┐
                  │ feishu-longconn │
                  │   (中转服务)    │
                  └──────┬──────┘
                         │ HTTP POST /channels/feishu/longconn/event
                  ┌──────▼──────┐
                  │  gateway-    │ ← 多渠道适配 & 身份映射 & 4路意图分类
                  │  adapter     │
                  └──┬───┬───┬──┘
                     │   │   │
        ┌────────────┘   │   └────────────┐
        │                │                │
   ┌────▼────┐    ┌──────▼──────┐   ┌─────▼──────┐
   │ LiteLLM │    │  workflow-  │   │  fact-      │
   │  Proxy  │ ←──│  service    │──→│  retrieval  │
   └─────────┘    └──┬─────┬────┘   └──────┬──────┘
                     │     │               │
             ┌───────┘     └────────┐      │ (知识审核/提取)
             │                      │      │
      ┌──────▼──────┐     ┌────────▼──────┐ │
      │  executor-  │     │    hermes-      │ │
      │  gateway    │     │    adapter      │ │
      └──┬────┬─────┘     │  (记忆/上下文)   │ │
         │    │            └─────────────────┘ │
    ┌────┘    └────┐                            │
    │              │                            │
┌───▼───┐    ┌────▼────┐  ┌──────────┐  ┌──────▼──────┐
│generic│    │ code     │  │ skill-    │  │  web-portal │
│exec.  │    │ exec.    │  │ library   │  │ (管理后台)   │
└───┬───┘    └────┬────┘  │ (3007)    │  └──────┬──────┘
    │             │       └──────────┘         │
    └──────┬──────┘              │             │ (审核/策略/监控)
           │                     │             │
    ┌──────▼──────┐  ┌───────────▼──┐  ┌──────▼──────┐
    │  PostgreSQL │  │  resource-   │  │  mobile-app │
    │  + pgvector │  │  scheduler   │  │  (推送服务)  │
    │  + AGE 图   │  │  (3008)      │  │  (3009)     │
    └─────────────┘  └──────────────┘  └─────────────┘
```

---

## 三、服务清单与职责

### 3.1 核心业务服务

| 服务 | 目录 | 容器名 | 主机端口 (容器内均为3000) | 职责 |
|------|------|--------|--------------------------|------|
| **gateway-adapter** | `apps/gateway-adapter/` | ah-gateway | 3000 | 多渠道消息入口，身份解析与绑定，意图分类，路由到 workflow 或直接 LLM 对话 |
| **workflow-service** | `services/workflow/` | ah-workflow | 3001 | 工作流规划(planner)、监督(supervisor)、状态机(engine)，CRUD |
| **executor-gateway** | `services/executor-gateway/` | ah-executor | 3002 | 接收 dispatch，按阶段调度多种执行器，完成后回调 workflow |
| **fact-retrieval** | `services/fact-retrieval/` | ah-fact-retrieval | 3004 | 事实存储与向量检索，可选图检索和重排序 |
| **hermes-adapter** | `services/hermes-adapter/` | ah-hermes | 3005 | 会话记忆管理：存储、召回、压缩上下文 |
| **feishu-longconn** | `services/feishu-longconn/` | ah-feishu-longconn | — | 飞书长连接 WebSocket 客户端，转发消息到 gateway |
| **web-portal** | `apps/web-portal/` | ah-web-portal | 3003 | Web 管理界面：登录/设置向导/工作流管理/策略管理/组织管理/知识审核 |
| **skill-library** | `services/skill-library/` | ah-skill-library | 3007 | 技能库管理：Skill 注册/版本管理/候选生成/标签检索/复用统计 |
| **resource-scheduler** | `services/resource-scheduler/` | ah-resource-scheduler | 3008 | 资源配额与巡检：组织限额检查/资源回收/健康巡检/定时调度 |
| **mobile-app** | `apps/mobile-app/` | ah-mobile-app | 3009 | 移动推送服务：FCM/APNs 推送/设备注册/通知模板/任务完成提醒 |

> 注：所有服务容器内部均监听 3000 端口，docker-compose 通过 ports 映射到不同主机端口。服务间通信使用 `http://<容器名>:3000`。

### 3.2 基础设施服务

| 服务 | 容器名 | 端口 | 职责 |
|------|--------|------|------|
| PostgreSQL + pgvector + AGE | ah-postgres | 5432 | 主数据库（用户、工作流、事实、策略、审计、向量检索、图检索） |
| Redis 7 | ah-redis | 6379 | 会话缓存 |
| MinIO | ah-minio | 9000/9001 | 对象存储（artifacts） |
| LiteLLM Proxy | ah-litellm | 4000 | LLM 统一代理（MiniMax-M2.7、Qwen3-Max、GLM-5） |
| SigNoz OTel Collector | ah-signoz-otel | 4317/4318 | OpenTelemetry 数据采集 |
| SigNoz Query | ah-signoz-query | 8080 | 查询服务 |
| SigNoz Frontend | ah-signoz-frontend | 3301 | Web UI |
| ClickHouse | ah-clickhouse | 8123 | 时序数据存储 |

---

## 四、核心数据流

### 4.1 Chat 消息流程（普通对话）

```
用户飞书发消息
  → feishu-longconn WebSocket 接收
  → HTTP POST → gateway-adapter /channels/feishu/longconn/event
  → 立即返回 200 OK（不阻塞）
  → 异步处理:
      1. resolveIdentity (查 channel_identity 表 → 自动绑定或复用)
      2. normalizeMessage (提取 session_hint、conversation_id)
      3. classifyIntentWithLLM → LiteLLM → 判断 chat/task
      4. [chat 路径]:
         a. recallContext → hermes /internal/memory/recall (取历史)
         b. generateChatReply → LiteLLM (带上下文)
         c. rememberContext → hermes /internal/memory (存消息)
      5. sendFeishuTextReply → 飞书 API → 用户收到回复
```

### 4.2 Task 消息流程（长任务）

```
用户飞书发任务消息
  → ... (同 Chat 步骤 1-3)
  → 4. [task 路径]:
       a. 检查 identity_binding_state === 'bound'
       b. 检查 org 限额
       c. POST → workflow-service /internal/workflows/plan
          → LLM 生成 stage_chain (4阶段: IntentClarification → EvidenceRetrieval → DecisionMaking → ResultReporting)
       d. POST → workflow-service /internal/workflows/{ref}/dispatch
          → workflow 转发到 executor-gateway /internal/executor/dispatch
       e. 返回 "任务已受理，workflow=xxx"
       f. sendFeishuTextReply → 用户收到受理回复
  → 5. 后台轮询 (pollAndReplyWorkflowResult):
       每 5 秒查 workflow 状态
       → workflow completed 后 sendFeishuTextReply → 用户收到结果
```

### 4.3 执行器阶段执行流程

```
executor-gateway /internal/executor/dispatch
  → 生成 runRef
  → 立即返回 dispatch_status: 'accepted'
  → 异步调用 autoExecuteWorkflowStages:
      1. 从 workflow-service 拉取完整计划
      2. 提取 user_goal (从 plan.goal.user_goal)
      3. 按序执行每个 stage:
         - 创建 ExecutorInput (user_goal + context + policy_hash)
         - executor.execute(input) → LLM 调用 → 返回结果
         - POST → workflow-service /internal/workflows/{ref}/stages/{id}/dispatch (上报结果)
         - workflow 记录 heartbeat
      4. 全部完成后:
         - POST → workflow /internal/workflows/{ref}/complete (触发状态机推进)
         - workflow: running → verifying → reporting → succeeded
         - 注销 supervisor
```

### 4.4 Knowledge Submit 流程（知识主动提交）

```
用户飞书发知识消息（含"记录一下"/"备忘"/"更新联系方式"等关键词）
  → ... (同 Chat 步骤 1-3)
  → 4. [knowledge_submit 路径]:
       a. classifyIntentWithLLM → intent_type: 'knowledge_submit'
       b. submitKnowledge → POST → fact-retrieval /internal/fact/submit
          → 写入 unconfirmed 池 (source='user_submitted', status='unconfirmed')
          → 自动提取 subject/predicate (基于中文语义模板)
       c. 返回 "知识已提交，等待审核"
       d. sendFeishuTextReply → 用户收到确认
  → 5. 管理员在 web-portal「知识审核」页面审核 → 批准/共享/退回/拒绝
```

### 4.5 Quick Lookup 流程（快速信息查询）

```
用户飞书发查询消息（"/find xxx"/"/查 xxx"/问人名/问联系方式等）
  → ... (同 Chat 步骤 1-3)
  → 4. [quick_lookup 路径]:
       a. classifyIntentWithLLM → intent_type: 'quick_lookup'
       b. quickLookup → POST → workflow-service /internal/workflows/plan
          → 创建轻量级单阶段工作流 (rapid-retrieval, 15s 超时)
       c. 短轮询 (3轮 × 5s) → 获取 workflow 结果
         → 成功: 返回检索到的信息文本
         → 超时/失败: 自动降级到 chat 路径
       d. sendFeishuTextReply → 用户收到结果
```

---

## 五、工作流状态机

```
draft → planned → running → verifying → reporting → succeeded → archived
                  ↓          ↓            ↓           ↓
              waiting_user  repairing    paused      failed
                  ↓          ↓
              blocked      paused
```

关键状态转换：
- `planned → running`: dispatch 成功
- `running → verifying → reporting → succeeded`: executor 完成后自动串行推进
- 任何终态 → `archived`: 需显式事件

---

## 六、数据库核心表

### 6.1 用户与身份

| 表名 | 用途 |
|------|------|
| `user` | 用户主表 (username, org_id, role, status) |
| `organization` | 组织/租户 |
| `channel_identity` | 渠道身份绑定 (channel_type, external_identity → user_id, binding_status) |
| `user_profile` | 用户画像与人设表 (persona_tier, soul, identity, tone_style, behavior_boundary, skill_tags, work_preference, evolved_history) |

### 6.2 工作流

| 表名 | 用途 |
|------|------|
| `workflow_instance` | 工作流实例 (status, plan, owner_user_id, org_id) |
| `workflow_stage` | 工作流阶段 (stage_type, status, assigned_executor) |
| `workflow_checkpoint` | 工作流断点/检查点 |

### 6.3 策略与审计

| 表名 | 用途 |
|------|------|
| `org_policy` | 组织级策略规则 (role, resource, action → decision) |
| `policy_snapshot` | 策略快照（用于工作流一致性检查） |
| `audit_event` | 审计日志 |

### 6.4 记忆与上下文

| 表名 | 用途 |
|------|------|
| `session` | 会话 (owner_user_id, session_id) |
| `memory_entry` | 记忆条目 (role, content, 带向量嵌入) |

### 6.5 事实检索

| 表名 | 用途 |
|------|------|
| `fact` | 事实条目 (content, embedding, source_url, entity_count) |
| `entity` | 实体 (name, type, metadata) |
| `fact_entity` | 事实-实体关联 |
| `document` | 文档 (title, scope_type) |
| `document_chunk` | 文档分块 (content, embedding, search_tsv — 含 GIN 索引支持全文检索) |
| `retrieval_trace` | 检索追踪 |

---

## 七、关键配置项 (.env)

```bash
# 数据库
DATABASE_URL=postgresql://agent_harness:dev_password@localhost:5432/agent_harness
DATABASE_NAME=agent_harness
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_USER=agent_harness
DATABASE_PASSWORD=dev_password

# Redis
REDIS_URL=redis://:dev_password_redis@redis:6379

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_BUCKET=agent-harness

# LiteLLM
LITELLM_MASTER_KEY=litellm-dev-key
LITELLM_MODEL=minimax-m2.7
LITELLM_PLAN_MODEL=minimax-m2.7
LITELLM_CODE_MODEL=minimax-m2.7
LITELLM_PLAN_TIMEOUT_MS=60000

# 飞书
FEISHU_APP_ID=cli_a95bad0b00b89cc9
FEISHU_APP_SECRET=v4KJ6qyCFqN3X4F7g20ZxdLzSwCyJR5H
FEISHU_VERIFICATION_TOKEN=
FEISHU_SIGNING_SECRET=
FEISHU_DOMAIN=feishu

# Web Portal
PORTAL_PORT=3003
JWT_SECRET=dev-secret-key

# 服务间通信 URL（容器内使用）
WORKFLOW_URL=http://workflow-service:3000
EXECUTOR_URL=http://executor-gateway:3000
FACT_RETRIEVAL_URL=http://fact-retrieval:3000
HERMES_URL=http://hermes-adapter:3000
GATEWAY_URL=http://gateway-adapter:3000
SKILL_LIBRARY_URL=http://skill-library:3000
RESOURCE_SCHEDULER_URL=http://resource-scheduler:3000
MOBILE_APP_URL=http://mobile-app:3000
```

---

## 八、启动命令

```bash
# 位置: D:\teamclaw\agent-harness

# 全量构建并启动 (app profile: 所有业务服务)
docker compose --profile app up -d --build

# 仅启动基础设施 (postgres, redis, minio, litellm)
docker compose up -d

# 数据库迁移
npm run db:migrate

# 查看服务状态
docker ps --format "table {{.Names}}\t{{.Status}}"

# 查看各服务日志
docker logs -f ah-gateway
docker logs -f ah-workflow
docker logs -f ah-executor
docker logs -f ah-skill-library
docker logs -f ah-resource-scheduler
docker logs -f ah-mobile-app
```

---

## 九、API 端点速查

### gateway-adapter (主机端口 3000)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/channels/feishu/longconn/event` | 接收飞书长连接事件 |
| POST | `/channels/wecom/callback` | 接收企微回调 |
| POST | `/channels/webot/callback` | 接收 Web 浏览器回调 |

### workflow-service (主机端口 3001)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/workflows/plan` | 生成工作流计划 |
| GET | `/internal/workflows` | 列出工作流 |
| GET | `/internal/workflows/:ref` | 获取工作流详情 |
| POST | `/internal/workflows/:ref/dispatch` | 分发到执行器 |
| POST | `/internal/workflows/:ref/stages/:sid/dispatch` | 阶段结果上报 |
| POST | `/internal/workflows/:ref/complete` | 完成回调 |

### executor-gateway (主机端口 3002)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/executor/dispatch` | 接收工作流分发 |
| GET | `/internal/executor/runs/:ref` | 查询执行运行状态 |
| GET | `/health` | 健康检查 |

### hermes-adapter (主机端口 3005)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/memory` | 存储记忆条目 |
| POST | `/internal/memory/recall` | 召回记忆（含压缩上下文） |
| POST | `/internal/memory/clear` | 清理会话记忆 |
| POST | `/internal/context/compress` | 压缩上下文 |

### fact-retrieval (主机端口 3004) — 新增端点
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/fact/submit` | 接收用户主动提交的知识片段（写入 unconfirmed 池） |
| GET | `/internal/fact/review` | 列出待审核/已审核知识条列（支持 status + org_id 过滤） |
| POST | `/internal/fact/review` | 管理员审核知识（approve/approve_shared/reject/return） |
| POST | `/internal/knowledge/extract` | 从对话记忆中提取结构化知识 |

### skill-library (主机端口 3007)
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/internal/skills` | 技能列表（支持标签/组织过滤） |
| POST | `/internal/skills` | 注册新技能 |
| GET | `/internal/skills/:ref` | 获取技能详情 |
| POST | `/internal/skills/candidates` | 从工作流结果生成 Skill 候选 |

### web-portal (主机端口 3003)
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/setup/status` | 设置向导状态 |
| POST | `/api/setup/initialize` | 初始化步骤 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/admin/policies` | 策略列表 |
| POST | `/api/admin/policies` | 创建策略 |
| GET | `/api/admin/organization-invitations` | 组织邀请列表 |
| GET | `/api/admin/organization-members` | 组织成员列表 |
| GET | `/api/knowledge/review` | 知识审核列表（代理到 fact-retrieval） |
| POST | `/api/knowledge/review` | 提交审核决定（代理到 fact-retrieval） |

---

## 十、第三轮修复内容（2026-05-01）

本轮针对飞书实际使用中发现的问题：

| # | 问题 | 根因 | 修复位置 |
|---|------|------|---------|
| 1 | 飞书无"响应中"图标 | handleFeishuEvent 同步处理所有逻辑后才返回 200，飞书超时 | `apps/gateway-adapter/src/index.ts` — 立即返回 200，异步处理 |
| 2 | 每次回复末尾有长串 `feishu:xxx:conv:xxx` | session_ref 被拼接到回复文本泄露给用户 | `apps/gateway-adapter/src/index.ts` — 移除拼接 |
| 3 | 用户身份无法绑定 | 新用户只创建 pending 绑定到占位用户，无自动绑定机制 | `apps/gateway-adapter/src/services/identity-resolver.ts` — 自动创建用户 + 立即绑定 |
| 4 | 多轮对话无上下文 | gateway 的 LLM 调用完全不使用 Hermes 记忆服务 | `apps/gateway-adapter/src/index.ts` — 集成 recallContext + rememberContext |
| 5 | 执行器收到 `[object Object]` | plan.goal 是对象，String() 转换为 `[object Object]` | `services/executor-gateway/src/index.ts` — 提取 plan.goal.user_goal |
| 6 | Workflow 完成后无最终回复 | gateway 只发受理回复，不跟踪完成状态 | `apps/gateway-adapter/src/index.ts` — 新增 pollAndReplyWorkflowResult |

## 十一、第四轮修复内容（2026-05-03）

本轮基于 19 条用户故事线 (AH-1~AH-19) 进行全面代码审计，发现 19 个问题，按 P0/P1/P2 优先级逐一修复：

### P0 修复（阻断性缺陷）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P0-1 | 缺少 `knowledge_submit` 意图识别 | 用户无法通过对话提交业务知识 | `apps/gateway-adapter/src/index.ts` — 新增 `isKnowledgeSubmitIntent()` + 关键词匹配 + LLM意图分类扩展 |
| P0-2 | 缺少知识审核桌面/API | 提交的知识无人审核，知识库无法增长 | `services/fact-retrieval/src/index.ts` — 新增 `/internal/fact/submit`, `/internal/fact/review` (GET/POST)；`services/fact-retrieval/src/service.ts` — 新增 `submitUserFact()`, `listFactsForReview()`, `reviewFact()`；`apps/web-portal/src/index.ts` — 新增「知识审核」导航页 + `renderKnowledgeReview()` |
| P0-3 | 缺少定时知识提取调度 | 零散对话记忆无法自动转化为结构化知识 | `services/fact-retrieval/src/service.ts` — 新增 `extractKnowledgeFromMemory()` |
| P0-4 | document_chunk 缺少全文检索索引 | 中文关键词检索性能差 | `libs/shared/src/db/schema.ts` — 添加 `search_tsv` tsvector 列 + GIN 索引 `idx_document_chunk_search_tsv` |

### P1 修复（功能缺口）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P1-1 | 缺少 `quick_lookup` 路由路径 | 用户无法快速查询已知信息（如人名/联系方式） | `apps/gateway-adapter/src/index.ts` — 新增 `isQuickLookupIntent()` + `quickLookup()` (轻量workflow+短轮询+chat降级) |
| P1-2 | 缺少 Workflow → Skill 候选提取 | 成功的工作流模式无法复用为 Skill | `apps/gateway-adapter/src/index.ts` — 新增 `extractWorkflowAsSkillCandidate()`，在 workflow 完成后自动触发 |
| P1-3 | Dream Summarization 缺少压缩触发检测 | 冗长会话占用过多上下文窗口 | `services/executor-gateway/src/executor/generic-executor.ts` — 增强 `executeDreamSummarization()`，添加 `needs_compression` 检测 + 三级压缩任务 |
| P1-4 | AGE 图标签集偏小 | 无法建模业务关系场景（客户/联系人/商机/项目） | `services/fact-retrieval/src/service.ts` — VERTEX_LABELS 8→12 (新增 Client, Contact, Opportunity, Project)，EDGE_LABELS 8→16 (新增 BELONGS_TO, EMPLOYES, INVOLVED_IN, INTERACTS_WITH, REPORTS_TO, PARTNERS_WITH, COMPETES_WITH, SUPPLIES_TO) |

### P2 修复（体验增强）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P2-1 | 系统人设固定单一 | 无法按组织/用户个性化调整语气行为 | `libs/shared/src/db/schema.ts` — 新增 `user_profile` 表（三层人设体系：系统基座→组织人设→用户画像）；`apps/gateway-adapter/src/index.ts` — 增强系统提示词（6条行为规则） |
| P2-2 | Workflow 完成无推送通知 | 移动端用户无法及时得知任务完成 | `apps/gateway-adapter/src/index.ts` — 在 `pollAndReplyWorkflowResult` 中集成 `sendMobilePushNotification()` |

---

## 十二、文档导航

| 文档 | 内容 |
|------|------|
| [产品说明](./PRODUCT.md) | 功能特性、使用场景、核心价值 |
| [运维手册](./OPS.md) | 部署、监控、故障排查、备份恢复、安全加固 |
| [开源协议](./LICENSES.md) | 第三方依赖许可证清单、合规义务 |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史、修复记录、当前状态 |

## 十三、关键文件索引

| 文件 | 用途 |
|------|------|
| `docker-compose.yml` | 全部服务编排，环境变量 |
| `.env` | 环境变量配置（密钥、密码） |
| `.env.example` | 环境变量模板 |
| `apps/gateway-adapter/src/index.ts` | Gateway 主逻辑（4路意图分类 + 知识提交/快速查询/Skill提取/推送） |
| `apps/gateway-adapter/src/services/identity-resolver.ts` | 身份解析与绑定 |
| `services/workflow/src/index.ts` | Workflow CRUD + 调度 |
| `services/workflow/src/planner/planner.ts` | LLM 任务规划 |
| `services/workflow/src/supervisor/manager.ts` | 心跳监控 |
| `services/workflow/src/engine/workflow-machine.ts` | XState 状态机 |
| `services/executor-gateway/src/index.ts` | 自动执行编排 |
| `services/executor-gateway/src/executor/generic-executor.ts` | 通用执行器（含 Dream 压缩增强） |
| `services/hermes-adapter/src/index.ts` | 记忆管理 |
| `services/fact-retrieval/src/service.ts` | 事实检索核心业务逻辑（含知识审核/提取 + AGE图标签扩展） |
| `services/skill-library/src/index.ts` | 技能库管理 |
| `services/resource-scheduler/src/index.ts` | 资源配额与巡检 |
| `apps/mobile-app/src/index.ts` | 移动推送服务 |
| `apps/web-portal/src/index.ts` | Web管理后台（含知识审核渲染） |
| `libs/shared/src/db/schema.ts` | 数据库 schema 定义（含 user_profile 表 + GIN索引） |
| `db/migrations/` | 数据库迁移文件 |
