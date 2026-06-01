# DEV-35 核心代码实施路线与自检计划

> 状态：首批可执行资产规划与落地记录
> 读者：负责人、产品、架构、研发、测试、后续 Agent
> 日期：2026-06-01
> 依赖：DEV-23 至 DEV-34

## 1. 目标

本阶段目标不是直接做完整 UI、数据库或外部系统连接器，而是先把文档中最关键的对象和规则落成可执行资产：

- TaskGraph。
- Information Gap。
- Evidence。
- SalesGateCheck。
- External Fact Mirror。
- External Writeback Intent。
- P1 demo fixtures。
- 文档图谱一致性检查。
- 契约与业务红线测试。

这一步完成后，后续 UI、Agent 编排、CRM 对接、项目管理系统对接都可以依赖同一套契约，不会各自理解一套对象。

## 2. 六小时执行切片

| 时间盒 | 目标 | 交付物 | 验证 |
|---|---|---|---|
| 0-1 小时 | 盘点历史 v1 与主版本目录边界 | 确认 `jueying-mainline/` 独立承载主版本契约包，历史 v1 留在兼容层 | 主版本目录结构检查 |
| 1-2 小时 | 建立可执行契约内核 | `src/contracts/*`、`package.json` | `npm run check:contracts` |
| 2-3 小时 | 建立 P1 fixture | `fixtures/p1-demo/*` | fixture 结构与交叉引用检查 |
| 3-4 小时 | 建立文档和图谱检查 | `scripts/check-docs.mjs` | `npm run check:docs` |
| 4-5 小时 | 建立业务红线测试 | `tests/contracts.test.mjs` | `npm test` |
| 5-6 小时 | 补文档索引和后续路线 | DEV-35、README、docs/README | `npm run verify` |

当前已完成前五个切片，并通过本地验证。

## 3. 已落地代码资产

| 路径 | 作用 |
|---|---|
| `package.json` | `jueying-mainline/` Node 工程入口，提供 `check:docs`、`check:contracts`、`test`、`verify`。 |
| `src/contracts/constants.mjs` | 状态、证据类型、自治等级、外部系统类型、销售阶段等枚举。 |
| `src/contracts/schema.mjs` | 最小 JSON Schema 风格契约定义。 |
| `src/contracts/validator.mjs` | 无外部依赖运行时校验器，包含结构校验和关键语义校验。 |
| `src/contracts/sales-gates.mjs` | 读取 `sales-six-step-gates.json`，生成 Gate index 和证据词表。 |
| `src/contracts/index.mjs` | 核心契约导出入口。 |
| `schemas/*.schema.json` | 由 `src/contracts/schema.mjs` 生成的标准 JSON Schema 文件，供前端、后端、Agent 和测试消费。 |
| `fixtures/p1-demo/*` | P1 销售 Discover、CRM Mirror、PM Mirror、Writeback Intent 样例数据。 |
| `scripts/export-schemas.mjs` | 从代码契约导出 JSON Schema，避免手写 schema 漂移。 |
| `scripts/check-docs.mjs` | 文档、图谱、路由、Gate ID、Evidence 词表、场景 ID、主版本目录结构自检。 |
| `scripts/check-contracts.mjs` | fixture 契约校验、销售 Gate 证据词表校验、跨对象引用校验。 |
| `scripts/run-sales-gate-audit.mjs` | 基于 P1 fixture 运行 Discover 阶段 Gate 巡检并生成报告。 |
| `scripts/build-view-models.mjs` | 从 P1 fixture 生成 Operating Console、Management Command Center、TaskGraph、Information Gap、External Sync Console view model。 |
| `reports/sales-gate-audit.discover.acme.json` | Discover 阶段 Gate 巡检样例输出。 |
| `reports/view-models.p1-demo.json` | P1 UI/API view model 样例输出。 |
| `apps/ops-console/server.mjs` | 本地应用服务，提供静态前端、`/api/state`、管理指挥 API、runtime health API 和 `/health`，并处理端口、请求体、timeout 与静态路径边界。 |
| `apps/ops-console/public/*` | P1 运营控制台前端，包含总览、角色行动队列、管理指挥、销售 Gate、TaskGraph、信息缺口、外部同步、故事线验收、主版本能力和契约健康。 |
| `scripts/smoke-app.mjs` | HTTP/API/静态页面冒烟测试，覆盖角色权限、错误 JSON、超大请求体、runtime timeout 兜底和静态路径逃逸。 |
| `scripts/browser-smoke.mjs` | 真实浏览器视图切换、桌面/移动截图、进度条边界、截图新鲜度和控制台错误检查。 |
| `output/playwright/*` | 浏览器自检截图。 |
| `tests/contracts.test.mjs` | 关键业务红线测试。 |

