# DEV-34 文档图谱一致性审计与修复记录

> 状态：持续一致性审计记录
> 读者：负责人、产品、架构、研发、测试、后续 Agent
> 最近审计日期：2026-05-31
> 依赖：DEV-23 至 DEV-38、context-graph.json、context-routing.json、scenario-coverage.json、sales-six-step-gates.json、role-storyline-acceptance.json、src/contracts、src/integrations/jueying-v1、apps/ops-console、tests/contracts.test.mjs

## 1. 审计结论

2026-05-31 全量审计未发现会推翻产品方向、对象模型或运行架构的根本矛盾。当前文档、图谱、代码、测试和故事线主线成立：

- JueYing 主版本已收敛到 `jueying-mainline/`，AI 原生运营中枢默认内置在主版本里，历史 JueYing v1 只作为运行时兼容层。
- 北极星不是“重做 CRM”或“重做项目管理系统”，而是在企业已有事实层之上建立 Agent 运营判断层。
- Agent 可以成为大量日常运营判断的主体，但它最大的落地限制是传感器不足。
- Human Twin Agent 的核心价值是通知、追问、整理、草稿和授权代理，不是把人降格为工具。
- TaskGraph 是运营执行事实中心，CRM 阶段和外部项目任务状态只能作为输入事实，不能直接等同 Agent 判断。
- Sales Six-Step Gate 是销售推进的主干，所有销售阶段质量必须回到 Gate、Evidence、Information Gap 和推荐 Activity。
- CRM 和项目管理系统必须通过 External Fact Mirror、Writeback Intent、Policy、Queue 和 Audit 保持事实一致。
- 角色故事线验收已进入可执行资产，覆盖 10 个角色、12 条故事线、46 个步骤、101 个场景故事和 27 个销售 Gate。
- 角色操作路径测试已把 46 个步骤物化为 46 个可执行测试用例和 478 条断言，覆盖 UI、API、契约、fixture、外部同步和旧主版本桥接路径。
- 管理指挥中心已进入统一 Ops Console，覆盖老板/经营负责人登录视角、即时下发、定时任务、条件触发、Agent 委派链、项目泳道和项目组合，不再只是独立看板设想。
- JueYing 主版本能力整合已通过离线 adapter、桥接 payload、runtime health 降级检查、应用 API 和浏览器 smoke 进入 `npm run verify`。
- DEV-38 记录的在线联调属于真实运行时验证资产，默认不强制要求 Docker 服务在线，但必须能从文档入口、图谱和路由召回。

本轮发现的问题主要是索引、机器召回和逐操作路径验证防漂移不够严格：根 README 漏列 DEV-37 和角色验收矩阵，context graph 未显式收录 DEV-38 在线联调资产，`check:docs` 过去只检查“路径存在”，没有要求所有活跃文档和关键 JSON 资产都能从入口、图谱、路由召回；角色故事线过去只证明步骤覆盖，没有把每个步骤展开为可执行的 UI/API/契约/fixture/外部同步/旧主版本桥接断言。已在本轮修复并写入自动审计。

## 2. 已修复问题

