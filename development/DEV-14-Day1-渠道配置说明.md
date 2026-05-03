# Day1 渠道配置说明（飞书 / 企微）

> 对应计划：`development/DEV-14-2026-04-24-3天执行计划.md` Day 1

## 1) 网关新增入口

- 飞书 webhook：`POST /channels/feishu/webhook`（兼容 `POST /webhook/feishu`）
- 飞书长连接事件转发入口：`POST /channels/feishu/longconn/event`
- 企微 webhook：
  - `GET /channels/wecom/webhook`（challenge 回包）
  - `POST /channels/wecom/webhook`（消息回调）
  - 兼容路径：`/webhook/wecom`
- 统一归一化入口保持不变：`POST /internal/channel-ingress/normalize`

## 2) 必要环境变量

已透传到 `gateway-adapter` 容器（见 `agent-harness/docker-compose.yml`）：

- `FEISHU_SIGNING_SECRET`：飞书签名密钥（为空时跳过签名校验）
- `FEISHU_APP_ID`：飞书应用 App ID（用于调用飞书发消息 API）
- `FEISHU_APP_SECRET`：飞书应用 App Secret（用于获取 tenant_access_token）
- `FEISHU_LONGCONN_TOKEN`：可选。若设置，则 `POST /channels/feishu/longconn/event` 需携带请求头 `x-longconn-token`
- `WECOM_TOKEN`：企微 Token（为空时跳过签名校验）

本地联调示例（PowerShell）：

```powershell
$env:FEISHU_SIGNING_SECRET='dev-feishu-secret'
$env:FEISHU_APP_ID='cli_xxx'
$env:FEISHU_APP_SECRET='xxx'
$env:WECOM_TOKEN='dev-wecom-token'
docker compose up -d --no-deps gateway-adapter
```

## 3) 行为约定

- 飞书 `url_verification`：返回 `{"challenge": "..."}`
- 企微 challenge（GET）：原样返回 `echostr`
- 统一错误码：
  - 签名失败 -> `401` + `{"error":"signature_invalid"}`
  - JSON 格式错误 -> `400` + `{"error":"invalid_json"}`
  - 消息格式不满足最小要求 -> `400` + `{"error":"invalid_payload"}`
- 重复事件幂等：10 分钟内按 `event_id/msgid` 去重，重复请求返回 `200` + `duplicate=true`
- 最小回包：返回 `session_ref` 的 echo 文本，便于渠道侧确认闭环
- 若已配置 `FEISHU_APP_ID/FEISHU_APP_SECRET`，飞书入站消息会尝试调用飞书 API 主动回消息（`delivered=true` 表示成功）
- 若使用飞书长连接模式，可由长连接进程将事件体转发到 `/channels/feishu/longconn/event`，事件结构与 webhook `event` body 保持一致

## 4) 验收命令

```bash
npm run smoke:channels
```

说明：`smoke:channels` 会覆盖飞书/企微 challenge、签名失败、消息回包、重复事件四类路径。

---

## 5) 长连接服务（一键运维）

已集成飞书官方长连接 SDK，无需配置公网 webhook。

### 服务位置
- 代码：`agent-harness/services/feishu-longconn`
- 容器：`ah-feishu-longconn`（profile: app）

### 启动命令

```powershell
# 设置飞书凭据
$env:FEISHU_APP_ID='cli_a95bad0b00b89cc9'
$env:FEISHU_APP_SECRET='v4KJ6qyCFqN3X4F7g20ZxdLzSwCyJR5H'

# 启动所有服务（包括长连接）
npm run infra:bootstrap:full
docker compose --profile app up -d

# 或仅启动飞书服务
npm run feishu:start
```

### 查看日志

```powershell
# 查看飞书长连接最新日志（最近5分钟）
npm run feishu:logs

# 持续跟踪日志
npm run docker:logs:feishu
```

### 验证长连接是否连通

启动后日志应显示：
```
[info]: [ 'event-dispatch is ready' ]
[info]: [ '[ws]', 'ws client ready' ]
```

### 测试闭环

1. 确认服务启动成功（见上方日志）
2. 在飞书开放平台确认事件订阅已开启长连接模式
3. 在飞书客户端给机器人发送消息（如 "hello"）
4. 查看日志：`npm run feishu:logs`，应该看到 `feishu.message.received` + `gateway.forward.success` + `delivered=true`
