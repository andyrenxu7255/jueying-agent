# JueYing (绝影) — 运维手册

> 版本: 1.3.0 | 更新日期: 2026-05-06
> 适用场景: 开发、测试，生产环境部署与维护

---

## 一、快速部署

### 1.1 环境准备

**系统要求:**
- Docker Engine 24.0+
- Docker Compose v2
- Node.js 20+
- npm 10+
- PowerShell (Windows) 或 Bash (Linux/macOS)

**获取代码:**
```bash
git clone <repo-url> agent-harness
cd agent-harness
```

### 1.2 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填写必要的密钥
# 至少需要配置:
#   MINIMAX_API_KEY    — MiniMax 大模型 API 密钥
#   FEISHU_APP_ID      — 飞书应用 ID
#   FEISHU_APP_SECRET  — 飞书应用密钥
```

### 1.2.1 本地开发配置（Andy 的工作区）

当前 `d:\teamclaw\agent-harness\.env` 中使用的配置：

| 配置项 | 当前值 |
|--------|--------|
| POSTGRES_USER | `agent_harness` |
| POSTGRES_PASSWORD | `change_me_123` |
| POSTGRES_DB | `agent_harness` |
| REDIS_PASSWORD | `change_me_123` |
| MINIO_ROOT_USER | `minioadmin` |
| MINIO_ROOT_PASSWORD | `change_me_123` |
| ADMIN_PASSWORD | `admin123` |
| CORS_ORIGINS | `http://localhost:3003` |

**关键环境变量说明:**

| 变量 | 必填 | 默认值 | 说明 |
|------|:--:|--------|------|
| `MINIMAX_API_KEY` | 是 | - | MiniMax 大模型 API 密钥 |
| `LITELLM_MASTER_KEY` | 是 | - | LiteLLM 代理主密钥 |
| `FEISHU_APP_ID` | 否 | - | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 否 | - | 飞书应用密钥 |
| `WECOM_CORP_ID` | 否 | - | 企业微信 CorpID |
| `WECOM_CORP_SECRET` | 否 | - | 企业微信应用密钥 |
| `WECOM_TOKEN` | 否 | - | 企业微信回调 Token |
| `WECOM_ENCODING_AES_KEY` | 否 | - | 企业微信消息加密密钥 |
| `WECOM_AGENT_ID` | 否 | - | 企业微信 AgentID |
| `ADMIN_PASSWORD` | 否 | - | Web Portal 管理员初始密码 |
| `CORS_ORIGINS` | 否 | `http://localhost:3003` | CORS 允许的来源 |
| `POSTGRES_USER` | 否 | `agent_harness` | PostgreSQL 用户名 |
| `POSTGRES_PASSWORD` | 否 | `dev_password` | PostgreSQL 密码 |
| `DB_POOL_MAX` | 否 | `10` | 数据库连接池最大连接数 |
| `LOG_LEVEL` | 否 | `debug` | 日志级别 (debug/info/warn/error) |
| `SKIP_LLM_PLAN` | 否 | `true` | 跳过 LLM 任务规划（开发模式） |

### 1.3 启动服务

```bash
# 方式一：启动基础设施 + 全部业务服务
docker compose --profile app up -d --build

# 方式二：先启动基础设施，再启动业务服务
docker compose up -d                    # 仅数据库、Redis、MinIO、LiteLLM
docker compose --profile app up -d      # 启动业务服务

# 方式三：本地 LLM 模式（使用 Ollama）
docker compose --profile local-llm up -d
```

### 1.4 初始化系统

```bash
# 1. 数据库迁移
npm run db:migrate

# 2. 初始化管理员账号（在线模式）
node scripts/init-admin.cjs <your-admin-password>

# 如果容器未启动，使用离线模式直接写入数据库
node scripts/init-admin.cjs <your-admin-password> --offline

# 3. 创建测试用户
node scripts/setup-users.cjs <your-admin-password>

# 4. 预制 JueYing 办公技能（从 ClawHub 国内镜像站 mirror-cn.clawhub.com）
node scripts/seed-clawhub-skills.cjs
```

