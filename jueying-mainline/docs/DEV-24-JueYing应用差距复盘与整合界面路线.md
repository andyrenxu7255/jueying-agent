# DEV-24 JueYing 应用差距复盘与整合界面路线

> 状态：研发复盘与路线草案
> 读者：内部产品、研发、架构、前端、Agent 实现团队
> 依据：JueYing v1.7.0 历史工程与文档、DEV-23 AI 原生运营系统总纲

## 1. 复盘结论

JueYing v1 不是失败方向，它已经具备升级为 AI 原生运营系统的多个底座：IM 入口、workflow 规划与执行、skill 沉淀、proactive 主动运营、org_task 派单、知识/记忆/归因、审计和权限。

但 JueYing v1 的产品抽象仍然偏“企业级 AI Agent 编排与执行平台”。它更擅长把用户请求转成可执行 workflow，而不是让 AI PM 持续管理企业中的事项。

核心差距是：缺少一层面向运营的对象模型和界面。现有 `workflow/stage_chain`、`proactive_mission`、`org_task_assignment` 都是局部组件，不能直接等同于 `Project/Routine/TaskGraph/Human Twin Agent`。

## 2. 总体映射

| AI 原生运营目标 | JueYing v1 当前支撑 | 关键缺口 | 结论 |
|---|---|---|---|
| AI PM 管理一件事 | workflow planner / executor | workflow 是阶段链，不是动态任务图谱 | 可复用为执行底座 |
| 动态 TaskGraph | stage_chain、workflow_stage | 缺依赖图、并行、派生任务、重规划、信息缺口 | 需要新增运营层 |
| 人类信息采集 | org_task_assignment、IM 通知 | 缺 Agent 生成的信息采集 schema 和补充追问 | 需要升级人类任务通道 |
| 数字分身 | 渠道身份、记忆、任务通知 | 缺 Human Twin Agent 授权、技能和反馈整理模型 | 需要新增角色抽象 |
| COO Agent | proactive-orchestrator | 当前是规则扫描与审核派单，不是持续运营观察者 | 可作为信号发现组件 |
| 经验沉淀 | skill-library、workflow_definition_review | 缺个人分身 skill 到岗位/组织 skill 的扩散闭环 | 需要补组织学习机制 |
| 运营可观测 | Web Portal workflow/proactive 页面 | 缺任务施工图谱、信息缺口、异常升级、验收复盘界面 | 需要新工作台 |

## 3. 主要结构性差距

### 3.1 workflow 不是 TaskGraph

JueYing v1 的 workflow 以 `stage_chain` 为核心，适合处理“用户提出一个复杂任务，系统分阶段执行并汇报”的场景。

AI 原生运营需要的是 `TaskGraph`：

- 有任务依赖，而不只是 `seq`。
- 有任务执行主体，包括 Worker Agent、Human Twin Agent、真人、外部系统。
- 有输入、输出、证据和验收规则。
- 能根据反馈动态新增任务或重规划。
- 能表达信息缺口和信息采集任务。
- 能跨天、跨人、跨渠道持续推进。

因此，后续不应直接把 `workflow_instance` 改名为 `project`。推荐新增运营层，让 `TaskGraph` 在需要时调用 workflow 作为执行器。

### 3.2 proactive 不是 COO Agent

JueYing v1 的 proactive-orchestrator 已经能扫描事实、记忆、技能和任务状态，生成 insight，审核后派 mission。

但 COO Agent 还需要：

- 维护跨 Program/Project/Routine 的运营状态。
- 主动识别资源冲突、阻塞、异常、质量风险。
- 向 PM Agent 或人类发出优化建议。
- 触发新的 TaskGraph 或修改现有 TaskGraph。
- 追踪优化是否有效。

所以 proactive 应作为 COO Agent 的一个能力组件：信号扫描、证据打包、洞察生成和去重。

### 3.3 org_task 是人类任务通道，不是任务图谱

JueYing v1 的 `org_task` 和 `org_task_assignment` 能承接任务派发与反馈，但结构偏扁平。

TaskGraph 需要补齐：

- parent/child task。
- dependency。
- assignment strategy。
- required evidence。
- acceptance criteria。
- deliverable refs。
- information_gap。
- replan reason。
- autonomy level。
- human twin permission。

推荐保留 org_task 作为兼容层和通知通道，新增 TaskGraph 层负责运营语义。

### 3.4 数字分身尚未成为明确产品对象

JueYing v1 有渠道身份、IM、记忆和任务通知，但没有把“人的数字分身”建模成独立 Agent。

升级后 Human Twin Agent 应具备：

- 与真人绑定的渠道。
- 可见的授权等级。
- 可用 skill。
- 信息采集 schema。
- 草稿生成能力。
- 反馈完整性检查。
- 真人确认记录。
- 可被 PM Agent 调度的能力描述。

