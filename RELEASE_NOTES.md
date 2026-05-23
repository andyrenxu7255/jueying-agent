# JueYing v1.7.0 - Proactive Orchestration Main Release

发布日期：2026-05-23

## 摘要

v1.7.0 是当前主版本发布。它在 v1.6.3 的管理后台初始化、ClawHub 维护、模型/知识/数据库/资源监控修复和 MEDDIC demo 数据基础上，新增完整主动运营编排闭环：Admin 制定规则，智能体定期扫描事实层、组织记忆、技能和任务状态，生成带证据洞察；默认经 Admin 审核后，再派单给具体用户执行，并汇总到管理员汇报看板。

这次发布把系统从“用户提问后响应”推进到“智能体主动洞察、督促人类执行、再向管理员汇报”的可治理链路。

## 本次新增与修复

- 新增 `proactive-orchestrator` 服务，负责主动运营规则、扫描运行、证据洞察、审核后 mission、派单和管理员汇报。
- 新增数据库迁移 `029_proactive_orchestration.sql`，包含 `proactive_rule`、`proactive_run`、`proactive_insight`、`proactive_mission`、`proactive_report`，并扩展 `org_task` / `org_task_assignment` 的主动运营关联字段。
- 新增 Web Portal「主动运营」页面，支持规则创建、手动扫描、洞察审核、mission 派单、汇报发布和 dashboard 汇总。
- Web Portal 后端新增 `/api/admin/proactive/*` 代理接口，统一转发到 `proactive-orchestrator`，复用现有管理员登录与权限边界。
- Docker Compose 新增 `ah-proactive-orchestrator` 服务，主机端口 `3010`，健康检查为 `/health/live` 和 `/health/ready`。
- 主动运营默认 `review_first`：扫描只生成待审洞察，Admin 批准后才生成 mission，避免智能体绕过治理直接打扰普通用户。
- 派单复用既有 `org_task` / `org_task_assignment`，主动任务类型写入 metadata，不破坏已有 `task_type` 约束。
- 重复扫描按 `rule_id + insight_type + evidence_pack_hash` 去重；相同未关闭洞察只更新 `last_seen_*` 元数据，不堆积重复待审项。
- 前端导航改为 hash route，支持刷新或分享直达 `http://localhost:3003/#proactive`，并按角色可见性 fallback。
- 新增 `test:proactive` 功能测试，覆盖规则创建、扫描、证据洞察、重复扫描去重、审核生成 mission、复用组织任务派单、汇报发布和测试数据清理。
- 新增 Web Portal 静态前端 hash 直达回归，避免接口测试通过但前端导航不可用。
- 文档、产品说明、运维手册、用户故事线、架构文档和 context graph 已同步主动运营链路。

## 延续的 v1.6.3 基础能力

- 飞书长连接配置明确只需要 App ID 和 App Secret；Signing Secret 仅用于 Webhook 验签。
- 模型管理支持多模型优先级、API 模型目录获取、上下文窗口、最大输出、思考模式和思考强度。
- Embedding 与 Rerank 支持从 API 获取候选模型、配置维度/超时并执行测试。
- 知识导入修复 DOCX/TXT 上传和索引链路，手动输入与文件上传成为两条清晰入口。
- 数据库运维按钮返回真实执行结果和刷新后的统计。
- 资源监控修正存储单位展示，并支持非 Docker 环境 fallback。
- ClawHub 管理入口支持 admin token、URL 导入、`SKILL.md` 上传、升级检查、变更摘要、安全信息和管理员确认升级。
- 预置低风险办公、搜索、安全审查、天气、MEDDIC B2B Sales Review、Customer Research 等技能。
- 新环境预置 MEDDIC 销售知识、共享文档、知识分块、实体和关系图谱，不包含 key、token 或个人敏感信息。

## 预置 Demo 内容

数据库迁移会写入以下 public demo 知识：

- MEDDIC销售六步法总览
- 销售六步法Gates检查清单
- Champion识别标准
- Discovery探索阶段五道门
- Business Case商业论证框架

同时写入基础销售图谱实体与关系，包括 MEDDIC 销售六步法、Discovery、Scope、Go/No-Go、Validate Solution、Business Case、Champion、Economic Buyer。主动运营可以把这些 demo 知识、ClawHub 销售技能和组织任务状态作为扫描信号。

## 验证结果

2026-05-23 已验证：

```bash
npm run test:portal-static
npm run test:proactive
npm test -- --coverage --runInBand
npm run type-check
npm run lint
npm run build
npm run db:migrate
npm run context:audit
npm audit --audit-level=moderate
```

结果：

- Web Portal 静态脚本语法与 hash 直达测试通过：10/10。
- 主动运营功能测试通过：9/9。
- Jest 全量测试通过：19 个测试套件 / 204 个用例。
- 覆盖率超过 95% 门禁：Statements 98.74%，Branches 95.49%，Functions 96.21%，Lines 99.24%。
- TypeScript 类型检查通过。
- ESLint 通过。
- 构建通过。
- SQL 迁移幂等通过，无待执行迁移。
- Context graph audit 通过：M1 / M2 / M3 / portal_admin_quality / proactive_orchestration。
- npm moderate 级安全审计通过，0 vulnerabilities。
- Docker 本地运行验证：`ah-web-portal` healthy，`ah-proactive-orchestrator` healthy。
- 浏览器验证通过：`http://127.0.0.1:3003/#proactive` 可直接进入主动运营页。

## 升级说明

从 v1.6.3 升级到 v1.7.0 需要执行新增 SQL 迁移并重建 Web Portal 与主动运营服务：

```bash
cd agent-harness
npm run db:migrate
docker compose --profile app build web-portal proactive-orchestrator
docker compose --profile app up -d web-portal proactive-orchestrator
```

本地入口：

- Web Portal: http://localhost:3003
- 主动运营页: http://localhost:3003/#proactive
- Proactive Orchestrator: http://localhost:3010/health/ready

旧版本 release 已保留为历史版本；`v1.7.0` 是当前 Latest 主版本。
