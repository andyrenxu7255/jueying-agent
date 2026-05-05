# TeamClaw (agent-harness) 对象关系图谱

> 版本: v2.1 | 生成日期: 2026-05-05
> 基于: ARCHITECTURE.md + AH1-14/17 + DEV-08 + 源码分析 + docker-compose.yml
> 目标: 单一文件承载全系统对象关系，减少 debug/优化场景的上下文加载量

---

## 1. 系统拓扑

```
┌──────────────────────────────────────────────────────────────────────┐
│                         外部渠道 (IM)                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │   飞书    │  │   企微    │  │  Web     │  │  Mobile  │             │
│  │ WebSocket │  │ Webhook  │  │ Portal   │  │  App     │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
│       │             │             │             │                     │
│  ┌────▼─────┐       │             │             │                     │
│  │ feishu-  │       │             │             │                     │
│  │ longconn │       │             │             │                     │
│  └────┬─────┘       │             │             │                     │
└───────┼─────────────┼─────────────┼─────────────┼────────────────────┘
        │             │             │             │
   ┌────▼─────────────▼─────────────▼─────────────▼────┐
   │               gateway-adapter                      │  ← 多渠道适配 & 身份映射 & 5路意图分类
   │          (主机3000 / 容器3000)                      │
   └──┬──────┬──────────┬──────────┬──────────┬────────┘
      │      │          │          │          │
      │ ┌────▼────┐     │          │          │
      │ │ LiteLLM │     │          │          │  ← LLM 统一代理
      │ │  :4000  │     │          │          │
      │ └─────────┘     │          │          │
      │                 │          │          │
 ┌────▼────┐  ┌─────────▼────┐  ┌──▼───────┐ │
 │workflow │  │  executor-   │  │ hermes-  │ │  ← 核心业务链
 │:3000    │◄►│  gateway:3000│  │ adapter  │ │     (容器内均监听 3000)
 └──┬──┬───┘  └──┬──┬──┬────┘  │ :3000    │ │
    │  │         │  │  │       └────┬─────┘ │
    │  │    ┌────┘  │  └────┐       │       │
    │  │    │       │       │       │       │
    │  │ ┌──▼──┐ ┌──▼──┐ ┌──▼──┐    │  ┌────▼────┐ ┌─────────┐ ┌────────┐
    │  │ │gen. │ │code │ │retr │    │  │ skill-  │ │resource-│ │mobile  │
    │  │ │exec │ │exec │ │aware│    │  │ library │ │scheduler│ │-app    │
    │  │ │     │ │     │ │exec │    │  │ :3000   │ │ :3000   │ │:3000   │
    │  │ └─────┘ └──┬──┘ └──┬──┘    │  └────┬────┘ └────┬────┘ └───┬────┘
    │  │      ┌─────┘       │       │       │          │          │
    │  │ ┌────▼────┐ ┌──────▼────┐  │       │          │          │
    │  │ │verify  │ │  repair-  │  │       │          │          │
    │  │ │exec    │ │  executor │  │       │          │          │
    │  │ └────────┘ └───────────┘  │       │          │          │
    │  │         ┌──────────┐      │       │          │          │
    │  │         │ approval │      │       │          │          │
    │  │         │ executor │      │       │          │          │
    │  │         └──────────┘      │       │          │          │
    │  │                            │       │          │          │
 ┌──▼──▼────────────────────────────▼───────▼──────────▼──────────▼──┐
 │                 PostgreSQL + pgvector + AGE                        │
 │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────┐ │
 │  │ 业务表       │ │ 检索表       │ │ 图投影       │ │ 治理表    │ │
 │  │(用户/工作流/ │ │(事实/文档/   │ │(AGE vertex/  │ │(审计/配额/│ │
 │  │ 策略/技能)   │ │ 向量/记忆)   │ │ edge)        │ │ 技能评估) │ │
 │  └──────────────┘ └──────────────┘ └──────────────┘ └───────────┘ │
 └───────────────────────────────────────────────────────────────────┘
        │                   │                    │
   ┌────▼────┐    ┌─────────▼────┐    ┌─────────▼────┐
   │  Redis  │    │    MinIO     │    │  SigNoz/OTel │
   │  :6379  │    │  :9000/9001  │    │  追踪+告警   │
   └─────────┘    └──────────────┘    └──────────────┘
```

---

## 2. 核心领域对象 (12 个权威领域对象)

| ID | 领域对象 | 权威定义文档 | 核心结构 |
|----|---------|-------------|---------|
| DO-01 | **WorkflowLifecycle** | `AH1-17` §2-5,§21 | WorkflowPlan → stage_chain → 状态机 13 态 |
| DO-02 | **PolicySnapshot** | `AH1-16` | scope + role + rules → snapshot_hash |
| DO-03 | **ApiContract** | `AH1-15` | 事件信封 + 错误码 + internal API |
| DO-04 | **ExecutionSession** | `AH1-18` | repo/branch/status → SubagentLoop |
| DO-05 | **CheckpointResumeReplay** | `AH1-19` | checkpoint_type + resume_token + state_hash |
| DO-06 | **RetrievalFactWrite** | `AH1-20` | RetrievalPlan → EvidencePack → Fact→FactEvidence |
| DO-07 | **ArtifactStorage** | `AH1-22` | artifact_type + storage_ref → MinIO |
| DO-08 | **AuditLogMetrics** | `AH1-23` | user+resource+action+result → audit_event |
| DO-09 | **ProviderRouting** | `AH1-26` | LLM/Embedding/Rerank provider 选择与 fallback |
| DO-10 | **ConfigLayer** | `AH1-28` | .env → 环境变量 → 服务配置层级 |
| DO-11 | **ErrorDegradePolicy** | `AH1-31` | 错误分类(Transient/Permanent/System) → 降级熔断 |
| DO-12 | **ApiVersionLifecycle** | `AH1-32` | API 版本生命周期与兼容策略 |

### 领域对象间约束关系

```
DO-01(WorkflowLifecycle) ──CONSTRAINED_BY──► DO-02(PolicySnapshot)
DO-04(ExecutionSession)  ──CONSTRAINED_BY──► DO-02(PolicySnapshot)
DO-06(RetrievalFactWrite)──CONSTRAINED_BY──► DO-02(PolicySnapshot)
DO-01(WorkflowLifecycle) ──CONSTRAINED_BY──► DO-03(ApiContract)
DO-03(ApiContract)       ──CONSTRAINED_BY──► DO-12(ApiVersionLifecycle)
DO-06(RetrievalFactWrite)──DEPENDS_ON──────► DO-09(ProviderRouting)
DO-04(ExecutionSession)  ──DEPENDS_ON──────► DO-05(CheckpointResumeReplay)
DO-04(ExecutionSession)  ──DEPENDS_ON──────► DO-07(ArtifactStorage)
DO-01(WorkflowLifecycle) ──DEPENDS_ON──────► DO-05(CheckpointResumeReplay)
DO-08(AuditLogMetrics)   ──OBSERVES────────► DO-01,DO-04,DO-06,DO-07
```

---

## 3. 数据库表 ER 图 (47 张表，按模块分组)

