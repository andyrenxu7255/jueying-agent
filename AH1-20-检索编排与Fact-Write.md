# 文档 20：检索编排与 Fact Write 细则 v1.0

## 20.1 文档目的

本文件把《Fact / Memory / Retrieval Orchestration V1》的原则进一步落实为：

- 检索查询计划
- 候选裁剪与 rerank 规则
- Evidence Pack 生成规则
- Fact Write、冲突与升级规则

目标是让 Retrieval Service 与 Fact Writer 可并行开发。

## 20.2 总体原则

1. 先权限过滤，再检索。
2. 结构化优先，不做全库向量乱搜。
3. 进入模型上下文的内容必须少、准、可追溯。
4. 事实写入永远绑定证据与来源链。
5. 冲突事实不直接覆盖旧事实。

术语说明：

- `public:workflow` 在检索链路中只对应 `workflow_definition` / template，不对应运行态 `workflow_instance`。

## 20.3 Retrieval Query Plan

### 20.3.1 最小结构

```json
{
  "query_plan_id": "rq_123",
  "query_text": "当前 workflow 的最近失败原因是什么",
  "intent_type": "object-status",
  "policy_snapshot_hash": "sha256:...",
  "allowed_scopes": ["private:u_123", "public:workflow", "public:skill"],
  "steps": [
    {"type": "structured", "enabled": true},
    {"type": "fulltext", "enabled": false},
    {"type": "vector", "enabled": false},
    {"type": "graph", "enabled": false}
  ],
  "candidate_limits": {
    "structured": 20,
    "fulltext": 20,
    "vector": 30,
    "graph": 10,
    "final_clip": 12
  }
}
```

## 20.4 意图到检索链路映射

| 意图 | 首选链路 | 可选增强 | 默认禁用 |
|---|---|---|---|
| `object-status` | 结构化 | 全文补充 | 向量全库 |
| `evidence` | 全文 | 向量召回、rerank | 图漫游 |
| `relation` | 结构化 + 图增强 | 全文补充 | 全库向量 |
| `similar-case` | 向量 | rerank、图补充 | 无约束 AGE |
| `dev-context` | 结构化 + 全文 + 向量 | 图增强 | 整仓注入模型 |
| `memory-hint` | memory 检索 | rerank | 直接覆盖主事实 |

## 20.5 检索步骤细则

### 20.5.1 Step 0：权限过滤

输入：

- `policy_snapshot_hash`
- `allowed_scopes`
- 资源类型白名单

输出：

- 可检索 scope 集合
- 可检索资源类型集合
- 约束集，如 `max_graph_hops`、`memory_enabled`

### 20.5.2 Step 1：结构化查询

触发条件：

- 有明确对象名、ID、owner、当前用户、公共区、当前 workflow 等线索。

典型查询：

- `workflow_instance` 当前状态
- `workflow_stage` 最近失败记录
- `skill` 是否已发布
- `fact` 当前有效值

### 20.5.3 Step 2：全文检索

触发条件：

- 需要找原文片段
- 查询包含日志、文档、历史输出关键词
- 结构化结果不够解释原因

### 20.5.4 Step 3：向量召回

触发条件：

- 查询语义模糊
- 需要相似案例
- 需要开发上下文补全

约束：

- 必须先 scope 过滤。
- 必须有候选上限。
- 必须记录使用的 embedding 模型版本。

### 20.5.5 Step 4：图增强

触发条件：

- 已拿到主对象，需要扩展一跳/二跳关系。
- 需要依赖链、影响链、引用链。

约束：

- `max_hops <= 2`
- 必须带类型过滤
- 必须可映射回 PostgreSQL 主键

### 20.5.6 Step 5：Rerank

触发条件：

- 候选超过阈值
- 来源跨多个子系统
- 多意图混合

输出：

- 标准化排序分数
- 进入 clip 的候选集合

## 20.6 Clip 规则

进入模型上下文前必须执行 clip。

### 20.6.1 clip 目标

- 保留最相关、最新、证据强的片段
- 去除重复、弱相关、跨 scope 边缘内容
- 为每个片段保留来源头信息

### 20.6.2 clip 结果结构

```json
{
  "item_ref": "doc_chunk_123",
  "item_type": "document_chunk",
  "score": 0.92,
  "source_scope": "private:u_123",
  "explain": "matched workflow error keywords and latest failed verification"
}
```

## 20.7 Evidence Pack 生成规则

### 20.7.1 最小输出

Evidence Pack 至少包含：

- `evidence_pack_id`
- `query_text`
- `intent_type`
- `scope_summary`
- `retrieval_steps`
- `items`
- `clip_summary`
- `evidence_pack_hash`

### 20.7.2 生成要求

1. 每个 item 都要能回溯到源记录或 artifact。
2. 每个 item 都要标出来源 scope。
3. 若发生降级，必须在 `clip_summary` 或 trace 中体现。
4. 若 item 来源于大日志或 patch，优先以 `artifact_excerpt` 形式进入 Evidence Pack，而不是整对象直入模型。