这会成为 JueYing 从“任务通知系统”升级为“AI 管事系统”的关键。

## 4. 整合机制路线

### P0：理念与目录重构

- `jueying-mainline/` 是 JueYing 主版本工作区，AI 原生运营中枢默认内置在主版本里。
- JueYing v1 归档到 `legacy/jueying-v1/`。
- 新文档以 DEV-23 和 DEV-24 作为研发锚点。

### P1：运营对象模型

定义并落地最小对象：

- Work Unit。
- Project。
- Routine。
- Run。
- TaskGraph。
- Task。
- Assignment。
- Deliverable。
- Evidence。
- Human Twin Agent。

先做 schema 和 API 设计，不急于替换旧 workflow。

### P2：AI PM MVP

以“每周五卫生检查”或“销售线索跟进”作为首个真实闭环：

- 用户创建 Routine/Project。
- 选择 PM Agent 模板。
- 选择可用人员和数字分身。
- PM Agent 生成 TaskGraph。
- 人确认后开始执行。
- 系统通过 IM 收集现场信息和证据。
- Agent 验收、追问、补充、复盘。

### P3：JueYing v1 能力接入

- workflow-service 作为 Worker Agent 执行底座。
- proactive-orchestrator 作为 COO Agent 信号组件。
- org_task_assignment 作为人类任务通知和回写通道。
- skill-library 作为 Agent/岗位能力库。
- fact-retrieval 和 hermes 作为信息召回与组织记忆底座。

### P4：组织学习与扩散

- 个人数字分身 skill 可被观察和推荐。
- 高质量 skill 进入岗位模板。
- 岗位模板进入组织公共 skill。
- 复盘报告沉淀为 Routine/Project 模板。

## 5. 界面空间

### 5.1 AI PM 创建与模板配置

用于创建 Project Manager Agent 或 Routine Manager Agent。

核心控件：

- 事项类型：Project / Routine。
- 目标描述。
- 成功标准。
- 自治等级。
- 可用 Agent。
- 可用人员与数字分身。
- 信息采集偏好。
- 验收规则。

### 5.2 数字分身与信息采集配置

用于配置真人如何被 Agent 调度。

核心控件：

- 绑定渠道：飞书、企微、微信。
- 授权等级：notify、collect、draft、submit_with_confirmation、act_delegated。
- 可用 skill。
- 工作时间和提醒频率。
- 信息采集模板。
- 需真人确认的动作。

### 5.3 任务施工图谱

不是传统甘特图，而是动态 TaskGraph。

需要显示：

- 任务依赖。
- 执行主体。
- 当前状态。
- 信息缺口。
- 证据状态。
- 验收结果。
- 阻塞点。
- Agent 自动派生的新任务。

### 5.4 信息缺口与异常处理

这是区别于传统项目管理的关键界面。

需要显示：

- Agent 当前判断缺什么信息。
- 该信息为什么影响判断。
- 建议谁去采集。
- 采集方式和格式。
- 已反馈内容是否足够。
- 需要补充的问题。

### 5.5 复盘与组织扩散

用于把一次成功闭环变成组织能力。

需要显示：

- 本次 Run 的结果。
- 哪些任务提前/延后。
- 哪些信息缺口最影响推进。
- 哪些 Agent/人/skill 表现好。
- 是否生成模板。
- 是否推荐为岗位 skill 或组织 skill。

## 6. 优先级建议

| 优先级 | 内容 | 原因 |
|---|---|---|
| P0 | 文档、目录和理念召回 | 避免旧抽象继续牵引新系统。 |
| P1 | TaskGraph 与 Human Twin Agent 设计 | 这是新旧系统的分水岭。 |
| P2 | 一个真实 Routine 闭环 | 小场景能证明 AI 管事是否成立。 |
| P3 | 接入旧 workflow/proactive/org_task | 复用已有能力，避免重写底座。 |
| P4 | 组织学习和 skill 扩散 | 形成长期护城河。 |

## 7. 不建议立即做的事

- 不建议先做大型运营大屏。
- 不建议先重构旧 workflow-service。
- 不建议先扩写大量行业模板。
- 不建议把所有旧概念重命名为新概念。
- 不建议在没有 Human Twin Agent 授权模型前让 Agent 代替真人确认任务。

## 8. 下一步

下一轮研发应先输出运营层的最小接口与数据模型设计，重点回答：

- TaskGraph 如何表达依赖、状态、信息缺口和验收。
- Human Twin Agent 如何授权、通知、追问和回传。
- 旧 workflow 如何作为 Worker Agent 或执行 substrate 被调用。
- proactive insight 如何触发 TaskGraph，而不是只生成扁平 mission。
