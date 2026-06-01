# DEV-37 角色故事线逐步验收回归记录

日期：2026-06-01

## 目标

本轮目标是把“不同用户角色、不同故事线、不同步骤、不同操作路径”的验收从人工口头检查，落成可召回、可执行、可在界面查看的回归资产。

它补齐的是上一轮整合后的关键缺口：原有 `npm run verify` 已经覆盖契约、销售 Gate、旧 JueYing v1 主版本整合、应用和浏览器 smoke，但还没有显式证明每个角色的业务故事线和每一步操作路径都能落到界面、接口、契约、fixture、外部同步和旧主版本能力。

## 已落地资产

新增：

- `docs/role-storyline-acceptance.json`
- `src/contracts/storyline-acceptance.mjs`
- `src/contracts/operation-path-tests.mjs`
- `scripts/run-storyline-acceptance.mjs`
- `scripts/run-operation-path-tests.mjs`
- `reports/storyline-acceptance.json`
- `reports/role-operation-path-tests.json`

接入：

- `npm run storylines:check`
- `npm run operation-paths:check`
- `npm run verify`
- `/api/storylines`
- `/api/operation-paths`
- `/api/state` 中的 `views.storyline_acceptance`
- `/api/state` 中的 `views.operation_path_tests`
- Ops Console 的“故事线验收”视图

## 覆盖结果

当前验收覆盖：

| 维度 | 结果 |
|---|---|
| 角色 | 10 个 |
| 故事线 | 12 条 |
| 步骤 | 46 个 |
| 场景故事 | 101 / 101 |
| 销售 Gate | 27 / 27 |
| 操作路径测试用例 | 46 / 46 |
| 操作路径断言 | 671 / 671 |
| UI 视角 | 8 个 |
| API 视角 | 6 个 |
| 契约引用 | 9 个 |
| 外部同步路径 | 9 个 |
| 旧主版本桥接路径 | 7 个 |

覆盖角色包括：

- 企业负责人 / COO
- 销售负责人
- 销售人员
- 交付负责人
- 项目经理
- 一线执行者 / 现场信息采集者
- Admin / IT
- Project Manager Agent
- Human Twin Agent
- Worker Agent

新增管理指挥故事线覆盖：

- 老板 / COO 以登录后的经营负责人视角进入统一 JueYing 管理指挥中心。
- 老板即时下发经营任务，由运营 PM Agent 拆成 TaskGraph，再委派给销售 Agent、交付 Agent、Worker Agent 或 Human Twin / 下属人员。
- 老板安排定时巡检任务，例如每周经营节奏、销售 Gate、交付风险和外部反写巡检。
- 老板配置条件触发任务，例如项目延期、缺证据、客户无下一步或外部系统状态异常。
- 老板通过项目泳道图查看计划、委派、执行、缺信息、待验收和完成状态，范围不限销售，也覆盖交付、运营、治理和自定义组织项目。

## 验收逻辑

每个步骤必须说明：

- 引用哪些 `SS-*`、`PD-*`、`XS-*` 场景故事。
- 若属于销售六步法 Gate 判断，引用哪些 `D-G*` 至 `N-G*` Gate。
- 使用哪些能力域，例如 `taskgraph_engine`、`information_gap_engine`、`crm_fact_sync`、`project_management_fact_sync`、`legacy_workflow_adapter`。
- 落到哪些界面视角，例如总览、管理指挥、销售 Gate、TaskGraph、信息缺口、外部同步、主版本整合、故事线验收。
- 落到哪些接口，例如 `/api/state`、`/api/management/command-center`、`/api/management/dispatch-preview`、`/api/storylines`、`/api/legacy/bridge-preview`。
- 依赖哪些契约，例如 `taskGraph`、`informationGap`、`evidence`、`salesGateCheck`、`externalFactMirror`、`externalWritebackIntent`、`managementCommandCenter`、`agentOutput`、`legacyBridge`。
- 是否需要 CRM 或项目管理系统镜像和反写意图。
- 是否需要旧 JueYing v1 主版本能力，并检查 adapter 是否 ready。

每个操作路径测试会把上述步骤继续展开为可执行断言：

