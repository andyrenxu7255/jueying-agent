# DEV-37 角色故事线逐步验收回归记录

日期：2026-05-26

## 目标

本轮目标是把“不同用户角色、不同故事线、不同步骤”的验收从人工口头检查，落成可召回、可执行、可在界面查看的回归资产。

它补齐的是上一轮整合后的关键缺口：原有 `npm run verify` 已经覆盖契约、销售 Gate、旧 JueYing v1 主版本整合、应用和浏览器 smoke，但还没有显式证明每个角色的业务故事线都能落到界面、接口、契约、外部同步和旧主版本能力。

## 已落地资产

新增：

- `docs/role-storyline-acceptance.json`
- `src/contracts/storyline-acceptance.mjs`
- `scripts/run-storyline-acceptance.mjs`
- `reports/storyline-acceptance.json`

接入：

- `npm run storylines:check`
- `npm run verify`
- `/api/storylines`
- `/api/state` 中的 `views.storyline_acceptance`
- Ops Console 的“故事线验收”视图

## 覆盖结果

当前验收覆盖：

| 维度 | 结果 |
|---|---|
| 角色 | 10 个 |
| 故事线 | 11 条 |
| 步骤 | 41 个 |
| 场景故事 | 101 / 101 |
| 销售 Gate | 27 / 27 |

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

## 验收逻辑

每个步骤必须说明：

- 引用哪些 `SS-*`、`PD-*`、`XS-*` 场景故事。
- 若属于销售六步法 Gate 判断，引用哪些 `D-G*` 至 `N-G*` Gate。
- 使用哪些能力域，例如 `taskgraph_engine`、`information_gap_engine`、`crm_fact_sync`、`project_management_fact_sync`、`legacy_workflow_adapter`。
- 落到哪些界面视角，例如总览、销售 Gate、TaskGraph、信息缺口、外部同步、主版本整合、故事线验收。
- 落到哪些接口，例如 `/api/state`、`/api/storylines`、`/api/legacy/bridge-preview`。
- 依赖哪些契约，例如 `taskGraph`、`informationGap`、`evidence`、`salesGateCheck`、`externalFactMirror`、`externalWritebackIntent`、`agentOutput`、`legacyBridge`。
- 是否需要 CRM 或项目管理系统镜像和反写意图。
- 是否需要旧 JueYing v1 主版本能力，并检查 adapter 是否 ready。

## 修复的问题

本轮发现并修复：

1. 缺少角色故事线验收资产。
2. 缺少 `/api/storylines` 接口。
3. 控制台缺少面向业务角色的验收视图。
4. 原浏览器自检没有覆盖故事线验收页面。
5. 原测试只证明契约和整合通过，未证明所有角色故事线覆盖。

## 当前边界

当前验收是 P1 可执行回归，不等于所有真实外部系统已在线联调完成。

已经验证：

- 角色故事线、步骤、场景故事和销售 Gate 覆盖完整。
- 每个步骤都有已实现 UI/API/契约/能力域落点。
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
npm run app:smoke
npm run browser:smoke
npm run verify
```

预期结果：

- `storylines:check` 输出 10 个角色、11 条故事线、41/41 步骤、101/101 故事、27/27 Gate。
- `app:smoke` 验证 `/api/storylines` 和页面入口存在。
- `browser:smoke` 点击“故事线验收”并验证销售负责人、项目经理和 `41/41` 可见。
- `verify` 串联全部文档、契约、Gate、故事线、主版本整合、应用和浏览器验收。
