# DEV-15 控制台优化与标准测试故事线

## 1. 本次优化目标

把 `apps/web-portal` 从 M1 阶段的最小页面，提升为符合 AH1 设计思路的控制台：

- 像 OpenClaw Gateway UI 一样具备固定壳层、导航、总览、工作台视角
- 体现 Web Portal 作为 OpenClaw Layer 一部分的职责，而不是孤立 demo
- 让 admin 治理动作、审计、检索、checkpoint、观测逻辑形成统一使用入口

## 2. 控制台职责边界

### 2.1 门户负责什么

- 登录与角色视角（user/admin）
- 任务接入与 Workflow 创建
- Workflow 查询、详情、暂停、恢复、取消
- 身份绑定治理
- 审计与检索追踪查询
- 告诉操作者“接下来该做什么”

### 2.2 SigNoz 负责什么

- 服务健康
- 指标趋势
- 技术性能
- 告警
- 运行态异常定位

### 2.3 推荐使用顺序

1. 先看门户总览：确认哪层异常、哪个 Workflow 卡住、是否有待处理身份冲突。
2. 再看 Workflow 控制台：看阶段、checkpoint、审计，决定要不要 pause/resume/cancel。
3. 再看审计与检索：判断是否是权限、检索降级、错误治理动作导致问题。
4. 最后看 SigNoz：确认是否是运行时性能、依赖健康或异常趋势问题。

## 3. 当前与 AH1 的贴合点

### 3.1 已修正

- Web Portal 不再只是“登录 + 创建 + 列表”的极简页，而是控制台壳层
- admin 可跨用户查看 Workflow 并执行治理动作
- 网关首次遇到未知 external identity 时会自动落 `pending` 记录，便于 admin 接手
- admin 动作审计会记录操作者，而不是错误地只记录 Workflow owner
- 门户内明确说明了与 SigNoz 的职责分工和使用逻辑

### 3.2 仍需后续继续增强的点

- Web Portal 的“继续当前任务”目前基于页面上下文键和活动 Workflow 复用，不是完整的多轮消息续接协议
- 门户尚未实现完整的公共发布审批工作流 UI
- 身份冲突解决目前提供 rebind/disable 基础动作，尚未做更细粒度冲突对比面板

## 4. 标准测试故事线

以下故事线用于判断系统是否符合最初设计思路。每条故事线都必须同时看：

- 门户控制面结果
- Workflow 状态与阶段
- 审计/检索记录
- 必要时的 SigNoz 运行态指标

### 故事线 1：业务用户发起分析任务

目标：验证 Web Portal 是统一任务入口。

步骤：

1. 用普通账号登录门户。
2. 进入“任务接入”。
3. 输入分析任务，例如：`分析本周销售机会推进风险并给出建议`。
4. 提交并等待系统返回 workflow 信息。
5. 进入 Workflow 控制台查看详情。

期望：

- 返回 `workflow_id`、`session_ref`、`dispatch_status`、`executor_run_ref`
- Workflow 至少包含规划、审批、结果汇报等阶段
- 审计中可看到 `portal.workflow.create`、`workflow.state.changed` 等事件

### 故事线 2：管理员跨用户治理 Workflow

目标：验证 Admin 操作台不是摆设，而是真正的治理面。

步骤：

1. 用 `admin` 登录门户。
2. 进入 Workflow 控制台，切换到全部 Workflow 视角。
3. 打开任意他人 Workflow 详情。
4. 执行 `pause`、`resume` 或 `cancel`。

期望：

- 可以看到 owner、类型、目标、阶段链、checkpoint、审计
- 动作后 Workflow 状态变化可见
- 审计记录中的 actor 是 admin，而不是错误地写成 owner

### 故事线 3：未绑定身份进入待处理队列

目标：验证未绑定身份不会错误创建私有 Workflow。

步骤：

1. 通过飞书或企业微信入口发送新消息。
2. 如果 external identity 未绑定，系统返回 `binding_required`。
3. admin 进入“身份绑定”页面查看待处理记录。
4. 执行 rebind 或 disable。

期望：

- 未绑定请求不会直接创建 Workflow
- 身份绑定页可见 `pending` / `conflicted` 记录
- 审计页可见 `identity.pending_created`、`identity.rebind` 或 `identity.disable`

### 故事线 4：等待用户 / 阻塞 / 暂停 的恢复闭环

目标：验证状态机和 checkpoint 设计成立。

步骤：

1. 找到 `waiting_user`、`blocked` 或 `paused` 的 Workflow。
2. 在详情页查看 checkpoint 列表。
3. 执行 resume。
4. 观察 Workflow 回到运行态。

期望：

- checkpoint 列表中可见 `checkpoint_type`、`stage_ref`、`resume_token`
- 恢复后审计中出现 resume 相关事件

### 故事线 5：检索权限与 Evidence Pack 审核

目标：验证“零越权、可审计、可追溯”的事实层设计。

步骤：

1. 执行检索型任务，或运行既有 M2 PoC。
2. 进入“审计与检索”页查看 retrieval trace。
3. 核对 query、intent_type、duration、degraded。
4. 验证不同用户私有数据不会互相出现在结果中。

期望：

- retrieval trace 有完整查询信息
- 降级时可见 degraded
- 与 M2 PoC 口径一致：零越权

### 故事线 6：观测与控制面联动排障

目标：让操作者知道门户和 SigNoz 怎么配合使用。

步骤：

1. 先在门户总览确认问题范围。
2. 再到 Workflow 控制台定位具体实例。
3. 再看审计与检索页确认治理和权限链路。
4. 最后打开 SigNoz 看指标和告警趋势。

期望：

- 门户回答“哪个对象有问题、该做什么”
- SigNoz 回答“为什么会这样、系统层是否异常”

## 5. 推荐验收顺序

1. 故事线 1：确认门户是系统入口。
2. 故事线 2：确认 admin 治理闭环成立。
3. 故事线 3：确认接入层不会绕过身份绑定。
4. 故事线 4：确认 checkpoint/resume 成立。
5. 故事线 5：确认事实层与权限模型成立。
6. 故事线 6：确认门户与观测台联动逻辑清晰。

## 6. 当前建议的使用入口

- 门户：`http://localhost:3003`
- Gateway：`http://localhost:3000/health/live`
- Workflow：`http://localhost:3001/health/live`
- Executor：`http://localhost:3002/health/live`
- Fact Retrieval：`http://localhost:3004/health/live`
- LiteLLM：`http://localhost:4000/health/liveliness`
- SigNoz：`http://localhost:3301`
