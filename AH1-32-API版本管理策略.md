# 文档 32：API 版本管理策略 v1.0

## 32.1 文档目的

本文件定义 Agent Harness V1 的 API 版本管理策略，覆盖：

- 版本命名规范
- 版本兼容性规则
- 版本迁移策略
- 废弃策略
- 版本文档化

## 32.2 版本命名规范

### 32.2.1 URL 版本策略

Day 1 采用 URL 路径版本策略：

```
/api/v1/workflows
/api/v1/stages
/api/v1/retrieval
```

### 32.2.2 版本号格式

采用语义化版本（Semantic Versioning）：

```
MAJOR.MINOR.PATCH

MAJOR: 不兼容的 API 变更
MINOR: 向后兼容的功能新增
PATCH: 向后兼容的问题修复
```

### 32.2.3 版本生命周期

| 阶段 | 持续时间 | 说明 |
|------|----------|------|
| Current | 当前版本 | 活跃开发与支持 |
| Deprecated | 6 个月 | 已废弃，仍可用，计划移除 |
| Sunset | 3 个月 | 即将移除，强烈建议迁移 |
| Retired | - | 已移除，不可用 |

## 32.3 兼容性规则

### 32.3.1 兼容性定义

#### 向后兼容的变更（允许）

| 变更类型 | 示例 |
|----------|------|
| 新增端点 | `POST /api/v1/new-endpoint` |
| 新增可选字段 | `{"name": "xxx", "new_field": "optional"}` |
| 新增枚举值 | `status: "new_status"` |
| 新增响应字段 | `{"id": "1", "new_field": "value"}` |
| 放宽验证规则 | 必填改为可选 |

#### 不兼容的变更（需要新版本）

| 变更类型 | 示例 |
|----------|------|
| 删除端点 | 删除 `POST /api/v1/old-endpoint` |
| 删除字段 | 删除响应中的 `old_field` |
| 重命名字段 | `name` → `display_name` |
| 改变字段类型 | `count: number` → `count: string` |
| 收紧验证规则 | 可选改为必填 |
| 改变错误码 | `ERROR_A` → `ERROR_B` |

### 32.3.2 兼容性检查清单

```typescript
interface CompatibilityCheck {
  endpoint_added: boolean;
  endpoint_removed: boolean;
  field_added_optional: boolean;
  field_added_required: boolean;
  field_removed: boolean;
  field_renamed: boolean;
  field_type_changed: boolean;
  enum_value_added: boolean;
  enum_value_removed: boolean;
}
```

## 32.4 版本迁移策略

### 32.4.1 迁移通知

当发布新版本时，在响应头中包含迁移信息：

```http
HTTP/1.1 200 OK
X-API-Version: v1
X-API-Deprecated: true
X-API-Sunset: 2026-10-20
X-API-Migration-Guide: https://docs.example.com/api/migration/v1-to-v2
Link: </api/v2/workflows>; rel="successor-version"
```

### 32.4.2 迁移指南模板

```markdown
# API v1 → v2 迁移指南

## 概述
v2 版本于 2026-04-20 发布，v1 将于 2026-10-20 废弃。

## 主要变更

### 端点变更
| v1 端点 | v2 端点 | 说明 |
|---------|---------|------|
| POST /workflows | POST /workflows | 无变化 |
| GET /workflows/{id}/stages | GET /workflows/{id}/stages | 响应格式变更 |

### 字段变更
| 字段 | v1 | v2 | 迁移方式 |
|------|-----|-----|----------|
| stage.assigned_executor | string | object | 结构化对象 |
| workflow.budget | flat fields | nested object | 预算字段结构化 |

### 新增功能
- 新增 `POST /workflows/{id}/cancel` 端点
- 新增 `workflow.metadata` 字段

## 迁移步骤
1. 更新 API 基础 URL：`/api/v1` → `/api/v2`
2. 更新 `assigned_executor` 字段解析逻辑
3. 更新 `budget` 字段解析逻辑
```

> **注意**：迁移指南示例中的字段变更不应与现有文档定义矛盾。Workflow 状态名称（如 `running`、`waiting_user`）已在文档 17 中定义为小写下划线格式，版本迁移不应改变状态枚举的大小写格式。

### 32.4.3 并行运行期

在新版本发布后，旧版本保持可用 6 个月：

```
v1 发布 ──────────────────────────────────────────────▶ v1 废弃
         │                                              │
         │  v2 发布                                      │
         │  │                                           │
         ▼  ▼                                           ▼
    ┌─────────────────────────────────────────────────────┐
    │              并行运行期 (6个月)                       │
    │   v1: 可用但废弃                                    │
    │   v2: 当前版本                                      │
    └─────────────────────────────────────────────────────┘
```

## 32.5 废弃策略

### 32.5.1 废弃流程

```
1. 标记废弃 (Deprecated)
   - 在响应头添加 X-API-Deprecated: true
   - 在文档中标记废弃
   - 发布废弃公告

2. 进入 Sunset 阶段
   - 在响应头添加 X-API-Sunset 日期
   - 返回警告信息
   - 加强迁移通知

3. 移除 (Retired)
   - 返回 410 Gone
   - 提供迁移指南链接
```

### 32.5.2 废弃响应

```json
{
  "code": "SYSTEM_API_VERSION_RETIRED",
  "message": "API v1 has been retired. Please migrate to v2.",
  "detail": {
    "retired_version": "v1",
    "current_version": "v2",
    "migration_guide": "https://docs.example.com/api/migration/v1-to-v2"
  }
}
```

### 32.5.3 废弃审计

