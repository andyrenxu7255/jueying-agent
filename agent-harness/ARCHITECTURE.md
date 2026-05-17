# agent-harness 系统架构文档

> 版本: 2026-05-17 (第十七轮：冒烟测试 + 四角色体验闭环 + 高危依赖收口)
> 当前状态: **全链路验证通过，TypeScript零错误，系统指南文档与图谱已全面更新至代码最新状态**

---

## 一、系统概述

agent-harness（品牌名 JueYing / 绝影）是一个 AI Agent 编排与执行平台。用户通过飞书/企微等 IM 渠道与系统交互，系统使用 LLM 将用户意图规划为多阶段工作流，自动调度执行器完成各阶段任务，最终汇报结果。系统支持多用户、组织隔离、策略控制、记忆管理。

核心能力:
- **多渠道接入**: 飞书长连接 WebSocket、企微 Webhook、Web Portal
- **LLM 任务规划**: 根据用户目标自动拆解为 knowledge / development 类型阶段链
- **工作流引擎**: 基于 XState 状态机的完整生命周期管理
- **多种执行器**: generic-executor、code-executor、retrieval-aware-executor、verification-executor、repair-executor、approval-executor
- **记忆系统**: 基于 Hermes 的会话记忆，支持压缩上下文召回
- **梦境模式**: 记忆分层管理 + 技能发现生态，每日自动分析
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
                  │  gateway-    │ ← 多渠道适配 & 身份映射 & 5路意图分类
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
       每 10 秒查 workflow 状态
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

## 5b、文件存储机制

### 5.1 存储架构

系统采用**双后端 + 用户隔离**文件存储方案：

```
{storage_root}/
├── staging/                          # 临时预入库区（上传后→校验→入库→清理）
│   └── {session_id}/
│       └── {original_filename}
├── users/                             # 用户独立存储空间
│   └── {org_id}/
│       └── {user_id}/
│           ├── uploads/               # 用户上传的原始文件（按年月归档）
│           │   └── {YYYY-MM}/
│           │       └── {timestamp}_{random}_{sanitized_name}
│           └── artifacts/             # LLM/阶段生成的制品文件
│               └── {artifact_id}.{ext}
├── legacy/                            # 旧版 org 级别存储（向后兼容）
│   └── {org_id}/
│       └── {artifact_id}.txt
└── shared/                            # 组织级共享文件
    └── {org_id}/
        └── ...
```

### 5.2 存储后端

| 后端 | 配置 | 用途 |
|------|------|------|
| `localfs` | `config/default.yaml` → `storage.backend: localfs` | 开发环境，`.runtime/artifacts/` |
| `minio` | 环境变量 `MINIO_ENDPOINT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY` | 生产环境，S3 兼容对象存储 |

### 5.3 用户独立存储空间

每个用户（user）拥有**完全隔离**的个人存储目录：
- **路径**: `users/{org_id}/{user_id}/`
- **上传文件**: 保存在 `uploads/{YYYY-MM}/` 子目录，保留原始文件
- **AI 生成文件**: 保存在 `artifacts/` 子目录
- **权限**: 仅该用户和同组织管理员可访问 `private` 文件
- **共享机制**: 用户可将文件 scope 从 `private` 改为 `shared`（组织内可见）或 `public`（所有人可见）

### 5.4 文件上传流程

```
用户发送文件（飞书/企微/Web）
  → downloadFile() → Buffer
  → sanitizeFileName() + validateFileForImport()
  → storeStaging(temp)           ← 暂存到 staging/{session}/
  → extractTextFromFile()        ← 文本提取（PDF/DOCX/XLSX 多格式）
  → artifactStorage.storeUserFile()  ← 保存原文到 users/{user}/uploads/
  → POST fact-retrieval /internal/documents/index  ← 文本索引到 document_chunks
  → INSERT user_file             ← 写入文件元数据记录
  → cleanupStaging()             ← 清理临时文件
```

### 5.5 文件访问控制

| scope | 读取权限 | 修改权限 |
|-------|---------|---------|
| `private` | 仅文件所有者 | 仅文件所有者 |
| `shared` | 同组织所有成员 | 仅文件所有者/管理员 |
| `public` | 所有人 | 仅文件所有者/管理员 |

### 5.6 关键数据库表

| 表名 | 用途 |
|------|------|
| `user_file` | 文件元数据（所有者、路径、大小、哈希、类别、scope、来源） |
| `document` | 文档索引主表 |
| `document_version` | 文档版本（含 `raw_file_ref` 指向原始上传文件） |
| `document_chunk` | 文档分块（含 embedding 向量） |
| `artifact_object` | 制品对象（LLM 生成物） |

---

