# DEV-20 事实图门控与 Workflow 公共池

## 背景

当前仓库里同时存在历史 V1 口径与新一轮产品口径。为了避免后续测试、开发和验收继续跑偏，需要把以下四件事写成统一的真实规则：

1. 图能力不是“向量增强”，而是事实层门控。
2. 自动任务不是 workflow 的替代品，而是首次任务的执行模式。
3. 成功路径可以先沉淀为个人 workflow，再走公共池审批。
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

任务进入系统后，先找既有 workflow_definition：

1. 个人私有 workflow。
2. 组织 workflow。
3. 公共 workflow。

若都未命中，则进入自动任务首跑模式。自动任务跑通后：

1. 过程和结果展示给用户。
2. 用户确认后，沉淀为个人私有 workflow_definition。
3. 管理员审核后，可提升为组织或公共可复用资产。

### 3. 公共池

任何用户都可以把自己确认过的 workflow 提交到公共池候选区。公共池候选区不是立即生效的公共资产，必须经过 admin 审批。

审批通过后：

1. workflow_definition 进入 `public` scope。
2. 其他用户可在匹配阶段优先复用。
3. 审批记录必须可追溯。

### 4. md 与 PG 的分工

Markdown 的角色只是“结果留痕与证据载体”，不承担权威状态。

- 需要唯一真相的，查 PG。
- 需要过程说明和原文证据的，查 md / artifact。
- 需要规则生效的，查 workflow_definition / policy_snapshot / fact / entity / relation。
- 需要复盘的，读 md，再回到 PG 做状态判断。

## 建议落点

1. 后续所有故事线以 B2B 销售管理为日常样板。
2. 后续所有检索与评测，以“向量找候选，图做门控，PG 做真相”作为验收准则。
3. 后续所有 workflow 沉淀，以“自动任务首跑 -> 用户确认 -> 私有复用 -> 公共审批”作为生命周期基线。
