# 文档 26：Provider 选择与配置设计 v1.0

## 26.1 文档目的

本文件定义平台外部能力供应商的选择策略、配置规则与切换机制，覆盖：

- LLM Provider 选择与配置
- Embedding Provider 选择与配置
- Rerank Provider 选择与配置
- 供应商切换与降级策略
- 成本与配额管理

## 26.2 设计原则

1. 所有外部能力通过 Provider Adapter 接入，不直接耦合具体供应商。
2. Day 1 固定主供应商，但保留切换能力。
3. 支持多供应商并行配置，运行期按策略选择。
4. 成本与配额必须可观测、可控制。
5. 敏感凭证不进入代码仓库，通过环境变量或密钥管理服务注入。

## 26.3 LLM Provider

### 26.3.1 Day 1 主供应商

| 用途 | 主供应商 | 备选供应商 | 说明 |
|------|----------|------------|------|
| Planner | OpenAI GPT-4o | Claude 3.5 Sonnet | 高质量规划 |
| Executor | OpenAI GPT-4o | Claude 3.5 Sonnet | 代码生成与执行 |
| Code Executor | OpenAI GPT-4o | Claude 3.5 Sonnet | 开发任务专用 |
| 通用对话 | OpenAI GPT-4o-mini | Claude 3 Haiku | 轻量任务 |

### 26.3.2 LLM 配置结构

```json
{
  "provider_id": "openai",
  "provider_type": "llm",
  "models": [
    {
      "model_id": "gpt-4o",
      "model_name": "gpt-4o-2024-08-06",
      "context_window": 128000,
      "max_output_tokens": 16384,
      "capabilities": ["planning", "code", "reasoning"],
      "cost_per_1k_input_tokens": 0.0025,
      "cost_per_1k_output_tokens": 0.01,
      "rate_limit_rpm": 500,
      "rate_limit_tpm": 30000
    },
    {
      "model_id": "gpt-4o-mini",
      "model_name": "gpt-4o-mini-2024-07-18",
      "context_window": 128000,
      "max_output_tokens": 16384,
      "capabilities": ["chat", "light-reasoning"],
      "cost_per_1k_input_tokens": 0.00015,
      "cost_per_1k_output_tokens": 0.0006,
      "rate_limit_rpm": 500,
      "rate_limit_tpm": 200000
    }
  ],
  "api_endpoint": "https://api.openai.com/v1",
  "auth_method": "api_key",
  "auth_ref": "env:OPENAI_API_KEY",
  "timeout_sec": 120,
  "retry_policy": {
    "max_retries": 3,
    "retry_on": ["rate_limit", "timeout", "server_error"],
    "backoff_base_sec": 1,
    "backoff_max_sec": 30
  }
}
```

### 26.3.3 LLM 调用路由规则

| 场景 | 优先模型 | 降级模型 | 说明 |
|------|----------|----------|------|
| Workflow Planner | gpt-4o | gpt-4o-mini | 需要高质量规划 |
| Code Executor | gpt-4o | claude-3.5-sonnet | 代码生成优先质量 |
| Evidence Summary | gpt-4o-mini | gpt-4o | 轻量摘要任务 |
| Intent Classification | gpt-4o-mini | gpt-4o | 分类任务轻量优先 |
| Verification Analysis | gpt-4o | gpt-4o-mini | 需要深度分析 |

## 26.4 Embedding Provider

### 26.4.1 Day 1 主供应商

| 用途 | 主供应商 | 维度 | 说明 |
|------|----------|------|------|
| 文档切片 | OpenAI text-embedding-3-small | 1536 | 性价比高 |
| Memory | OpenAI text-embedding-3-small | 1536 | 与文档统一 |
| Skill Summary | OpenAI text-embedding-3-small | 1536 | 与文档统一 |

### 26.4.2 Embedding 配置结构

```json
{
  "provider_id": "openai-embedding",
  "provider_type": "embedding",
  "models": [
    {
      "model_id": "text-embedding-3-small",
      "model_name": "text-embedding-3-small",
      "dimensions": 1536,
      "max_input_tokens": 8191,
      "cost_per_1k_tokens": 0.00002,
      "rate_limit_rpm": 3000,
      "rate_limit_tpm": 1000000
    }
  ],
  "api_endpoint": "https://api.openai.com/v1",
  "auth_method": "api_key",
  "auth_ref": "env:OPENAI_API_KEY",
  "batch_size": 100,
  "timeout_sec": 30
}
```

