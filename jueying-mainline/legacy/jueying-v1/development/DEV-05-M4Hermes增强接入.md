# M4：Hermes增强接入

> **工期**: 3天 | **前置条件**: M3完成 | **阻塞条件**: M3验收通过

---

## M4.1 前置约束

- M3全部验收通过
- 文档14中记忆与技能表DDL已冻结
- 文档20中Memory检索与写回边界已冻结

---

## M4.2 任务清单

### M4.2.1 数据库表落地

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M4-01 | 落记忆与技能表 | 编写迁移脚本008_memory_skill.sql：创建memory_item（含embedding vector(1536)+HNSW索引、memory_source、memory_usage_log、skill（含retrieval_embedding vector(1536)）、skill_version、skill_source表 | 迁移脚本 | 迁移成功 | AH1-14 §14.5.5 |

### M4.2.2 Hermes适配

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M4-02 | 实现Hermes Adapter | 在services/hermes-adapter实现POST /internal/hermes/query：查询memory/dream/skill候选，返回候选结果和source_refs | Hermes Adapter | 可查询候选结果 | AH1-15 §15.4.7 |
| M4-03 | 实现Memory Policy Guard | Hermes输出只以候选形式进入平台，写入时必须绑定owner_user_id和policy_snapshot，写入时必须生成embedding，原始引用保留在metadata.hermes_ref | Memory Policy Guard | Hermes不能绕过平台写主事实 | AH1-20 §20.12.3 |
| M4-04 | 实现Memory映射规则 | short_term不映射，long_term经Adapter写入（source_kind=hermes），dream经质量评估写入（memory_type=dream_summary），preference直接写入（memory_type=user_preference） | Memory映射 | 四种映射规则正确执行 | AH1-20 §20.12.3 |
| M4-05 | 实现Skill映射与封装 | auto_generated经SkillExtraction阶段评估，user_created直接写入，community不直接映射。封装时通过质量标准（可复用性>=3次、完整性、准确性>=80%、独立性）。Day 1默认私有，admin可发布到公共区 | Skill封装 | Skill封装受质量标准约束 | AH1-20 §20.12.4 |
| M4-06 | 实现DreamSummarization后处理 | Workflow成功后按策略触发DreamSummarization阶段，生成经验摘要写入memory_item（memory_type=dream_summary） | Dream处理 | Dream摘要可生成并写入 | AH1-17 §17.7.1 |
| M4-07 | 实现SkillExtraction后处理 | Workflow成功后按触发条件（succeeded+可复用模式+用户未拒绝）触发SkillExtraction阶段，生成Skill候选，质量评估，达标后创建skill+skill_version | Skill提取 | Skill候选可生成并通过质量评估 | AH1-17 §17.19 |
| M4-08 | 实现Memory检索集成 | 仅在用户偏好/历史经验/Dream级摘要场景触发，禁止在客观状态查询/权限判断/主事实冲突裁决场景触发，Memory失败时跳过不阻断主链路 | Memory检索 | Memory检索受场景约束 | AH1-20 §20.5 |
| M4-09 | P0-6 PoC：Hermes增强接入 | 准备memory/dream/skill样例，通过Hermes Adapter查询候选，平台执行metadata/policy/audit校验，写入私有memory或skill草稿 | PoC报告 | Hermes不能绕过平台写主事实，每次写回可审计 | AH1-24 §24.10 |

---

## M4.3 验收门槛

- P0-6通过
- Hermes不能直接写主事实
- Memory检索受场景约束
- Skill封装受质量标准约束
- 公共skill发布需admin审批
- 每次写回都有审计

---

## M4.4 Hermes Memory映射规则

| Hermes概念 | 平台概念 | 映射规则 |
|-------------|----------|----------|
| memory.short_term | 不映射 | 短期记忆不持久化 |
| memory.long_term | memory_item表 | 经Adapter转换，source_kind=hermes |
| memory.dream | memory_item表 | Dream摘要经质量评估，memory_type=dream_summary |
| memory.preference | memory_item表 | 用户偏好直接写入，memory_type=user_preference |

---

## M4.5 Skill封装质量标准

| 维度 | 最低标准 | 说明 |
|------|----------|------|
| 可复用性 | >=3次类似任务出现相同模式 | 避免一次性经验封装 |
| 完整性 | 包含完整的输入/输出/步骤描述 | 不封装半成品 |
| 准确性 | 验证通过率>=80% | 不封装低质量经验 |
| 独立性 | 不依赖特定用户私有数据 | 公共Skill必须通用 |

---

## M4.6 下一步

验收通过后，进入 M5：容量验证与治理收口
