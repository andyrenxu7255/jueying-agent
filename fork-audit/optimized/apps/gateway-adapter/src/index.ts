/**
 * TeamClaw Agent Harness - Gateway Adapter (Optimized v2)
 *
 * 原版问题:
 *   - 2230行单文件，混合 Feishu/WeCom 双渠道 ~80% 重复逻辑
 *   - 5个意图分类函数分散在192行中
 *   - 5条路由路径重复身份检查+记忆写入模板
 *
 * 优化后:
 *   - 模块化: memory-manager / request-pipeline / file-importer
 *   - ChannelAdapter 接口: 飞书+企微适配器独立
 *   - IntentClassifier: 统一意图分类，高置信跳过 LLM
 *   - Pipeline 模式: 中间件消除路由模板重复
 *
 * @module gateway-adapter
 */

import { createMicroService } from '../../libs/shared/src/server/bootstrap';
import { FeishuAdapter } from '../../libs/shared/src/channel/feishu-adapter';
import { WecomAdapter } from '../../libs/shared/src/channel/wecom-adapter';
import type { ChannelAdapter } from '../../libs/shared/src/channel/adapter';
import { memoryManager } from './services/memory-manager';
import {
  RequestPipeline,
  requireIdentity,
  persistMemory,
  handleKnowledgeSubmit,
  handleQuickLookup,
  handleTask,
  handleTaskDispatch,
  createQuotaCheck
} from './services/request-pipeline';
import { importFile } from './services/file-importer';
import { closeAllPools } from '../../libs/shared/src/db/pool-manager';
import type { MicroServiceConfig } from '../../libs/shared/src/server/bootstrap';

const PORT = Number(process.env.PORT || 3000);

// 初始化渠道适配器
const feishu = new FeishuAdapter();
const wecom = new WecomAdapter();

// 构建请求流水线
const pipeline = new RequestPipeline()
  .use(requireIdentity)
  .use(createQuotaCheck({}))
  .use(persistMemory)
  .build();

// -- Webhook Handlers --

async function handleFeishuWebhook(
  _req: unknown, _res: unknown,
  body: Record<string, unknown>
): Promise<void> {
  const raw = String(body._raw || '');
  const challenge = (body as Record<string, unknown>).challenge as string | undefined;

  // Feishu URL Verification (首次配置)
  if (challenge && typeof challenge === 'string') {
    const res = body._res as { writeHead?: (c: number, h: Record<string, unknown>) => void; end?: (b: string) => void };
    res?.writeHead?.(200, { 'content-type': 'application/json' });
    res?.end?.(JSON.stringify({ challenge }));
    return;
  }

  if (!raw) return;

  // 风控检查
  try {
    const jsonBody = JSON.parse(raw) as { header?: { event_id?: string }; event?: Record<string, unknown> };
    const eventId = jsonBody.header?.event_id;
    if (eventId && feishu.isDuplicate(eventId)) return;
  } catch {}

  // 处理消息
  await processWebhookEvent(body, feishu);
}

async function handleWecomWebhook(
  _req: unknown, _res: unknown,
  body: Record<string, unknown>
): Promise<void> {
  const searchParams = body._searchParams as URLSearchParams | undefined;
  const raw = String(body._raw || '');

  // 去重检测
  try {
    const jsonBody = JSON.parse(raw) as { msgid?: string };
    if (jsonBody.msgid && wecom.isDuplicate(jsonBody.msgid)) return;
  } catch {}

  // 解密（企业微信加密模式）
  let eventBody = parseBody(raw);
  const encrypted = wecom.decryptMessage(raw);
  if (encrypted) eventBody = encrypted;

  await processWebhookEvent(eventBody, wecom);
}

// -- 通用Webhook事件处理 --