## 六、数据库核心表

### 6.1 用户与身份

| 表名 | 用途 |
|------|------|
| `user` | 用户主表 (username, org_id, role, status) |
| `organization` | 组织 |
| `channel_identity` | 渠道身份绑定 (channel_type, external_identity → user_id, binding_status) |
| `user_profile` | 用户画像与人设表 (persona_tier, soul, identity, tone_style, behavior_boundary, skill_tags, work_preference, evolved_history) |

### 6.2 工作流

| 表名 | 用途 |
|------|------|
| `workflow_definition` | 工作流定义/模板 (scope_type, name, workflow_type, version, definition_json) |
| `workflow_instance` | 工作流实例 (status, plan, owner_user_id, org_id, policy_snapshot_id) |
| `workflow_stage` | 工作流阶段 (stage_type, status, assigned_executor, seq) |
| `checkpoint` | 工作流断点/检查点 (checkpoint_type, resume_token, state_hash, policy_snapshot_hash) |
| `workflow_event` | 工作流事件记录 (event_type, from_status, to_status) |
| `execution_session` | 执行会话 (repo_ref, branch_ref, status, backend_type, policy_snapshot_hash) |

### 6.3 策略与审计

| 表名 | 用途 |
|------|------|
| `org_policy` | 组织级策略规则 (role, resource, action → decision) |
| `policy_snapshot` | 策略快照 (snapshot_hash, allowed_scopes, resource_rules, constraints) |
| `audit_event` | 审计日志 (user_id, action, resource_type, resource_ref, result) |

### 6.4 记忆与上下文

| 表名 | 用途 |
|------|------|
| `hermes_memory` | 会话记忆 (owner_user_id, session_id, role, content, token_count) |
| `memory_item` | 结构化记忆项 (memory_type, summary, embedding, status, source_kind) |
| `memory_source` | 记忆来源 (memory_item_id, source_type, source_ref, relevance_score) |
| `memory_usage_log` | 记忆使用日志 (memory_item_id, workflow_instance_id, usage_type) |

### 6.5 事实检索

| 表名 | 用途 |
|------|------|
| `fact` | 事实条目 (subject_ref, predicate, object_value, status, confidence, supersedes_fact_id) |
| `fact_evidence` | 事实证据 (fact_id, evidence_ref, evidence_type, excerpt) |
| `fact_conflict` | 事实冲突 (existing_fact_id, incoming_fact_id, conflict_reason, resolution_status) |
| `entity` | 实体 (entity_type, canonical_name, status, source_confidence) |
| `entity_attribute` | 实体属性 (entity_id, attr_key, attr_value, confidence, source_ref) |
| `relation` | 实体关系 (from_entity_id, relation_type, to_entity_id, strength, evidence_ref) |
| `document` | 文档 (title, scope_type, source_kind, status) |
| `document_version` | 文档版本 (document_id, version_no, content_hash, storage_ref) |
| `document_chunk` | 文档分块 (content_text, embedding, search_tsv — 含 GIN 索引支持全文检索) |
| `artifact_object` | 制品对象 (artifact_type, storage_backend, storage_ref, content_hash, byte_size) |
| `retrieval_trace` | 检索追踪 (query_text, intent_type, scope_summary, duration_ms) |
| `projection_event` | AGE 图投影事件 (source_table, operation, payload, applied) |

### 6.6 技能

| 表名 | 用途 |
|------|------|
| `skill` | 技能主表 (skill_name, skill_type, scope_type, status) |
| `skill_version` | 技能版本 (skill_id, version, definition_json, content_hash) |
| `skill_source` | 技能来源 (skill_version_id, source_type, source_uri) |

### 6.7 文件存储

| 表名 | 用途 |
|------|------|
| `user_file` | 用户文件 (storage_backend, storage_path, original_name, mime_type, scope, file_category) |

### 6.8 组织任务

| 表名 | 用途 |
|------|------|
| `org_task` | 组织任务 (task_type, schedule_type, cron_expression, status, prompt_message) |
| `org_task_assignment` | 任务分配 (task_id, user_id, status, workflow_ref, notified_at) |

### 6.9 梦境模式

| 表名 | 用途 |
|------|------|
| `dream_mode_config` | 梦境模式配置（组织级，含调度时间/压缩阈值/审核参数） |
| `memory_analysis_run` | 记忆分析运行记录（追踪每次梦境分析任务状态和结果） |
| `org_memory_summary` | 组织级整合记忆（Admin 中央知识库，含 embedding 向量检索） |
| `memory_access_log` | 记忆访问权限审计日志（记录所有记忆访问行为） |
| `memory_compression_log` | 记忆压缩归档记录（压缩方法/原文/压缩后/归档文件引用） |
| `scene_value_assessment` | 场景价值评估（使用次数/成功次数/价值分/状态流转） |
| `skill_audit_record` | 技能多维审核记录（功能/安全/性能/适配 四维评分） |
| `skill_usage_stats` | 技能使用日统计（调用次数/成功/失败/平均耗时/活跃用户） |
| `org_skill_registry` | 组织技能注册表（用户技能提升为组织级技能的注册表） |

