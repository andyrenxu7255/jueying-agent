# 文档 24：PoC / 压测执行方案 v1.0

## 24.1 文档目的

本文件把《Capacity / Risk / Validation Plan V1》中的 PoC 清单进一步落为执行方案，明确：

- 每个 PoC 需要验证什么
- 测试环境如何搭
- 用什么数据与脚本
- 通过阈值是什么

## 24.2 测试环境建议

### 24.2.1 基准环境

- 服务器规格：`4C16G`
- PostgreSQL + pgvector + AGE 同机部署
- Redis 同机部署
- 对象存储可先用本地 MinIO 或文件系统替代

### 24.2.2 软件环境

- OpenClaw 接入壳层最小实例
- 平台主服务最小实例
- Code Executor 最小 backend
- Hermes Adapter 最小 mock / 真服务各一套

## 24.3 PoC 总表

| PoC | 目标 | 输入 | 输出 | 成功标准 |
|---|---|---|---|---|
| P0-1 | OpenClaw 与 Workflow 解耦接入 | 标准化请求 | Workflow 实例与进度回传 | 能稳定创建 Workflow 并回传状态 |
| P0-2 | Workflow + Checkpoint + Resume | 人工构造长任务 | checkpoint 与恢复结果 | `waiting_user`、`blocked`、`paused` 可区分且可恢复 |
| P0-3 | PostgreSQL + pgvector + 权限过滤 | 私有/公共混合数据集 | 检索延迟与准确率 | 在权限过滤下响应可接受，且零越权 |
| P0-4 | AGE 图增强 | 关系型对象数据集 | 1-2 跳查询耗时 | 性能可控、映射一致 |
| P0-5 | Code Executor Adapter | 小型代码仓库 | patch、测试、checkpoint | 阶段内执行闭环可跑通 |
| P0-6 | Hermes 增强接入 | memory/skill 样例 | 候选结果与治理写回 | 输出受 policy 控制且可审计 |

## 24.4 数据集建议

### 24.4.1 Workflow 数据集

- 20 个并发 Workflow 样本
- 覆盖：知识检索、分析、开发三类
- 覆盖状态：`running`、`waiting_user`、`blocked`、`paused`、`failed`

### 24.4.2 Retrieval 数据集

- 10k `document_chunk`
- 2k `memory_item`
- 1k `skill_version summary`
- 关系图样本：5k `entity`、10k `relation`
- 至少 3 个用户隔离数据集 + 公共区数据

### 24.4.3 Code Executor 数据集

- 一个小型 TypeScript 仓库
- 一个小型 Python 仓库
- 每个仓库准备 5-10 个可验证任务

## 24.5 P0-1 执行方案

### 24.5.1 步骤

1. 模拟渠道请求进入 OpenClaw 壳层。
2. 覆盖已绑定身份与未绑定身份两条路径。
3. 标准化后调用 Workflow Planner。
4. 创建 Workflow 实例。
5. 回传 `planned -> running` 进度。

### 24.5.2 验收

- 10 次连续请求成功创建 Workflow。
- 未绑定身份不会错误创建 Workflow。
- 进度回传字段完整。
- 审计事件存在。

## 24.6 P0-2 执行方案

### 24.6.1 步骤

1. 设计一个会进入 `waiting_user` 的任务。
2. 设计一个外部依赖缺失导致 `blocked` 的任务。
3. 设计一个预算耗尽导致 `paused` 的任务。
4. 从最近 checkpoint 恢复。

### 24.6.2 验收

- 三类状态能被清晰区分。
- 恢复后能继续推进或正确失败。
- `policy_snapshot_hash` 变化时恢复被拒绝。

## 24.7 P0-3 执行方案

### 24.7.1 步骤

1. 为三位用户各导入私有文档与 memory。
2. 导入公共 `workflow_definition` / `skill` 数据。
3. 执行结构化、全文、向量混合检索。
4. 验证结果中无越权条目。

### 24.7.2 指标

- `retrieval_duration_ms`
- `candidate_count`
- `evidence_pack_build_ms`
- 越权读取次数

### 24.7.3 验收

- 零越权读取。
- 主查询场景 p95 可接受。

## 24.8 P0-4 执行方案

### 24.8.1 步骤

1. 将 `entity` / `relation` 投影到 AGE。
2. 执行 1 跳、2 跳、超 2 跳限制场景。
3. 比对 AGE 查询结果与 PostgreSQL 主键映射。

### 24.8.2 验收

- 1-2 跳查询稳定。
- 超过 2 跳的请求被拒绝或裁剪。
- 图结果可回映射到事务表。

## 24.9 P0-5 执行方案

### 24.9.1 步骤

1. 创建开发任务 Workflow。
2. 进入 Code Executor 阶段。
3. 执行代码修改。
4. 运行测试。
5. 制造一次失败并触发修复。
6. 产出 patch、日志、test result、checkpoint。

### 24.9.2 验收

- 可完整跑通一次实现-验证-修复闭环。
- 失败证据可追溯。
- checkpoint 可恢复。

## 24.10 P0-6 执行方案

### 24.10.1 步骤

1. 准备一组 memory / dream / skill 样例。
2. 通过 Hermes Adapter 查询候选。
3. 平台执行 metadata / policy / audit 校验。
4. 将允许结果写入私有 memory 或 skill 草稿。

### 24.10.2 验收

- Hermes 输出不能绕开平台写主事实。
- 每次写回都能审计。
- 公共发布仍需 admin。

## 24.11 压测场景

### 24.11.1 基础并发压测

- 20 个运行态 Workflow
- 其中 2-4 个处于 Code Executor 重阶段
- 其余为轻量知识/分析任务

### 24.11.2 极限检索压测

- 高频混合检索
- 同时触发结构化、全文、向量、图增强

### 24.11.3 恢复压测

- 批量中断正在运行的 Workflow
- 验证恢复成功率与耗时

## 24.12 关键通过阈值

- 跨用户越权读取次数：`0`
- 审计事件完整率：`100%`
- Checkpoint 恢复成功率：`>= 95%`
- 重开发阶段不会导致全部系统槽位被长期占满

补充阈值（Day 1 冻结）：

- 未绑定身份误创建 Workflow 次数：`0`
- replay 写入主事实次数：`0`
- `public:workflow` 被错误解析为 `workflow_instance` 的次数：`0`

## 24.13 输出物要求

每个 PoC 至少输出：

- 环境说明
- 测试步骤
- 原始结果
- 指标截图或导出
- 风险判断
- 是否建议进入下一里程碑
