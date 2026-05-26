# JueYing 冒烟测试与安全审计报告

> 日期：2026-05-17  
> 范围：`agent-harness`、`development/context-graph.json`、`development/context-routing.json`  
> 审计目标：完成冒烟测试、修复发现缺陷、补齐四角色体验故事线、清理 high/critical 依赖风险

## 一、执行摘要

本轮审计以“能否交给真实团队接手”为标准，而不是只看单个测试命令。审计覆盖开发启动、数据库迁移、Docker Compose、渠道 Webhook、梦境模式、技能组织边界、PDF 文件解析、依赖漏洞、文档图谱和回归脚本。

结论：本轮发现的阻断性冒烟问题已修复；`npm audit --audit-level=high` 目标为 high/critical 清零；剩余 moderate 项集中在开发工具链 `drizzle-kit` 的 `esbuild` 传递依赖，未进入生产运行时。

## 二、已修复问题

| ID | 严重级别 | 问题 | 修复 |
|----|----------|------|------|
| SMOKE-001 | P0 | M0 校验引用不存在的 Jest 配置 | `scripts/validate-m0.js` 指向 `tests/setup/jest.config.cjs` |
| SMOKE-002 | P0 | 数据库迁移脚本不读取 `.env`，默认密码错误 | `scripts/apply-sql-migrations.js` 增加 `.env` 加载和 `POSTGRES_*` 连接串生成 |
| SMOKE-003 | P0 | LiteLLM 镜像标签不可拉取 | `docker-compose.yml` 使用可拉取镜像标签 |
| SMOKE-004 | P1 | 渠道烟测与 Gateway 默认签名密钥不一致 | Compose 默认值与 `channel-webhook-smoke.mjs` 对齐，脚本读取 `.env` |
| SMOKE-005 | P1 | 飞书事件烟测未兼容异步 ACK | 烟测接受 `{ ok: true, received: true }` 与同步业务响应 |
| SMOKE-006 | P1 | SigNoz 查询健康检查命中旧路径 | `smoke-eval.js` 改为访问当前入口 `/` |
| UX-001 | P1 | Quick Lookup 缺少组织上下文 | Gateway 调用 Workflow 时传入 `org_id` |
| ADMIN-001 | P1 | 梦境个人分析测试用户外键失败 | Hermes 自动补齐测试组织和用户记录 |
| ADMIN-002 | P1 | 组织级记忆/技能接口缺少强制组织边界 | 缺少 `org_id` 时返回 `missing_org_id` |
| ADMIN-003 | P2 | Admin 结果字段不够业务化 | 返回 `merged_to_org`、`promoted_to_org` |
| DEPS-001 | P1 | `pdf-parse` 命中已知漏洞 | 替换为 `pdfjs-dist` 并同步锁文件 |
| DEPS-002 | P1 | OpenTelemetry 直接依赖命中 high 漏洞 | 升级 `@opentelemetry/auto-instrumentations-node`、`@opentelemetry/sdk-node` |

## 三、审计覆盖

| 维度 | 检查点 | 结果 |
|------|--------|------|
| 开发体验 | lint/type/unit/M0/context 可复现 | 通过：lint、type-check、8个测试套件/80个测试、M0、context:audit |
| 运维体验 | Compose、迁移、核心健康、SigNoz/LiteLLM 入口 | 通过：镜像重建后服务拉起，`db:migrate` 无待执行迁移，`health:core` 通过，`smoke:eval` 33/33 |
| Admin 体验 | 梦境分析、组织汇总、技能审核、组织边界 | 通过：`test:dream-mode` 14/14，缺少 `org_id` 的负例返回 400 |
| 普通用户体验 | 飞书/企微签名、异步 ACK、重复事件、快查、PDF 解析 | 通过：`smoke:channels` 16/16；飞书异步 ACK 与企微同步回复均通过 |
| 依赖安全 | `npm audit --audit-level=high` | 通过：high/critical 为 0；保留 4 个 moderate 开发依赖提示 |
| 密钥安全 | `.env` 不纳入版本控制，扫描排除本地密钥文件 | 未发现待提交的明文私钥或真实 Bearer/AWS 凭据；命中项为文档占位符和环境变量名 |

## 四、剩余风险

1. `drizzle-kit` 的 `esbuild` moderate 提示来自开发工具链。强制降级/替换 Drizzle 可能影响迁移命令，建议另开兼容性验证。
2. 生产级 SigNoz/ClickHouse 存储后端需要运维配置；本轮开发栈用 logging exporter 保证 Collector 可启动和接收。
3. 真实飞书长连接依赖正式凭据和应用发布状态，本轮以 Webhook 签名与异步事件冒烟覆盖核心入口；本地 `feishu-longconn` 可能停留在 starting/unhealthy，不代表 Webhook 主链路失败。

## 五、关联文档

- `用户故事线.md`：新增故事线二十一，覆盖开发、运维、Admin、普通用户体验闭环。
- `development/DEV-17-冒烟测试与四角色体验闭环.md`：记录本轮验收路径、修复清单和剩余风险。
- `ARCHITECTURE.md`：新增第十七轮修复与验收说明。
- `HANDOFF-SESSION.md`：更新当前状态、已知问题和接续提示。