---

## 七、关键配置项 (.env)

```bash
# 数据库
DATABASE_URL=postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DB_NAME>
DATABASE_NAME=<DB_NAME>
DATABASE_HOST=<DB_HOST>
DATABASE_PORT=5432
DATABASE_USER=<DB_USER>
DATABASE_PASSWORD=<DB_PASSWORD>

# Redis
REDIS_URL=redis://:<REDIS_PASSWORD>@<REDIS_HOST>:6379

# MinIO
MINIO_ROOT_USER=<MINIO_ADMIN_USER>
MINIO_ROOT_PASSWORD=<MINIO_ADMIN_PASSWORD>
MINIO_ENDPOINT=<MINIO_HOST>
MINIO_PORT=9000
MINIO_BUCKET=<BUCKET_NAME>

# LiteLLM
LITELLM_MASTER_KEY=<LITELLM_MASTER_KEY>
LITELLM_MODEL=<LLM_MODEL_NAME>
LITELLM_PLAN_MODEL=<LLM_MODEL_NAME>
LITELLM_CODE_MODEL=<LLM_MODEL_NAME>
LITELLM_PLAN_TIMEOUT_MS=60000

# 飞书
FEISHU_APP_ID=<FEISHU_APP_ID>
FEISHU_APP_SECRET=<FEISHU_APP_SECRET>
FEISHU_VERIFICATION_TOKEN=
FEISHU_SIGNING_SECRET=<FEISHU_SIGNING_SECRET>
FEISHU_DOMAIN=feishu

# Web Portal
PORTAL_PORT=3003
JWT_SECRET=<JWT_SECRET>

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
| POST | `/channels/feishu/webhook` | 接收飞书 Webhook 回调 |
| POST | `/channels/wecom/webhook` | 接收企微回调 |
| POST | `/webhook/feishu` | 飞书回调（兼容路径） |
| POST | `/webhook/wecom` | 企微回调（兼容路径） |

### workflow-service (主机端口 3001)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/workflows/plan` | 生成工作流计划 |
| GET | `/internal/workflows` | 列出工作流 |
| GET | `/internal/workflows/:ref` | 获取工作流详情 |
| POST | `/internal/workflows/:ref/dispatch` | 分发到执行器 |
| POST | `/internal/workflows/:ref/stages/:sid/dispatch` | 阶段结果上报 |
| POST | `/internal/workflows/:ref/complete` | 完成回调 |
| POST | `/internal/workflows/:ref/pause` | 暂停工作流 |
| POST | `/internal/workflows/:ref/resume` | 恢复工作流 |
| POST | `/internal/workflows/:ref/cancel` | 取消工作流 |
| POST | `/internal/workflows/:ref/fail` | 强制失败 |
| POST | `/internal/workflows/:ref/heartbeat` | 阶段心跳 |
| GET | `/internal/workflows/:ref/supervision` | 监督器进度查询 |
| GET | `/internal/workflows/:ref/progress` | 工作流进度详情 |
| POST | `/internal/checkpoints/create` | 创建检查点 |
| POST | `/internal/checkpoints/resume` | 从检查点恢复 |

### executor-gateway (主机端口 3002)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/executor/dispatch` | 接收工作流分发 |
| POST | `/internal/executor/execute` | 直接执行器阶段执行 |
| GET | `/internal/executor/runs/:ref` | 查询执行运行状态 |
| POST | `/internal/executor/sessions/:id` | 会话操作（终止/状态/取消/暂停/恢复） |
| GET | `/health` | 健康检查 |

### hermes-adapter (主机端口 3005)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/memory` | 存储记忆条目 |
| POST | `/internal/memory/recall` | 召回记忆（含压缩上下文） |
| POST | `/internal/memory/clear` | 清理会话记忆 |
| POST | `/internal/context/compress` | 压缩上下文 |
| POST | `/internal/memory/analyze` | 梦境模式：个人记忆分析（收集→压缩→抽取） |
| POST | `/internal/memory/analyze/org` | 梦境模式：组织级记忆整合 |
| GET | `/internal/memory/summary` | 梦境模式：组织级记忆汇总查询 |
| GET | `/internal/memory/analysis-runs` | 梦境模式：分析运行历史 |
| GET | `/internal/memory/compression-logs` | 梦境模式：压缩日志查询 |
| GET | `/internal/memory/access-log` | 梦境模式：记忆访问审计日志 |