| 问题 | 风险 | 修复 |
|---|---|---|
| 根 README 漏列 DEV-37 和 `role-storyline-acceptance.json` | 后续 Agent 或研发只读根入口时会漏掉角色故事线验收主资产 | 已补齐根 README Active Docs。 |
| `context-graph.json` 未显式收录 DEV-38 在线联调资产 | 运行时联调经验可能只存在文档索引中，无法被机器召回到集成路线 | 已加入 `live_runtime_bridge_validation` authority 和概念节点。 |
| `context-routing.json` 缺少在线联调任务路线 | 修复 legacy runtime、Docker smoke、runtime health 时可能漏读 DEV-38 和 live smoke 脚本 | 已新增 `live_runtime_bridge_validation` 路由，并将 DEV-38 加入默认召回、集成、UI、实施和故事线相关路线。 |
| `check:docs` 对入口/图谱/路由完整性检查不够严格 | 新增文档或关键 JSON 资产可能路径存在但不可召回 | 已新增活跃文档入口检查、关键 JSON 入口检查、context graph/routing 覆盖检查、authority/concept authority 路径检查。 |
| README 与 docs/README 对 DEV-31 的描述漏掉 External Fact Mirror 和 Writeback Intent | 后续 Agent 可能只按 TaskGraph/Gap/Evidence 理解最小契约 | 已更新两个索引入口。 |
| DEV-23 总纲没有把 CRM/项目管理系统作为外部事实层提前说明 | 产品方向可能被误读为替代客户原有系统 | 已补充 External Fact Mirror、Writeback Intent，并加入反模式。 |
| DEV-25 用户故事线缺少外部事实层故事 | P1 可能只做内部 TaskGraph，导致事实分裂 | 已新增 UJ-23 至 UJ-26，并新增项目交付同步故事线。 |
| DEV-27 P1 范围没有显式列出外部事实同步 | 研发排期可能把 CRM/PM 同步后置 | 已加入 External Fact Mirror、Writeback Intent、冲突提示、测试和 demo 数据。 |
| DEV-29 曾存在 evidence type 重复和部分销售 Gate 证据词汇缺口 | Gate 引擎和 Evidence schema 容易不一致 | 已补齐 Gate 证据类型，并移除重复项。 |
| DEV-29 末尾曾保留过时的后续文档指向 | 后续节奏可能继续扩写概念而不是进入契约 | 已改为进入 schema、fixture、契约测试和端到端验收脚本。 |
| DEV-31 正文已包含外部事实镜像，但索引和早期文档未同步 | 人读和 Agent 路由得到不同结论 | 已同步索引、总纲、故事线和研发闸门。 |
| 角色故事线验收没有逐步物化为操作路径测试 | 只能说明故事线矩阵覆盖，不能证明每个角色的每一步都具备可执行 UI/API/契约/fixture/外部同步/旧主版本桥接证据 | 已新增 `operation-paths:check`、`reports/role-operation-path-tests.json`、`/api/operation-paths`、Ops Console 操作路径视图和单元/应用/浏览器验证。 |
| 管理层任务下发曾只停留在故事线概念 | 老板无法在统一网页端按权限下发即时/定时/条件任务，也看不到项目泳道和 Agent 委派链 | 已新增 `managementCommandCenter` 契约、P1 fixture、`/api/management/command-center`、`/api/management/dispatch-preview`、Ops Console“管理指挥”视图和单元/应用/浏览器验证。 |

## 3. 不得破坏的一致性规则

| 规则 | 说明 | 权威文档 |
|---|---|---|
| JueYing 主版本优先 | `jueying-mainline/` 的主线是面向中小团队集中管理的企业级 Agent Harness，不是历史 v1 页面延续 | DEV-23、DEV-24 |
| 旧系统只作底座 | legacy workflow、skill、proactive、org_task 可复用，但不作为新产品抽象 | DEV-24、DEV-26 |
| 人类不是工具 | 真人是责任主体、现场执行者和信息采集者；Human Twin Agent 是系统接口 | DEV-23、DEV-25 |
| 信息缺口是一等对象 | Agent 传感器不足必须产品化为 Information Gap，而不是临时聊天追问 | DEV-23、DEV-26、DEV-31 |
| TaskGraph 独立于 workflow | TaskGraph 是上层运营图谱，workflow 可作为执行底座 | DEV-24、DEV-26、DEV-31 |
| 销售遵守六步法 Gate | 销售阶段推进必须基于 D-G1 至 N-G4，而不是 CRM 阶段文本 | DEV-30、sales-six-step-gates.json |
| CRM 是外部事实层 | CRMRecordMirror 是快照，CRMWritebackIntent 是反写意图，Agent 不直接覆盖关键字段 | DEV-32 |
| 项目管理系统是外部事实层 | PMRecordMirror 是快照，PMWritebackIntent 是反写意图，外部任务状态不等同 Agent Task 状态 | DEV-33 |
| 证据驱动验收 | 完成、通过、关闭、验收都必须绑定 Evidence 或明确 waiver | DEV-29、DEV-31 |
| 审计不可后置 | 授权、派发、验收、重规划、反写、确认都必须可追溯 | DEV-27、DEV-31、DEV-32、DEV-33 |

## 4. 故事线覆盖审计

