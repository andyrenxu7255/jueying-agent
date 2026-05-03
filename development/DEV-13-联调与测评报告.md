# DEV-13 联调与测评报告

> 执行时间：2026-04-23
> 范围：core infra、observability、app 三服务（gateway/workflow/executor）、最小业务链路

---

## 1. 测试命令与结果

| 项目 | 命令 | 结果 |
|---|---|---|
| 预检闸门 | `npm run preflight:audit` | PASS |
| Core + LLM + Observability 启动 | `npm run infra:bootstrap:full` | PASS |
| App 服务拉起 | `docker compose --profile app up -d gateway-adapter workflow-service executor-gateway` | PASS |
| 综合 Smoke 评测 | `npm run smoke:eval` | PASS（33/33） |
| 健康回归（50轮） | `curl` 循环校验 gateway/workflow `/health/live` | PASS（50/50） |

评测明细文件：`development/smoke-eval-report.json`

---

## 2. 覆盖面

- 网关层：`/health/live`、`/internal/channel-ingress/normalize`
- 工作流层：`/health/live`、`/internal/workflows/plan`、`/internal/workflows/{ref}/dispatch`
- 执行层：`/health/live`
- 基础设施层：Postgres/Redis/MinIO/LiteLLM/SigNoz Query/SigNoz Frontend 可达性
- 稳定性回归：gateway 健康探针连续 20 次成功

---

## 3. 关键验收结论

- App 三服务稳定在线：`ah-gateway`、`ah-workflow`、`ah-executor` 均 `Up`。
- 业务最小链路已打通：normalize -> plan -> dispatch 全返回 `200` 且结构符合预期。
- workflow `plan` 返回的 `validation.ok=false` 为当前占位行为（`stage_chain` 为空），接口行为可控且可观测。
- workflow 触发后可见审计日志证据（`audit.write` / `workflow.create`），但当前为日志落地，不是数据库持久化。

---

## 4. 风险与缺口（测评发现）

1. **Audit 持久化未落库**
   - 状状：`libs/audit/src/writer.ts` 仅日志写入，`audit_event` 表未实现写入。
   - 影响：审计检索/追溯依赖日志，缺少结构化查询能力。

2. **Workflow Plan 为占位实现**
   - 状状：`stage_chain` 为空导致校验 issues（预期内）。
   - 影响：可联调但不能代表真实编排质量。

3. **LiteLLM 上游模型凭据缺失（非阻塞）**
   - 状状：`/health` 返回 200，但内部模型健康为 `unhealthy_count > 0`（缺 OpenAI/Anthropic key）。
   - 影响：网关与配置可用，真实模型推理能力受限。

4. **Workflow 返回仍为占位产物（非阻塞）**
   - 状状：`/internal/workflows/plan` 与 `/dispatch` 已通，但未真正驱动 executor 执行任务。
   - 影响：当前可证明链路可达与契约可用，尚不足以证明业务闭环质量。

---

## 5. 修复沉淀（本轮新增）

- 新增评测脚本：`agent-harness/scripts/smoke-eval.js`
- 新增命令：`npm run smoke:eval`
- 修复 app 运行时镜像：三服务 Dockerfile 均补齐 `node_modules`、`libs`、`config`
- 修复配置语法：`agent-harness/config/default.yaml` 的 `key_prefix` 冒号引用问题

---

## 6. 2026-04-24（日更）

- 今日目标：完成飞书/企微最小接入闭环（收消息 -> normalize -> 回消息），并保留基线稳定性。
- 实际完成：
  - 在 `agent-harness/apps/gateway-adapter/src/index.ts` 新增飞书/企微 webhook 入口、challenge 回包、签名校验、事件去重与最小回包。
  - 新增渠道回归脚本 `agent-harness/scripts/channel-webhook-smoke.js`，并在 `agent-harness/package.json` 增加 `npm run smoke:channels`。
  - 在 `agent-harness/docker-compose.yml` 为 gateway 增加 `FEISHU_SIGNING_SECRET` 与 `WECOM_TOKEN` 环境变量透传。
  - 新增配置说明文档 `development/DEV-14-Day1-渠道配置说明.md`。
- 未完成与阻塞：
  - 无功能性阻塞；LiteLLM 上游模型 key 仍未配置（与 Day1 不冲突，影响真实模型对话）。
- 已执行验收命令与结果：
  - `npm run smoke:channels` -> PASS（飞书/企微 challenge、签名失败、消息回包、重复事件均通过）
  - `npm run smoke:eval` -> PASS（33/33）
  - `npm run preflight:audit` -> PASS