### fact-retrieval (主机端口 3004)
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/documents/index` | 文档索引（分块、向量化、全文检索） |
| POST | `/internal/retrieval/query` | 向量 + 全文混合检索 |
| POST | `/internal/facts/write` | 事实写入（insert/supersede/conflict/attach-evidence） |
| POST | `/internal/artifacts/write` | 制品写入（LLM 生成物存储） |
| POST | `/internal/artifacts/read` | 制品读取（含权限过滤） |
| POST | `/internal/entities/write` | 实体与关系批量写入 |
| POST | `/internal/embeddings/backfill` | 触发 embedding 回填任务 |
| POST | `/internal/fact/submit` | 接收用户主动提交的知识片段（写入 unconfirmed 池） |
| GET | `/internal/fact/review` | 列出待审核/已审核知识条列（支持 status + org_id 过滤） |
| POST | `/internal/fact/review` | 管理员审核知识（approve/approve_shared/reject/return） |
| POST | `/internal/knowledge/extract` | 从对话记忆中提取结构化知识 |
| GET | `/internal/files` | 列出用户文件（支持 category/scope 过滤） |
| POST | `/internal/files/upload` | 上传文件（base64 编码） |
| GET | `/internal/files/:id/download` | 下载文件 |
| POST | `/internal/files/:id/share` | 修改文件 scope（private/shared/public） |
| DELETE | `/internal/files/:id` | 软删除文件 |

### skill-library (主机端口 3007)
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/internal/skills` | 技能列表（支持分页和过滤） |
| POST | `/internal/skills/create` | 注册新技能（自动生成 v1 版本） |
| GET | `/internal/skills/search` | 搜索技能（关键词、类型过滤） |
| GET | `/internal/skills/:id` | 获取技能详情（含最新版本定义） |
| POST | `/internal/skills/:id/update` | 更新技能定义（自动递增版本号） |
| POST | `/internal/skills/:id/publish` | 发布技能（draft → active） |
| POST | `/internal/skills/:id/archive` | 归档技能（active → archived） |
| POST | `/internal/skills/import` | 从 Markdown 内容导入技能 |
| GET | `/internal/skills/:id/export` | 导出技能定义为 Markdown |
| GET | `/internal/skills/:id/versions` | 列出技能的所有版本 |
| POST | `/internal/skills/audit` | 梦境模式：单个技能四维审核 |
| POST | `/internal/skills/audit/batch` | 梦境模式：批量技能审核 |
| POST | `/internal/skills/:id/promote-to-org` | 梦境模式：技能提升为组织级 |
| GET | `/internal/skills/org-registry` | 梦境模式：组织技能注册表 |
| GET | `/internal/skills/audit-records` | 梦境模式：审核记录查询 |
| GET | `/internal/skills/usage-stats` | 梦境模式：技能使用统计 |
| GET | `/internal/skills/scene-assessments` | 梦境模式：场景价值评估 |

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
| POST | `/api/admin/dream/analyze` | 梦境模式：触发个人记忆分析 |
| POST | `/api/admin/dream/analyze-org` | 梦境模式：触发组织级记忆整合 |
| GET | `/api/admin/dream/summary` | 梦境模式：组织级记忆汇总 |
| GET | `/api/admin/dream/runs` | 梦境模式：分析运行历史 |
| GET | `/api/admin/dream/compressions` | 梦境模式：压缩日志 |
| GET | `/api/admin/dream/access-log` | 梦境模式：访问审计日志 |
| POST | `/api/admin/dream/skill-audit` | 梦境模式：单技能审核 |
| POST | `/api/admin/dream/skill-audit-batch` | 梦境模式：批量技能审核 |
| GET | `/api/admin/dream/skill-audit-records` | 梦境模式：审核记录 |
| GET | `/api/admin/dream/org-skills` | 梦境模式：组织技能库 |
| GET | `/api/admin/dream/skill-usage` | 梦境模式：技能使用统计 |
| GET | `/api/admin/dream/scenes` | 梦境模式：场景价值评估 |
| POST | `/api/admin/skills/:id/promote-to-org` | 梦境模式：技能提升为组织级 |
| GET | `/api/admin/dream/config` | 梦境模式：读取配置 |
| POST | `/api/admin/dream/config` | 梦境模式：保存配置 |

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

## 十二、第五轮修复内容（2026-05-04）— 梦境模式实现

本轮实现故事线 AH-20「梦境模式：记忆分层管理 + 技能发现生态」，新增 9 张数据库表、14 个 API 端点、3 个 Web Portal 页面和自动调度器。