## 4. 当前校验命令

```bash
npm run verify
```

当前通过项：

- 文档审计通过。
- JSON Schema 可由代码导出。
- 契约审计通过。
- Discover 阶段销售 Gate 巡检报告可生成。
- P1 view model 样例可生成。
- 本地应用可启动并通过 HTTP/API 冒烟。
- 浏览器可打开应用、切换主要视图、验证当前视图和登录身份会同步到地址栏、生成本轮桌面/移动截图、确认进度条在 0-100 之间且无控制台错误。
- 32 个销售证据类型与 27 个销售 Gate 对齐。
- 89 个业务红线、视图模型、整合、故事线、操作路径、主版本桥接和文档图谱测试通过。
- Node 严格覆盖率当前达到 100% 行覆盖、100% 分支覆盖和 100% 函数覆盖；严格命令为 `node --experimental-test-coverage --test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100 --test tests/*.test.mjs`。

## 4A. 本地应用运行

```bash
npm run app:start
```

打开：

```text
http://localhost:4173
```

当前应用不是营销页，而是第一屏可操作的运营工作台。它包含：

- Operating Console：任务、Gate、外部镜像、反写队列摘要，以及按当前登录身份排序的角色行动队列。
- Console Resilience：角色快速切换、URL 状态同步、runtime health 异步刷新、异常进度值、错误请求体、超大请求体、非法 timeout 和静态路径逃逸都要清晰降级，不能让用户看到旧状态、丢失上下文或越界 UI。
- Sales Gate：Discover 阶段 D-G1 至 D-G7 巡检结果。
- TaskGraph：任务、依赖、证据、缺口和验收标准。
- Information Gap Inbox：Agent 要求人类补采的信息。
- External Sync Console：CRM/项目管理镜像和反写队列。
- Contract Health：契约校验状态。

## 5. 已固化的业务红线

| 红线 | 当前测试 |
|---|---|
| 已验收 Task 不能没有 Evidence | `accepted task without evidence is rejected` |
| TaskGraph 不能存在依赖环 | `task dependency cycle is rejected` |
| SalesGateCheck 的 stage 必须匹配 Gate ID | `sales gate stage mismatch is rejected` |
| missing gate 必须生成 Information Gap | `missing sales gate without information gap is rejected` |
| 高风险外部系统反写不能自动执行 | `high-risk writeback cannot auto execute` |
| P1 fixture 必须能通过所有契约 | `npm run check:contracts` |

## 6. 下一批核心代码优先级

### P1-A Schema 资产化

把当前 JS object schema 输出为标准 JSON Schema 文件：

- `schemas/task-graph.schema.json`
- `schemas/information-gap.schema.json`
- `schemas/evidence.schema.json`
- `schemas/sales-gate-check.schema.json`
- `schemas/external-fact-mirror.schema.json`
- `schemas/external-writeback-intent.schema.json`

验收：schema 文件由代码生成，不能手写漂移。

当前状态：已完成首版导出，后续应补充 schema 兼容性测试和版本号策略。

### P1-B Agent 输出契约

新增 PM Agent 和 Human Twin Agent 输出契约：

- `pm_agent_plan_output`
- `pm_agent_verify_output`
- `human_twin_collect_prompt`
- `human_twin_collect_result`
- `replan_output`

验收：每个输出都有 fixture 和失败样例。

当前状态：已完成首版 `agentOutput` 契约、fixture 和关键失败测试。

### P1-C Gate 巡检引擎

基于 `sales-six-step-gates.json` 实现：

- 输入 Opportunity 上下文、Evidence、CRM Mirror。
- 输出每个 Gate 的 `SalesGateCheck`。
- 对 missing gate 生成 Information Gap 和推荐 Activity。

验收：Discover 阶段至少覆盖 D-G1 至 D-G7。

当前状态：已完成 Discover 阶段证据类型匹配、SalesGateCheck 生成、Information Gap 生成和报告输出雏形。

### P1-D External Sync Policy

实现通用反写策略：

- low risk Note/Task/Comment/Link 可自动。
- amount、stage、expected close date、status、assignee、due date、priority 必须确认。
- high risk 永不自动。

验收：CRM 与 PM 两类 intent 都有策略测试。

