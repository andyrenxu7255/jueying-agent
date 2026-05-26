# Day3 长任务监督与数据落盘说明

> 对应计划：`development/DEV-14-2026-04-24-3天执行计划.md` Day 3

## 1) Workflow 监督器

### 模块位置
- 代码：`agent-harness/services/workflow/src/supervisor/manager.ts`
- 导出：`agent-harness/services/workflow/src/supervisor/index.ts`

### 核心功能

| 功能 | 说明 |
|---|---|
| 心跳监控 | 定期检查 workflow 状态，missed_heartbeats 计数，grace_periods 管理 |
| 进度追踪 | 当前 stage、进度百分比、耗时、剩余预算 |
| 超时策略 | 软超时（可 retry）、硬超时（checkpoint_and_pause 或 fail） |
| 重试策略 | 指数退避（10s -> 20s -> 40s -> 60s max） |

### API 接口

```bash
# 注册监督（在 plan 成功后自动调用）
POST /internal/workflows/plan  # 内部自动注册

# 心跳上报
POST /internal/workflows/{workflow_ref}/heartbeat
{
  "stage_id": "st_xxx",
  "stage_seq": 1
}

# 进度查询
GET /internal/workflows/{workflow_ref}/progress

# 进度更新
POST /internal/workflows/{workflow_ref}/progress
{
  "stage_id": "st_xxx",
  "stage_seq": 2,
  "status": "running",
  "output_preview": "..."
}
```

### 默认配置

```yaml
heartbeat_interval_sec: 30
soft_timeout_sec: 120
hard_timeout_sec: 600
max_retries: 3
retry_backoff_sec: 10
max_retry_backoff_sec: 60
progress_check_interval_sec: 15
```

---

## 2) 数据落盘

### 审计持久化

- 表：`audit_event`
- 列：`id, user_id, workflow_instance_id, action, resource_type, resource_ref, resource_scope, result, detail_json, occurred_at`
- 索引：`user_id, action, resource_ref, occurred_at, workflow_instance_id`

当前状态：已积累 4019+ 条审计记录。

### 结构化存储

| 表 | 用途 |
|---|---|
| `workflow_instance` | workflow 实例元数据与进度 |
| `workflow_stage` | stage 执行记录 |
| `checkpoint` | checkpoint 状态快照与恢复 token |
| `conversation` | 会话记录 |
| `message` | 消息记录 |

### Markdown 归档

- 模块：`libs/shared/src/archive/markdown-archiver.ts`
- 路径：`/var/lib/archive/workflows/{date}/{user_id}/{workflow_ref}.md`
- 会话：`/var/lib/archive/conversations/{date}/{channel_type}/{conversation_id}.md`

---

## 3) Checkpoint 恢复验证

### 测试脚本
```bash
node scripts/test-day3-supervision.js
```

### 验证步骤
1. 创建 workflow -> 自动注册监督
2. 创建 checkpoint -> 获得 resume_token
3. 正确 policy hash 恢复 -> policy_hash_valid=true
4. 错误 policy hash 恢复 -> 400 + error

---

## 4) 回放验证

### 测试脚本
```bash
node scripts/verify-day3-persistence.js
```

### 验证项目
- Audit 持久化（count >= 10）
- Checkpoint 表可访问
- Workflow 表可访问
- Conversation 表可访问

---

## 5) 环境变量

```powershell
# 数据库连接
$env:DATABASE_URL='postgresql://agent_harness:dev_password@postgres:5432/agent_harness'

# 归档路径（可选）
$env:ARCHIVE_PATH='/var/lib/archive'
```

---

## 6) 验收命令

```bash
npm run smoke:eval
npm run preflight:audit
node scripts/verify-day3-persistence.js
```