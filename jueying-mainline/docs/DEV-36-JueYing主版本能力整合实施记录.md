# DEV-36 JueYing 主版本能力整合实施记录

日期：2026-05-26

## 目标

本轮目标不是另建一个孤立的新系统样例，而是把升级后的 AI 原生运营中枢归并为 JueYing 主版本的默认能力。JueYing 的产品定义是面向中小团队集中管理的企业级 Agent Harness；运营总览、销售 Gate、TaskGraph、信息缺口、外部事实同步和故事线验收都应视为 JueYing 主版本能力，而不是 JueYing 旁边的第二个程序。

整合原则：

- `jueying-mainline/` 是 JueYing 主版本工作区，包含应用、契约、脚本、测试、文档、图谱和历史运行时兼容层。
- `legacy/jueying-v1/agent-harness/` 是历史 v1 代码和运行时兼容层，不再代表另一个并列产品。
- 主版本通过适配层发现、映射、调用和验证 v1 运行时能力。
- 对外产品语言使用 JueYing mainline / JueYing Agent Harness；`legacy` 仅作为内部迁移兼容命名。

## 已落地代码

### 主版本能力适配层

新增：

- `src/integrations/jueying-v1/capability-map.mjs`
- `src/integrations/jueying-v1/adapter.mjs`
- `src/integrations/jueying-v1/runtime-client.mjs`
- `src/integrations/jueying-v1/index.mjs`

适配层当前覆盖 11 个主版本能力域：

1. Workflow 编排主干
2. Executor 执行器主干
3. 事实检索与证据层
4. 渠道接入与 Human Twin 入口
5. 组织任务分发
6. 技能库与工作流模板
7. 主动运营编排
8. 旧主版本管理门户
9. 审计、权限和身份
10. 记忆、梦境与归因
11. 移动通知与提醒

适配层会检查：

- legacy package 和 workspace package 是否存在
- 每个能力域的关键源码路径是否存在
- 每个能力域的 package scripts 是否存在
- legacy shared schema 中是否存在对应表
- 旧接口路由、数据对象、桥接契约和切换阶段是否能被新系统召回

### 桥接契约函数

已实现第一批可执行转换：

- `taskGraphToLegacyWorkflowPlan`
- `informationGapToLegacyOrgTask`
- `evidenceToLegacyFactWrite`
- `writebackIntentToLegacyAuditEvent`

这些函数把新系统对象投影到旧主版本可接受的工作流、派单、事实写入和审计 payload。它们不是最终在线调用层，但已经把“新对象如何落到旧主版本能力”变成可测试代码。

### 运行时调用客户端

`runtime-client.mjs` 提供旧主版本在线时的统一调用封装：

- `createWorkflowFromTaskGraph`
- `createOrgTaskFromInformationGap`
- `writeFactFromEvidence`
- `health`

客户端读取 `JUEYING_WORKFLOW_URL`、`JUEYING_GATEWAY_URL`、`JUEYING_FACT_RETRIEVAL_URL` 和 `JUEYING_INTERNAL_TOKEN`。当旧服务离线、超时或返回非成功状态时，客户端返回 `degraded: true`，并保留已生成的桥接 payload，便于控制台解释“准备好了什么、卡在哪里”。

### 控制台接入

`apps/ops-console/server.mjs` 新增主版本 API：

- `/api/jueying/mainline/capabilities`
- `/api/jueying/mainline/bridge-preview`
- `/api/jueying/mainline/runtime-health`

兼容期保留：

- `/api/legacy/capabilities`
- `/api/legacy/bridge-preview`
- `/api/legacy/runtime-health`
- `/api/state` 中的 `views.legacy_integration`

`apps/ops-console/public/` 新增主版本能力视图：

- 展示关键能力 ready 比例
- 展示旧路由、旧数据对象、桥接契约数量
- 按编排执行、人类闭环、事实证据、复利能力、界面入口分组展示能力状态
- 展示运营中枢能力归并到 JueYing 主版本的路线

### 自检脚本

新增：

- `npm run integration:check`
- `npm run legacy:smoke`

`integration:check` 生成：

- `reports/legacy-integration.jueying-v1.json`

`legacy:smoke` 当前做轻量自检：

- legacy M0 文件结构检查
- legacy Web Portal `localization.js` 语法检查
- legacy Web Portal `app.js` 语法检查

