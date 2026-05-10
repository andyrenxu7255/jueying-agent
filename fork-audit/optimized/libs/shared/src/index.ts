/**
 * @agent-harness/shared - 共享库入口 (Optimized v2)
 *
 * 原版 libs/shared 提供 logger/metrics/http/retry/ai 等模块。
 * 优化后新增:
 *   - utils/TTLMap:         带TTL的内存存储（解决内存泄漏）
 *   - llm/LlmClient:        统一LLM客户端（消除3处 callLiteLLM 重复）
 *   - db/pool-manager:      统一DB连接池（消除6个独立Pool）
 *   - channel/*:            ChannelAdapter 接口 + Feishu/Wecom 适配器
 *   - server/bootstrap:     createMicroService() 服务工厂
 *   - intent/classifier:    IntentClassifier 统一意图分类
 */

export { TTLMap } from './utils/ttl-map';

export { LlmClient, llmClient } from './llm/client';
export type { LlmCallOptions, LlmCallResult } from './llm/client';

export { getPool, closeAllPools, getPoolsStats } from './db/pool-manager';

export { FeishuAdapter } from './channel/feishu-adapter';
export { WecomAdapter } from './channel/wecom-adapter';
export type {
  ChannelAdapter,
  SendMessageOptions,
  DownloadFileResult,
  PollTarget
} from './channel/adapter';

export { createMicroService } from './server/bootstrap';
export type { MicroServiceConfig, MicroServiceInstance, RouteHandler } from './server/bootstrap';

export { IntentClassifier, intentClassifier } from './intent/classifier';
export type { IntentClassification, IntentType, TaskTypeHint, RiskLevel } from './intent/classifier';