所有废弃相关事件必须记录审计：

```json
{
  "action": "api.version.deprecated",
  "version": "v1",
  "sunset_date": "2026-10-20",
  "reason": "Major architecture change",
  "migration_guide_url": "https://docs.example.com/api/migration/v1-to-v2"
}
```

## 32.6 版本路由

### 32.6.1 路由实现

```typescript
const API_VERSIONS = {
  v1: {
    deprecated: false,
    handler: v1Router
  }
};

app.use('/api/:version/*', (req, res, next) => {
  const version = req.params.version;
  const versionConfig = API_VERSIONS[version];

  if (!versionConfig) {
    return res.status(404).json({
      code: 'SYSTEM_API_VERSION_NOT_FOUND',
      message: `API version ${version} not found`,
      available_versions: Object.keys(API_VERSIONS)
    });
  }

  res.setHeader('X-API-Version', version);
  if (versionConfig.deprecated) {
    res.setHeader('X-API-Deprecated', 'true');
    if (versionConfig.sunset_date) {
      res.setHeader('X-API-Sunset', versionConfig.sunset_date);
    }
  }

  versionConfig.handler(req, res, next);
});
```

> **Day 1 说明**：Day 1 仅存在 v1 版本，`deprecated` 为 `false`。当 v2 发布后，v1 的 `deprecated` 才应设为 `true` 并添加 `sunset_date`。

### 32.6.2 版本协商

支持通过多种方式指定版本：

| 方式 | 优先级 | 示例 |
|------|--------|------|
| URL 路径 | 1 (最高) | `/api/v2/workflows` |
| 请求头 | 2 | `Accept: application/json; version=2` |
| 查询参数 | 3 | `?version=2` |

## 32.7 内部 API 版本管理

### 32.7.1 内部 API 规则

内部服务间 API 采用不同的版本策略：

| API 类型 | 版本策略 | 说明 |
|----------|----------|------|
| 外部 API | URL 版本 | 需要长期兼容 |
| 内部 API | 无版本或宽松版本 | 可同步更新 |
| 事件契约 | Schema 版本 | 需要版本标识 |

### 32.7.2 事件版本管理

```json
{
  "event_id": "evt_123",
  "event_type": "workflow.stage.started",
  "event_version": "2",
  "payload": {
  }
}
```

### 32.7.3 事件版本兼容

```typescript
interface EventHandler {
  handle(event: Event): Promise<void>;
}

class WorkflowStageStartedHandler implements EventHandler {
  async handle(event: Event): Promise<void> {
    const payload = this.parsePayload(event);
  }

  private parsePayload(event: Event): WorkflowStageStartedPayload {
    switch (event.event_version) {
      case '1':
        return this.parseV1(event.payload);
      case '2':
        return this.parseV2(event.payload);
      default:
        throw new UnsupportedEventVersionError(event.event_version);
    }
  }
}
```

## 32.8 版本文档化

### 32.8.1 API 文档结构

```
docs/api/
├── v1/
│   ├── overview.md
│   ├── authentication.md
│   ├── workflows.md
│   ├── retrieval.md
│   └── changelog.md
├── v2/
│   ├── overview.md
│   ├── authentication.md
│   ├── workflows.md
│   ├── retrieval.md
│   └── changelog.md
└── migration/
    ├── v1-to-v2.md
    └── index.md
```

### 32.8.2 OpenAPI 规范

```yaml
openapi: 3.0.3
info:
  title: Agent Harness API
  version: 1.0.0
  description: |
    Agent Harness V1 API

    ## Version History
    - v1.0.0 (2026-04-20): Initial release

servers:
  - url: https://api.example.com/api/v1
    description: Production
  - url: https://api-staging.example.com/api/v1
    description: Staging

paths:
  /workflows:
    get:
      summary: List workflows
      operationId: listWorkflows
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WorkflowList'
```

### 32.8.3 变更日志模板

```markdown
# API Changelog

## v1.0.0 (2026-04-20)

### New Features
- Initial API release
```

## 32.9 版本发布流程

### 32.9.1 发布检查清单

```markdown
## API 版本发布检查清单

### 发布前
- [ ] 完成兼容性评估
- [ ] 更新 OpenAPI 规范
- [ ] 更新文档
- [ ] 编写迁移指南（如有 Breaking Changes）
- [ ] 通知所有已知的 API 消费者

### 发布时
- [ ] 部署新版本
- [ ] 验证健康检查
- [ ] 验证 API 文档可访问
- [ ] 监控错误率

### 发布后
- [ ] 更新版本公告
- [ ] 监控使用情况
- [ ] 收集反馈
```

### 32.9.2 版本公告模板

```markdown
# API v2 发布公告

## 发布日期
2026-04-20

## 主要变更
1. 新增 Workflow 取消端点
2. Executor 信息结构化

## 迁移要求
- v1 将于 2026-10-20 废弃
- 请在废弃日期前完成迁移

## 文档
- [API 文档](https://docs.example.com/api/v2)
- [迁移指南](https://docs.example.com/api/migration/v1-to-v2)

## 支持
如有问题，请联系 api-support@example.com
```

## 32.10 Day 1 验证用例

1. v1 API 正确返回版本信息头。
2. 废弃版本正确返回废弃警告头。
3. 不存在的版本返回 404、可用版本列表及 `SYSTEM_API_VERSION_NOT_FOUND` 错误码。
4. 版本迁移指南可访问。
5. OpenAPI 文档正确描述当前版本。
6. 所有错误码符合文档 15 §15.3 定义的前缀规范（`SYSTEM_*` 前缀）。
