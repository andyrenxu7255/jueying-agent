# JueYing v1.6.3 - Admin Initialization and ClawHub Maintenance

发布日期：2026-05-23

## 摘要

v1.6.3 是管理后台初始化与真实功能测试补强版本。它在 v1.6.2 的双语体验与审计硬化基础上，补齐管理员初始化数据、ClawHub 技能维护、模型/知识/数据库/资源监控链路的功能合理性验证，并把可演示的 MEDDIC 销售知识和图谱预置到新环境。

## 本次新增与修复

- 飞书长连接配置明确只需要 App ID 和 App Secret；Signing Secret 仅用于 Webhook 校验，并在配置保存后热加载，同时返回可选重启目标。
- 模型管理支持第二模型正确持久化、优先级列表、API 模型目录获取、上下文窗口、最大输出、思考模式和思考强度。
- Embedding 与 Rerank 配置支持从 API 获取候选模型、维度/超时配置和测试按钮。
- 知识导入修复 DOCX/TXT 上传与索引链路，手动输入的来源类型文案改为更清晰的“来源场景”。
- 数据库运维按钮返回真实执行结果和刷新后的统计，不再只提示成功。
- 资源监控修正存储单位展示，并保留非 Docker 环境的 fallback 标识。
- 技能管理新增 ClawHub 管理入口：`CLAWHUB_SITE`、`CLAWHUB_REGISTRY`、`CLAWHUB_ADMIN_TOKEN`。Token 只保存在本地环境配置，不明文回显，也不会进入仓库。
- 技能页支持 ClawHub URL 导入、上传/粘贴 `SKILL.md`、批量/单个升级检查、变更摘要、安全信息和管理员逐个确认升级。
- 当运行镜像中没有 `clawhub` CLI 时，后台会自动 fallback 到 ClawHub API 获取版本、变更和审查信息。
- 新增低风险预置技能，包含办公、搜索、安全审查、天气，以及 ClawHub 上的 `meddic-b2b-sales-review` 和 `customer-research`。
- 新增 demo 数据迁移，预置 MEDDIC 销售文档、知识分块、实体、关系图谱和 ClawHub 技能元数据，不包含 key、token 或个人敏感信息。
- 修复 Web Portal 静态脚本转义导致页面停在“加载中”的问题，并新增 `test:portal-static` 防止接口测试通过但前端脚本语法损坏。

## 预置 Demo 内容

数据库迁移会写入以下 public demo 知识：

- MEDDIC销售六步法总览
- 销售六步法Gates检查清单
- Champion识别标准
- Discovery探索阶段五道门
- Business Case商业论证框架

同时写入基础销售图谱实体与关系，包括 MEDDIC 销售六步法、Discovery、Scope、Go/No-Go、Validate Solution、Business Case、Champion、Economic Buyer。

## 验证结果

2026-05-23 已验证：

```bash
npm run db:migrate
npm run test:portal-static
npm run test:portal-admin
npm run lint
npm run type-check
npm test
npm run context:audit
```

结果：

- SQL 迁移幂等通过，无待执行迁移。
- Web Portal 静态脚本语法检查通过。
- 管理后台功能测试通过：14/14，覆盖飞书配置、模型目录与测试、知识导入、DOCX/TXT 上传、数据库运维、资源监控、ClawHub 技能维护、demo 知识和图谱断言。
- Lint 通过。
- TypeScript 类型检查通过。
- Jest 通过：8 个测试套件 / 82 个用例。
- Context graph audit 通过：M1 / M2 / M3 三个 task profile。
- 浏览器实测通过：`http://localhost:3003` 技能管理页可打开，ClawHub 状态、预置 MEDDIC/customer-research、技能详情和升级检查可用。

## 升级说明

从 v1.6.2 升级到 v1.6.3 需要执行新增 SQL 迁移：

```bash
cd agent-harness
npm run db:migrate
docker compose build web-portal skill-library
docker compose up -d web-portal skill-library
```

如需使用 ClawHub 管理员能力，可在 Web Portal 系统配置中填写 `CLAWHUB_ADMIN_TOKEN`。没有 token 时仍可使用公开技能目录、内置预置技能和升级检查 fallback。
