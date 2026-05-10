/**
 * FeishuAdapter - 飞书渠道适配器
 *
 * 从原版 gateway-adapter 中提取 getFeishuTenantAccessToken / sendFeishuTextReply /
 * downloadFeishuFile / verifyFeishuSignature 核心逻辑。
 *
 * @module feishu-adapter
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { TTLMap } from '../utils/ttl-map';
import type { ChannelAdapter, SendMessageOptions, DownloadFileResult, PollTarget } from './adapter';

const TOKEN_CACHE_TTL = 7000 * 1000; // 7000秒 (飞书token有效期7200秒,留200秒缓冲)
const dedupeCache = new TTLMap<string, boolean>(300000); // 5分钟去重

export class FeishuAdapter implements ChannelAdapter {
  readonly channelType = 'feishu';

  private tokenCache = new TTLMap<string, string>(TOKEN_CACHE_TTL);
  private appId: string;
  private appSecret: string;
  private signingSecret: string;
  private apiBase: string;

  constructor(config?: { appId?: string; appSecret?: string; signingSecret?: string; apiBase?: string }) {
    this.appId = config?.appId || process.env.FEISHU_APP_ID || '';
    this.appSecret = config?.appSecret || process.env.FEISHU_APP_SECRET || '';
    this.signingSecret = config?.signingSecret || process.env.FEISHU_SIGNING_SECRET || '';

    const domain = (process.env.FEISHU_DOMAIN || 'feishu').trim().toLowerCase();
    this.apiBase = config?.apiBase || (domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn');
  }

  async getAccessToken(): Promise<string | null> {
    const cached = this.tokenCache.get('tenant_token');
    if (cached) return cached;

    if (!this.appId || !this.appSecret) return null;

    try {
      const response = await fetch(`${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
        signal: AbortSignal.timeout(10000)
      });

      const body = await response.json() as {
        code?: number;
        tenant_access_token?: string;
        expire?: number;
      };

      if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
        return null;
      }

      const ttl = (body.expire || 7200) * 1000;
      this.tokenCache.set('tenant_token', body.tenant_access_token, ttl);
      return body.tenant_access_token;
    } catch {
      return null;
    }
  }

  async sendTextMessage(
    userId: string,
    text: string,
    opts?: SendMessageOptions
  ): Promise<boolean> {
    const token = await this.getAccessToken();
    if (!token) return false;

    const receiveIdType = opts?.msgType || 'open_id';

    try {
      const response = await fetch(
        `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            receive_id: userId,
            msg_type: 'text',
            content: JSON.stringify({ text })
          }),
          signal: AbortSignal.timeout(10000)
        }
      );

      const body = await response.json() as { code?: number };
      return response.ok && body.code === 0;
    } catch {
      return false;
    }
  }

  async downloadFile(fileKey: string, fileType: string = 'file'): Promise<DownloadFileResult | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const endpoint = fileType === 'image'
        ? `${this.apiBase}/open-apis/im/v1/images/${fileKey}`
        : `${this.apiBase}/open-apis/im/v1/files/${fileKey}`;

      const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) return null;

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        fileName: fileKey
      };
    } catch {
      return null;
    }
  }

  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
    if (!this.signingSecret) return false;

    const timestamp = headers['x-lark-request-timestamp'];
    const rawSignature = headers['x-lark-signature'];
    const nonce = headers['x-lark-request-nonce'];

    if (typeof timestamp !== 'string' || typeof rawSignature !== 'string') {
      return false;
    }

    const signature = rawSignature.startsWith('sha256=')
      ? rawSignature.slice('sha256='.length)
      : rawSignature;

    if (!signature || signature.length !== 64) return false;

    const payload = typeof nonce === 'string'
      ? `${timestamp}:${nonce}:${rawBody}`
      : `${timestamp}\n${rawBody}`;

    const digest = createHmac('sha256', this.signingSecret)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
    } catch {
      return false;
    }
  }

  getPollTargets(eventBody: Record<string, unknown>): PollTarget[] {
    const message = (eventBody.event as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined || {};
    const sender = (eventBody.event as Record<string, unknown> | undefined)?.sender as Record<string, unknown> | undefined || {};
    const senderId = sender?.sender_id as Record<string, unknown> | undefined || {};

    const targets: PollTarget[] = [];

    if (typeof message?.chat_id === 'string' && message.chat_id) {
      targets.push({ receiveIdType: 'chat_id', receiveId: message.chat_id });
    }
    if (typeof senderId?.user_id === 'string' && senderId.user_id) {
      targets.push({ receiveIdType: 'user_id', receiveId: senderId.user_id });
    }
    if (typeof senderId?.open_id === 'string' && senderId.open_id) {
      targets.push({ receiveIdType: 'open_id', receiveId: senderId.open_id });
    }
    if (typeof senderId?.union_id === 'string' && senderId.union_id) {
      targets.push({ receiveIdType: 'union_id', receiveId: senderId.union_id });
    }

    return targets;
  }

  /** 去重检测 */
  isDuplicate(eventId: string): boolean {
    if (dedupeCache.has(`feishu:${eventId}`)) return true;
    dedupeCache.set(`feishu:${eventId}`, true);
    return false;
  }
}