### 26.4.3 Embedding 版本管理

1. **版本锁定**：Day 1 固定使用 `text-embedding-3-small`，不混用其他模型。
2. **迁移策略**：若需更换模型，必须：
   - 创建新的 embedding 列（如 `embedding_v2`）
   - 后台批量重建索引
   - 验证召回质量后切换
   - 保留旧索引直到迁移完成
3. **版本标识**：每次写入 embedding 时记录 `embedding_model_version`。

## 26.5 Rerank Provider

### 26.5.1 Day 1 主供应商

| 用途 | 主供应商 | 说明 |
|------|----------|------|
| 检索结果重排 | Cohere Rerank v3 | 高质量重排 |

### 26.5.2 Rerank 配置结构

```json
{
  "provider_id": "cohere-rerank",
  "provider_type": "rerank",
  "models": [
    {
      "model_id": "rerank-v3.5",
      "model_name": "rerank-v3.5",
      "max_documents": 1000,
      "cost_per_1k_documents": 0.002
    }
  ],
  "api_endpoint": "https://api.cohere.ai/v1",
  "auth_method": "api_key",
  "auth_ref": "env:COHERE_API_KEY",
  "timeout_sec": 30
}
```

### 26.5.3 Rerank 触发条件

| 条件 | 是否触发 | 说明 |
|------|----------|------|
| 候选数 > 20 | 是 | 需要精排 |
| 多源混合结果 | 是 | 需要统一排序 |
| 单源候选数 ≤ 5 | 否 | 无需重排 |
| 用户明确要求精准 | 是 | 强制重排 |

## 26.6 Provider Adapter 接口

### 26.6.1 LLM Adapter 接口

```typescript
interface LLMAdapter {
  provider_id: string;
  
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterator<LLMChunk>;
  count_tokens(text: string): number;
  get_model_info(model_id: string): ModelInfo;
}

interface LLMRequest {
  model_id: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  stop_sequences?: string[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "required" | "none";
  metadata?: Record<string, unknown>;
}

interface LLMResponse {
  request_id: string;
  model_id: string;
  content: string;
  tool_calls?: ToolCall[];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  finish_reason: "stop" | "length" | "tool_call" | "error";
}
```

### 26.6.2 Embedding Adapter 接口

```typescript
interface EmbeddingAdapter {
  provider_id: string;
  
  embed(texts: string[]): Promise<EmbeddingResponse>;
  embed_batch(texts: string[], batch_size?: number): Promise<EmbeddingResponse[]>;
  get_dimension(): number;
}

interface EmbeddingResponse {
  request_id: string;
  embeddings: number[][];
  model_id: string;
  usage: {
    total_tokens: number;
  };
}
```

### 26.6.3 Rerank Adapter 接口

```typescript
interface RerankAdapter {
  provider_id: string;
  
  rerank(request: RerankRequest): Promise<RerankResponse>;
}

interface RerankRequest {
  query: string;
  documents: string[];
  top_n?: number;
}

interface RerankResponse {
  request_id: string;
  results: {
    index: number;
    relevance_score: number;
    document: string;
  }[];
}
```

## 26.7 供应商切换与降级

### 26.7.1 切换触发条件

| 触发条件 | 动作 |
|----------|------|
| 主供应商连续失败 3 次 | 切换到备选供应商 |
| 主供应商响应时间 > 60s | 切换到备选供应商 |
| 主供应商配额耗尽 | 切换到备选供应商 |
| 主供应商返回 5xx 错误 | 切换到备选供应商 |

### 26.7.2 降级策略

| 场景 | 降级策略 |
|------|----------|
| 所有 LLM 不可用 | 返回 `INTEGRATION_LLM_UNAVAILABLE`，Workflow 进入 `blocked` |
| Embedding 不可用 | 跳过向量召回，保留结构化+全文 |
| Rerank 不可用 | 使用规则排序（BM25 + 时间衰减） |
| 所有供应商不可用 | 返回 `INTEGRATION_ALL_PROVIDERS_DOWN`，触发告警 |

### 26.7.3 自动恢复

1. 供应商切换后，每 5 分钟探测主供应商健康状态。
2. 主供应商恢复后，自动切回（可配置为手动确认）。
3. 切换事件必须写入审计日志。

## 26.8 成本与配额管理

### 26.8.1 "更大资源投入"预算策略