| 场景 | 当前覆盖 | 缺口判断 |
|---|---|---|
| 行政 Routine | DEV-25 覆盖卫生检查闭环，能验证基础 AI 管事 | 足够作为第一个低风险 MVP。 |
| 销售推进 | DEV-28 + DEV-30 覆盖线索、Discover、Scope、Go/No-Go、验证、Business Case、谈判关闭、复盘 | 主线充分，后续应进入 schema 和测试，而不是继续抽象。 |
| CRM 同步 | DEV-32 覆盖读取、镜像、字段归属、反写意图、策略、冲突和审计 | P1 范围已明确，应做 provider 能力分级和样例 fixture。 |
| 项目交付 | DEV-28 覆盖 PD-01 至 PD-44，包含交接、需求、现场、计划、执行、质量、变更、验收、回款、复盘和外部项目同步 | 主线充分，需把关键故事转成 E2E 验收脚本。 |
| 项目管理同步 | DEV-33 覆盖 Jira、禅道、TAPD、飞书项目、Teambition、Asana、Monday、ClickUp、Linear、MS Project 和自研系统 | P1 需先做只读镜像和低风险 Comment/Evidence Link 反写。 |
| 跨场景治理 | DEV-25、DEV-28、DEV-29 覆盖权限、打扰控制、审计、legacy 接入 | 足够支撑 P1。 |
| 角色故事线验收 | DEV-37 + `role-storyline-acceptance.json` 覆盖 10 个业务和 Agent 角色、12 条故事线、46 个步骤 | 已经进入 `storylines:check`、`app:smoke`、`browser:smoke` 和 `npm run verify`。 |
| 角色操作路径测试 | `role-storyline-acceptance.json` + `operation-path-tests.mjs` 生成 46 个测试用例和 478 条断言，逐项检查 UI/API/契约/fixture/外部同步/旧主版本桥接 | 已经进入 `operation-paths:check`、`/api/operation-paths`、Ops Console 故事线验收视图、`app:smoke`、`browser:smoke` 和 `npm run verify`。 |
| 管理指挥中心 | `management-command-center.json` + Ops Console 管理指挥视图覆盖老板 -> PM Agent -> 专门 Agent -> 下属/Worker 的即时、定时、条件触发和泳道项目管理 | 已经进入 `check:contracts`、`storylines:check`、`operation-paths:check`、`app:smoke`、`browser:smoke` 和 `npm run verify`。 |
| JueYing 在线联调 | DEV-38 + `legacy:live-smoke` 记录 workflow、org_task、fact 写入的真实 runtime 链路 | 在线 Docker 服务不作为默认 verify 前置，但文档、图谱、路由和脚本必须保持一致。 |

## 5. 依赖闭环审计

当前依赖链应按以下顺序理解：

1. DEV-23 定义北极星、人机分工、对象和 Agent 组织。
2. DEV-25 定义端到端用户旅程。
3. DEV-30 定义销售六步法 Gate 权威模型。
4. DEV-28 穷举销售、交付和跨场景故事。
5. DEV-29 将故事映射为能力、对象、UI、测试和补洞清单。
6. DEV-31 给出 TaskGraph、Information Gap、Evidence、SalesGateCheck、External Fact Mirror、Writeback Intent 和 Agent 输出最小契约。
7. DEV-32 细化 CRM 外部事实层同步。
8. DEV-33 细化项目管理外部事实层同步。
9. DEV-26 汇总对象依赖、系统图谱和 legacy 接入边界。
10. DEV-27 定义研发前闸门、风险和 P1 范围。
11. DEV-34 记录一致性审计结果和未来改动自检规则。
12. DEV-35 至 DEV-38 记录契约代码、主版本整合、角色故事线验收和在线联调结果。

如果后续文档修改改变以上任一依赖顺序，必须同步更新 `README.md`、`docs/README.md`、`context-graph.json` 和 `context-routing.json`。

## 6. 图谱与机器召回规则

后续 Agent 召回时应遵守：