### 分支一：记忆分层管理系统

| # | 新增功能 | 实现位置 |
|---|----------|----------|
| D-01 | 个人梦境分析端点 `POST /internal/memory/analyze` | `services/hermes-adapter/src/index.ts` — 三步流水线（收集→压缩→抽取） |
| D-02 | 组织级记忆整合端点 `POST /internal/memory/analyze/org` | `services/hermes-adapter/src/index.ts` — 扫描 dream_extraction 事实 → 去重整合 → org_memory_summary |
| D-03 | 记忆汇总/运行历史/压缩日志/访问日志查询端点 | `services/hermes-adapter/src/index.ts` — 4 个 GET 端点 |
| D-04 | 数据库迁移 021_dream_mode.sql | `db/migrations/021_dream_mode.sql` — 9 张新表 |

### 分支二：技能发现与管理生态

| # | 新增功能 | 实现位置 |
|---|----------|----------|
| D-05 | 单技能四维审核端点 `POST /internal/skills/audit` | `services/skill-library/src/index.ts` — 功能/安全/性能/适配评分 |
| D-06 | 批量技能审核端点 `POST /internal/skills/audit/batch` | `services/skill-library/src/index.ts` — 每日自动审核 |
| D-07 | 技能提升/注册表/审核记录/使用统计/场景评估端点 | `services/skill-library/src/index.ts` — 5 个端点 |

### Web Portal 集成

| # | 新增功能 | 实现位置 |
|---|----------|----------|
| D-08 | 梦境模式 API 代理（14 个端点） | `apps/web-portal/src/index.ts` — 代理到 hermes/skill-library |
| D-09 | 梦境模式自动调度器 | `apps/web-portal/src/index.ts` — 每 2 分钟检查，按配置触发分析/审核 |
| D-10 | 梦境模式 UI 页面（3 个） | `apps/web-portal/static/app.js` — 记忆分析/技能发现/配置管理 |

---

## 十三、第六轮修复内容（2026-05-05）— 安全闭环 + 文档对齐

本轮基于前五轮审计发现，对遗留问题进行系统性收口：

### P0 修复（安全闭环）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P0-5 | executor 服务仍含硬编码 API 密钥回退值 `'litellm-dev-key'` | 若环境变量缺失，服务以可猜测密钥运行 | `generic-executor.ts`, `verification-executor.ts`, `repair-executor.ts`, `code-executor.ts` — 全部 4 个文件移除硬编码回退值，改为 `''` + `logger.warn` 警告 |
| P0-6 | planner.ts 含硬编码 API 密钥回退值 `'ollama'` | 同上 | `services/workflow/src/planner/planner.ts` — 移除硬编码回退值 |

### P1 修复（文档对齐）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P1-5 | `CORS_ORIGINS` 默认值文档滞后（含 `,*` 通配符） | 运维配置参考与实际不一致 | `OPS.md` — 同步为 `http://localhost:3003` |
| P1-6 | 用户故事线服务端口与 Docker 内部端口不一致 | 新开发者配置混乱 | `用户故事线.md` — 所有服务 URL 统一为容器内 `:3000` |
| P1-7 | skill-library API 端点文档与实际代码路径不符 | API 文档不可信 | `ARCHITECTURE.md` — 全量重写 skill-library 端点表 |
| P1-8 | gateway-adapter API 端点含有不存在的 `/channels/webot/callback` | 文档描述不存在功能 | `ARCHITECTURE.md` — 更新为实际路径 |
| P1-9 | fact-retrieval 端点文档严重缺失（仅 4 个 vs 实际 18 个） | 内部 API 文档不完整 | `ARCHITECTURE.md` — 补齐全部 18 个端点 |
| P1-10 | 文件存储端点路径错误（`/api/files` → `/internal/files`） | 调用方使用错误路径 | `ARCHITECTURE.md` — 合并到 fact-retrieval 主端点表 |

### P2 修复（工程化提升）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P2-3 | 核心服务缺少单元测试 | 重构/修改风险高 | `libs/shared/src/http/index.test.ts`, `services/workflow/src/engine/workflow-machine.test.ts` — 已有；本轮新增 `gateway-adapter`, `fact-retrieval`, `hermes-adapter` 测试 |
| P2-4 | 知识图谱未同步本轮变更 | 图谱与文档脱节 | `context-graph.json` — 更新版本号与描述 |

---

## 十四、第七轮修复内容（2026-05-05）— Docker运维健全 + 错误处理完善

