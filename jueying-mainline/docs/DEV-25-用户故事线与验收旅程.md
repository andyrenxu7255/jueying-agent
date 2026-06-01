# DEV-25 用户故事线与验收旅程

> 状态：研发前故事线基准
> 读者：产品、设计、前后端、Agent 编排、测试
> 依赖：DEV-23、DEV-24、DEV-30、DEV-32、DEV-33

## 1. 目标

本文定义 AI 原生运营系统的首批用户故事线。所有后续研发必须能回答：这个功能服务哪条故事线，推进了哪个闭环，是否让 Agent 更稳定地管理事项，是否让人类更有效地补充现场信息。

研发验收不以“页面能打开”或“接口能调用”为准，而以故事线闭环为准：目标创建、Agent 拆解、信息缺口识别、人类采集、Agent 判断、任务推进、异常升级、复盘沉淀。

## 2. 角色

| 角色 | 核心诉求 | 不可接受问题 |
|---|---|---|
| 企业老板 / 负责人 | 给出经营意图，看异常、决策点和结果，不被明细淹没 | Agent 只汇报流水账，无法说明卡点和下一步 |
| 运营负责人 / COO | 让多个事项持续推进，看到跨事项风险和资源瓶颈 | 只能手工巡检，无法形成可追踪优化闭环 |
| 部门经理 / AI PM Owner | 创建和管理一个 Project 或 Routine，配置 Agent 和人员 | 任务图谱不可解释，派单不可控 |
| 一线员工 / 现场执行者 | 收到清楚的采集要求，知道怎么反馈才算完成 | 任务描述模糊，反复被追问无上下文 |
| Admin / IT | 配组织、渠道、权限、Agent 模板、审计和集成 | 数字分身越权，数据边界不清 |
| Project Manager Agent | 理解目标、生成 TaskGraph、识别信息缺口、推进状态 | 没有结构化任务和状态机，只能生成文本计划 |
| Human Twin Agent | 通知真人、追问信息、整理反馈、检查完整性 | 未授权替真人确认或承诺 |
| Worker Agent | 完成 AI 可执行的任务并交付证据 | 输出无法验收、无法追溯 |
| 开发者 | 基于清晰对象模型、接口和验收标准实现 | 概念混用，Project/Workflow/Task 边界不清 |

## 3. 第一阶段故事线矩阵

