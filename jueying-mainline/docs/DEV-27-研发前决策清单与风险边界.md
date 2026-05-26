# DEV-27 研发前决策清单与风险边界

> 状态：研发前闸门
> 读者：负责人、产品、架构、研发、测试
> 依赖：DEV-23、DEV-24、DEV-25、DEV-26、DEV-29、DEV-31、DEV-32、DEV-33

## 1. 研发前必须锁定的决策

| 决策 | 推荐默认 | 原因 |
|---|---|---|
| 首个 MVP 场景 | 每周卫生检查 | 低风险、信息采集明确、能验证 AI 管事闭环。 |
| 第二验证场景 | 销售线索跟进 | 非标准化信息多，能验证 Agent 判断和追问能力。 |
| 默认自治等级 | L1 首次确认，后续低风险可 L2 | 既能证明 AI 推进，也能控制初期风险。 |
| Human Twin 默认权限 | notify + collect + draft | 避免未经授权替真人承诺或提交。 |
| TaskGraph 与 workflow 关系 | TaskGraph 是上层，workflow 是执行底座 | 防止把旧 stage_chain 误当运营图谱。 |
| 任务状态机 | 新建 Task 状态机 | legacy workflow 状态机粒度不匹配。 |
| UI 起点 | Operating Console + AI PM Builder + TaskGraph View | 先跑通管理闭环，不先做大屏。 |
| 旧系统迁移策略 | 只接入，不重构 | 先复用底座，避免陷入旧工程重写。 |
| 外部事实层策略 | CRM 和项目管理系统先镜像、低风险反写、关键字段需确认 | 避免 Agent 事实与企业原系统事实分裂。 |

## 2. 关键风险

| 风险 | 表现 | 缓解 |
|---|---|---|
| 概念混用 | Project、Workflow、Task、Mission 混在一起 | 以 DEV-26 对象模型为准。 |
| Agent 越权 | 数字分身替真人确认高风险事项 | 默认权限限制，所有升级需显式授权。 |
| 信息采集失控 | Agent 追问过多，人类疲劳 | 每个 Information Gap 必须有原因、优先级和截止。 |
| 图谱复杂度过高 | MVP 过早支持复杂 DAG、跨部门资源优化 | P1 只支持最小依赖和派生任务。 |
| 旧系统牵引 | 继续围绕 workflow 页面做产品 | `jueying-mainline/` 文档以 JueYing 主版本为主，历史 v1 只作运行时兼容层。 |
| 外部系统事实分裂 | CRM、Jira、禅道、TAPD、飞书项目或自研项目系统与 Agent TaskGraph 各说各话 | 通过 External Fact Mirror、Writeback Intent、Policy、Queue、Audit 连接。 |
| 验收不可解释 | Agent 判断“完成”但无证据 | 每个完成状态必须绑定 Evidence 或明确免证据原因。 |
| 过早行业化 | 一开始做销售、交付、行政、研发全模板 | 先完成两个场景，再抽象模板。 |
| UI 变大屏 | 做成展示而不是操作 | 每个视图必须有推进动作：确认、派发、补充、验收、复盘。 |

## 3. 不做清单

第一阶段不做：

- 不做复杂组织资源排班优化。
- 不做全自动 L4 自治。
- 不做通用行业模板市场。
- 不做完整替代旧 JueYing workflow。
- 不做完整替代客户已有 CRM 或项目管理系统。
- 不做纯展示大屏。
- 不做没有证据绑定的自动验收。
- 不做数字分身默认自动提交。

## 4. P1 最小研发范围

P1 必须只覆盖：

- Organization/User 的最小引用。
- Human Twin Agent 配置和授权。
- Project/Routine 创建。
- Run 创建。
- TaskGraph 生成和确认。
- Task/Assignment 状态流转。
- Information Gap 生成。
- Evidence 提交。
- CRM/项目管理系统 External Fact Mirror 最小读取和新鲜度展示。
- CRM/项目管理系统低风险 Writeback Intent、队列、策略和审计。
- 外部系统冲突提示，不静默覆盖关键字段。
- PM Agent 验收。
- Run 复盘。

P1 可以暂缓：

- 复杂权限策略 UI。
- 跨组织模板市场。
- 大规模图算法。
- 自动 skill 发布。
- 多模型评测系统。

## 5. 接口前置问题

研发前需要写清楚以下接口契约：

| 契约 | 必须回答 |
|---|---|
| PM Agent plan | 输入目标和资源后，输出什么 TaskGraph JSON。 |
| TaskGraph validation | 哪些字段缺失会拒绝启动。 |
| Human Twin collect | 信息采集任务如何转成对真人的话。 |
| Evidence submit | 照片、文本、文件、链接如何入库和引用。 |
| Acceptance verify | Agent 如何输出通过、补充、失败、阻塞。 |
| Replan | 新增任务和改依赖如何记录原因。 |
| Legacy workflow dispatch | Task 如何调用旧 workflow，返回如何映射为 Deliverable。 |
| External fact sync | CRM 和项目管理系统如何读取、镜像、反写、降级和冲突处理。 |
| Audit event | 每类动作写什么审计字段。 |

## 6. 测试前置问题

| 测试层 | 必测内容 |
|---|---|
| 单元测试 | Task 状态机、Run 状态机、TaskGraph 校验。 |
| Agent 契约测试 | PM Agent 输出必须可解析、可校验、可执行。 |
| 权限测试 | Human Twin 不得越权提交或确认。 |
| 集成测试 | Routine 从创建到复盘完整闭环。 |
| UI 测试 | AI PM Builder、TaskGraph View、Information Gap Inbox。 |
| 外部事实同步测试 | CRM/项目管理系统读取、镜像刷新、反写意图、冲突和降级。 |
| 回归测试 | legacy workflow 被调用时不破坏旧执行路径。 |
| 审计测试 | 派发、验收、重规划、授权变更均有事件。 |

## 7. 验收样例数据

P1 应内置一组 demo 数据：

- 组织：TeamClaw Demo Co.
- 人员：负责人、运营经理、张三、李四。
- Human Twin：张三分身、李四分身。
- Routine：每周办公室卫生检查。
- Project：销售线索 ACME 跟进。
- Worker Agent：报告整理 Agent、文档生成 Agent。
- Evidence：照片占位、拜访纪要占位、评分表占位。
- CRM Mirror：ACME 商机、联系人、最近活动、CRM URL 占位。
- PM Mirror：客户交付项目、外部任务、评论、附件和项目 URL 占位。

## 8. 进入代码实现的闸门

只有满足以下条件才进入代码实现：

- DEV-25 的 MVP 故事线无未解决产品矛盾。
- DEV-26 的对象模型和状态机无命名冲突。
- DEV-27 的不做清单被接受。
- 已确定 P1 场景和默认自治等级。
- 已写出 TaskGraph JSON 最小契约。
- 已写出 CRM/项目管理系统 External Fact Mirror 与 Writeback Intent 最小契约。
- 已确认旧 JueYing v1 只作为 legacy substrate，不把旧页面直接延续为新产品入口。