### P1 修复（运维健全）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P1-11 | 8 个 app 服务缺失 Docker 健康检查 | 容器编排器无法判断服务真正就绪 | `docker-compose.yml` — 为 gateway-adapter, workflow-service, fact-retrieval, executor-gateway, feishu-longconn, hermes-adapter, skill-library, resource-scheduler 添加统一的 `node -e "require('http').get('/health/live')"` 健康检查 |

### 运维增强详情

| 服务 | 原状态 | 新状态 |
|------|:------:|:------:|
| gateway-adapter | ❌ | ✅ |
| workflow-service | ❌ | ✅ |
| fact-retrieval | ❌ | ✅ |
| executor-gateway | ❌ | ✅ |
| feishu-longconn | ❌ | ✅ |
| hermes-adapter | ❌ | ✅ |
| skill-library | ❌ | ✅ |
| resource-scheduler | ❌ | ✅ |

### P2 修复（代码质量）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P2-5 | planner.ts `catch {}` 空 catch 块丢失调试信息 | JSON 解析失败时无法定位根因 | `services/workflow/src/planner/planner.ts:L183` — 改为 `catch (parseError)` 并记录错误信息 |

---

## 十五、第八轮修复内容（2026-05-06）— 全面系统审计修复

本轮基于7路并行审计代理对全工作区代码、文档、图谱进行深度审计，发现104个问题（含前轮遗留9项），按P0/P1/P2优先级逐一修复。

### P0 修复（安全闭环）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P0-7 | `.env` 含5组明文API密钥 + 3组默认密码 | 凭据泄露风险 | `.env` — 全部替换为 `<CHANGE_ME>` 占位符 |
| P0-8 | `safeCompareSignature` padding机制可被时序分析利用 | 飞书签名可被伪造 | `gateway-adapter/index.ts` — 移除padding，直接用长度检查+`timingSafeEqual` |
| P0-9 | fact-retrieval artifact-storage 路径遍历风险 | 恶意文件名可越权访问文件系统 | `fact-retrieval/src/artifact-storage.ts` — 新增 `validateSecurePath()` 路径约束 + bucket名称正则校验 |

### P1 修复（代码质量）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P1-11 | gateway-adapter 40处 `fireAndForget(...),'tag'` 缺少空格 | 代码风格不一致 | `gateway-adapter/index.ts` — 添加逗号后空格 |
| P1-12 | `sharedDbPool` 类型过于宽泛 + `getSharedDbPool` 无错误处理 | 运行时类型不安全 | `gateway-adapter/index.ts` — 改为 `Pool` 类型 + try-catch |
| P1-13 | `getFeishuApiBase` 未知domain直接返回原始值 | 飞书API调用失败 | `gateway-adapter/index.ts` — 未知domain降级到 `feishu.cn` + logger.warn |
| P1-14 | identity-resolver 无输入校验 + catch块吞错误 | 无效参数穿透 + 问题难以排查 | `identity-resolver.ts` — 添加类型/长度校验 + `console.error` 错误日志 |
| P1-15 | approval-executor 无审批人上限 + 日志泄露用户ID | DoS风险 + 隐私泄露 | `approval-executor.ts` — `MAX_APPROVERS=20` + 日志改用 `approver_count` |
| P1-16 | evaluateAlerts 仅检查counter忽略histogram | histogram指标告警失效 | `libs/shared/metrics.ts` — 扩展支持histogram平均值对比 |
| P1-17 | app.js 全文 `var` 声明 + `\|\|` 旧式默认值 | 不符合ES6+规范 | `web-portal/static/app.js` — 全部 `var`→`const`/`let`, `\|\|`→`??` |

### P2 修复（文档图谱同步）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P2-6 | context-graph.json v1.6 缺少DEV-14/15/16 + AH1-36 | 工具链加载不完整 | `context-graph.json` — v1.7 补全6个文档引用 |
| P2-7 | context-graph.json authority_map 3处映射不准确 | skill/resource/dream权威文档错误 | `context-graph.json` — resource→AH1-24, dream→AH1-20 |
| P2-8 | context-routing.json v1.2 缺少 `types/**` 路径 | types文件不可访问 | `context-routing.json` — v1.3 添加 `agent-harness/types/**` |
| P2-9 | object-relationship-graph.md 未包含新DEV文档 + AH1-36 | 图谱与文档层不一致 | `object-relationship-graph.md` — v2.2 补全L1/L2层 |

### 已验证无需修复的项目（前轮审计误报）

| # | 审计发现 | 实际状态 |
|---|---------|---------|
| — | `verifyInternalAuth` 放行逻辑 | 已正确实现生产环境拒绝逻辑 |
| — | `evictOldest` Map迭代顺序 | JavaScript Map按插入顺序，第一个=最旧，逻辑正确 |
| — | embedding 错误日志缺失 | 已正确记录HTTP状态码和响应体摘要 |
| — | `timer.unref()` 未调用 | 已存在于approval-executor.ts |

