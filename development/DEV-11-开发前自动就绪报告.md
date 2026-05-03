# DEV-11 开发前自动就绪报告

> 执行时间：2026-04-23（已二次复核）
> 目标：在正式开发前完成文档、上下文治理、工具链与仓库基线检查。

---

## 1. 上下文治理就绪

| 检查项 | 结果 | 说明 |
|---|---|---|
| 依赖图谱存在 | PASS | `development/DEV-08-文件内容与依赖对象图谱.md` |
| 执行标准存在 | PASS | `development/DEV-09-上下文防腐执行标准.md` |
| 目录白名单存在 | PASS | `development/DEV-10-工作区结构与读取白名单.md` |
| 机器可读图谱 | PASS | `development/context-graph.json` |
| 机器可读路由 | PASS | `development/context-routing.json` |
| Guard 工具可用 | PASS | `development/context_guard.py` |

Guard 验证结果：

- `M1_ingress_workflow`: PASS
- `M2_retrieval_fact`: PASS
- `M3_executor`: PASS

---

## 2. 文档与索引基线

| 检查项 | 结果 | 说明 |
|---|---|---|
| development 文档链接完整 | PASS | `broken 0` |
| DEV 索引已纳入 DEV-08/09/10 | PASS | `development/DEV-00-开发索引.md` |
| 废弃目录标记 | PASS | `archive/` 已在 DEV-10 标记为 Deprecated |

---

## 3. 开发环境与工具链

| 组件 | 结果 | 版本/状态 |
|---|---|---|
| Node.js | PASS | `v24.14.0` |
| npm | PASS | `11.9.0` |
| Python | PASS | `3.12.0` |
| Docker CLI | PASS | `29.2.1` |
| Docker Compose CLI | PASS | `v5.1.0` |
| Docker Daemon | PASS | daemon 可连接，core 容器可稳定拉起 |

---

## 4. 仓库可执行性基线

| 检查项 | 结果 | 说明 |
|---|---|---|
| M0 文件校验 | PASS | `npm run validate:m0` 通过 |
| TS 类型检查 | PASS | `npm run type-check` 全 workspaces 通过 |
| 测试命令可运行 | PASS | 已安装 `ts-node`，并允许无测试场景通过 |
| 依赖安全扫描 | WARN | `npm audit` 报告 6 个 moderate 漏洞（未阻塞 Day 1） |
| 预检审计闸门 | PASS | `npm run preflight:audit` 全通过（lint/type-check/test/context:audit） |
| Core 基础设施健康 | PASS | `ah-postgres`/`ah-redis`/`ah-minio`/`ah-litellm` 全 healthy |
| Observability 基础设施健康 | PASS | `ah-clickhouse`/`ah-signoz-otel`/`ah-signoz-query`/`ah-signoz-frontend` 全 Up |
| App 服务健康 | PASS | `ah-gateway`/`ah-workflow`/`ah-executor` 全 Up，`/health/live` 均返回 `200` |
| Gateway E2E Smoke | PASS | `POST /internal/channel-ingress/normalize` 返回 `session_ref`、`request_text`、`identity_binding_state` 等关键字段 |
| 综合 Smoke 评测 | PASS | `npm run smoke:eval`：33/33 用例通过；结果文件 `development/smoke-eval-report.json` |
| LiteLLM 健康探针 | PASS | 修复为 Python socket 探活，脱离镜像内 `curl` 依赖 |

---

## 5. 阻塞项与处置

### 当前阻塞

1. 无（本轮已解除）

### 已完成处置

1. 修复 Jest TS 配置依赖：已安装 `ts-node`。
2. 调整测试脚本以支持当前无测试集阶段：`--passWithNoTests`。
3. 修正 `context-graph.json` 分层遗漏：`AH1-21` 已纳入 L0 权威层。
4. 识别并修复 LiteLLM 与主库冲突：LiteLLM 改为使用独立 `litellm` 数据库，避免污染 `agent_harness`。
5. 修复 LiteLLM 健康检查假失败：将 `docker-compose.yml` 中探针从 `curl` 改为 Python socket 检查 `/health`。
6. 运行 smoke 校验：`/health` 返回 `200`，`/v1/models` 可返回模型列表（4个）。
7. 处理 Observability 拉起失败：完成 ClickHouse 镜像拉取、修正 SigNoz Query 参数与存储配置，`npm run infra:bootstrap:full` 已完整通过。
8. 修复 App 容器启动失败：补齐 app runtime 镜像中的 workspace 依赖与配置文件，修正 `config/default.yaml` 的 YAML 语法问题（`key_prefix: "ah:"`），并完成 gateway normalize 端到端 smoke。
9. 增加可复用综合评测脚本：`agent-harness/scripts/smoke-eval.js`，覆盖 gateway/workflow/executor/litellm/signoz 端点可用性、workflow plan+dispatch、20次健康稳定性回归。

---

## 6. 开发准入结论

- 结论：**准入（已满足）**
- 条件：无阻塞，开发可直接进入 DEV-02/03/04。

建议准入后首批命令：

1. `npm run health:core`
2. `npm run preflight:audit`
3. `npm run infra:bootstrap:full`（已验证通过，可作为回归检查）
4. 按任务画像进入 DEV-02/03/04 开发。
