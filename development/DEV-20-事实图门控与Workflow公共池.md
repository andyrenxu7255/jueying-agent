# DEV-20 事实图门控与 Workflow 公共池

## 背景

当前仓库里同时存在历史 V1 口径与新一轮产品口径。为了避免后续测试、开发和验收继续跑偏，需要把以下四件事写成统一的真实规则：

1. 图能力不是“向量增强”，而是事实层门控。
2. 自动任务不是 workflow 的替代品，而是首次任务的执行模式。
3. 成功路径当前先沉淀为个人 workflow 型 skill，再走技能审核与组织模板提升；高召回、高注入、高业务分的 workflow_definition_review 已经落地，审批后可固化为 active workflow_definition。
4. Markdown 文件和 PostgreSQL 的分工必须明确。

## 目标口径

### 1. 事实层与图门控

PostgreSQL 仍然是唯一事实源。`entity`、`relation`、`fact`、`document_chunk`、`artifact_object` 构成事实层与证据层的联合体；`Apache AGE` 只负责图投影、图遍历和关系门控，不是第二事实源。

检索顺序应是：

1. 权限过滤。
2. 结构化 / 全文 / 向量找候选对象或关系。
3. 沿图遍历候选对象的关系与邻接事实。
4. 汇总成 Evidence Pack。
5. 进入模型上下文前做裁剪与溯源检查。

### 2. 自动任务与 workflow

任务进入系统后，当前先找既有 active skill 模板：

1. 个人私有 skill。
2. 组织 skill。
3. 公共 skill。

若都未命中，则进入自动任务首跑模式。自动任务跑通后：

1. 过程和结果展示给用户。
2. 用户确认后，沉淀为个人私有 active skill，`skill_type=workflow` 时可被 Planner 当作 workflow 阶段链模板。
3. 管理员审核后，可提升为组织级 skill 模板并写入 `org_skill_registry`。

`workflow_definition` 表已经存在，用于更强的契约层模板；当前主链路已经会把高质量 workflow 型 skill 提交 `workflow_definition_review`，由 admin 审批后写入 active `workflow_definition`。

### 3. 公共池

当前可运行的公共池口径落在 skill 模板治理：用户确认过的 workflow 型 skill 可以被管理员审核，符合组织复用条件时提升为 org skill。公共池候选区不是立即生效的公共资产，必须经过 admin 审批。

当前审批通过后：

1. skill 进入 `org` scope，并在 `org_skill_registry` 登记。
2. 同组织用户可在匹配阶段优先复用。
3. 审批记录必须可追溯。

公共 `workflow_definition` 发布的目标规则是：来源验收、admin 审批、无私有信息泄露检查、发布审计全部通过后，才进入 public scope；组织内路径则通过 `org_id` 约束可见边界。

### 4. md 与 PG 的分工

Markdown 的角色只是“结果留痕与证据载体”，不承担权威状态。

- 需要唯一真相的，查 PG。
- 需要过程说明和原文证据的，查 md / artifact。
- 需要规则生效的，查 policy_snapshot / fact / entity / relation；当前复用模板查 skill / skill_version / org_skill_registry，契约层模板查 workflow_definition。
- 需要复盘的，读 md，再回到 PG 做状态判断。

## 建议落点

1. 后续所有故事线以 B2B 销售管理为日常样板。
2. 后续所有检索与评测，以“向量找候选，图做门控，PG 做真相”作为验收准则。
3. 后续所有可复用路径沉淀，以“自动任务首跑 -> 提取 workflow 型 skill -> 用户确认 -> 私有复用 -> admin 审核为组织模板 -> 高质量候审 -> workflow_definition 固化”为生命周期基线。

## DEV-21 补充：Dream / Hook / Outcome 闭环

公共池与技能沉淀的质量判断不能只看“是否生成了 skill”，还要看该 skill 或知识是否在真实 workflow 中被召回、注入，并带来好的 outcome。

新增统一口径：

1. 检索服务写 `knowledge_recall_event`，记录 fact / chunk / memory 的召回与注入。
2. Hermes / skill-library 写 `skill_recall_event` 与 `hook_event_log`，记录 skill 召回、审核和提升。
3. Workflow 终态写 `workflow_outcome_eval`，再生成 `recall_outcome_attribution`。
4. 梦境调度低峰期读取归因账本，用于提升高贡献 skill、修订低贡献 skill、整理高价值组织记忆。

因此，公共池审批除安全、完整性、通用性外，应优先参考近 30 天 `avg_business_score`、`succeeded_count` 与 `injected_count`。