## 20.8 Retrieval Trace 细则

每次检索必须记录：

- 意图分类结果
- 是否启用 memory
- 是否启用 graph
- 各步骤候选数量
- 降级原因
- 最终 Evidence Pack hash

示例：

```json
{
  "intent_type": "dev-context",
  "steps": [
    {"type": "structured", "candidates": 8},
    {"type": "fulltext", "candidates": 14},
    {"type": "vector", "candidates": 20},
    {"type": "graph", "candidates": 4}
  ],
  "final_candidates": 10,
  "degraded": false
}
```

## 20.9 Fact Write 模型

### 20.9.1 写入模式

- `insert`：新增事实声明
- `supersede`：用新版本替代旧版本，但保留旧事实
- `conflict`：发现冲突并登记
- `attach-evidence`：为现有事实补证据

### 20.9.2 Fact 状态建议

- `candidate`
- `active`
- `conflicted`
- `superseded`
- `rejected`

### 20.9.3 Fact Write 最小请求

```json
{
  "subject_ref": "wf_123",
  "predicate": "current_status",
  "object_value_json": {"value": "failed"},
  "fact_type": "workflow-status",
  "scope_type": "private",
  "owner_user_id": "u_123",
  "evidence_refs": ["art_verification_123"],
  "source_refs": ["workflow_stage:st_40"]
}
```

## 20.10 冲突检测规则

### 20.10.1 触发条件

以下情况触发冲突检测：

1. 同一 `subject_ref + predicate` 写入了互斥值。
2. 新事实与现有 `active` 事实在时间、版本、证据上无法自然覆盖。
3. 来自不同来源链的高置信度事实相互矛盾。

### 20.10.2 处理方式

1. 新事实先写为 `candidate`。
2. 创建 `fact_conflict` 记录。
3. 旧事实维持原状态，除非进入明确 supersede。
4. 如涉及公共区发布，必须转人工确认。

## 20.11 Supersede 规则

只有满足以下条件，才允许 `supersede`：

1. 新事实与旧事实为同一 `subject_ref + predicate`。
2. 新事实证据更强或版本更高。
3. 新事实不与当前 policy/publication 规则冲突。
4. 若资源在公共区，需治理流程放行。

## 20.12 Memory 检索与写回边界

### 20.12.1 Memory 允许进入的场景

- 用户偏好
- 历史经验提示
- Dream 摘要线索
- skill 形成原料

### 20.12.2 Memory 禁止参与的场景

- 客观审批结果
- 权限判断
- 主事实冲突裁决
- 公共发布最终结论

### 20.12.3 Hermes Memory 到平台 Memory 的映射规则

Hermes 的 Memory 输出不直接写入平台 `memory_item` 表，必须经过以下映射流程：

| Hermes 概念 | 平台概念 | 映射规则 |
|-------------|----------|----------|
| `memory.short_term` | 不映射 | 短期记忆不持久化，仅存在于 Hermes 会话内 |
| `memory.long_term` | `memory_item` 表 | 经 Hermes Adapter 转换后写入，`source_kind=hermes` |
| `memory.dream` | `memory_item` 表 | Dream 摘要经质量评估后写入，`memory_type=dream_summary` |
| `memory.preference` | `memory_item` 表 | 用户偏好直接写入，`memory_type=user_preference` |

映射约束：

1. Hermes Memory 只能以**候选**形式进入平台，由平台决定是否写入。
2. 写入时必须绑定 `owner_user_id`，继承当前请求的 `policy_snapshot`。
3. 写入时必须生成 `embedding`，参与后续检索。
4. Hermes Memory 的原始引用保留在 `metadata.hermes_ref` 中，可追溯。

### 20.12.4 Hermes Skill 到平台 Skill 的映射规则

| Hermes 概念 | 平台概念 | 映射规则 |
|-------------|----------|----------|
| `skill.auto_generated` | `skill` + `skill_version` | 经 SkillExtraction 阶段评估后写入 |
| `skill.user_created` | `skill` + `skill_version` | 用户显式创建，直接写入 |
| `skill.community` | 不直接映射 | 公共 Skill 需经 admin 审核后发布 |

映射约束：

1. Hermes Skill 只能以**候选**形式进入平台，由 SkillExtraction 阶段决定是否封装。
2. 封装时必须通过质量标准（见文档17 §17.19.2）。
3. Day 1 默认私有，admin 可发布到公共区。
4. Skill 的 `retrieval_embedding` 必须生成，参与后续检索匹配。

## 20.13 降级规则

| 失败点 | 降级方式 |
|---|---|
| 结构化失败 | 尝试全文，但标记可信度下降 |
| 全文失败 | 保留结构化与向量 |
| 向量失败 | 保留结构化与全文 |
| AGE 失败 | 跳过图增强，记录降级原因 |
| rerank 失败 | 采用规则排序 |
| memory 失败 | 跳过 memory，不阻断主链路 |