| ID | 故事线 | 主角色 | 成功标准 | 优先级 |
|---|---|---|---|---|
| UJ-01 | 首次进入新系统 | Admin | 根入口清楚，能理解旧 JueYing v1 已归档，新方向以 AI 原生运营为主 | P0 |
| UJ-02 | 创建组织与人员 | Admin | 能创建组织、人员、角色，并绑定至少一种通知渠道 | P1 |
| UJ-03 | 创建数字分身 | Admin / 员工 | 为真人创建 Human Twin Agent，设置授权等级、工作时间和通知渠道 | P1 |
| UJ-04 | 创建 AI PM 模板 | 运营负责人 | 能配置 PM Agent 的目标理解、自治等级、可用资源和验收偏好 | P1 |
| UJ-05 | 创建 Routine | 部门经理 | 能创建周期性事项，例如每周卫生检查，并生成下一次 Run | P1 |
| UJ-06 | 创建 Project | 部门经理 | 能创建一次性事项，例如销售线索推进或客户交付 | P2 |
| UJ-07 | Agent 生成 TaskGraph | PM Agent | 从目标生成任务、依赖、执行主体、证据要求和验收规则 | P1 |
| UJ-08 | 人确认后启动 | 部门经理 | L1 模式下，人确认 TaskGraph 后才派发 | P1 |
| UJ-09 | Agent 自动派发 | PM Agent | L2/L3 模式下，低风险任务可自动派发并留审计 | P2 |
| UJ-10 | 信息缺口识别 | PM Agent | Agent 明确说明缺什么信息、为什么缺、谁采、怎么采 | P1 |
| UJ-11 | 现场信息采集 | 一线员工 | 员工通过 IM 或任务页提交照片、文本、评分、文件等证据 | P1 |
| UJ-12 | 数字分身追问补充 | Human Twin Agent | 反馈不完整时，数字分身能追问并保持上下文 | P1 |
| UJ-13 | Agent 验收任务 | PM Agent | 根据证据和验收规则判断完成、需补充、阻塞或失败 | P1 |
| UJ-14 | 动态重规划 | PM Agent | 反馈导致计划变化时，Agent 能新增/调整任务并记录原因 | P2 |
| UJ-15 | 异常升级 | PM Agent / 负责人 | 低置信度、高风险、逾期、冲突任务升级给人 | P1 |
| UJ-16 | 任务施工图谱可观测 | 运营负责人 | 能看到任务依赖、状态、信息缺口、证据和阻塞点 | P1 |
| UJ-17 | Run 复盘 | PM Agent | Run 结束后输出结果、异常、信息缺口、改进建议 | P1 |
| UJ-18 | 模板沉淀 | 运营负责人 | 成功 Run 可沉淀为 Routine/Project 模板 | P2 |
| UJ-19 | Skill 扩散 | Admin / 运营负责人 | 高质量个人/岗位 skill 可推荐为组织 skill | P3 |
| UJ-20 | 接入旧 JueYing workflow | 开发者 / PM Agent | Task 可调用 legacy workflow 作为 Worker Agent 执行底座 | P2 |
| UJ-21 | 接入 proactive 信号 | COO Agent | proactive insight 能触发 TaskGraph，而不只是扁平 mission | P2 |
| UJ-22 | 审计与追溯 | Admin | 每次派发、确认、验收、重规划、授权变化均可追溯 | P1 |
| UJ-23 | 接入 CRM 事实层 | Admin / 销售负责人 | 能读取 CRM 客户、联系人、商机、活动并形成 CRMRecordMirror，Agent Gate 判断不与 CRM 阶段混同 | P1 |
| UJ-24 | CRM 低风险反写 | 销售负责人 / Admin | Note、Task、Activity 等低风险内容可按策略反写，高风险字段生成 Writeback Intent 等待确认 | P1 |
| UJ-25 | 接入项目管理事实层 | Admin / 交付负责人 | 能读取 Jira、禅道、TAPD、飞书项目或自研系统任务并形成 PMRecordMirror，外部任务状态不等同 Agent Task 状态 | P1 |
| UJ-26 | 项目管理低风险反写 | 交付负责人 / Admin | Comment、Evidence Link、风险摘要可按策略反写，状态、负责人、截止时间等关键字段需确认 | P1 |

## 4. MVP 故事线：每周卫生检查

### 4.1 前置条件

- 已创建组织。
- 已创建两名员工及其 Human Twin Agent。
- Human Twin Agent 授权为 `notify + collect + draft`。
- 已创建 Routine Manager Agent。
- 通知渠道至少支持一种：IM 或任务页。

### 4.2 用户步骤

1. 部门经理创建 Routine：每周五检查办公室卫生。
2. 填写目标：保持茶水间、会议室、卫生间达到可接待客户标准。
3. 选择自治等级：L1 首次确认后派发。
4. 选择可用人员：张三、李四。
5. Agent 生成 TaskGraph：检查茶水间、检查会议室、检查卫生间、汇总异常、输出复盘。
6. Agent 为每个任务生成证据要求：照片、评分、问题描述、是否需整改。
7. 部门经理确认 TaskGraph。
8. 到周五，Human Twin Agent 提醒对应员工。
9. 员工提交照片和文字。
10. Human Twin Agent 检查反馈完整性，不足时追问。
11. PM Agent 验收任务。
12. 如发现问题，Agent 派生整改任务。
13. 全部完成后，Agent 输出 Run 复盘和下次优化建议。

### 4.3 验收标准

- TaskGraph 至少包含 4 个任务和 1 个依赖关系。
- 每个现场任务必须有证据要求。
- 不完整反馈必须进入 `needs_info` 或 `needs_supplement`。
- 派生整改任务必须记录 `replan_reason`。
- Run 复盘必须包含结果、异常、证据、下次建议。

## 5. 第二场景：销售线索跟进

### 5.1 目标

验证系统能处理非标准化业务信息，而不是只处理行政检查。

销售场景必须遵守 DEV-30 的销售六步法 Gate。CRM 是原有业务事实层，Agent 的 SalesGateCheck 是运营判断层；读取和反写 CRM 必须遵守 DEV-32。

### 5.2 故事线