---

## 十六、第5轮全面代码审计（2026-05-17）

本轮从依赖项、前端UX/安全、后端安全、服务间通信4个维度进行深度审计，发现31个问题，修复25项。

### P0 修复（功能阻断/安全漏洞）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P0-1 | `const guideTab` 赋值失败（const不可重新赋值） | 指南页标签切换完全失效 | `app.js:L328` → `let guideTab` |
| P0-2 | `const container` 在 showToast 中重新赋值导致崩溃 | Toast通知完全不可用 | `app.js:L44` → `let container` |
| P0-3 | showModal 点击overlay关闭时ESC监听器泄漏 | 内存泄漏+多次绑定 | `app.js:L94` → 统一调用 `closeModal()` |
| P0-4 | Dream Scheduler 调用 `/api/admin/dream/*` 不传session → 401 | 梦境模式定时任务全部失败 | `index.ts` → 直接调用 `fetchFromService(hermesUrl/skillLibraryUrl)` |
| P0-5 | Task Scheduler 同样HTTP自调用但无session | 组织任务分发定时失效 | `index.ts` → `fetchFromService(gatewayUrl)` |
| P0-6 | `/internal/tasks/assign` 和 `/internal/tasks/notify` 无认证 | 任意用户可操纵任务分发 | `index.ts` → 添加 `requireAdmin()` |

### P1 修复（安全加固）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P1-1 | setup IP检查使用 `includes` 子串匹配 | `127.0.0.100` 可绕过 | `index.ts` → `Set.has()` 精确匹配 + `x-forwarded-for` |
| P1-2 | setup 初始化后未自禁用 | 可反复覆盖系统配置 | `index.ts` → 检查org+admin已存在则拒绝 |
| P1-3 | `fetchFromService` 无超时机制 | 下游故障时无限挂起 | `index.ts` → 30s AbortController + AbortError处理 |
| P1-4 | litellm 镜像 `main-latest` 浮动标签 | 不可复现部署 | `docker-compose.yml` → `main-v1.74.4-stable` |
| P1-5 | ADMIN_PASSWORD 环境变量默认值为空 | 潜在空密码后门 | `docker-compose.yml` → `${ADMIN_PASSWORD:-default_admin_changeme}` |
| P1-6 | Redis healthcheck 使用 `redis-cli -a` 暴露密码于进程列表 | 密码泄露风险 | `docker-compose.yml` → `REDISCLI_AUTH` 环境变量 |
| P1-7 | ollama + ollama-pull 服务存在（用户明确不需要本地模型） | 多余基础设施 | `docker-compose.yml` → 移除3个ollama相关定义 |

### P2 修复（代码质量/UX）

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| P2-1 | triggerOrgTask/pauseOrgTask/archiveOrgTask 未检查 `r.ok` | 失败后显示虚假成功 | `app.js` → 添加错误检查和错误toast |
| P2-2 | handleApproval 失败后仍刷新视图 | 丢失错误上下文 | `app.js` → 只在成功时 `renderView()` |
| P2-3 | initApp 无错误边界 | 启动失败→白屏 | `app.js` → try-catch + 错误UI |
| P2-4 | doLogout 不调用后端使session失效 | session残留到过期 | `app.js` → `POST /api/auth/logout` |
| P2-5 | pg 版本不统一（3处 ^8.15.3） | 文档误导 | `audit/hermes/web-portal package.json` → `^8.20.0` |
| P2-6 | yaml 版本不统一（shared ^2.4.0） | 文档误导 | `shared/package.json` → `^2.8.3` |
| P2-7 | hermes-adapter 使用 drizzle-orm 但未声明依赖 | 隐式依赖 | `hermes-adapter/package.json` → 添加 `drizzle-orm` |
| P2-8 | pdf-parse CVE-2023-26134 已知漏洞 | 用户上传PDF风险 | `gateway-adapter/index.ts` → 替换为 `pdfjs-dist` 并同步锁文件 |

### 验证结果

| 检查项 | 结果 |
|--------|------|
| `tsc --noEmit` | ✅ pass (exit 0) |
| `docker compose config --quiet` | ✅ pass (exit 0) |
| context-graph.json | ✅ valid JSON, v2.0 |
| context-routing.json | ✅ valid JSON, v1.5 |
| diagnostics | ✅ 0 errors |

---

## 十七、第6轮冒烟测试与四角色体验闭环（2026-05-17）

本轮在前一轮安全与 UX 修复基础上，按“开发、运维、Admin、普通用户”四条故事线做端到端验收，重点把脚本可复现性、Compose 可启动性、渠道烟测、梦境模式、组织边界和依赖安全收口到同一套发布前检查中。

