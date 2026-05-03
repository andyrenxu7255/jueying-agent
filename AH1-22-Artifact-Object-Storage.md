# 文档 22：Artifact / Object Storage 设计 v1.0

## 22.1 文档目的

本文件定义平台制品与对象存储规则，覆盖：

- patch、测试结果、日志、附件、报告的统一存储方式
- 数据库元数据与对象存储正文的分层
- 命名、哈希、保留期、权限与回收规则

## 22.2 总体原则

1. 大对象正文不直接塞入事务表。
2. 数据库存元数据、引用、hash、大小、状态。
3. 所有 artifact 都必须可追溯到 Workflow / Stage / Execution Session，或在发布场景下追溯到 Skill / SkillVersion。
4. Artifact 访问仍受 `policy_snapshot` 约束。

术语说明：

- `public workflow` 在本文件中统一指 `public workflow_definition` / template。
- `artifact_object` 即使服务于公共 workflow_definition / skill 的发布，也不作为公共区资源单独暴露。

## 22.3 Artifact 类型

Day 1 至少支持以下类型：

- `raw_attachment`
- `document_source`
- `patch`
- `test_result`
- `command_log`
- `verification_report`
- `error_log`
- `checkpoint_payload`
- `final_report`
- `evidence_excerpt`

## 22.4 存储分层

### 22.4.1 数据库层

使用 `artifact_object` 保存：

- `scope_type`
- `owner_user_id`
- `artifact_type`
- `storage_backend`
- `storage_ref`
- `content_hash`
- `content_size`
- `mime_type`
- `summary`
- `workflow_instance_id`
- `workflow_stage_id`
- `execution_session_id`

### 22.4.2 对象存储层

存储实际正文：

- 原始文件
- patch 正文
- 测试输出全文
- 验证报告
- checkpoint payload

## 22.5 Key 命名规则

推荐对象 key：

```text
org/<org_id>/wf/<workflow_id>/st/<stage_id>/<artifact_type>/<artifact_id>
```

示例：

```text
org/default/wf/wf_123/st/st_40/patch/art_789
```

## 22.6 写入流程

1. 组件产出 artifact 正文。
2. 计算 `content_hash`。
3. 正文上传对象存储。
4. 数据库写 `artifact_object` 元数据。
5. 若数据库落盘失败，触发补偿清理或重试。

补充规则：

- 渠道原始附件统一先写成 `raw_attachment` artifact。
- 只有进入长期检索或抽取链路时，才提升为 `document`。

## 22.7 读取流程

1. 先校验 `policy_snapshot_hash`。
2. 查询 `artifact_object` 元数据。
3. 按需读取正文。
4. 对大日志优先提供摘要与分段读取，而不是整包注入模型。

## 22.8 Inline 与 External 划分

### 22.8.1 可内联内容

- 小于 `32 KB` 的摘要
- 简短失败说明
- 小型 JSON 验证结果

### 22.8.2 必须外置内容

- 原始附件
- 完整 patch
- 完整测试日志
- 命令输出全文
- checkpoint payload

## 22.9 Hash 与去重规则

1. 统一使用 `sha256`。
2. 允许按 `content_hash` 做去重，但去重不能破坏来源链。
3. 同一正文若被多个 Workflow 引用，可共享对象存储正文，但数据库元数据记录必须分开。

## 22.10 保留期建议

| 类型 | 保留建议 |
|---|---|
| `patch` | 至少保留到 Workflow 归档后 180 天 |
| `test_result` | 至少保留 180 天 |
| `command_log` | 至少保留 90 天 |
| `checkpoint_payload` | 至少保留到 Workflow 归档后 30 天 |
| `final_report` | 长期保留 |
| `raw_attachment` | 依据业务合规策略决定 |

## 22.11 安全规则

1. Artifact 不得绕过 `scope` 与 `owner` 校验单独暴露。
2. artifact 可以服务于 `public workflow_definition` / `public skill` 的发布流程，但 artifact 自身不进入公共区。
3. 涉及凭证、私钥、敏感配置的 artifact 必须标记敏感级别，并默认禁止模型直接读取原文。
4. `checkpoint_payload` 仅供恢复与调试使用，默认不得直接进入模型上下文。

## 22.12 与 Document 的边界

- `document` 面向可检索证据与版本化正文。
- `artifact_object` 面向执行过程中产生的结果物。
- 一个 artifact 如果后续需要进入长期检索，可经过治理转化为 `document`。

## 22.13 Day 1 验证用例

1. Code Executor 产生 patch 后，能写入对象存储并落元数据。
2. 大日志不会整段进入模型上下文，而是通过摘要或切片读取。
3. 普通用户无法读取其他用户私有 artifact。
4. checkpoint payload 丢失时，恢复流程能给出明确错误而不是静默失败。