### 3.1 身份与权限模块

```
┌──────────────────────┐       ┌──────────────────────┐
│ organization │       │        user          │
│──────────────│ 1──N  │──────────────────────│
│ id (PK)      │◄──────│ id (PK) defaultRandom│
│ org_name     │       │ org_id (FK→org)     │
│ display_name │       │ username              │
│ status       │       │ display_name          │
│ settings     │       │ role                  │
│ metadata     │       │ status                │
└──────────────┘       │ metadata              │
                       │ created_at defaultNow │
                       │ updated_at defaultNow │
                       └──────┬───────────────┘
                              │ 1──N
                       ┌──────▼───────────────┐
                       │  channel_identity     │
                       │──────────────────────│
                       │ id (PK)              │
                       │ user_id (FK→user)    │
                       │ channel_type          │  ('feishu'/'wecom'/'webot')
                       │ external_identity     │
                       │ binding_status        │  ('pending'/'bound'/'unbound')
                       │ unique(channel_type,  │
                       │   external_identity) │
                       └──────────────────────┘

                       ┌──────────────────────┐
                       │    user_profile       │
                       │──────────────────────│
                       │ id (PK)              │
                       │ user_id (FK→user)    │
                       │ org_id (FK→org)      │
                       │ persona_tier          │
                       │ soul (JSONB)          │
                       │ identity (JSONB)      │
                       │ tone_style (JSONB)    │
                       │ behavior_boundary     │
                       │ skill_tags (TEXT[])   │
                       │ current_focus         │
                       │ work_preference       │
                       │ evolved_history       │
                       │ unique(user_id)       │
                       └──────────────────────┘
```

```
┌──────────────────────┐
│   org_policy          │
│──────────────────────│
│ id (PK)              │
│ org_id (FK→org)     │
│ role                  │
│ resource              │
│ action                │
│ decision              │  ('allow'/'deny')
└──────────────────────┘

┌──────────────────────┐       ┌──────────────────────┐
│  policy_snapshot      │       │        user          │
│──────────────────────│       │  (见上方)            │
│ id (PK)              │       └──────────────────────┘
│ user_id (FK→user)   │
│ role                  │
│ allowed_scopes (JSONB)│
│ constraints (JSONB)   │
│ snapshot_hash (UNIQUE)│
└──────────────────────┘
```

### 3.2 工作流治理模块 (6 表核心链)

```
┌──────────────────────┐
│ workflow_definition   │  ← 公共/私有模板定义
│──────────────────────│
│ id (PK)              │
│ owner_user_id (FK)   │
│ scope_type            │  ('public'/'private')
│ name                  │
│ workflow_type         │
│ version               │
│ definition_json(JSONB)│
│ unique(owner,name,ver)│
└──────────────────────┘
         │ 1──N (模板→实例)
         ▼
┌──────────────────────┐       ┌──────────────────────┐
│  workflow_instance    │──────►│  policy_snapshot      │
│──────────────────────│       └──────────────────────┘
│ id (PK)              │
│ workflow_definition_id│       ┌──────────────────────┐
│ owner_user_id (FK)   │──────►│        user          │
│ policy_snapshot_id    │       └──────────────────────┘
│ scope_type='private'  │
│ status                │
│ plan (JSONB)          │  ← 完整的 WorkflowPlan DSL
│ plan_hash            │
│ budget_json (JSONB)   │
│ started_at            │
│ finished_at           │
└──────┬───────────────┘
       │ 1──N
       ▼
┌──────────────────────┐
│   workflow_stage      │
│──────────────────────│
│ id (PK)              │
│ workflow_instance_id  │
│ stage_key (UNIQUE)   │
│ stage_type            │
│ seq (UNIQUE)          │
│ assigned_executor     │
│ status                │
│ input_refs (JSONB)    │
│ output_refs (JSONB)   │
│ acceptance_result     │
│ last_output_preview   │
│ verification_meta     │
│ next_action           │
└──────┬───────────────┘
       │ 1──1
       ▼
┌──────────────────────┐
│     checkpoint        │
│──────────────────────│
│ id (PK)              │
│ workflow_instance_id  │
│ workflow_stage_id     │
│ checkpoint_type       │  ('stage-enter'/'stage-exit'/'waiting-user'/'blocked'/'paused'/'repair')
│ resume_token (UNIQUE) │
│ state_hash           │
│ policy_snapshot_hash │
│ status_snapshot(JSONB)│
│ artifact_refs (JSONB) │
│ evidence_pack_hash   │
│ next_action           │
└──────────────────────┘

┌──────────────────────┐       ┌──────────────────────┐
│   workflow_event      │       │   execution_session  │
│──────────────────────│       │──────────────────────│
│ workflow_instance_id  │       │ id (PK)              │
│ workflow_stage_id     │       │ workflow_instance_id │
│ event_type            │       │ workflow_stage_id    │
│ from_status           │       │ owner_user_id (FK)   │
│ to_status             │       │ status                │
│ event_payload (JSONB) │       │ repo_ref             │
│ occurred_at           │       │ branch_ref            │
└──────────────────────┘       │ worktree_ref          │
                               │ checkpoint_id         │
                               │ stage_goal            │
                               │ budget_json (JSONB)   │
                               │ acceptance_rules      │
                               │ backend_type          │
                               │ policy_snapshot_hash  │
                               └──────────────────────┘
```

### 3.3 事实检索模块 (7 表)

```
┌──────────────────────┐
│       entity          │
│──────────────────────│
│ id (PK)              │
│ owner_user_id (FK)   │
│ scope_type            │
│ entity_type           │
│ canonical_name        │
│ status                │
│ source_confidence     │
└──────┬───────────────┘
       │ 1──N                   1──N
       ▼                ┌──────────────────────┐
┌──────────────────────┐│     relation          │
│  entity_attribute    ││──────────────────────│
│──────────────────────││ id (PK)              │
│ entity_id (FK)       ││ from_entity_id(FK)   │
│ attr_key             ││ to_entity_id(FK)     │
│ attr_value_json      ││ owner_user_id (FK)   │
│ value_type           ││ relation_type         │
│ evidence_ref         ││ strength              │
│ confidence           ││ status                │
└──────────────────────┘│ evidence_ref          │
                       └──────────────────────┘

┌──────────────────────┐       ┌──────────────────────┐
│        fact           │       │    fact_evidence     │
│──────────────────────│ 1──N  │──────────────────────│
│ id (PK)              │◄──────│ fact_id (FK)         │
│ owner_user_id (FK)   │       │ evidence_ref          │
│ org_id (FK)          │       │ evidence_type         │
│ scope_type            │       │ excerpt               │
│ subject_ref           │       └──────────────────────┘
│ predicate             │
│ object_value          │       ┌──────────────────────┐
│ object_json (JSONB)   │       │    fact_conflict      │
│ status                │       │──────────────────────│
│ confidence            │       │ existing_fact_id(FK)  │
│ supersedes_fact_id(FK)│       │ incoming_fact_id(FK)  │
│ metadata (JSONB)      │       │ conflict_reason       │
└──────────────────────┘       │ resolution_status     │
                               │ metadata (JSONB)      │
                               │ resolved_at           │
                               └──────────────────────┘
```