当前状态：已完成首版反写策略函数，覆盖低风险 Note/Comment/Link 自动执行、高风险字段和状态更新需确认。

### P1-E 最小 UI 前准备

先不写页面，先定义 UI view model：

- Operating Console summary。
- Role Action Queue：从管理执行任务、信息缺口、销售 Gate 和外部同步事项推导当前角色的优先下一步。
- TaskGraph View model。
- Information Gap Inbox model。
- External Sync Console model。
- Writeback Queue model。

验收：每个 view model 从 P1 fixture 推导得到稳定 JSON。

当前状态：已完成 Operating Console、Role Action Queue、Management Command Center、TaskGraph View、Information Gap Inbox、External Sync Console view model 推导和报告输出。

### P1-F 控制台韧性和用户体验边界

统一 Ops Console 的本地服务和前端必须对非理想输入保持可解释：

- 前端 `loadState` 和 runtime health 刷新用请求序号防止旧响应覆盖新角色视角。
- 未知视图目标回到总览，避免错误 action 让页面进入空状态。
- 管理泳道和指挥预览里的 `progress_percent` 只用于 0-100 的进度条显示；异常值应夹取或隐藏。
- `PORT` 非法时回到默认端口，runtime health `timeout_ms` 非法或越界时回到安全范围。
- 空 POST body 可按默认指挥预览处理；错误 JSON 返回 400；超大请求体返回 413。
- 静态资源只允许从 `apps/ops-console/public` 目录提供。

验收：`app:smoke` 覆盖 API/静态路径边界，`browser:smoke` 覆盖真实浏览器视图、进度条范围和截图新鲜度。

当前状态：已完成首版边界收紧，并进入 `npm run verify`。

### P1-G 严格覆盖和稀疏输入韧性

契约核心、视图模型和旧主版本适配层必须在严格覆盖阈值下保持可证明：

- 管理视图在没有活动角色时不能泄露执行任务或 TaskGraph 泳道任务。
- 指挥预览在有创建权限但缺少 `user_id` 时保留清晰 `unknown` 委派链兜底。
- Operating Console 排序必须覆盖无效日期、未知优先级和所有已知状态桶。
- JueYing v1 adapter 必须覆盖缺失 `taskGraph.tasks`、workspace 非目录、required path 文件/目录诊断和工作区外路径展示。
- 稀疏 management、storyline matrix、operation path report 和 legacy runtime 数据不能让视图模型或验证器崩溃。

验收：普通 `npm test` 通过，严格覆盖命令必须同时达到 100% lines / branches / functions。

当前状态：已完成严格覆盖闭环，`npm test` 覆盖 89 个用例。

### P1-H 故事线 UI/API 可操作性补强

故事线声明的阶段、Gate 和写类动作必须能被真实 UI/API 验证：

- 管理指挥从预览升级为提交接口，提交后刷新 `management_command_center` 仍能看到新 command 和泳道任务。
- Sales Gate 视图暴露六阶段完整 gate index；P1 样例证据状态与 index-only 状态明确区分。
- Evidence 提交、Information Gap 回复/反驳、Writeback 审批/拒绝、外部连接草案有代表性 POST 路径。
- Operation Path 断言展开 `gate_refs` 范围，并对写类步骤检查 action surface/API。
- Context graph/routing 增加故事线 UI 可操作性召回入口。

验收：`npm test`、`npm run check:docs`、`npm run operation-paths:check`、`npm run app:smoke`、`npm run browser:smoke` 通过。

当前状态：已完成首版可操作性补强，操作路径报告覆盖 46/46 paths、671/671 assertions。

## 7. 不建议立刻做的事

- 不要把历史 v1 UI 搬回仓库外层根目录；所有主版本程序都留在 `jueying-mainline/`。
- 不要先做完整数据库 schema。
- 不要先做真实 CRM/Jira API。
- 不要先做大屏或销售完整工作台。
- 不要把外部系统状态同步成 Agent Task 状态。

原因是当前最重要的风险不是页面缺，而是对象、证据、Gate、缺口、反写策略在代码里是否稳定一致。

## 8. 进入下一阶段的闸门

下一阶段开始前，需要保持：

- `npm run verify` 必须通过。
- 新增对象必须有 schema、fixture、测试。
- 新增销售逻辑必须引用 DEV-30 Gate ID。
- 新增外部系统写入必须走 Writeback Intent。
- 新增完成/验收判断必须引用 Evidence 或 waiver。