1. 销售经理创建 Project：推进某条销售线索。
2. 输入目标：确认客户预算、决策链、痛点、下一步会议。
3. PM Agent 判断缺少客户现场信息。
4. Human Twin Agent 给销售发采集要求：拜访时需问哪些问题、记录哪些原话、上传哪些资料。
5. 销售反馈拜访纪要。
6. Human Twin Agent 整理成结构化字段。
7. PM Agent 按当前六步法阶段检查 Gate，并生成 SalesGateCheck。
8. Agent 对照 CRMRecordMirror，判断 CRM 阶段、下一步、活动记录和 Gate 证据是否一致。
9. 若缺关键决策人信息，派生补充任务。
10. 若需要更新 CRM，生成 CRM Writeback Intent；低风险 Note/Task 可按策略自动反写，阶段、金额、预计成交日等字段需确认。
11. 复盘沉淀为销售跟进模板。

### 5.3 验收标准

- Agent 不应只输出“建议跟进”，必须生成明确采集问题。
- 采集结果必须结构化。
- 销售推进判断必须引用 DEV-30 的阶段或 Gate ID。
- CRM 阶段不能单独决定 SalesGateCheck 结果。
- CRM 写回必须经过 DEV-32 的 Mirror、Writeback Intent、Policy、Queue 和 Audit。
- 缺口必须能派生下一步任务。
- 经理看到的是异常和下一步，不是原始流水账；总览必须按当前登录角色聚合行动队列，让负责人、销售/交付 Agent 和采集者先看到自己最该处理的任务、缺口、Gate 或同步事项。

## 6. 第三场景：项目交付同步

### 6.1 目标

验证系统能接入客户或团队已有项目管理系统，让外部项目事实、Agent TaskGraph、交付证据和风险判断保持一致。

项目管理系统是外部项目事实层，Agent 的 TaskGraph 是运营验收事实层；读取和反写项目管理系统必须遵守 DEV-33。

### 6.2 故事线

1. 交付负责人创建 Project：某客户项目交付。
2. Admin 接入项目管理系统：Jira、禅道、TAPD、飞书项目或自研系统。
3. Agent 读取外部 Project、Issue、Task、Comment、Attachment、Milestone，建立 PMRecordMirror。
4. PM Agent 根据合同、交接包和外部任务生成交付 TaskGraph。
5. Agent 发现外部任务已 Done 但缺少验收证据，生成 Information Gap。
6. Human Twin Agent 指导实施人员补充截图、客户确认或交付物链接。
7. Evidence 补齐后，Agent 更新 TaskGraph 验收状态。
8. 如需同步外部项目系统，Agent 生成 PM Writeback Intent；低风险 Comment/Evidence Link 可按策略自动反写，状态、负责人、截止时间需确认。
9. 交付负责人在 External Sync Console 查看镜像新鲜度、冲突、反写队列和审计记录。

### 6.3 验收标准

- 外部任务状态不能单独决定 Agent Task 完成。
- Agent TaskGraph 变更必须记录原因、证据和版本。
- PMRecordMirror 必须保留外部系统字段、更新时间和来源链接。
- PM 写回必须经过 DEV-33 的 Mirror、Writeback Intent、Policy、Queue 和 Audit。
- 项目管理系统不可用时，系统应降级为只读快照、报告链接或人工补录，而不是丢失 Agent 运营事实。

## 7. 端到端准出规则

| 类别 | 准出要求 |
|---|---|
| 目标理解 | Agent 能把自然语言目标转换为 Project/Routine 设置。 |
| 图谱生成 | TaskGraph 表达任务、依赖、执行主体、证据和验收。 |
| 信息采集 | Agent 能主动说明缺什么信息、怎么采集。 |
| 数字分身 | Human Twin Agent 不越权，能追问和整理。 |
| 状态推进 | 每个 Task 有可追踪状态和更新时间。 |
| 异常升级 | 高风险、逾期、低置信度任务能升级给人。 |
| 复盘沉淀 | Run 结束后能形成复盘和模板候选。 |
| 外部事实同步 | CRM 和项目管理系统通过 Mirror/Writeback Intent 连接，外部状态不得覆盖 Agent 判断。 |
| 审计 | 授权、派发、验收、重规划都可追溯。 |

## 8. 研发前必须回答的问题

- 首个 MVP 是卫生检查还是销售线索跟进。
- L1/L2/L3 的默认自治等级如何选择。
- Human Twin Agent 的最小权限集合是否固定为 `notify + collect + draft`。
- TaskGraph 的状态集合是否独立于 legacy workflow 状态机。
- 旧 workflow 是作为 Worker Agent、子任务执行器，还是模板来源。
- proactive insight 如何映射到 TaskGraph 触发条件。
- CRM 和项目管理系统的 P1 连接器先支持哪些 provider、哪些对象和哪些低风险写回。