### 3.4 文档与 Artifact 模块

```
┌──────────────────────┐
│      document         │
│──────────────────────│
│ id (PK)              │
│ owner_user_id (FK)   │
│ scope_type            │
│ title                 │
│ current_version_id    │
└──────┬───────────────┘
       │ 1──N
       ▼
┌──────────────────────┐
│   document_version    │
│──────────────────────│
│ id (PK)              │
│ document_id (FK)     │
│ version               │
│ storage_ref           │
│ content_hash          │
│ mime_type             │
└──────┬───────────────┘
       │ 1──N
       ▼
┌──────────────────────┐
│   document_chunk      │
│──────────────────────│
│ id (PK)              │
│ document_version_id   │
│ chunk_index           │
│ content_excerpt       │
│ token_count           │
│ embedding vector(1536)│  ← HNSW index
│ search_tsv tsvector   │  ← GIN index
└──────────────────────┘

┌──────────────────────┐
│   artifact_object     │       ┌──────────────────────┐
│──────────────────────│       │   retrieval_trace     │
│ workflow_instance_id  │       │──────────────────────│
│ workflow_stage_id     │       │ workflow_instance_id  │
│ execution_session_id  │       │ workflow_stage_id     │
│ owner_user_id (FK)   │       │ query_text            │
│ artifact_type         │       │ intent_type           │
│ storage_backend       │       │ scope_summary (JSONB) │
│ storage_ref           │       │ step_trace_json       │
│ content_hash          │       │ evidence_pack_hash    │
│ content_size          │       └──────────────────────┘
│ mime_type             │
│ summary               │
│ status                │
│ sensitivity_level     │
└──────────────────────┘
```

### 3.5 记忆与技能模块

```
┌──────────────────────┐
│   hermes_memory       │  ← 会话记忆 (热存储)
│──────────────────────│
│ id (PK)              │
│ owner_user_id (TEXT) │
│ org_id (FK→org)      │
│ session_id            │
│ role                  │  ('user'/'assistant'/'system')
│ content               │
│ token_count           │
│ metadata (JSONB)      │
│ created_at            │
└──────────────────────┘

┌──────────────────────┐
│     memory_item       │       ┌──────────────────────┐
│──────────────────────│       │    memory_source      │
│ id (PK)              │ 1──N  │──────────────────────│
│ owner_user_id (FK)   │◄──────│ memory_item_id (FK)  │
│ org_id (FK)          │       │ source_type           │
│ scope_type            │       │ source_ref            │
│ memory_type           │       │ relevance_score       │
│ content_text          │       │ metadata (JSONB)      │
│ summary               │       └──────────────────────┘
│ embedding vector(1536)│
│ confidence            │       ┌──────────────────────┐
│ status                │       │  memory_usage_log     │
│ metadata (JSONB)      │       │──────────────────────│
└──────────────────────┘       │ memory_item_id (FK)   │
                               │ workflow_instance_id  │
                               │ usage_type            │
                               │ relevance_score       │
                               │ metadata (JSONB)      │
                               └──────────────────────┘

┌──────────────────────┐
│        skill          │       ┌──────────────────────┐
│──────────────────────│ 1──N  │    skill_version     │
│ id (PK)              │◄──────│ skill_id (FK)        │
│ owner_user_id (FK)   │       │ version               │
│ org_id (FK)          │       │ definition_json(JSONB)│
│ scope_type            │       │ content_hash          │
│ skill_name            │       │ status                │
│ description           │       │ metadata (JSONB)      │
│ skill_type            │       └──────┬───────────────┘
│ status                │              │ 1──N
│ metadata (JSONB)      │              ▼
└──────────────────────┘       ┌──────────────────────┐
                               │    skill_source      │
                               │──────────────────────│
                               │ skill_version_id(FK) │
                               │ source_type           │
                               │ source_uri            │
                               │ content_text          │
                               │ metadata (JSONB)      │
                               └──────────────────────┘
```

### 3.5b 梦境模式与记忆分析模块

```
┌──────────────────────┐
│  dream_mode_config    │  ← 梦境模式配置 (per user/org)
│──────────────────────│
│ id (PK)              │
│ owner_user_id (FK)   │
│ org_id (FK)          │
│ enabled               │
│ schedule_cron         │  ← cron 表达式
│ analysis_depth        │
│ last_run_at           │
│ metadata (JSONB)      │
└──────┬───────────────┘
       │ 1──N
       ▼
┌──────────────────────┐
│  memory_analysis_run  │  ← 分析运行记录
│──────────────────────│
│ id (PK)              │
│ owner_user_id (FK)   │
│ org_id (FK)          │
│ status                │  ('pending'/'running'/'completed'/'failed')
│ started_at            │
│ finished_at           │
│ summary (JSONB)       │
│ metadata (JSONB)      │
└──────┬───────────────┘
       │ 1──N
       ▼
┌──────────────────────┐
│  org_memory_summary   │  ← 记忆摘要结果
│──────────────────────│
│ id (PK)              │
│ analysis_run_id (FK) │
│ org_id (FK)          │
│ memory_type           │
│ content_text          │
│ relevance_score       │
│ embedding vector(1536)│
│ metadata (JSONB)      │
└──────────────────────┘

┌──────────────────────┐       ┌──────────────────────┐
│  memory_access_log    │       │ memory_compression_log│
│──────────────────────│       │──────────────────────│
│ id (PK)              │       │ id (PK)              │
│ memory_item_id (FK)  │       │ owner_user_id (FK)   │
│ workflow_instance_id  │       │ org_id (FK)          │
│ access_type           │       │ compression_type     │
│ duration_ms           │       │ items_before         │
│ metadata (JSONB)      │       │ items_after          │
└──────────────────────┘       │ metadata (JSONB)      │
                               └──────────────────────┘
```

### 3.5c 技能治理与评估模块

```
┌──────────────────────┐
│  skill_audit_record   │  ← 技能审核记录
│──────────────────────│
│ id (PK)              │
│ skill_id (FK)        │
│ skill_version_id (FK)│
│ org_id (FK)          │
│ reviewer_user_id (FK)│
│ status                │  ('pending'/'approved'/'rejected')
│ comment               │
│ metadata (JSONB)      │
│ created_at            │
└──────────────────────┘

┌──────────────────────┐
│  skill_usage_stats    │  ← 技能使用统计
│──────────────────────│
│ id (PK)              │
│ skill_id (FK)        │
│ org_id (FK)          │
│ user_id (FK)         │
│ workflow_instance_id  │
│ usage_count           │
│ success_rate          │
│ avg_duration_ms       │
│ metadata (JSONB)      │
└──────────────────────┘

┌──────────────────────┐
│  org_skill_registry   │  ← 组织技能注册表
│──────────────────────│
│ id (PK)              │
│ org_id (FK)          │
│ skill_id (FK)        │
│ status                │  ('active'/'inactive'/'deprecated')
│ metadata (JSONB)      │
└──────────────────────┘

┌──────────────────────┐
│ scene_value_assessment│  ← 场景价值评估
│──────────────────────│
│ id (PK)              │
│ org_id (FK)          │
│ skill_id (FK)         │
│ scene_name            │
│ value_score           │
│ usage_frequency       │
│ metadata (JSONB)      │
│ assessed_at           │
└──────────────────────┘
```

