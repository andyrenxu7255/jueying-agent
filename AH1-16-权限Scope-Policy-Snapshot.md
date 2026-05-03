# 文档 16：权限、Scope、Policy Snapshot 详细设计 v1.0

## 16.1 文档目的

本文件细化 V1 权限模型，目标是把“单组织、多用户、默认严格隔离、仅 admin 可跨用户治理”落实到：

- 主体模型
- 资源模型
- scope 定义
- policy snapshot 生成规则
- 查询过滤规则
- 写入与发布规则

本文件是 Day 1 安全边界的核心约束文件。

## 16.2 权限模型总原则

1. 单组织，不做多租户。
2. 默认私有，默认拒绝跨用户读写。
3. `public` 不是“任何资源都可共享”，只允许 `workflow_definition` 与 `skill` 两类资产进入公共区；其中 `public:workflow` 是对可复用 workflow template 的运行期简称。
4. 任何读、检索、工具执行、事实写入都必须绑定 `policy_snapshot_hash`。
5. admin 具备跨用户读取、编辑、治理权限，但仍需审计。
6. 系统内部组件不拥有脱离用户上下文的无限权限，只能以受限系统主体执行。

## 16.3 主体类型

### 16.3.1 人类主体

| 主体 | 说明 |
|---|---|
| `user` | 普通用户，只能访问自己的私有资源和公共区资源 |
| `admin` | 管理员，可跨用户读取、编辑、治理与发布 |

### 16.3.2 系统主体

| 主体 | 说明 |
|---|---|
| `system:gateway` | 仅负责接入、身份映射、消息回传 |
| `system:workflow` | 仅负责任务治理与状态推进 |
| `system:retrieval` | 仅负责受 snapshot 约束的检索 |
| `system:executor` | 仅负责阶段执行，不能绕开 snapshot |
| `system:admin-console` | 仅在 admin 代理场景下执行治理动作 |

说明：

- 系统主体不是超管账号。
- 系统主体必须带 `acting_for_user_id` 或 `acting_for_admin_id`。

## 16.4 资源类型

Day 1 资源类型至少包括：

- `workflow_definition`
- `workflow_instance`
- `workflow_stage`
- `checkpoint`
- `execution_session`
- `document`
- `document_version`
- `document_chunk`
- `artifact_object`
- `entity`
- `relation`
- `fact`
- `memory_item`
- `skill`
- `skill_version`
- `retrieval_trace`
- `audit_event`

## 16.5 操作类型

统一动作集合：

- `read`
- `write`
- `update`
- `delete`
- `execute`
- `publish`
- `approve`
- `govern`
- `archive`

说明：

- Day 1 不建议开放真正物理删除，`delete` 仅保留接口语义，实际多为状态失效或归档。
- `execute` 专指发起阶段执行、工具调用、Code Executor 执行等动作。

## 16.6 Scope 模型

### 16.6.1 允许的 scope

V1 只允许三类逻辑 scope：

- `private:{user_id}`
- `public:workflow`
- `public:skill`

数据库列仍保留：

- `scope_type = private | public`
- `owner_user_id`

运行期策略计算使用展开后的 scope token，如：

```json
[
  "private:u_123",
  "public:workflow",
  "public:skill"
]
```

补充说明：

- `public:workflow` 只映射到 `workflow_definition` / template。
- `workflow_instance`、`workflow_stage`、`checkpoint`、`execution_session` Day 1 不允许进入公共区。

### 16.6.2 明确禁止的 scope

- `department:*`
- `group:*`
- `share-with:user_x`
- `team:*`
- `org:*`

这些都不在 Day 1 范围内。

## 16.7 资源可见性矩阵

| 资源 | 普通用户私有读 | 普通用户跨用户读 | 普通用户公共读 | admin 跨用户读 | admin 跨用户写 |
|---|---|---|---|---|---|
| workflow_definition | 是 | 否 | 仅公共 workflow_definition | 是 | 是 |
| workflow_instance | 是 | 否 | 否 | 是 | 是 |
| workflow_stage | 是 | 否 | 否 | 是 | 是 |
| checkpoint | 是 | 否 | 否 | 是 | 是 |
| execution_session | 是 | 否 | 否 | 是 | 是 |
| document | 是 | 否 | 否 | 是 | 是 |
| artifact_object | 是 | 否 | 否 | 是 | 是 |
| entity / relation / fact | 是 | 否 | 否 | 是 | 是 |
| memory_item | 是 | 否 | 否 | 是 | 是 |
| skill / skill_version | 是 | 否 | 仅公共 skill | 是 | 是 |
| retrieval_trace | 是，仅限本人任务 | 否 | 否 | 是 | 是 |
| audit_event | 否，普通用户仅可看与本人任务相关的受限视图 | 否 | 否 | 是 | 是 |

## 16.8 Policy Snapshot 结构

### 16.8.1 最小结构

```json
{
  "policy_snapshot_id": "ps_123",
  "user_id": "u_123",
  "role": "user",
  "acting_subject": "system:workflow",
  "allowed_scopes": [
    "private:u_123",
    "public:workflow",
    "public:skill"
  ],
  "resource_rules": {
    "workflow_instance": ["read", "write", "update", "execute", "archive"],
    "skill": ["read"],
    "fact": ["read", "write"]
  },
  "constraints": {
    "max_graph_hops": 2,
    "allow_cross_user_read": false,
    "allow_public_publish": false
  },
  "snapshot_hash": "sha256:..."
}
```

