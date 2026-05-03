# M2：事实层 + 检索主链路

> **工期**: 4天 | **前置条件**: M1完成 | **阻塞条件**: M1验收通过

---

## M2.1 前置约束

- M1全部验收通过
- 文档14中文档/证据/对象/关系/事实/检索/审计表的DDL已冻结
- 文档15中Retrieval API、Fact Write API契约已冻结
- 文档20中检索编排规则已冻结

---

## M2.2 任务清单

### M2.2.1 数据库表落地

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M2-01 | 落文档与证据表 | 使用Drizzle ORM编写迁移脚本004_document_evidence.sql：创建document、document_version、document_chunk（含embedding vector(1536)、search_tsv tsvector、HNSW索引、GIN索引） | 迁移脚本 | 迁移成功，HNSW索引创建成功 | AH1-14 §14.5.3 |
| M2-02 | 落对象与事实表 | 使用Drizzle ORM编写迁移脚本005_entity_fact.sql：创建entity、entity_attribute、relation、fact、fact_evidence、fact_conflict表 | 迁移脚本 | 迁移成功 | AH1-14 §14.5.4 |
| M2-03 | 落Artifact表 | 使用Drizzle ORM编写迁移脚本006_artifact.sql：创建artifact_object表（含scope_type=private check约束） | 迁移脚本 | 迁移成功 | AH1-14 §14.5.3 |
| M2-04 | 落检索与审计表 | 使用Drizzle ORM编写迁移脚本007_retrieval_audit.sql：创建retrieval_trace、audit_event表 | 迁移脚本 | 迁移成功 | AH1-14 §14.5.6 |

### M2.2.2 检索服务

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M2-05 | 实现结构化查询服务 | 在services/fact-retrieval实现：按scope/owner/status过滤的结构化查询，支持workflow_instance、workflow_stage、fact、skill等对象的精确查询 | 结构化查询服务 | 查询结果受scope过滤 | AH1-20 §20.5.2 |
| M2-06 | 实现全文检索 | 基于document_chunk.search_tsv + pg_trgm实现全文检索，先scope过滤再全文匹配 | 全文检索服务 | 查询结果受scope过滤 | AH1-14 §14.6 |
| M2-07 | 接入pgvector语义召回 | 实现embedding写入（使用OpenAI text-embedding-3-small 1536维）和向量近邻搜索，必须先scope过滤再向量排序 | 向量检索服务 | 向量搜索结果受scope过滤 | AH1-20 §20.5.4 |
| M2-08 | 实现Retrieval Query Plan | 实现POST /internal/retrieval/query：根据intent_type选择检索链路（object-status->结构化优先，evidence->全文优先，similar-case->向量优先，dev-context->混合），按步骤执行并记录retrieval_trace | 检索编排服务 | 不同intent_type走不同链路 | AH1-20 §20.3-20.5 |
| M2-09 | 实现Evidence Pack Builder | 聚合多源检索结果，执行clip（去重、去跨scope边缘、保留来源头），生成Evidence Pack（含evidence_pack_hash） | Evidence Pack服务 | 每个item可追溯到源记录 | AH1-20 §20.6-20.7 |

### M2.2.3 Fact Write服务

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M2-10 | 实现Fact Write与Conflict Detector | 实现POST /internal/facts/write：支持insert/supersede/conflict/attach-evidence四种模式，冲突时创建fact_conflict记录，旧事实不直接覆盖 | Fact Write服务 | 冲突事实不直接覆盖旧事实 | AH1-20 §20.9-20.10 |
| M2-11 | 实现Artifact Object Storage | 实现artifact写入流程（正文上传MinIO -> 计算content_hash -> 数据库写元数据），读取流程（先校验policy_snapshot_hash -> 查元数据 -> 按需读取正文） | Artifact Storage服务 | 大对象不进数据库，权限校验正确 | AH1-22 §22.6-22.7 |

### M2.2.4 Provider适配器

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M2-12 | 实现Embedding Provider Adapter | 在libs/shared实现EmbeddingAdapter接口：调用OpenAI text-embedding-3-small，支持批量嵌入，记录embedding_model_version | Embedding Adapter | 维度1536正确，可写入pgvector | AH1-26 §26.6.2 |
| M2-13 | 实现Rerank Provider Adapter | 在libs/shared实现RerankAdapter接口：调用Cohere Rerank v3，候选>20时触发，降级时使用BM25+时间衰减规则排序 | Rerank Adapter | 候选>20时触发rerank，降级时规则排序 | AH1-26 §26.6.3 |
| M2-14 | 实现Retrieval-aware Executor | 实现检索感知执行器：接收阶段目标，调用检索编排获取Evidence Pack，基于Evidence Pack执行任务 | Retrieval-aware Executor | EvidenceRetrieval阶段可跑通 | AH1-17 §17.8 |
| M2-15 | P0-3 PoC：PostgreSQL+pgvector+权限过滤 | 为三位用户各导入私有文档，导入公共数据，执行混合检索，验证零越权 | PoC报告 | 零越权读取，p95可接受 | AH1-24 §24.7 |

---

## M2.3 验收门槛

- P0-3通过：零越权读取
- 检索trace完整
- Evidence Pack中每个item可追溯到源记录
- 冲突事实不直接覆盖旧事实
- Artifact大对象不进数据库

---

## M2.4 检索链路定义

### 意图到检索链路映射

| 意图 | 首选链路 | 可选增强 | 默认禁用 |
|------|----------|----------|----------|
| object-status | 结构化 | 全文补充 | 向量全库 |
| evidence | 全文 | 向量召回、rerank | 图漫游 |
| relation | 结构化+图增强 | 全文补充 | 全库向量 |
| similar-case | 向量 | rerank、图补充 | 无约束AGE |
| dev-context | 结构化+全文+向量 | 图增强 | 整仓注入模型 |
| memory-hint | memory检索 | rerank | 直接覆盖主事实 |

### 候选上限

- structured: 20
- fulltext: 20
- vector: 30
- graph: 10
- final_clip: 12

---

## M2.5 关键API

### Retrieval API
- 路径: POST /internal/retrieval/query
- 来源: AH1-15 §15.4.4

### Fact Write API
- 路径: POST /internal/facts/write
- 来源: AH1-15 §15.4.5

---

## M2.6 下一步

验收通过后，进入 M3：Code Executor集成