### 3.6 AGE 图投影模块

```
┌──────────────────────┐
│  projection_event     │  ← 待同步的变更事件队列
│──────────────────────│
│ id (PK)              │
│ graph_name            │
│ vertex_label          │
│ edge_label            │
│ operation             │  ('insert'/'update'/'delete')
│ entity_ref            │
│ payload (JSONB)       │
│ applied               │
│ applied_at            │
└──────────────────────┘
         │
         │ BullMQ Worker 消费
         ▼
┌──────────────────────────────────────────────┐
│              Apache AGE 图投影               │
│──────────────────────────────────────────────│
│ Vertex:  entity_vertex / workflow_vertex    │
│          / skill_vertex                      │
│ Edge:    relation_edge / stage_edge          │
│          / evidence_edge                     │
│                                              │
│ 约束: max_hops ≤ 2                          │
│ 重建: MATCH (n) DETACH DELETE n + re-insert │
└──────────────────────────────────────────────┘
```

### 3.7 审计、文件与资源管理模块

```
┌──────────────────────┐
│     audit_event       │
│──────────────────────│
│ id (PK)              │
│ user_id (FK→user)   │
│ workflow_instance_id  │
│ action                │
│ resource_type         │
│ resource_ref          │
│ resource_scope        │
│ result                │  ('success'/'failure')
│ detail_json (JSONB)   │
│ occurred_at           │
│ ip_address            │
│ user_agent            │
└──────────────────────┘

┌──────────────────────┐       ┌──────────────────────┐
│      org_task         │       │ org_task_assignment  │
│──────────────────────│       │──────────────────────│
│ org_id (FK→org)     │       │ task_id (FK→org_task)│
│ task_type             │       │ user_id              │
│ status                │       │ assigned_role         │
│ due_date              │       └──────────────────────┘
└──────────────────────┘

┌──────────────────────┐
│      user_file        │  ← 用户文件存储 (MinIO)
│──────────────────────│
│ id (PK)              │
│ owner_user_id (FK)   │
│ org_id (FK)          │
│ filename              │
│ storage_ref           │
│ mime_type             │
│ file_size             │
│ content_hash          │
│ is_shared             │
│ metadata (JSONB)      │
│ created_at            │
└──────────────────────┘

┌──────────────────────┐       ┌──────────────────────┐
│   resource_quota      │       │   resource_usage     │
│──────────────────────│       │──────────────────────│
│ id (PK)              │       │ id (PK)              │
│ org_id (FK)          │       │ org_id (FK)          │
│ resource_type         │       │ resource_type         │
│ daily_limit           │       │ usage_count          │
│ monthly_limit         │       │ usage_date           │
│ metadata (JSONB)      │       │ metadata (JSONB)      │
└──────────────────────┘       └──────────────────────┘

┌──────────────────────┐
│ service_status_event  │  ← 服务状态变更历史
│──────────────────────│
│ id (PK)              │
│ service_name          │
│ status                │  ('healthy'/'degraded'/'down')
│ detail_json (JSONB)   │
│ occurred_at           │
└──────────────────────┘
```

---

## 4. 工作流状态机 (13 状态 + 完整迁移矩阵)

```
                         ┌───────────┐
                    ┌───►│  archived │◄──────────────────────────┐
                    │    └───────────┘                           │
                    │          ▲                                 │
                    │          │ ARCHIVE                         │
                    │    ┌─────┴─────┐  ┌──────────┐  ┌────────┐│
                    │    │ succeeded │  │  failed  │  │cancelled│
                    │    └─────▲─────┘  └────▲─────┘  └───▲────┘│
                    │          │             │            │      │
                    │     ┌────┴────┐        │            │      │
                    │     │reporting│        │            │      │
                    │     └────▲────┘        │            │      │
                    │          │             │            │      │
                    │     ┌────┴────┐        │            │      │
                    │     │verifying│◄───┐   │            │      │
                    │     └────▲────┘    │   │            │      │
                    │          │     ┌───┴───┴┐           │      │
                    │          │     │repairing│          │      │
                    │          │     └───▲────┘           │      │
                    │     ┌────┴────┐    │                │      │
                    │     │ running │◄───┘                │      │
                    │     └──┬─┬─┬─┘                     │      │
                    │        │ │ │  ┌──────────┐         │      │
                    │    ┌───┘ │ └─►│  paused  │─────────┘      │
                    │    │     │    └────▲─────┘                │
                    │    │     │         │                      │
                    │    │     │    ┌────┴─────┐                │
                    │    │     └───►│ blocked  │                │
                    │    │          └────▲─────┘                │
                    │    │               │                      │
                    │    │          ┌────┴────────┐             │
                    │    └─────────►│waiting_user │             │
                    │               └────▲────────┘             │
                    │                    │                      │
                    │              ┌─────┴─────┐                │
                    │              │  planned  │                │
                    │              └─────▲─────┘                │
                    │                    │                      │
                    │              ┌─────┴─────┐                │
                    └──────────────│   draft   │                │
                                   └───────────┘                │
                                                                │
              终态(succeeded/failed/cancelled) ─────────────────┘
```

### 状态迁移规则矩阵

| 从 | 到 | 事件 | 触发源 |
|----|----|------|--------|
| `draft` | `planned` | PLAN | workflow-service `/internal/workflows/plan` |
| `planned` | `running` | DISPATCH | workflow-service `/dispatch` → executor `/dispatch` |
| `running` | `verifying` | VERIFY | stage 完成, stage_type=Verification |
| `verifying` | `repairing` | REPAIR | 验证失败, repair_budget > 0 |
| `repairing` | `verifying` | VERIFY | 修复完成, 重新验证 |
| `verifying` | `reporting` | REPORT | 验证通过 |
| `reporting` | `running` | NEXT | 还有下一阶段, 继续执行 |
| `reporting` | `succeeded` | SUCCEED | 所有阶段完成 |
| `running` | `waiting_user` | WAIT_USER | 需要用户输入/审批 |
| `running` | `blocked` | BLOCK | 外部依赖不可用 |
| `running` | `paused` | PAUSE | 用户主动暂停 |
| `paused` | `running` | RESUME | 用户恢复 |
| `running/verifying/repairing` | `failed` | FAIL | 不可恢复失败 |
| `planned/running/waiting_user/blocked/paused` | `cancelled` | CANCEL | 用户取消 |
| `succeeded/failed/cancelled` | `archived` | ARCHIVE | 24h 后自动或手动 |

---

## 5. 核心故事线 (数据流)

### 5.1 Chat 消息全链路