### 16.8.2 hash 生成规则

`snapshot_hash` 必须基于规范化 JSON 生成，参与字段包括：

- `user_id`
- `role`
- `acting_subject`
- `allowed_scopes`
- `resource_rules`
- `constraints`

不包含：

- `created_at`
- 数据库自增版本号
- 临时 trace 信息

原因：恢复与回放需要稳定判断“是不是同一份策略约束”。

## 16.9 Snapshot 生成规则

### 16.9.1 普通用户

普通用户生成规则：

- `role = user`
- `allowed_scopes = [private:{user_id}, public:workflow, public:skill]`
- `allow_cross_user_read = false`
- `allow_cross_user_write = false`
- `allow_public_publish = false`

### 16.9.2 admin

admin 生成规则：

- `role = admin`
- `allowed_scopes` 包含所有用户私有 scope 与公共 scope，但仍须携带操作原因
- `allow_cross_user_read = true`
- `allow_cross_user_write = true`
- `allow_public_publish = true`

说明：

- admin 具备能力不代表默认放开；系统仍需在 UI/API 层明确标记“管理员治理动作”。

### 16.9.3 系统主体代理执行

系统主体生成规则：

- 必须绑定具体用户或 admin 代理上下文。
- 继承被代理主体的 `allowed_scopes`。
- 只追加该系统组件完成职责所需的最小动作。

例如：

- `system:retrieval` 可以在既有 `read` 能力内执行结构化/全文/向量/图查询。
- `system:executor` 可以在既有 `execute` 能力内触发工具调用与 artifact 写回。

## 16.10 强制执行点

以下位置必须校验 `policy_snapshot_hash`：

1. 渠道身份解析后发起 Workflow 规划前。
2. 进入 Retrieval 之前。
3. 进入任何 Executor 之前。
4. 执行工具调用前。
5. 写入 `fact`、`memory_item`、`skill`、`artifact_object` 前。
6. 发布公共 workflow 或 skill 前。
7. checkpoint 恢复前。

## 16.11 查询过滤规则

### 16.11.1 普通用户 SQL 过滤原则

普通用户读取带 `scope` / `owner` 的表时，统一条件应等价于：

```sql
where (
  scope_type = 'private' and owner_user_id = :current_user_id
) or (
  scope_type = 'public' and :current_resource_kind in ('workflow_definition', 'skill')
)
```

### 16.11.2 admin SQL 过滤原则

admin 可跨用户读取，但必须带审计上下文：

```sql
where true
```

同时必须写审计：

- `action = admin.cross_user_read`
- `resource_ref`
- `acting_admin_id`
- `reason`

### 16.11.3 检索过滤原则

检索不能先召回再过滤，必须先做 scope 过滤。

允许流程：

1. 先按 `allowed_scopes` 过滤候选对象集合。
2. 再做全文、向量、图增强。
3. 最后再 rerank 与 clip。

禁止流程：

1. 先全库向量召回。
2. 再临时裁掉别人的结果。

## 16.12 写入规则

### 16.12.1 私有写入

普通用户默认只能向自己的 `private:{user_id}` 作用域写入：

- workflow 实例
- stage
- checkpoint
- artifact
- entity / relation / fact
- memory
- 私有 skill 草稿

### 16.12.2 公共写入

公共区只允许两类资源：

- `workflow_definition`
- `skill`

且必须满足：

1. 来源对象已经过验收或治理。
2. 由 admin 审批或 admin 直接执行发布。
3. 写入时保留来源链、证据链与发布审计。

## 16.13 发布规则

### 16.13.1 workflow 公共发布

允许场景：

- 某一类 Workflow 模板被确认可在组织内复用。

必须满足：

- 来源为稳定模板而非某个用户运行态实例。
- 不含私有附件、私有客户信息、私有路径。
- 由 admin 审核通过。

### 16.13.2 skill 公共发布

允许场景：

- 经验证的 skill 具备通用复用价值。

必须满足：

- 来源链完整。
- 风险等级已评估。
- 无私有事实泄漏。
- admin 发布。

## 16.14 拒绝与异常处理

常用拒绝码：

| 错误码 | 场景 |
|---|---|
| `POLICY_SNAPSHOT_MISSING` | 请求未携带 snapshot |
| `POLICY_HASH_MISMATCH` | 恢复/回放时策略不一致 |
| `POLICY_DENIED` | scope 或 action 不允许 |
| `POLICY_SCOPE_INVALID` | 资源 scope 非法 |
| `PUBLICATION_DENIED` | 非 admin 尝试发布公共资产 |

## 16.15 审计要求

以下动作必须写 `audit_event`：

- 身份绑定与解绑
- 生成 policy snapshot
- 越权拒绝
- 跨用户读取
- 公共发布
- 管理员暂停、恢复、取消他人 Workflow
- 读取他人 memory / fact / artifact

## 16.16 Day 1 需要先做的权限测试

1. 普通用户 A 不能读取普通用户 B 的任何私有 `workflow_instance`。
2. 普通用户 A 不能通过向量召回拿到普通用户 B 的 `document_chunk`。
3. 普通用户 A 可以读取 `public:workflow` 与 `public:skill`。
4. admin 可以跨用户读取，但每次都有审计记录。
5. checkpoint 恢复时，如 `policy_snapshot_hash` 不一致，恢复被拒绝。