### 20.13.1 Memory 检索失败降级审计规则

#### 审计要求

Memory 检索失败时，**必须写入审计日志**，记录失败原因和降级决策。

#### 审计事件定义

```json
{
    "event_type": "retrieval.memory_degraded",
    "event_id": "evt_123",
    "trace_id": "trace_abc",
    "workflow_instance_id": "wf_456",
    "workflow_stage_id": "st_789",
    "occurred_at": "2026-04-20T10:00:00Z",
    "payload": {
        "failure_reason": "INTEGRATION_HERMES_TIMEOUT",
        "failure_detail": "Hermes Adapter 响应超时，超过 5000ms",
        "degraded_action": "skip_memory_retrieval",
        "impact_assessment": {
            "memory_items_missed": 5,
            "estimated_relevance_drop": "low",
            "fallback_sources": ["structured", "fulltext", "vector"]
        },
        "retry_attempted": true,
        "retry_count": 2
    }
}
```

#### 失败原因分类

| 失败原因 | 错误码 | 是否重试 | 审计级别 |
|----------|--------|----------|----------|
| Hermes Adapter 超时 | `INTEGRATION_HERMES_TIMEOUT` | 是（最多 2 次） | warning |
| Hermes Adapter 连接失败 | `INTEGRATION_HERMES_CONNECTION_FAILED` | 是（最多 2 次） | warning |
| Memory 表查询超时 | `RETRIEVAL_MEMORY_TIMEOUT` | 是（最多 2 次） | warning |
| Memory 向量索引错误 | `RETRIEVAL_MEMORY_INDEX_ERROR` | 否 | error |
| 权限校验失败 | `POLICY_DENIED` | 否 | error |
| 数据格式错误 | `RETRIEVAL_MEMORY_FORMAT_ERROR` | 否 | error |

#### 审计字段要求

| 字段 | 必填 | 说明 |
|------|------|------|
| `event_type` | 是 | 固定为 `retrieval.memory_degraded` |
| `workflow_instance_id` | 是 | 关联的 Workflow 实例 ID |
| `workflow_stage_id` | 是 | 关联的阶段 ID |
| `failure_reason` | 是 | 失败原因错误码 |
| `failure_detail` | 是 | 详细错误信息 |
| `degraded_action` | 是 | 降级动作：`skip_memory_retrieval` |
| `impact_assessment` | 是 | 影响评估 |
| `retry_attempted` | 是 | 是否尝试重试 |
| `retry_count` | 否 | 重试次数 |

#### 影响评估字段

| 字段 | 说明 |
|------|------|
| `memory_items_missed` | 预估丢失的 Memory 条目数 |
| `estimated_relevance_drop` | 预估相关性下降程度：`low`/`medium`/`high` |
| `fallback_sources` | 降级后使用的检索源 |

#### 不审计的场景

以下场景**不需要**写入审计日志：

| 场景 | 原因 |
|------|------|
| Memory 检索成功 | 正常流程，不需要降级审计 |
| Memory 检索返回空结果 | 无匹配数据，不是失败 |
| Memory 检索被场景禁用 | 按规则不触发 Memory 检索 |

#### 审计日志查询

管理员可通过以下方式查询 Memory 降级事件：

```sql
SELECT * FROM audit_event 
WHERE event_type = 'retrieval.memory_degraded' 
  AND occurred_at > now() - interval '24 hours'
ORDER BY occurred_at DESC;
```

#### 告警规则

| 条件 | 告警级别 | 说明 |
|------|----------|------|
| 5 分钟内 > 10 次降级 | warning | Memory 服务可能不稳定 |
| 5 分钟内 > 50 次降级 | error | Memory 服务严重故障 |
| 单个 Workflow 连续 3 次降级 | warning | 可能影响任务质量 |

#### 审计与检索 Trace 的关系

Memory 降级审计事件与 `retrieval_trace` 表的关系：

| 维度 | 审计事件 | retrieval_trace |
|------|----------|-----------------|
| 目的 | 记录降级决策 | 记录检索过程 |
| 写入时机 | 降级发生时 | 每次检索时 |
| 存储位置 | `audit_event` 表 | `retrieval_trace` 表 |
| 关联方式 | 通过 `workflow_stage_id` | 通过 `workflow_stage_id` |

`retrieval_trace` 中也会记录 Memory 检索的状态：

```json
{
    "trace_id": "trace_abc",
    "source": "memory",
    "status": "degraded",
    "degraded_reason": "INTEGRATION_HERMES_TIMEOUT",
    "items_returned": 0,
    "duration_ms": 5200
}
```

## 20.14 Day 1 必做验证

1. 普通用户检索不会拿到其他用户私有 chunk。
2. `object-status` 场景结构化优先，平均耗时可控。
3. `dev-context` 场景可同时给出代码证据、日志证据与结构化状态。
4. 冲突事实不会直接覆盖旧事实。
5. Evidence Pack 中每个 item 都可追溯到主键或 artifact ref。