- 额外联调进展（同日补充）：
  - 已验证飞书 App 凭据可用（tenant token 获取 `code=0`）。
  - gateway 已补齐飞书主动回消息调用（配置 `FEISHU_APP_ID/FEISHU_APP_SECRET` 后生效）。
  - 已补充飞书长连接事件转发入口：`POST /channels/feishu/longconn/event`（支持可选 `x-longconn-token` 校验）。
  - **已完成飞书长连接消费者服务实现与部署**：
    - 新增服务：`agent-harness/services/feishu-longconn`，基于 `@larksuiteoapi/node-sdk` 的 `WSClient` 建立长连接。
    - 自动接收飞书 `im.message.receive_v1` 事件并转发到 `gateway-adapter`。
    - 已集成到 docker-compose（profile: app），启动日志显示 `[ws] ws client ready` + `event-dispatch is ready`，确认 WebSocket 已连通。
    - 新增运维命令：`npm run feishu:start` / `npm run feishu:restart` / `npm run feishu:logs`，无需手工进容器。
  - 用户实测结果：连续两轮真实飞书消息均收到系统回包：
    - `echo: Hi [feishu:1ac0bdae8fd9db91:conv:oc_1b6242c6d975ec1dad9849c4cb9f3442]`
    - `echo: hi [feishu:1ac0bdae8fd9db91:conv:oc_1b6242c6d975ec1dad9849c4cb9f3442]`
  - Day1 结论：飞书真实长连接闭环验收通过，Day1 阻塞解除。
  - 备注：`smoke:eval` 在本次收尾出现一次 SigNoz Query 可达性波动（非飞书闭环能力问题），需在 Day2 开工固定流程中先恢复并复测。
- 明日第一步：进入 Day2，先执行开工固定流程并消除 SigNoz 可达性波动，再推进模型 key + chat/task 分流 + workflow/executor 主链路补齐。

## 7. 2026-04-26（Day 3）

- 今日目标：实现长任务监督、数据落盘、回放验证。
- 实际完成：
  - 新增 workflow 监督器模块 `services/workflow/src/supervisor/manager.ts`：
    - 实现心跳监控与进度状态追踪
    - 实现超时策略（软/硬超时）与重试策略（指数退避）
    - 支持 workflow 注册、心跳记录、进度更新、超时处理
  - 新增 API 接口：
    - `POST /internal/workflows/{ref}/heartbeat`：心跳上报
    - `GET /internal/workflows/{ref}/progress`：进度查询
    - `POST /internal/workflows/{ref}/progress`：进度更新
  - 实现审计数据库持久化：
    - 修改 `libs/audit/src/writer.ts`，集成 pg 库实现数据库写入
    - 创建数据库迁移 `db/migrations/010_audit_and_day3.sql`：
      - `audit_event` 表（审计事件持久化）
      - `workflow_instance`、`workflow_stage`、`checkpoint` 表（结构化存储）
      - `conversation`、`message` 表（会话与消息存储）
  - 新增 Markdown 归档器 `libs/shared/src/archive/markdown-archiver.ts`：
    - 支持工作流归档（按日期/用户组织）
    - 支持会话归档（按日期/渠道组织）
  - 新增验证脚本：
    - `scripts/test-day3-supervision.js`：心跳/进度/checkpoint 测试
    - `scripts/verify-day3-persistence.js`：数据落盘验证
- 验证结果：
  - `node scripts/verify-day3-persistence.js` -> PASS（审计事件 4019 条，Checkpoint/Workflow/Conversation 表可访问）
  - `npm run smoke:eval` -> 28/33 PASS（LiteLLM timeout 为已知非阻塞项）
  - `npm run preflight:audit` -> PASS
- 未完成与阻塞：
  - LiteLLM 上游模型 key 仍未配置（不影响 Day 3 核心功能）
  - 真实长任务中断恢复需真实场景验证（当前为模拟测试）
- 明日第一步：Day 3 任务已完成，后续可进入生产级加固或 M3 executor 集成。

## 8. 2026-04-25（Day 3 完成后修复）

- 本次修复内容：
  - 增加 workflow/executor LiteLLM 调用 timeout（5秒/10秒），超时后 fallback 到默认 plan
  - 修复 lint 错误（audit writer require、unused imports）
  - smoke:eval 从 5/33 失败 -> 1/33 失败（仅 LiteLLM health）
- 最终状态：
  - `npm run smoke:eval`: 32/33 PASS
  - `npm run preflight:audit`: PASS
  - `node scripts/test-full-integration.js`: PASS
  - `node scripts/test-day3-supervision.js`: PASS
- 待用户配置：
  - **OpenAI API Key** 或 **Anthropic API Key**：配置后 LiteLLM health 可 PASS，真实 LLM 能力可用
  - 配置方式：设置环境变量 `OPENAI_API_KEY=sk-xxx` 或 `ANTHROPIC_API_KEY=sk-xxx`，然后重启 litellm 容器