同时修复了 legacy `scripts/validate-m0.js` 的旧绝对路径，让它能在归档路径下继续工作。

## 主版本能力到新系统对象映射

| 旧主版本能力 | 新系统对象 | 当前整合方式 |
|---|---|---|
| `workflow-service` | `TaskGraph` / `Run` / `Task` | `TaskGraph` 转 legacy workflow plan |
| `executor-gateway` | `Worker Agent` / `AgentOutput` | legacy execution result 归一化 |
| `fact-retrieval` | `Evidence` / `Fact` / `RetrievalTrace` | Evidence 投影到 fact/document/evidence pack |
| `gateway-adapter` | `Human Twin Agent` / channel session | 信息缺口通过渠道下发 |
| `org_task` | `Assignment` / `Information Gap Work Order` | Information Gap 转 org_task |
| `skill-library` | `Skill` / `Workflow Template` | 成功工作流沉淀为技能候选 |
| `proactive-orchestrator` | `COO Signal Layer` | insight 转 TaskGraph / org_task |
| `web-portal` | Legacy surface / migration source | 新控制台逐步接管旧页面 |
| `audit` / `policy` / `identity` | `Audit Event` / `Policy Snapshot` / `Human Twin Identity` | 反写、确认、身份绑定事件投影 |
| `hermes-adapter` / dream mode | `Memory` / `Recall Attribution` | 记忆汇总作为 Agent 上下文 |
| `mobile-app` | `Notification` / inbox badge | 信息补采提醒通道 |

## 接管阶段

1. 发现与只读映射
   - 新系统能定位 legacy 代码、脚本、路由、数据表和关键能力，不依赖旧系统在线。

2. 契约转换
   - `TaskGraph`、`Information Gap`、`Evidence`、`Writeback Intent` 能转换成 legacy workflow、org_task、fact、audit payload。

3. 运行时代理
   - legacy 服务在线时，新系统能健康检查并按能力路由调用；离线时保留静态适配状态。

4. 事实层一致
   - CRM/项目管理镜像、legacy fact/evidence 和 Agent fact layer 有明确冲突策略和反写策略。

5. 界面接管
   - 新 Ops Console 承接旧 Portal 的主能力入口，旧 Portal 退为排障和迁移参考。

## 当前边界

已经完成：

- 主版本能力整合图谱落地为代码
- 离线适配检查和轻量 legacy smoke
- 新系统 API 和 UI 展示整合状态
- 新系统测试覆盖旧能力发现和核心 payload 转换
- 运行时客户端支持旧 workflow、org_task、fact 写入的在线调用与离线降级

尚未完成：

- 在线启动 legacy 多服务并执行真实 workflow
- 连接 PostgreSQL/Redis/MinIO 后跑 legacy 全量集成测试
- 把新控制台每个按钮直接代理到 legacy runtime 并提供人工确认操作
- CRM/项目管理真实 connector 的 provider SDK 实现

这些不是概念缺口，而是后续运行时联调阶段的工作。

## 验收命令

从 `jueying-mainline/` 执行：

```bash
npm run integration:check
npm run legacy:smoke
npm run verify
```

预期：

- `integration:check` 输出 legacy integration OK
- `legacy:smoke` 输出 3 项检查 OK
- `verify` 串联文档、契约、销售 Gate、整合、自检、应用和浏览器 smoke

## 下一步开发建议

优先级一：

- 新增 runtime proxy，按 `JUEYING_*_URL` 调用在线 legacy 服务。
- 对 `/api/legacy/capabilities` 增加在线健康检查状态。
- 把 `Information Gap -> org_task -> assignment -> Evidence` 做成第一条真实闭环。

优先级二：

- 把 `TaskGraph -> workflow-service -> executor-gateway -> workflow progress` 做成第一条真实 workflow 闭环。
- 把执行结果和 retrieval trace 回写到新系统 Evidence/AgentOutput。

优先级三：

- 接 CRM 和项目管理 connector，把外部事实镜像投影到 legacy fact layer。
- 对高风险反写统一走 `WritebackIntent -> confirmation -> legacy audit`。

优先级四：

- 逐步把旧 Web Portal 的高频页面整合进新 Ops Console。
- 旧 Portal 保留为迁移期排障入口，最终退到 legacy admin surface。