### 1.5 验证部署

```bash
# 检查所有容器状态
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 预期输出: 18 个容器全部 running

# 各服务健康检查
curl http://localhost:3000/health     # Gateway Adapter
curl http://localhost:3001/           # Workflow Service
curl http://localhost:3002/health     # Executor Gateway
curl http://localhost:3003/health/live # Web Portal
curl http://localhost:3004/health     # Fact Retrieval
curl http://localhost:3005/health/live # Hermes Adapter
curl http://localhost:3007/health     # Skill Library
curl http://localhost:3008/health     # Resource Scheduler
curl http://localhost:3009/health     # Mobile App

# 全链路回归审计
node scripts/final-audit.cjs
```

---

## 二、服务管理

### 2.1 服务列表

| 服务 | 容器名 | 端口 | 健康检查端点 |
|------|--------|------|-------------|
| Gateway Adapter | ah-gateway | 3000 | `/health` |
| Workflow Service | ah-workflow | 3001 | `/` |
| Executor Gateway | ah-executor | 3002 | `/health` |
| Web Portal | ah-web-portal | 3003 | `/health/live` |
| Fact Retrieval | ah-fact-retrieval | 3004 | `/health` |
| Hermes Adapter | ah-hermes | 3005 | `/health/live` |
| Feishu Longconn | ah-feishu-longconn | - | 内部健康服务 |
| Skill Library | ah-skill-library | 3007 | `/health` |
| Resource Scheduler | ah-resource-scheduler | 3008 | `/health` |
| Mobile App | ah-mobile-app | 3009 | `/health` |
| PostgreSQL | ah-postgres | 5432 | pg_isready |
| Redis | ah-redis | 6379 | PING |
| MinIO | ah-minio | 9000/9001 | `/minio/health/live` |
| LiteLLM | ah-litellm | 4000 | `/health/liveliness` |
| SigNoz OTel | ah-signoz-otel | 4317/4318 | - |
| ClickHouse | ah-clickhouse | 8123 | - |
| SigNoz Query | ah-signoz-query | 8080 | - |
| SigNoz Frontend | ah-signoz-frontend | 3301 | - |

### 2.2 常用管理命令

```bash
# 查看服务日志
docker logs -f ah-gateway          # Gateway 实时日志
docker logs ah-workflow --tail 100 # Workflow 最近 100 行
docker logs ah-feishu-longconn --since 5m --tail 200  # 飞书最近 5 分钟

# 重启单个服务
docker compose --profile app restart gateway-adapter
docker compose --profile app restart workflow-service

# 停止所有服务
docker compose --profile app down

# 停止并清理所有数据（危险操作）
docker compose --profile app down -v
```

### 2.3 资源限制

各服务默认资源限制 (docker-compose.yml):

| 服务 | CPU 限制 | 内存限制 |
|------|----------|----------|
| gateway-adapter | 0.45 vCPU | 480 MB |
| workflow-service | 0.45 vCPU | 700 MB |
| executor-gateway | 0.45 vCPU | 1350 MB |
| fact-retrieval | 0.45 vCPU | 700 MB |
| hermes-adapter | 0.30 vCPU | 400 MB |
| feishu-longconn | 0.20 vCPU | 200 MB |
| web-portal | 0.30 vCPU | 300 MB |
| skill-library | 0.20 vCPU | 350 MB |
| resource-scheduler | 0.20 vCPU | 350 MB |
| mobile-app | 0.15 vCPU | 250 MB |
| postgres | 1.25 vCPU | 3 GB |
| redis | 0.20 vCPU | 450 MB |
| minio | 0.20 vCPU | 450 MB |
| clickhouse | 1.00 vCPU | 2 GB |