```
用户发消息(飞书)
  │
  ▼
[feishu-longconn] ──WebSocket──► [飞书服务器]
  │
  │ HTTP POST /channels/feishu/longconn/event (body: event + message)
  ▼
[gateway-adapter] handleFeishuEvent()
  │
  ├─ 1. 立即返回 200 OK
  │
  ├─ 2. normalizeMessage()  → 提取 text, chat_id, session_hint
  │
  ├─ 3. resolveIdentity()   → [identity-resolver]
  │     ├─ 查 channel_identity 表 (channel_type + external_identity)
  │     ├─ 不存在则 INSERT user + INSERT channel_identity (binding_status=bound)
  │     └─ 返回: { owner_user_id, identity_binding_state, session_id }
  │
  ├─ 4. classifyIntentWithLLM(text)
  │     └─ POST LiteLLM /chat/completions → { is_task: false }
  │
  ├─ 5. [chat 路径]
  │     ├─ recallContext(user, session)
  │     │   └─ POST hermes /internal/memory/recall
  │     │       └─ 查 memory_item (embedding 相似度 + owner+session 过滤)
  │     │           └─ 返回: { context: "压缩后的历史摘要" }
  │     │
  │     ├─ generateChatReply(text, context)
  │     │   └─ POST LiteLLM /chat/completions (带 system prompt + 历史上下文)
  │     │       └─ 返回: { text: "AI 回复" }
  │     │
  │     ├─ rememberContext(user, session, 'user', text)        ──┐
  │     ├─ rememberContext(user, session, 'assistant', reply)  ──┤
  │     │   └─ POST hermes /internal/memory                     │ (fire & forget)
  │     │       └─ INSERT memory_item + embedding                │
  │     │                                                        │
  │     └─ sendFeishuTextReply(chat_id, reply)
  │         └─ POST 飞书 API /im/v1/messages (reply)
  │
  └─ 用户收到回复
```

### 5.2 Task 消息全链路 (含轮询)

```
用户发任务消息(飞书)
  │
  ▼
[gateway-adapter] ... (步骤 1-4 同上, classifyIntent → is_task: true)
  │
  ├─ 5. [task 路径]
  │     ├─ 检查 identity_binding_state === 'bound'
  │     │   └─ 否则返回 "请先完成身份绑定"
  │     │
  │     ├─ 检查 org 限额 (每日 workflow 创建上限)
  │     │   └─ SELECT count(*) FROM audit_event
  │     │       WHERE action='workflow.create' AND date=today
  │     │
  │     ├─ POST workflow-service /internal/workflows/plan
  │     │   └─ [workflow-planner].plan(input)
  │     │       └─ POST LiteLLM (System Prompt: Planner 契约)
  │     │           └─ 返回 WorkflowPlan { stage_chain: [...], plan_hash }
  │     │               └─ plan-validator 校验:
  │     │                   seq 连续? stage_key 唯一? executor 合法?
  │     │                   └─ INSERT workflow_instance + workflow_stage[]
  │     │                       └─ INSERT audit_event (workflow.create)
  │     │
  │     ├─ POST workflow-service /internal/workflows/{ref}/dispatch
  │     │   └─ [workflow-service]
  │     │       ├─ policyManager.checkPermission(owner, role, resource, action)
  │     │       │   └─ 查 policy_snapshot → allowed_scopes + constraints
  │     │       │
  │     │       ├─ POST executor-gateway /internal/executor/dispatch
  │     │       │   └─ [executor-gateway]
  │     │       │       ├─ 生成 runRef
  │     │       │       ├─ 立即返回 { dispatch_status: 'accepted', runRef }
  │     │       │       └─ 异步: autoExecuteWorkflowStages(workflowRef, runRef)
  │     │       │           └─ 见 §5.3
  │     │       │
  │     │       ├─ workflow.stages[0].status = 'running'
  │     │       └─ INSERT audit_event (workflow.dispatch)
  │     │
  │     ├─ sendFeishuTextReply("✅ 已受理, 任务编号: wf_xxx")
  │     │
  │     └─ void pollAndReplyWorkflowResult(workflowRef, targets)  ← fire & forget
  │
  └─ [后台轮询] pollAndReplyWorkflowResult
       │
       ├─ 每 10s, 最多 72 次 (720s 超时, 由 WORKFLOW_POLL_MAX_ITERATIONS 控制)
       │
       ├─ GET workflow-service /internal/workflows/{ref}
       │   └─ 返回 { workflow: { status, stages: [...] } }
       │
       ├─ status === 'succeeded'/'failed'/'cancelled'
       │   └─ sendFeishuTextReply("✅/❌ 任务完成/失败")
       │       └─ 停止轮询
       │
       ├─ status === 'waiting_user'
       │   └─ sendFeishuTextReply("⏳ 需要您的输入")
       │       └─ 停止轮询
       │
       └─ 超时 300s
           └─ sendFeishuTextReply("⏳ 仍在执行中...")
```

### 5.3 执行器阶段自动执行流程

```
[executor-gateway] autoExecuteWorkflowStages(workflowRef, runRef)
  │
  ├─ 1. GET workflow-service /internal/workflows/{ref}
  │     └─ 获取 plan.stage_chain[] + plan.goal.user_goal
  │
  ├─ 2. 提取 user_goal (优先 plan.goal.user_goal, 而非 plan.goal)
  │     └─ 修复: 避免 [object Object]
  │
  ├─ 3. 遍历 stage_chain (只处理 status=running/pending 的阶段)
  │     │
  │     ├─ 选择 executor (按 stage.assigned_executor):
  │     │   generic-executor            → genericExecutor
  │     │   retrieval-aware-executor    → retrievalAwareExecutor
  │     │   approval-executor           → approvalExecutor
  │     │   code-executor               → codeExecutor
  │     │   verification-executor       → verificationExecutor
  │     │   repair-executor             → repairExecutor
  │     │
  │     ├─ executor.execute({
  │     │     workflow_instance_id,
  │     │     workflow_stage_id,
  │     │     stage,         ← 完整的 stage DSL 契约
  │     │     user_goal,
  │     │     context,       ← { owner_user_id, run_ref }
  │     │     policy_hash
  │     │   })
  │     │   │
  │     │   ├─ [genericExecutor]
  │     │   │   └─ POST LiteLLM /chat/completions
  │     │   │       └─ 可选: 调用 fact-retrieval /entities/write, /facts/write
  │     │   │
  │     │   ├─ [codeExecutor]
  │     │   │   └─ POST LiteLLM /chat/completions (code model)
  │     │   │       └─ 工具调用: file_read, file_write, shell_exec, git_ops, test_runner
  │     │   │           └─ 产出 patch artifact
  │     │   │
  │     │   ├─ [retrievalAwareExecutor]
  │     │   │   └─ POST fact-retrieval /internal/retrieval/query
  │     │   │       └─ 向量检索 (document_chunk + memory_item)
  │     │   │       └─ 图检索 (AGE Cypher, max_hops≤2)
  │     │   │           └─ 返回 EvidencePack
  │     │   │
  │     │   ├─ [verificationExecutor]
  │     │   │   └─ 运行测试/规则校验 → 返回 { pass/fail, metrics }
  │     │   │
  │     │   └─ [repairExecutor]
  │     │       └─ 分析失败原因 → 生成修复 patch → 最多 max_repairs 次
  │     │
  │     └─ 上报结果:
  │         POST workflow-service /internal/workflows/{ref}/stages/{sid}/dispatch
  │         └─ [workflow-service]
  │             ├─ 更新 stage.status = result.status
  │             ├─ 更新 stage.last_output_preview
  │             ├─ 更新 stage.verification_meta
  │             ├─ workflowSupervisor.recordHeartbeat() → 心跳记录
  │             ├─ 根据 stage.status 发送状态机事件:
  │             │   completed → VERIFY/REPORT
  │             │   failed    → FAIL
  │             │   waiting_user → WAIT_USER
  │             │   blocked   → BLOCK
  │             │   verifying → VERIFY
  │             │   repairing → REPAIR
  │             │   paused    → PAUSE
  │             ├─ INSERT checkpoint (stage-exit)
  │             ├─ INSERT audit_event
  │             │
  │             └─ 若 completed: 找下一个 stage (seq+1)
  │                 └─ 设置其 status = 'running'
  │                     └─ 状态不再由 executor-gateway 管理
  │                         而是由 workflow 自行推入下一阶段
  │                         (注意: 当前实现由 executor-gateway 循环驱动)
  │
  ├─ 4. 全部阶段完成后:
  │     POST workflow-service /internal/workflows/{ref}/complete
  │     └─ [workflow-service]
  │         ├─ 检查是否还有 unresolved stages
  │         ├─ 发送 COMPLETE 事件 → 状态机: running→verifying→reporting→succeeded
  │         ├─ INSERT audit_event (workflow.completed)
  │         └─ workflowSupervisor.unregister(workflowRef)
  │
  └─ 5. 返回 / 轮询通知
```

