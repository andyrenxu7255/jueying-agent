# TeamClaw — 第三方开源协议声明

> 版本: 1.0.0 | 更新日期: 2026-05-02

---

## 一、TeamClaw 本体许可

TeamClaw (Agent Harness) 本体采用 **MIT 许可证**。

```
MIT License

Copyright (c) 2026 TeamClaw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 二、NPM 运行时依赖

本项目的所有 npm 包均通过 package.json 声明，以下为**生产运行时依赖**及其许可证：

### 2.1 LLM / AI 相关

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `@larksuiteoapi/node-sdk` | ^1.30.0 ~ ^1.61.1 | MIT | https://github.com/larksuite/node-sdk |

### 2.2 工作流引擎

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `xstate` | ^5.9.0 | MIT | https://github.com/statelyai/xstate |

### 2.3 数据库与 ORM

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `drizzle-orm` | ^0.45.2 | Apache-2.0 | https://github.com/drizzle-team/drizzle-orm |
| `pg` | ^8.20.0 | MIT | https://github.com/brianc/node-postgres |
| `redis` | ^5.12.1 | MIT | https://github.com/redis/node-redis |

### 2.4 权限策略

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `casbin` | ^5.29.0 | Apache-2.0 | https://github.com/casbin/node-casbin |

### 2.5 文档处理

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `mammoth` | ^1.8.0 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js |
| `pdf-parse` | ^1.1.1 | MIT | https://github.com/mooz/pdf-parse |
| `xlsx` | ^0.18.5 | Apache-2.0 | https://github.com/SheetJS/sheetjs |
| `officeparser` | ^6.1.0 | MIT | https://github.com/harshank/officeparser |

### 2.6 工具库

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `zod` | ^3.25.76 | MIT | https://github.com/colinhacks/zod |
| `yaml` | ^2.4.0 ~ ^2.8.3 | ISC | https://github.com/eemeli/yaml |
| `effect` | ^3.0.0 | MIT | https://github.com/Effect-TS/effect |

### 2.7 云服务 SDK

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `@aws-sdk/client-s3` | ^3.908.0 | Apache-2.0 | https://github.com/aws/aws-sdk-js-v3 |

### 2.8 OpenTelemetry 可观测性

| 包名 | 版本范围 | 许可证 | 上游仓库 |
|------|----------|--------|----------|
| `@opentelemetry/sdk-node` | ^0.52.0 | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js |
| `@opentelemetry/auto-instrumentations-node` | ^0.50.0 | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js-contrib |

---

## 三、NPM 开发依赖

| 包名 | 版本范围 | 许可证 | 用途 |
|------|----------|--------|------|
| `typescript` | ^5.8.2 | Apache-2.0 | TypeScript 编译器 |
| `eslint` | ^8.57.0 | MIT | 代码规范检查 |
| `@typescript-eslint/parser` | ^7.0.0 | BSD-2-Clause | ESLint TS 解析器 |
| `@typescript-eslint/eslint-plugin` | ^7.0.0 | MIT | ESLint TS 规则 |
| `jest` | ^29.7.0 | MIT | 测试框架 |
| `ts-jest` | ^29.1.0 | MIT | TypeScript 测试支持 |
| `ts-node` | ^10.9.2 | MIT | TypeScript 运行时 |
| `tsx` | ^4.21.0 | MIT | TypeScript 执行器 |
| `drizzle-kit` | ^0.31.10 | MIT | Drizzle 迁移工具 |
| `@types/node` | ^20.11.0 | MIT | Node.js 类型定义 |
| `@types/jest` | ^29.5.0 | MIT | Jest 类型定义 |
| `@types/yaml` | ^1.9.6 | MIT | YAML 类型定义 |

---

## 四、Docker 基础设施服务

以下服务作为 Docker 镜像部署，各有其独立的开源许可证：

### 4.1 数据库

| 服务 | 镜像 | 许可证 | 说明 |
|------|------|--------|------|
| PostgreSQL 16 + pgvector + AGE | 自定义构建 (postgres:16) | PostgreSQL License | 类似 MIT，允许自由使用/修改/分发 |
| pgvector | (扩展) | PostgreSQL License | PostgreSQL 向量检索扩展 |
| Apache AGE | (扩展) | Apache-2.0 | PostgreSQL 图数据库扩展 |

### 4.2 缓存

| 服务 | 镜像 | 许可证 | 说明 |
|------|------|--------|------|
| Redis 7 | `redis:7-alpine` | BSD-3-Clause | 内存键值缓存 |

### 4.3 对象存储

| 服务 | 镜像 | 许可证 | 说明 |
|------|------|--------|------|
| MinIO | `minio/minio:RELEASE.2024-11-07` | AGPL-3.0 | S3 兼容对象存储 |

### 4.4 LLM 代理

| 服务 | 镜像 | 许可证 | 说明 |
|------|------|--------|------|
| LiteLLM | `ghcr.io/berriai/litellm:main-latest` | MIT | LLM 统一代理 |

### 4.5 可观测性

| 服务 | 镜像 | 许可证 | 说明 |
|------|------|--------|------|
| SigNoz OTel Collector | `signoz/signoz-otel-collector:0.88.11` | Apache-2.0 | OpenTelemetry 数据采集 |
| SigNoz Query | `signoz/query-service:0.44.0` | MIT | SigNoz 查询服务 |
| SigNoz Frontend | `signoz/frontend:0.44.0` | MIT | SigNoz Web UI |
| ClickHouse | `clickhouse/clickhouse-server:24.1.5` | Apache-2.0 | 时序数据库 |

### 4.6 本地 LLM (可选)

| 服务 | 镜像 | 许可证 | 说明 |
|------|------|--------|------|
| Ollama | `ollama/ollama:latest` | MIT | 本地 LLM 运行时 |

---

## 五、许可证类型摘要

### MIT 协议

适用于大部分 npm 包（xstate, pg, redis, zod, officeparser, mammoth 等）和基础设施（LiteLLM, SigNoz, Ollama）。

> **核心要求**: 保留版权声明和许可声明。允许商用、修改、分发、私人使用。

### Apache-2.0 协议

适用于 drizzle-orm, casbin, xlsx, @aws-sdk, OpenTelemetry 组件, Apache AGE, ClickHouse。

> **核心要求**: 保留版权声明、许可声明和 NOTICE 文件。需说明对原代码的修改。授予专利许可。

### BSD-2-Clause 协议

适用于 mammoth 和 @typescript-eslint/parser。

> **核心要求**: 保留版权声明、许可声明和免责声明。与 MIT 类似但更简洁。

### BSD-3-Clause 协议

适用于 Redis。

> **核心要求**: 同 BSD-2-Clause，额外禁止使用作者名义做背书。

### ISC 协议

适用于 yaml。

> **核心要求**: 功能等同 MIT，文本更简洁。

### PostgreSQL License

适用于 PostgreSQL 16 和 pgvector。

> **核心要求**: 与 MIT 类似，允许无限制使用。

### AGPL-3.0 协议

适用于 MinIO。

> **核心要求**: 如果通过网络提供 MinIO 服务（如作为 SaaS 的存储后端），**必须公开源代码**。内部使用则不受此限制。

### 许可证兼容性总结

| TeamClaw 协议 | 第三方协议 | 兼容性 |
|:---:|:---:|:---:|
| MIT | MIT | ✅ 完全兼容 |
| MIT | Apache-2.0 | ✅ 完全兼容 |
| MIT | BSD-2-Clause | ✅ 完全兼容 |
| MIT | BSD-3-Clause | ✅ 完全兼容 |
| MIT | ISC | ✅ 完全兼容 |
| MIT | PostgreSQL License | ✅ 完全兼容 |
| MIT | AGPL-3.0 | ⚠️ 注意网络分发条款 |

---

## 六、合规义务

### 6.1 必须保留的内容

根据各许可证要求，本项目分发时需包含：

1. **MIT / Apache-2.0 / BSD / ISC**: 原始版权声明和许可声明文本
2. **Apache-2.0**: 若有修改上游代码，需在修改文件中标注
3. **AGPL-3.0 (MinIO)**: 若将本项目以 SaaS 方式提供，需公开包含 MinIO 修改的完整源码

### 6.2 免责声明

所有第三方组件均按"原样"提供，无任何形式的明示或暗示担保。使用本项目即表示接受所有第三方组件的许可条款。

### 6.3 联系方式

如需完整的 LICENSE 文本或对合规性有疑问，请参考各上游仓库中的 LICENSE 文件。

---

## 七、相关文档

| 文档 | 内容 |
|------|------|
| [产品说明](./PRODUCT.md) | 功能特性、使用场景 |
| [运维手册](./OPS.md) | 部署、监控、故障排查、备份恢复 |
| [架构文档](./ARCHITECTURE.md) | 系统架构、数据流、API 端点 |
| [交接文档](./HANDOFF-SESSION.md) | 开发历史与当前状态 |
