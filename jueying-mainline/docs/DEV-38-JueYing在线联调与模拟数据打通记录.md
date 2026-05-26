# DEV-38 JueYing 在线联调与模拟数据打通记录

日期：2026-05-26

## 目标

本轮目标是验证 JueYing 主版本内置的 AI 原生运营中枢不只是离线适配历史 v1 代码，而是能在 JueYing Docker 服务在线时，用模拟销售/交付数据打通真实运行时链路。

## 启动范围

已通过旧主版本 `docker-compose.yml` 启动：

- PostgreSQL
- Redis
- MinIO
- LiteLLM
- workflow-service
- executor-gateway
- fact-retrieval
- gateway-adapter
- web-portal
- skill-library
- proactive-orchestrator
- hermes-adapter
- mobile-app

本轮验证的核心在线链路：

- `TaskGraph -> workflow-service`
- `Information Gap -> gateway-adapter / org_task`
- `Evidence -> fact-retrieval / fact`
- `runtime health -> 9/9 JueYing services`

## 模拟数据

使用 `jueying-mainline/` 内的 P1 fixture：

- `fixtures/p1-demo/task-graph.sales-discover.json`
- `fixtures/p1-demo/information-gaps.json`
- `fixtures/p1-demo/evidence.json`
- `fixtures/p1-demo/external-writeback-intents.json`

模拟场景是 ACME 商机 Discover 阶段：

- Champion 证据缺失，生成补采任务。
- 下一步会议已经由 CRM 日历证据确认。
- CRM 和项目管理外部事实镜像被写入旧事实层。

## 修复项

1. 修正旧主版本运行时端口和健康路径。
   - Web Portal 默认宿主端口为 `3003`。
   - Hermes 默认宿主端口为 `3005`。
   - Mobile 默认宿主端口为 `3009`。
   - Skill Library 和 Hermes 使用 `/health/live`。

2. 修正 Windows 本地健康检查地址。
   - 默认 legacy runtime URL 从 `localhost` 改为 `127.0.0.1`，避免宿主访问旧容器端口偶发超时。

3. 修正 `TaskGraph -> legacy workflow plan` payload。
   - `markdown_steps` 从字符串改为旧 planner 可消费的步骤数组。
   - payload 默认带 `user_role: admin`，让旧策略层允许创建 workflow。

4. 修正旧 workflow planner 的重复 stage key。
   - 旧 planner 从 markdown steps 生成多个相同 stage type 时，会产生重复 `stage_key`。
   - 已将 `stage_key` 加上序号，避免两个 `DecisionMaking` 阶段冲突。

5. 修正 runtime client 成功判定。
   - HTTP 200 但 body 中 `ok:false` 不能算成功。
   - 新 runtime client 会把这种情况标记为 degraded / failed。

6. 修正内部令牌和进度读取。
   - 在线 smoke 会读取旧 `.env` 中的 `INTERNAL_TOKEN`，没有时使用 Compose 默认 `dev_internal_token`。
   - 读取 workflow progress 时带 `owner_user_id` 和 `acting_role`，符合旧 workflow 访问控制。

## 新增脚本

新增：

```bash
npm run legacy:live-smoke
```

脚本会：

1. 检查旧主版本 runtime health。
2. 生成 legacy bridge preview。
3. 创建旧 workflow。
4. 创建旧 org task。
5. 写入 3 条旧 fact。
6. 读取 workflow progress。
7. 读取 org task 列表。
8. 输出 `reports/live-legacy-bridge-smoke.json`。

## 验收结果

已通过：

```bash
npm run legacy:live-smoke
npm test
```

关键结果：

- JueYing runtime health：`9/9` 服务在线。
- live bridge smoke：创建 `workflow=wf_1779781088469_dc195ff5`。
- org task：`1` 条补采任务创建成功。
- fact write：`3` 条 Evidence 写入旧 fact-retrieval 成功。
- 单元测试：`25/25` 通过。

## 当前边界

已经完成真实在线打通：

- JueYing 主版本对象能进入 workflow。
- JueYing 信息缺口能进入 org_task。
- JueYing Evidence 能进入 fact-retrieval。
- JueYing runtime health 能识别主版本 9 个在线服务。

尚未完成：

- `TaskGraph -> workflow dispatch -> executor-gateway -> AgentOutput` 的执行结果闭环。
- `org_task assignment -> human submit -> Evidence -> Gap closed` 的人类提交闭环。
- CRM / 项目管理真实 provider SDK 的在线读写。
- 高风险反写的人工确认 UI 和外部系统真实反写。

下一步应优先验证：

1. workflow dispatch 和 executor 执行结果回流。
2. org_task assignment 与提交反馈回流。
3. CRM / PM connector provider 的真实沙箱接入。