### 5.4 自修复 (Repair) 决策树

```
阶段执行失败
  │
  ├─ 1. 分类错误:
  │   ├─ Transient (可重试):    重试 < max_retries → 重试
  │   │                         重试 ≥ max_retries → 进入修复评估
  │   ├─ Permanent (不可重试):  直接进入修复评估
  │   └─ System (系统级):       进入 blocked, 等待恢复
  │
  ├─ 2. 修复评估:
  │   ├─ 可修复 (代码错误/测试失败)
  │   │   ├─ 修复次数 < max_repairs → Repair Stage
  │   │   ├─ 修复次数 ≥ max_repairs → waiting_user
  │   │   └─ 连续 3 次修复失败       → waiting_user (止损)
  │   ├─ 需要用户输入               → waiting_user
  │   └─ 不可修复 (权限/资源)       → failed
  │
  └─ 3. 修复后评估:
      ├─ 成功       → 继续原计划
      ├─ 部分成功   → 调整后续计划
      └─ 失败       → 回到步骤 2
```

---

## 6. 服务调用关系矩阵

### 6.1 服务间 HTTP 调用

```
调用方                 被调用方           端点                                  证据文件:行
──────────────────────────────────────────────────────────────────────────────────────────
gateway-adapter  →  hermes-adapter     POST /internal/memory                    index.ts:314
gateway-adapter  →  hermes-adapter     POST /internal/memory/recall              index.ts:329
gateway-adapter  →  workflow-service   POST /internal/workflows/plan             index.ts:467
gateway-adapter  →  workflow-service   POST /internal/workflows/{}/dispatch      index.ts:483
gateway-adapter  →  workflow-service   GET  /internal/workflows/{}               index.ts:850 (轮询)
gateway-adapter  →  skill-library      POST /internal/skills/create             index.ts (技能提取)
gateway-adapter  →  resource-scheduler   GET  /internal/quotas                    index.ts (限额检查)
gateway-adapter  →  LiteLLM            POST /chat/completions (意图分类)          index.ts:211
gateway-adapter  →  LiteLLM            POST /chat/completions (Chat 回复)         index.ts:343
gateway-adapter  →  飞书 API           POST /im/v1/messages                      index.ts:805
gateway-adapter  →  飞书 API           POST /auth/v3/tenant_access_token          index.ts:757

workflow-service →  executor-gateway   POST /internal/executor/dispatch          index.ts:489
workflow-service →  LiteLLM            POST /chat/completions (Planner)          planner.ts

executor-gateway →  workflow-service   GET  /internal/workflows/{}               index.ts:279
executor-gateway →  workflow-service   POST /internal/workflows/{}/stages/{}/dispatch  index.ts:340
executor-gateway →  workflow-service   POST /internal/workflows/{}/complete      index.ts:384
executor-gateway →  fact-retrieval     POST /internal/retrieval/query            retrieval-aware-executor.ts:39
executor-gateway →  fact-retrieval     POST /internal/facts/write                generic-executor.ts:470
executor-gateway →  fact-retrieval     POST /internal/entities/write             generic-executor.ts:433
executor-gateway →  LiteLLM            POST /chat/completions (各 executor)      各 executor

fact-retrieval   →  PostgreSQL         (直接 DB 读写)                             service.ts

hermes-adapter   →  fact-retrieval     POST /internal/facts/write                index.ts:211
hermes-adapter   →  PostgreSQL         (直接 DB 读写)                             index.ts

web-portal       →  workflow-service   (内部 API)                                 index.ts
web-portal       →  skill-library      (技能 CRUD / 审核 / 注册)                   index.ts
web-portal       →  resource-scheduler   (配额管理 / 使用统计)                    index.ts
web-portal       →  PostgreSQL         (直接 DB 查询)                             index.ts

skill-library    →  PostgreSQL         (直接 DB 读写)                             index.ts

resource-scheduler→ PostgreSQL         (直接 DB 读写)                             index.ts

mobile-app       →  PostgreSQL         (直接 DB 查询)                             index.ts
mobile-app       →  gateway-adapter    (通知触发回调)                              index.ts

feishu-longconn  →  gateway-adapter    POST /channels/feishu/longconn/event      外部转发
feishu-longconn  →  飞书 API           WebSocket 长连接                             index.ts
```

### 6.2 服务→数据表读写矩阵