### 修复与优化

| # | 问题 | 影响 | 修复位置 |
|---|------|------|---------|
| S-1 | M0 校验脚本引用旧 Jest 配置名 | 新开发者按文档运行即失败 | `scripts/validate-m0.js` → 指向 `tests/setup/jest.config.cjs` |
| S-2 | SQL 迁移脚本不读取 `.env` 且默认密码与 Compose 不一致 | 数据库迁移在本地开发栈失败 | `scripts/apply-sql-migrations.js` → 读取 `.env` 并从 `POSTGRES_*` 拼接连接串 |
| S-3 | 渠道烟测与 Compose 开发默认签名密钥不一致 | 飞书/企微本地烟测误报 | `docker-compose.yml`、`scripts/channel-webhook-smoke.mjs` |
| S-4 | SigNoz 查询健康检查命中历史路径 | `smoke:eval` 对可用服务报 404 | `scripts/smoke-eval.js` → 改用当前入口 `/` |
| S-5 | Quick Lookup 未携带 `org_id` | 快速查询缺少组织隔离上下文 | `apps/gateway-adapter/src/index.ts` |
| S-6 | 梦境个人分析测试用户缺少组织/用户记录 | Admin 手动梦境分析外键失败 | `services/hermes-adapter/src/index.ts` |
| S-7 | 组织记忆/技能接口缺少强制 `org_id` | Admin 组织边界不够清晰 | `services/hermes-adapter/src/index.ts`、`services/skill-library/src/index.ts` |
| S-8 | `pdf-parse` 已知漏洞残留 | PDF 上传解析存在依赖风险 | `pdfjs-dist` 替换并同步 `package-lock.json` |
| S-9 | OpenTelemetry 直接依赖命中 high 审计项 | 可观测依赖存在 DoS 风险 | 升级 `@opentelemetry/auto-instrumentations-node`、`@opentelemetry/sdk-node` |

### 验收故事线

开发视角要求从干净工作区按文档完成依赖、迁移、lint、类型检查、单元测试、上下文审计和烟测；运维视角要求 Compose 栈能启动，健康检查命中真实端点，并能区分真实凭据缺失与核心服务故障；Admin 视角要求组织级梦境、知识和技能治理必须强制携带 `org_id`，并返回可解释的业务结果字段；普通用户视角要求飞书/企微消息可异步 ACK、去重、快查、知识提交、长任务和文件解析都能按组织边界降级运行。

详细故事线见 [用户故事线.md](./用户故事线.md) 的“故事线二十一”和 [DEV-17-冒烟测试与四角色体验闭环.md](../development/DEV-17-冒烟测试与四角色体验闭环.md)。

## 十八、文档导航

| 文档 | 内容 |
|------|------|
| [产品说明](./PRODUCT.md) | 功能特性、使用场景、核心价值 |
| [运维手册](./OPS.md) | 部署、监控、故障排查、备份恢复、安全加固 |
| [开源协议](./LICENSES.md) | 第三方依赖许可证清单、合规义务 |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史、修复记录、当前状态 |
| [冒烟与安全审计报告](./AUDIT-REPORT-2026-05-17-SMOKE.md) | 本轮冒烟、UX故事线、安全依赖和剩余风险 |

## 十九、关键文件索引

| 文件 | 用途 |
|------|------|
| `docker-compose.yml` | 全部服务编排，环境变量 |
| `.env` | 环境变量配置（密钥、密码） |
| `.env.example` | 环境变量模板 |
| `apps/gateway-adapter/src/index.ts` | Gateway 主逻辑（5路意图分类 + 知识提交/快速查询/Skill提取/推送） |
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
| `apps/web-portal/src/index.ts` | Web管理后台（含知识审核渲染 + 文件管理API） |
| `apps/web-portal/static/app.js` | Web管理前端（含文件浏览器UI） |
| `libs/shared/src/db/schema.ts` | 数据库 schema 定义（含 user_profile + user_file 表 + GIN索引） |
| `services/fact-retrieval/src/artifact-storage.ts` | 文件存储后端抽象（双后端：localFS + MinIO，用户隔离 + staging） |
| `libs/shared/src/http/index.test.ts` | HTTP 工具函数单元测试 |
| `services/workflow/src/engine/workflow-machine.test.ts` | 工作流状态机单元测试 |
| `services/workflow/src/persistence/db.test.ts` | 数据库持久化单元测试 |
| `db/migrations/022_user_file_storage.sql` | 用户文件存储迁移（user_file 表 + 索引） |
| `db/migrations/` | 数据库迁移文件 |
