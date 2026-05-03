# M1：接入层 + Workflow主链路

> **工期**: 4天 | **前置条件**: M0完成 | **阻塞条件**: M0验收通过

## M1.1 前置约束

- M0全部验收通过
- 文档14中身份与权限表、Workflow核心表的DDL已冻结
- 文档15中Channel Ingress API、Workflow Planning API、Workflow Stage Dispatch API契约已冻结
- 文档16中Policy Snapshot结构已冻结
- 文档17中WorkflowPlan最小结构、Stage DSL、状态迁移规则已冻结
- 文档19中Checkpoint最小结构已冻结
- 文档21中渠道接入、身份绑定、Session映射规则已冻结

---

## M1.2 任务清单

### M1.2.1 数据库表落地

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M1-01 | 落身份与权限表 | 编写迁移脚本002_identity_policy.sql：创建user、channel_identity、policy_snapshot表，含所有约束和索引 | 迁移脚本 | 迁移执行成功，约束生效 | AH1-14 §14.5.1 |
| M1-02 | 落Workflow核心表 | 编写迁移脚本003_workflow_core.sql：创建workflow_definition、workflow_instance（含check scope_type=private）、workflow_stage、checkpoint、workflow_event、execution_session表 | 迁移脚本 | workflow_instance.scope_type只能为private | AH1-14 §14.5.2 |

### M1.2.2 渠道接入层

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M1-03 | 实现Channel Ingress | 在apps/gateway-adapter实现POST /internal/channel-ingress/normalize：接收渠道消息，标准化为平台请求，调用Identity Resolver，返回user_id/binding_state | Channel Ingress服务 | 已绑定身份返回user_id，未绑定返回binding_required | AH1-15 §15.4.1 |
| M1-04 | 实现Identity Resolver | 实现channel_identity查询与绑定：按(channel_type, external_identity)查找user_id，未绑定返回binding_required，冲突返回admin_resolution_required | Identity Resolver | 绑定/未绑定/冲突三种状态正确区分 | AH1-21 §21.4 |
| M1-05 | 实现Session Mapper | 实现session_ref生成与映射：按Session Key规则（DM/群聊/线程）生成session_ref，判断是否复用现有Workflow | Session Mapper | 同一线程续接原Workflow，新任务新建Workflow | AH1-21 §21.6 |

### M1.2.3 权限与策略

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M1-06 | 实现Policy Snapshot生成 | 使用node-casbin定义策略：普通用户生成allowed_scopes=[private:{user_id}, public:workflow, public:skill]，admin生成跨用户scope，系统主体绑定acting_for_user_id；序列化为Policy Snapshot并计算hash | Policy Snapshot服务 | 生成hash稳定，不同角色生成不同scope，casbin判定正确 | AH1-16 §16.3 |

### M1.2.4 Workflow核心

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M1-07 | 实现Workflow Planner最小版本 | 在services/workflow实现POST /internal/workflows/plan：接收标准化请求，通过LiteLLM代理调用LLM生成WorkflowPlan，校验plan合法性，创建workflow_instance+workflow_stage记录 | Workflow Planner | 能生成合法WorkflowPlan并持久化 | AH1-15 §15.4.2 |
| M1-08 | 实现Workflow状态机 | 使用XState实现状态迁移：定义13种状态和14条迁移规则的XState状态图，配置持久化到PostgreSQL，每次迁移写入workflow_event | Workflow状态机 | 非法迁移被XState拒绝，合法迁移写入事件 | AH1-17 §17.21 |
| M1-09 | 实现Checkpoint Manager | 实现checkpoint创建与恢复：必触发场景（进入waiting_user/blocked/paused前、阶段成功后、Code Executor关键patch后），恢复前校验policy_snapshot_hash一致，恢复动作按顺序装载 | Checkpoint Manager | checkpoint可恢复，hash不一致时拒绝 | AH1-19 §19.5-19.6 |
| M1-10 | 实现阶段进度回传 | 实现Workflow Stage Dispatch API POST /internal/workflows/{id}/stages/{id}/dispatch，阶段完成后回传结果，触发主动汇报 | 阶段调度与回传 | 阶段完成/失败/等待时都能回传 | AH1-15 §15.4.3 |
| M1-11 | 实现Generic Executor | 实现最简单的通用执行器：接收阶段目标，调用LLM完成任务，回写阶段结果。支持IntentClarification/PlanGeneration/ResultReporting/Archive等轻量stage_type | Generic Executor | 能完成知识查询类Workflow | AH1-17 §17.8 |
| M1-12 | 实现Web Portal最小版本 | 在apps/web-portal实现最小Web界面：用户登录、发起请求、查看Workflow状态、查看阶段进度 | Web Portal | 能通过Web创建Workflow并查看状态 | AH1-21 §21.10 |

### M1.2.5 PoC验证

| 任务ID | 任务名称 | 具体动作 | 产出 | 验收标准 | 引用来源 |
|--------|----------|----------|------|----------|----------|
| M1-13 | P0-1 PoC：OpenClaw与Workflow解耦接入 | 模拟渠道请求进入Gateway Adapter，覆盖已绑定/未绑定身份，创建Workflow实例，回传进度 | PoC报告 | 10次连续请求成功，未绑定不创建Workflow，审计事件存在 | AH1-24 §24.5 |
| M1-14 | P0-2 PoC：Workflow+Checkpoint+Resume | 设计waiting_user/blocked/paused三种场景，从checkpoint恢复，验证policy_snapshot_hash变化时恢复被拒绝 | PoC报告 | 三类状态可区分，恢复后可继续，hash不一致被拒绝 | AH1-24 §24.6 |

---

## M1.3 验收门槛

- P0-1通过：10次连续请求成功创建Workflow
- P0-2通过：waiting_user/blocked/paused可区分且可恢复
- 未绑定身份不会错误创建Workflow
- checkpoint可恢复
- 非法状态迁移被拒绝
- 所有状态迁移有审计事件

---

## M1.4 关键状态机定义

### 13种状态

draft | planned | running | verifying | repairing | reporting | waiting_user | blocked | paused | succeeded | failed | cancelled | archived

### 14条迁移规则

draft -> planned -> running -> verifying -> repairing -> verifying -> reporting -> running -> succeeded
              -> waiting_user
              -> blocked
              -> paused
              -> cancelled
              -> failed

verifying -> reporting -> succeeded | failed
repairing -> verifying | failed

---

## M1.5 关键API端点

### Channel Ingress API
- 路径: POST /internal/channel-ingress/normalize
- 来源: AH1-15 §15.4.1

### Workflow Planning API
- 路径: POST /internal/workflows/plan
- 来源: AH1-15 §15.4.2

### Workflow Stage Dispatch API
- 路径: POST /internal/workflows/{workflow_id}/stages/{stage_id}/dispatch
- 来源: AH1-15 §15.4.3

---

## M1.6 下一步

验收通过后，进入 M2：事实层+检索主链路