```
表名                          gateway  workflow  executor  fact-ret  hermes   web      skill-lib  resource  mobile  feishu
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
channel_identity               R/W       -         -         R         -        R        -          -         -       R
user                           R/W       R         R         R/W       R        R/W      R          R         R       -
organization                   R         R         -         -         -        R/W      -          R         -       -
policy_snapshot                R         R/W       R         -         -        R/W      -          -         -       -
org_policy                     R         R         -         -         -        R/W      -          -         -       -

workflow_definition            -         R/W       -         -         -        R        -          -         -       -
workflow_instance              R (轮询)  R/W       R         -         -        R        -          -         -       -
workflow_stage                 R (轮询)  R/W       R/W       -         -        R        -          -         -       -
checkpoint                     -         W         R         -         -        -        -          -         -       -
workflow_event                 -         W         -         -         -        -        -          -         -       -
execution_session              -         -         R/W       -         -        -        -          -         -       -

document                       -         -         -         R/W       -        -        -          -         -       -
document_version               -         -         -         R/W       -        -        -          -         -       -
document_chunk                 -         -         -         R/W       -        -        -          -         -       -

entity                         -         -         R         R/W       -        -        -          -         -       -
entity_attribute               -         -         -         R/W       -        -        -          -         -       -
relation                       -         -         -         R/W       -        -        -          -         -       -

fact                           -         -         R/W       R/W       R/W      -        -          -         -       -
fact_evidence                  -         -         -         R/W       R        -        -          -         -       -
fact_conflict                  -         -         -         R/W       -        -        -          -         -       -

hermes_memory                  R         -         -         -         R/W      -        -          -         -       -
memory_item                    -         -         -         -         R/W      -        -          -         -       -
memory_source                  -         -         -         -         R/W      -        -          -         -       -
memory_usage_log               -         -         -         -         W        -        -          -         -       -
memory_access_log              -         -         -         -         W        R        -          -         -       -
memory_compression_log         -         -         -         -         W        R        -          -         -       -
memory_analysis_run            -         -         -         -         -        R/W      -          -         -       -
org_memory_summary             -         -         -         -         -        R/W      -          -         -       -
dream_mode_config              -         -         -         -         -        R/W      -          -         -       -

skill / skill_version          -         -         -         -         R/W      R        R/W        -         -       -
skill_source                   -         -         -         -         R/W      -        R/W        -         -       -
skill_audit_record             -         -         -         -         -        R/W      R/W        -         -       -
skill_usage_stats              -         -         -         -         -        R        W          -         -       -
org_skill_registry             -         -         -         -         -        R/W      R/W        -         -       -
scene_value_assessment         -         -         -         -         -        R/W      R          -         -       -

artifact_object                -         -         W         R/W       -        -        -          -         -       -
retrieval_trace                -         -         -         R/W       -        R        -          -         -       -
projection_event               -         -         -         R/W       -        -        -          -         -       -

user_file                      -         -         -         -         -        R/W      -          -         R       -

resource_quota                 R         R         -         -         -        R/W      -          R/W       -       -
resource_usage                 -         R         -         -         -        R/W      -          R/W       -       -

audit_event                    W         W         W         W         W        R        W          W         W       -
org_task / org_task_assignment -         -         -         -         -        R/W      -          -         -       -
service_status_event           -         -         -         -         -        R        -          W         -       -
```

> R=Read, W=Write, R/W=Read+Write

---

## 7. 执行器类型与阶段映射

| Stage Type | 默认 Executor | Subagent 类型 | 主要操作 |
|------------|---------------|---------------|---------|
| `IntentClarification` | `generic-executor` | generic-subagent | 分析意图、确认缺口 |
| `PlanGeneration` | `generic-executor` | generic-subagent | 生成阶段性计划 |
| `EvidenceRetrieval` | `retrieval-aware-executor` | retrieval-subagent | 多轮检索直到召回足够 |
| `MemoryRetrieval` | `retrieval-aware-executor` | retrieval-subagent | 经验/偏好检索 |
| `ObjectExtraction` | `generic-executor` | generic-subagent | 结构化抽取 |
| `ArchitectureDesign` | `generic-executor` | generic-subagent | 架构/方案/设计 |
| `SpecGeneration` | `generic-executor` | generic-subagent | 规格文档生成 |
| `DecisionMaking` | `generic-executor` | generic-subagent | 综合分析决策 |
| `Implementation` | `code-executor` | code-subagent | 文件读写/Shell/Git/测试 |
| `Verification` | `verification-executor` | verification-subagent | 规则校验/测试结果判断 |
| `Repair` | `repair-executor` | repair-subagent | 分析失败→生成修复 patch |
| `Approval` | `approval-executor` | generic-subagent | 等待用户确认 |
| `ResultReporting` | `generic-executor` | generic-subagent | 汇报/总结/交付 |
| `SkillExtraction` | `generic-executor` | generic-subagent | 提取可复用经验 |
| `DreamSummarization` | `generic-executor` | generic-subagent | 经验总结归纳 |
| `Archive` | `generic-executor` | generic-subagent | 落归档与后处理 |

---

## 8. Workflow 类型模板

### 8.1 Development 模板 (9 阶段)

```
IntentClarification → PlanGeneration → EvidenceRetrieval
    → ArchitectureDesign/SpecGeneration → Implementation
    → Verification → (Repair ↻ Verification)
    → ResultReporting → Archive
    → (可选) SkillExtraction / DreamSummarization
```

### 8.2 Knowledge 模板 (6 阶段)

```
IntentClarification → EvidenceRetrieval → ObjectExtraction
    → DecisionMaking → ResultReporting → Archive
```

### 8.3 Analysis 模板 (6 阶段)

```
IntentClarification → EvidenceRetrieval
    → ArchitectureDesign/DecisionMaking → Verification
    → ResultReporting → Archive
```

### 8.4 Dream 模式模板 (离线分析)

```
DreamSummarization → EvidenceRetrieval → ObjectExtraction
    → DecisionMaking → ResultReporting → Archive
    → (可选) SkillExtraction
```

---

## 9. 文档权威源映射 (L0/L1/L2 分层)

```
┌─────────────────────────────────────────────────────────────┐
│ L0-Authority (权威定义层, 单一事实源)                         │
│─────────────────────────────────────────────────────────────│
│ AH1-14  →  数据库表设计与索引      → DO-ALL (物理 schema)    │
│ AH1-15  →  核心接口与事件契约      → DO-03 (ApiContract)     │
│ AH1-16  →  权限/Scope/Policy       → DO-02 (PolicySnapshot) │
│ AH1-17  →  Workflow DSL/Planner    → DO-01 (WorkflowLife.)  │
│ AH1-18  →  Executor/执行会话       → DO-04 (ExecutionSess.) │
│ AH1-19  →  Checkpoint/Resume       → DO-05 (Checkpoint)     │
│ AH1-20  →  检索编排/Fact-Write     → DO-06 (RetrievalFact)  │
│ AH1-21  →  渠道接入/Session映射    → DO-03 (ApiContract)    │
│ AH1-22  →  Artifact/Object存储     → DO-07 (Artifact)       │
│ AH1-23  →  审计/日志/告警          → DO-08 (Audit)          │
│ AH1-26  →  Provider选择            → DO-09 (Provider)       │
│ AH1-28  →  配置管理                → DO-10 (Config)         │
│ AH1-31  →  错误处理/降级           → DO-11 (Error)          │
│ AH1-32  →  API版本管理             → DO-12 (Version)        │
├─────────────────────────────────────────────────────────────┤
│ L1-Execution (开发执行层)                                    │
│─────────────────────────────────────────────────────────────│
│ DEV-01  →  M0 开发准备                                      │
│ DEV-02  →  M1 接入层 + Workflow 主链路                       │
│ DEV-03  →  M2 事实层检索主链路                               │
│ DEV-04  →  M3 Code Executor 集成                            │
│ DEV-05  →  M4 Hermes 增强接入                               │
│ DEV-06  →  M5 容量验证收口                                  │
│ DEV-07  →  主仓库骨架结构                                    │
├─────────────────────────────────────────────────────────────┤
│ L2-Governance (计划与验收层)                                 │
│─────────────────────────────────────────────────────────────│
│ AH1-24  →  PoC 压测执行方案                                  │
│ AH1-25  →  研发里程碑与任务拆解                              │
│ AH1-29  →  交付物清单                                       │
│ AH1-30  →  验收标准与测试用例                                │
│ AH1-33  →  文档关系与一致性清单                              │
│ AH1-34  →  安全架构增强                                     │
│ AH1-35  →  版本管理规范                                     │
│ AH1-37  →  架构审计报告                                     │
│ AH1-38  →  文档审计报告                                     │
└─────────────────────────────────────────────────────────────┘

规则:
- 实现判断必须回到 L0 (契约/状态机/权限/错误码)
- L1 与 L0 冲突时, 按 L0 修正 L1
- L2 仅做治理与审计, 不承载运行时契约
```