可根据实际负载调整，或在 docker-compose.yml 中移除 `deploy.resources.limits` 使用无限制模式。

---

## 三、监控与可观测性

### 3.1 日志系统

所有服务通过结构化日志输出到 stdout/stderr:

```bash
# 日志格式: JSON (包含 timestamp, level, component, message 等字段)

# 按级别过滤
docker logs ah-gateway 2>&1 | grep '"level":"error"'
docker logs ah-workflow 2>&1 | grep '"level":"warn"'
```

### 3.2 OpenTelemetry 追踪

SigNoz 提供全链路追踪能力:

| 访问地址 | 用途 |
|----------|------|
| http://localhost:3301 | SigNoz Web UI |
| http://localhost:4318 | OTLP HTTP 端点 |
| http://localhost:4317 | OTLP gRPC 端点 |

### 3.3 关键指标

| 指标 | 含义 | 获取方式 |
|------|------|----------|
| 容器健康状态 | 各服务是否存活 | `docker ps` |
| 数据库连接 | 连接池使用率 | 数据库日志 |
| LLM 调用延迟 | 大模型响应时间 | LiteLLM 日志 / SigNoz |
| 工作流状态分布 | 运行中/成功/失败数 | Workflow API |
| Supervisor 心跳 | 工作流执行器健康 | workflow 日志 `heartbeat` |
| 飞书 WS 连接 | 长连接状态 | feishu-longconn 日志 |

---

## 四、数据库管理

### 4.1 连接信息

```
主机: localhost (或 Docker 内 postgres)
端口: 5432
数据库: agent_harness
用户: agent_harness
密码: change_me_123 (本地开发) / dev_password (原默认值)
```

> ⚠️ **本地开发密码**: `change_me_123`
> 已记录在 OPS.md 第 1.2.1 节和 `.env` 文件中。

### 4.2 迁移

```bash
# 查看迁移状态
npm run db:migrate -- --dry-run

# 执行迁移
npm run db:migrate

# Drizzle ORM 推送 schema 变更
npm run db:push

# Drizzle ORM 生成迁移文件
npm run db:generate
```

### 4.3 备份与恢复

```bash
# 备份 PostgreSQL
docker exec ah-postgres pg_dump -U agent_harness agent_harness > backup_$(date +%Y%m%d).sql

# 备份 Redis
docker exec ah-redis redis-cli SAVE
docker cp ah-redis:/data/dump.rdb ./redis_backup_$(date +%Y%m%d).rdb

# 恢复 PostgreSQL
cat backup_20260502.sql | docker exec -i ah-postgres psql -U agent_harness agent_harness

# 恢复 Redis
docker cp ./redis_backup_20260502.rdb ah-redis:/data/dump.rdb
docker compose restart redis
```

### 4.4 清理旧数据

```bash
# 清理已归档的工作流（删除 30 天前的）
docker exec -it ah-postgres psql -U agent_harness agent_harness -c "
  DELETE FROM workflow_instance WHERE status = 'archived' AND updated_at < NOW() - INTERVAL '30 days';
"

# 清理旧审计日志（保留 90 天）
docker exec -it ah-postgres psql -U agent_harness agent_harness -c "
  DELETE FROM audit_event WHERE occurred_at < NOW() - INTERVAL '90 days';
"
```

---

## 五、故障排查

### 5.1 常见问题

#### 容器启动失败

```bash
# 查看详细错误
docker compose --profile app logs <服务名>

# 重新构建镜像
docker compose --profile app build --no-cache <服务名>
docker compose --profile app up -d <服务名>
```

#### 飞书无回应

1. 检查 feishu-longconn 日志: `docker logs ah-feishu-longconn --tail 50`
2. 确认 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 正确配置
3. 确认飞书应用已发布并配置了事件订阅 URL
4. 通过 Web Portal 检查身份绑定: http://localhost:3003 → 用户管理

#### LLM 调用超时