- 产品方向、核心概念和人机分工：先读 DEV-23。
- 用户旅程、端到端验收：读 DEV-25。
- 销售阶段、Gate、Activities、证据类型：读 DEV-30 和 `sales-six-step-gates.json`。
- 场景故事和 UI 视角：读 DEV-28。
- 能力缺口、P1/P2/P3 边界、测试矩阵：读 DEV-29。
- 数据契约、管理指挥中心和 Agent 输出：读 DEV-31。
- CRM 对接：读 DEV-32。
- 项目管理系统对接：读 DEV-33。
- 契约代码和测试路线：读 DEV-35。
- JueYing 主版本能力整合：读 DEV-36。
- 角色故事线验收：读 DEV-37 和 `role-storyline-acceptance.json`。
- 角色操作路径测试：读 `src/contracts/operation-path-tests.mjs`、`scripts/run-operation-path-tests.mjs` 和 `reports/role-operation-path-tests.json`。
- 老板任务下发、定时任务、条件触发和项目泳道：读 DEV-31、DEV-37、`fixtures/p1-demo/management-command-center.json` 和 `apps/ops-console/public/app.js`。
- 在线 runtime 联调：读 DEV-38 和 `scripts/live-legacy-bridge-smoke.mjs`。
- 对象图谱、状态机、legacy 接入：读 DEV-26。
- 研发闸门和不做清单：读 DEV-27。
- 一致性和历史修复记录：读 DEV-34。

不要从 legacy `development/context-graph.json` 推导新系统方向。旧 context 文件只作为历史参考。

## 7. 未来改动自检清单

每次新增或修改故事线、对象、契约、图谱或路由时，至少检查：

| 检查项 | 必须满足 |
|---|---|
| 文档入口 | 根 README 和 docs/README 能找到新文档或新方向。 |
| 机器图谱 | `context-graph.json` 和 `context-routing.json` 包含必要召回入口，且 `npm run check:docs` 能验证覆盖。 |
| 场景 ID | 新故事必须使用 `SS-*`、`PD-*`、`XS-*` 或新增前缀，并进入覆盖索引。 |
| 销售 Gate | 销售相关变更必须引用 DEV-30 或 `sales-six-step-gates.json` 的 Gate ID。 |
| Evidence | 新判断必须能落到 Evidence、waiver 或 Information Gap。 |
| 外部事实层 | CRM/PM 字段不得绕过 Mirror、Writeback Intent、Policy、Queue 和 Audit。 |
| UI 入口 | 新能力必须说明在哪个界面完成确认、补充、验收、冲突处理或复盘。 |
| 角色验收 | 影响业务角色或 Agent 行为的能力必须同步 `role-storyline-acceptance.json` 或说明为何不影响现有步骤。 |
| 操作路径测试 | 新增或修改角色步骤时必须保持 `operation-paths:check` 生成完整测试用例，且 UI/API/契约/fixture/外部同步/旧主版本桥接断言不能退化。 |
| 管理指挥 | 老板下发任务、定时任务、条件触发或项目看板变更必须同步 `managementCommandCenter` fixture、管理视图、API、故事线和浏览器 smoke。 |
| 在线联调 | 影响 legacy runtime 桥接、端口、健康路径或 payload 的改动必须同步 DEV-38、`live-legacy-bridge-smoke.mjs` 和对应报告口径。 |
| P1 边界 | 若进入 P1，必须能说明为什么是最小闭环所需。 |
| 反模式 | 不能把旧 workflow、CRM 阶段、外部项目状态直接改名为新系统事实。 |
| 测试 | 至少能写出一个契约测试或端到端验收脚本断言。 |

## 8. 当前可运行判断

当前主线已经从“机器可校验资产准备”推进到“本地可执行主版本验收”阶段：

- JSON Schema 已由 `src/contracts/schema.mjs` 导出到 `schemas/`。
- P1 fixture 覆盖 TaskGraph、Information Gap、Evidence、SalesGateCheck、External Fact Mirror、Writeback Intent、Management Command Center 和 Agent Output。
- `npm run verify` 串联 schema export、文档审计、契约审计、销售 Gate 审计、视图模型、角色故事线、操作路径测试、主版本整合、legacy smoke、单元测试、应用 smoke 和浏览器 smoke。
- `npm run legacy:live-smoke` 作为需要 Docker 在线时的真实运行时验证入口，不纳入默认离线 verify。

后续新增文档不应只扩写概念；必须服务于 schema、fixture、contract test、storyline acceptance、operation path tests、runtime bridge smoke、UI/API smoke 或真实 provider 联调。