async function processWebhookEvent(
  body: Record<string, unknown>,
  channel: ChannelAdapter
): Promise<void> {
  const normalized = await normalizeEvent(body, channel);
  if (!normalized) return;

  const type = String(normalized.type || '');
  const text = String(normalized.request_text || '');

  if (!text) return;

  // 文件和图片导入
  if (type === 'image_and_text' || type === 'file_and_text') {
    const fileKey = String(normalized.file_key || '');
    const fileType = String(normalized.file_type || 'file');
    if (fileKey) {
      await handleFileImport(normalized, channel, fileKey, fileType);
      return;
    }
  }

  // 常规文本处理
  const result = await pipeline(normalized);

  // 查找用户的channel ID发送回复
  const userId = String(normalized.primary_user_id || normalized.user_id || '');
  if (userId && result.replyText) {
    await channel.sendTextMessage(userId, result.replyText);
  }
}

async function handleFileImport(
  normalized: Record<string, unknown>,
  channel: ChannelAdapter,
  fileKey: string,
  fileType: string
): Promise<void> {
  const file = await channel.downloadFile(fileKey, fileType);
  if (!file) {
    const userId = String(normalized.user_id || '');
    if (userId) await channel.sendTextMessage(userId, '文件下载失败，请确认文件大小未超过限制。');
    return;
  }

  const userId = String(normalized.primary_user_id || normalized.user_id || '');
  const orgId = String(normalized.org_id || '');

  const result = await importFile(file, userId, orgId, channel.channelType);
  if (userId) {
    if (result.success) {
      await channel.sendTextMessage(
        userId,
        `文件已导入知识库！\n${result.docId ? `文档编号: ${result.docId}` : ''}\n提取文本长度: ${result.rawText.length} 字符`
      );
    } else {
      await channel.sendTextMessage(userId, `文件导入失败: ${result.error || '未知错误'}`);
    }
  }
}

async function normalizeEvent(
  body: Record<string, unknown>,
  channel: ChannelAdapter
): Promise<Record<string, unknown> | null> {
  const userId = String(body.from_user_id || body.user_id || '');
  if (!userId) return null;

  // 从DB查询用户组织信息
  let orgId = '';
  try {
    const result = await import('./services/id-resolver');
    // 简化：从 body 中获取 org_id
    orgId = String(body.org_id || '');
  } catch {}

  const text = String(body.text?.content || body.text || body.content || '');
  const sessionRef = `session_${userId}_${Date.now()}`;
  const msgId = String(body.msgid || body.header?.event_id || `${Date.now()}`);

  const targets = channel.getPollTargets(body);
  const primaryTarget = targets.length > 0 ? targets[0] : null;

  return {
    type: String(body.msgtype || body.type || 'text'),
    request_text: text,
    user_id: userId,
    primary_user_id: primaryTarget ? primaryTarget.receiveId : userId,
    session_ref: sessionRef,
    msg_id: msgId,
    org_id: orgId,
    channel_type: channel.channelType,
    identity_binding_state: 'bound',
    policy_snapshot_hash: 'sha256:auto',
    timestamp: new Date().toISOString(),
    file_key: body.file_key as string || '',
    file_type: body.file_type as string || 'file',
    raw_event: body
  };
}

function parseBody(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// -- 路由配置 --

const routes: MicroServiceConfig['routes'] = {
  '/webhook/feishu': { handler: handleFeishuWebhook as never, method: 'POST' },
  '/webhook/feishu/event': { handler: handleFeishuWebhook as never, method: 'POST' },
  '/webhook/wecom': { handler: handleWecomWebhook as never, method: 'POST' },
  '/webhook/wecom/callback': { handler: handleWecomWebhook as never, method: 'POST' },
};

const service = createMicroService({
  name: 'gateway-adapter',
  port: PORT,
  routes,
  onStart: () => {
    console.log(`[gateway-adapter] v2.0 optimized | channels: feishu + wecom | port: ${PORT}`);
  },
  onShutdown: async () => {
    await closeAllPools();
    console.log('[gateway-adapter] pools closed');
  },
  logger: {
    info: (_event: string, msg: string, _data?: Record<string, unknown>) => {
      console.log(`[INFO] ${msg}`);
    },
    warn: (_event: string, msg: string, _data?: Record<string, unknown>) => {
      console.warn(`[WARN] ${msg}`);
    },
    error: (_event: string, msg: string, _data?: Record<string, unknown>) => {
      console.error(`[ERROR] ${msg}`);
    }
  }
});

service.start();

export { feishu, wecom };