---

## 10. 关键文件索引 (代码级)

| 文件 | 核心职责 | 关键函数/类 |
|------|---------|------------|
| `apps/gateway-adapter/src/index.ts` | 多渠道消息入口, Chat/Task 分发, 轮询 | `handleFeishuEvent`, `processIncomingText`, `pollAndReplyWorkflowResult` |
| `apps/gateway-adapter/src/services/identity-resolver.ts` | 身份解析与自动绑定 | `resolveIdentity` (查+创建+绑定) |
| `services/workflow/src/index.ts` | CRUD, plan/dispatch/stage/complete | 所有 `/internal/workflows/*` 端点 |
| `services/workflow/src/planner/planner.ts` | LLM 规划器 | `workflowPlanner.plan()` |
| `services/workflow/src/planner/plan-validator.ts` | 计划校验 | stage chain 合法性检查 |
| `services/workflow/src/engine/workflow-machine.ts` | XState 状态机 | 13 状态 + 迁移规则 |
| `services/workflow/src/supervisor/manager.ts` | 心跳监控 | `recordHeartbeat`, `checkTimeout` |
| `services/workflow/src/persistence/db.ts` | 数据库持久化 | 工作流相关表 CRUD |
| `services/executor-gateway/src/index.ts` | 执行调度, 自动阶段执行 | `autoExecuteWorkflowStages` |
| `services/executor-gateway/src/executor/generic-executor.ts` | 通用执行器 | `genericExecutor.execute()` |
| `services/executor-gateway/src/executor/code-executor.ts` | 代码执行器 | `codeExecutor.execute()` |
| `services/executor-gateway/src/executor/retrieval-aware-executor.ts` | 检索感知执行器 | 调用 fact-retrieval 服务 |
| `services/executor-gateway/src/executor/verification-executor.ts` | 验证执行器 | 规则校验/测试判断 |
| `services/executor-gateway/src/executor/repair-executor.ts` | 修复执行器 | 失败分析 + patch 生成 |
| `services/executor-gateway/src/executor/approval-executor.ts` | 审批执行器 | 等待用户确认 |
| `services/fact-retrieval/src/index.ts` | 事实检索入口 | documents/index, retrieval/query, facts/write |
| `services/fact-retrieval/src/service.ts` | 核心检索逻辑 | 向量检索 + 图检索 + 重排序 |
| `services/hermes-adapter/src/index.ts` | 记忆管理 | memory/memory/recall/clear, context/compress |
| `services/skill-library/src/index.ts` | 技能库管理 | 技能 CRUD, 审核, 搜索, 注册表 |
| `services/resource-scheduler/src/index.ts` | 资源配额调度 | 配额管理, 使用统计, 巡检 |
| `apps/mobile-app/src/index.ts` | 移动端通知服务 | 设备注册, 推送通知, 历史查询 |
| `services/feishu-longconn/src/index.ts` | 飞书长连接网关 | WebSocket 事件转发 |
| `apps/web-portal/src/index.ts` | Web 管理后台 | 全量管理 API |
| `libs/shared/src/db/schema.ts` | 数据库 Schema (47表) | 所有 pgTable 定义 |
| `libs/shared/src/ai/embedding.ts` | 向量嵌入 | embedding 生成 |
| `libs/policy/src/manager.ts` | 策略管理器 | `checkPermission` |
| `libs/shared/src/config/manager.ts` | 配置管理器 | 环境变量加载 |
| `libs/shared/src/monitoring/health.ts` | 健康检查 | 各服务 `/health` 端点 |
| `libs/shared/src/monitoring/log-aggregator.ts` | 日志聚合 | 结构化日志输出 |
| `libs/shared/src/metrics/metrics.ts` | 指标收集 | OpenTelemetry metrics |
| `libs/contracts/events/types.ts` | 事件类型定义 | 事件信封结构 |

---

## 11. 任务级上下文加载策略

### 11.1 按任务加载的最小上下文包

| 任务场景 | 必读权威文档 | 必读代码文件 | 可选补充 |
|---------|-------------|-------------|---------|
| **M1: 接入层+Workflow** | AH1-21, AH1-15, AH1-16, AH1-17 | gateway-adapter, workflow-service, identity-resolver | AH1-23, AH1-28 |
| **M2: 检索+事实写回** | AH1-20, AH1-14, AH1-16, AH1-15 | fact-retrieval, retrieval-aware-executor | AH1-26, AH1-23 |
| **M3: Executor 集成** | AH1-18, AH1-17, AH1-19, AH1-22 | executor-gateway, code-executor, generic-executor | AH1-16, AH1-31 |
| **Provider 切换** | AH1-26, AH1-28, AH1-15 | LiteLLM config, embedding | AH1-31, AH1-23 |
| **压测收口** | AH1-24, AH1-23, AH1-27, AH1-31 | docker-compose, migrations | AH1-29, AH1-30 |
| **技能管理** | AH1-17, AH1-16 | skill-library, web-portal | AH1-34, AH1-35 |
| **Dream 梦境模式** | AH1-17, AH1-20 | web-portal (定时任务), fact-retrieval | AH1-23, AH1-31 |

### 11.2 上下文防腐规则

1. **权威源优先**: 每个领域对象仅一个权威文件, 在任务上下文中排在首位
2. **分层加载预算**: 默认只加载 1 个权威源 + ≤2 个直接依赖 + 1 个 DEV 文档
3. **冲突处理顺序**: AH1-15/16/17 > 领域权威 > DEV > 验收审计
4. **变更失效**: 任何权威文档变更 → 已有任务上下文立即失效

---

## 12. 维护规则

1. 新增数据库表 → 更新 §3 ER 图和 §6.2 读写矩阵
2. 新增服务端点 → 更新 §6.1 调用矩阵
3. 新增执行器类型 → 更新 §7 映射表
4. 修改 WorkflowPlan DSL → 更新 §4 状态机和 §5 故事线
5. 新增文档 → 补齐 §9 权威源映射
6. 每次里程碑变更后必须同步更新本文档

---

> 关联资产:
> - 架构全景: `agent-harness/ARCHITECTURE.md`
> - 上下文索引 (工具链消费): `development/context-graph.json`
> - 原始图谱设计: `development/DEV-08-文件内容与依赖对象图谱.md`
>
> 本文档为唯一权威对象关系图谱，已合并取代原 `development/app-graph/` 下所有分散的 JSON/MD 图谱文件。