- `acceptance_step_pass`：先证明角色故事线步骤本身已经通过。
- `operation_path_has_action_and_expected_result`：每一步必须有明确动作和预期结果。
- `operation_path_has_ui_api_and_contract_surfaces`：每一步必须同时绑定 UI、API 和契约落点。
- `ui_*`、`api_*`、`contract_*`：逐项验证声明的界面、接口和契约确实存在且可用。
- `fixture_*`：验证 P1 fixture 覆盖任务状态、缺口状态、证据类型、Gate 状态、Agent 输出或外部系统。
- `external_sync_*`：涉及 CRM/PM 外部事实层的步骤必须同时存在 Mirror 和 Writeback Intent。
- `legacy_bridge_preview` 和 `legacy_capability_*`：涉及旧主版本能力的步骤必须具备桥接 payload 和 adapter-ready capability。

## 修复的问题

本轮发现并修复：

1. 缺少角色故事线验收资产。
2. 缺少 `/api/storylines` 接口。
3. 控制台缺少面向业务角色的验收视图。
4. 原浏览器自检没有覆盖故事线验收页面。
5. 原测试只证明契约和整合通过，未证明所有角色故事线覆盖。
6. 原验收只证明“步骤可覆盖”，未把每个步骤物化成独立操作路径测试用例。
7. Ops Console 原来没有展示逐角色操作路径断言通过情况。
8. 原控制台缺少老板登录视角、任务下发、定时任务、条件触发和项目泳道图的统一管理工作台。
9. 2026-06-01 继续补齐故事线 UI/API 可操作性：管理指挥提交、Evidence 提交、Information Gap 回复/反驳、Writeback 审批/拒绝、外部连接草案和六阶段 Gate index 都进入 API、页面和操作路径断言。
10. 2026-06-01 修正旧验收数字：操作路径断言已增至 671，本文和 DEV-34 均以 `reports/role-operation-path-tests.json` 为准。

## 当前边界

当前验收是 P1 可执行回归，不等于所有真实外部系统已在线联调完成。

已经验证：

- 角色故事线、步骤、场景故事和销售 Gate 覆盖完整。
- 每个步骤都有已实现 UI/API/契约/能力域落点。
- 每个步骤已经生成独立操作路径测试用例，覆盖 UI/API/契约/fixture/外部同步/旧主版本桥接断言。
- 老板 -> 运营 PM Agent -> 专门 Agent -> 下属/Worker 的委派链已进入 `managementCommandCenter` fixture、视图模型、API 和 Ops Console。
- 定时任务、条件触发任务和项目泳道图已作为统一控制台能力进入本地验收。
- 老板下发任务后，`generated_task_ids`、`execution_tasks` 和 `execution_updates` 证明 PM Agent 自动拆解、人员/Agent 执行进展、阻塞和结果能回流到泳道卡片。
- CRM 和项目管理系统通过 External Fact Mirror / Writeback Intent 保持预留与样例闭环。
- 旧主版本能力通过 adapter、桥接 payload 和 runtime health 降级检查进入验收。

尚未验证：

- 真实 CRM provider SDK 在线读写。
- 真实 Jira、禅道、TAPD、飞书项目或自研项目管理系统在线读写。
- legacy 多服务、数据库、Redis、MinIO 全量在线联调。
- 真实组织成员通过 IM 长周期提交反馈。

这些属于下一阶段在线联调任务，不影响当前角色故事线的本地可执行验收。

## 验收命令

```bash
npm run storylines:check
npm run operation-paths:check
npm run app:smoke
npm run browser:smoke
npm run verify
```

预期结果：

- `storylines:check` 输出 10 个角色、12 条故事线、46/46 步骤、101/101 故事、27/27 Gate。
- `operation-paths:check` 输出 10 个角色、46/46 操作路径、671/671 断言，并生成 `reports/role-operation-path-tests.json`。
- `app:smoke` 验证 `/api/storylines`、`/api/management/command-center`、`/api/management/dispatch-preview` 和页面入口存在。
- `app:smoke` 验证 `/api/operation-paths` 和 `/api/state` 中的操作路径视图存在且全通过。
- `browser:smoke` 点击“管理指挥”并验证登录视角、下发任务、自动拆解、执行进展/结果、定时任务、条件触发、项目泳道、URL 状态同步和指挥预览可见；点击“故事线验收”并验证销售负责人、项目经理、`46/46`、`Operation Paths`、`Assertions` 和 `671/671` 可见。
- `verify` 串联全部文档、契约、Gate、故事线、操作路径、主版本整合、应用和浏览器验收。