与 OpenClaw 的默认保守策略不同，Agent Harness 明确选择"更大资源投入换取更高质量"的策略：

| 策略维度 | OpenClaw 默认 | Agent Harness 策略 | 差异说明 |
|----------|---------------|-------------------|----------|
| Planner 模型 | GPT-4o-mini | GPT-4o | 更高质量规划 |
| Executor 模型 | GPT-4o-mini | GPT-4o | 更高质量代码 |
| 检索候选数 | 10 | 50 | 更广召回范围 |
| Rerank | 不启用 | 启用 | 更精准排序 |
| 图增强 | 不支持 | AGE 2 跳 | 关联信息召回 |
| 修复循环 | 1 次 | 3-5 次 | 更彻底修复 |
| 上下文窗口 | 共享/压缩 | 独立/按需加载 | 避免上下文污染 |
| Checkpoint | 无 | 每阶段 | 可恢复执行 |

### 26.8.2 预算结构

```json
{
  "budget_policy": {
    "daily_limit_usd": 100,
    "per_workflow_limit_usd": 5,
    "per_stage_limit_usd": 1,
    "alert_threshold_pct": 80
  }
}
```

### 26.8.3 各任务类型预算指导

| 任务类型 | 建议日预算 | 单任务预算 | 说明 |
|----------|-----------|-----------|------|
| 知识查询 | $0.5/天 | $0.1/次 | 轻量检索+摘要 |
| 分析任务 | $2/天 | $0.5/次 | 多轮检索+分析 |
| 开发任务 | $20/天 | $3/次 | 多阶段+修复循环 |
| 复杂开发 | $50/天 | $5/次 | 含审批+多轮验证 |

### 26.8.4 配额追踪

| 指标 | 说明 |
|------|------|
| `provider_request_total` | 按供应商统计请求数 |
| `provider_tokens_total` | 按供应商统计 token 消耗 |
| `provider_cost_usd_total` | 按供应商统计成本 |
| `provider_error_total` | 按供应商统计错误数 |
| `provider_latency_ms` | 按供应商统计延迟 |

### 26.8.5 配额告警

| 告警 | 条件 |
|------|------|
| 日预算即将耗尽 | 日消耗 > 80% 日预算 |
| 单任务超支 | 单 Workflow 成本 > 阈值 |
| 供应商异常 | 错误率 > 10% 或延迟 p95 > 30s |

## 26.9 凭证管理

### 26.9.1 凭证存储

| 方式 | 适用场景 | 说明 |
|------|----------|------|
| 环境变量 | 开发/测试 | 简单直接 |
| Kubernetes Secret | K8s 部署 | 原生支持 |
| HashiCorp Vault | 生产环境 | 企业级密钥管理 |
| AWS Secrets Manager | AWS 部署 | 云原生方案 |

### 26.9.2 凭证轮换

1. 支持多凭证并行生效（新旧凭证过渡期）。
2. 凭证轮换不重启服务。
3. 轮换事件写入审计日志。

### 26.9.3 环境变量清单

> **📌 配置权威源说明**: 完整的环境变量定义和详细说明请参考 [文档28 §28.3.2](./AH1-28-配置管理.md)。本节仅列出 Provider 相关的核心环境变量。

```bash
# LLM Provider
OPENAI_API_KEY=sk-xxx
OPENAI_ORG_ID=org-xxx
ANTHROPIC_API_KEY=sk-ant-xxx

# Embedding Provider
OPENAI_API_KEY=sk-xxx  # 复用 LLM 凭证

# Rerank Provider
COHERE_API_KEY=xxx

# Optional: Custom Endpoints
OPENAI_API_BASE=https://api.openai.com/v1
ANTHROPIC_API_BASE=https://api.anthropic.com
```

**⚠️ 安全提醒**: 
- 所有包含 `KEY`、`SECRET`、`PASSWORD` 的环境变量必须通过密钥管理服务注入，不得硬编码在代码或提交到版本控制
- 生产环境建议使用 HashiCorp Vault 或云厂商的 Secrets Manager（详见文档28 §28.5）

## 26.10 Day 1 验证用例

1. LLM 调用成功返回响应，token 统计准确。
2. Embedding 生成维度正确，可写入 pgvector。
3. Rerank 对候选集正确排序。
4. 主供应商失败时自动切换到备选。
5. 预算超限时正确拒绝请求。
6. 凭证从环境变量正确读取。