1. 检查 LiteLLM 状态: `curl http://localhost:4000/health/liveliness`
2. 检查 `MINIMAX_API_KEY` 是否有效
3. 查看 LiteLLM 日志: `docker logs ah-litellm --tail 100`
4. 调整超时: `.env` 中 `LITELLM_PLAN_TIMEOUT_MS` 或 `LITELLM_EXEC_TIMEOUT_MS`

#### 数据库连接失败

1. 检查 PostgreSQL 容器: `docker ps | grep postgres`
2. 检查端口占用: `netstat -an | grep 5432`
3. 检查 DATABASE_URL 格式: `postgresql://user:pass@host:5432/dbname`

#### Supervisor 心跳超时

- 原因: 工作流执行时间过长，执行器未及时回调
- 影响: 非致命，supervisor 有 grace period 兜底
- 修复: 检查 executor-gateway 日志，可能需要增加 `LITELLM_EXEC_TIMEOUT_MS`

### 5.2 性能优化

| 优化项 | 措施 |
|--------|------|
| LLM 延迟 | 使用 `SKIP_LLM_PLAN=true` 跳过规划步骤（开发测试） |
| 数据库压力 | 增加 `DB_POOL_MAX`，使用连接池预热 |
| 内存占用 | 降低 `MAX_MEMORY_PER_SESSION`、`redis maxmemory` |
| 磁盘空间 | 清理旧的工作流、审计日志、MinIO artifacts |

---

## 六、安全加固

### 6.1 生产环境必做

1. **修改所有默认密码**: 
   - `POSTGRES_PASSWORD`
   - `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
   - `LITELLM_MASTER_KEY`
   - `REDIS_URL` 中的密码

2. **设置 `ADMIN_PASSWORD`**: Web Portal 的管理员环境密码

3. **配置 CORS**: 将 `CORS_ORIGINS` 设置为具体的域名，不要使用 `*`

4. **启用 HTTPS**: 在生产环境前端加 Nginx/Traefik 反向代理并配置 SSL

5. **数据库网络安全**: 
   - 生产环境不要暴露 PostgreSQL 5432 端口到公网
   - 使用 Docker 内部网络通信

6. **密钥管理**: 使用密钥管理服务（如 Vault）存储敏感配置，不要硬编码

### 6.2 认证机制

| 层面 | 方式 |
|------|------|
| Web Portal | Session Cookie (Redis, 24h TTL) + scrypt 密码哈希 |
| IM 渠道 | 飞书/企微 OAuth + channel_identity 绑定 |
| 服务间 | Docker 内部网络隔离 |

### 6.3 审计

所有关键操作记录在 `audit_event` 表:
- action: login, create_workflow, update_policy, invite_member 等
- user_id: 操作者
- detail_json: 操作详情
- occurred_at: 操作时间

---

## 七、版本升级

### 7.1 升级流程

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 备份数据库
docker exec ah-postgres pg_dump -U agent_harness agent_harness > backup_pre_upgrade.sql

# 3. 停止服务
docker compose --profile app down

# 4. 执行数据库迁移
npm run db:migrate

# 5. 重新构建并启动
docker compose --profile app up -d --build

# 6. 验证
node scripts/final-audit.cjs
```

### 7.2 回滚

```bash
# 1. 恢复数据库
cat backup_pre_upgrade.sql | docker exec -i ah-postgres psql -U agent_harness agent_harness

# 2. 切换到之前的代码版本
git checkout <previous-tag>

# 3. 重新构建启动
docker compose --profile app up -d --build
```

---

## 八、相关文档

| 文档 | 内容 |
|------|------|
| [产品说明](./PRODUCT.md) | 功能特性、使用场景 |
| [架构文档](./ARCHITECTURE.md) | 系统架构、数据流、API 端点 |
| [开源协议](./LICENSES.md) | 第三方依赖许可证清单 |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史与当前状态 |
