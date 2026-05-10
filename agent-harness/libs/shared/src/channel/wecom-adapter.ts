import { createHash, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { TTLMap } from '../utils/ttl-map';
import type { ChannelAdapter, SendMessageOptions, DownloadFileResult, PollTarget } from './adapter';

export class WecomAdapter implements ChannelAdapter {
  readonly channelType = 'wecom';

  private tokenCache = new TTLMap<string, string>(7000 * 1000);
  private dedupeCache = new TTLMap<string, boolean>(300000);
  private corpId: string;
  private corpSecret: string;
  private token: string;
  private agentId: string;
  private encodingAesKey: string;

  constructor(config?: {
    corpId?: string;
    corpSecret?: string;
    token?: string;
    agentId?: string;
    encodingAesKey?: string;
  }) {
    this.corpId = config?.corpId || process.env.WECOM_CORP_ID || '';
    this.corpSecret = config?.corpSecret || process.env.WECOM_CORP_SECRET || '';
    this.token = config?.token || process.env.WECOM_TOKEN || '';
    this.agentId = config?.agentId || process.env.WECOM_AGENT_ID || '';
    this.encodingAesKey = config?.encodingAesKey || process.env.WECOM_ENCODING_AES_KEY || '';
  }

  async getAccessToken(): Promise<string | null> {
    const cached = this.tokenCache.get('access_token');
    if (cached) return cached;

    if (!this.corpId || !this.corpSecret) return null;

    try {
      const response = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.corpSecret)}`,
        { signal: AbortSignal.timeout(10000) }
      );

      const body = await response.json() as {
        errcode?: number;
        access_token?: string;
        expires_in?: number;
      };

      if (!response.ok || body.errcode !== 0 || !body.access_token) {
        return null;
      }

      const ttl = (body.expires_in || 7200) * 1000;
      this.tokenCache.set('access_token', body.access_token, ttl);
      return body.access_token;
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

    const msgAgentId = opts?.agentId || this.agentId;
    if (!msgAgentId) return false;

    try {
      const response = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            touser: userId,
            msgtype: 'text',
            agentid: Number(msgAgentId),
            text: { content: text }
          }),
          signal: AbortSignal.timeout(10000)
        }
      );

      const body = await response.json() as { errcode?: number };
      return response.ok && body.errcode === 0;
    } catch {
      return false;
    }
  }

  async downloadFile(mediaId: string): Promise<DownloadFileResult | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const response = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`,
        { signal: AbortSignal.timeout(60000) }
      );

      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return null;

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        fileName: mediaId
      };
    } catch {
      return null;
    }
  }

  verifySignature(
    _rawBody: string,
    _headers: Record<string, string | string[] | undefined>,
    searchParams?: URLSearchParams
  ): boolean {
    if (!this.token) return false;

    const signature = searchParams?.get('msg_signature') || '';
    const timestamp = searchParams?.get('timestamp') || '';
    const nonce = searchParams?.get('nonce') || '';

    if (!signature || !timestamp || !nonce) return false;

    const source = [this.token, timestamp, nonce].sort().join('');
    const expected = createHash('sha1').update(source).digest('hex');

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  decryptMessage(rawBody: string): Record<string, unknown> | null {
    if (!this.encodingAesKey) return null;

    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      if (!body.encrypt) return null;

      const aesKey = Buffer.from(this.encodingAesKey + '=', 'base64');
      const iv = aesKey.slice(0, 16);
      const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
      decipher.setAutoPadding(false);

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(String(body.encrypt), 'base64')),
        decipher.final()
      ]);

      const msgBody = decrypted.slice(16);
      const msgLen = msgBody.readUInt32BE(0);
      const xmlStr = msgBody.slice(4, 4 + msgLen).toString('utf8');

      const fields: Record<string, string> = {};
      const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(xmlStr)) !== null) {
        fields[match[1]] = match[2];
      }

      return {
        msgtype: fields.MsgType || 'text',
        from_user_id: fields.FromUserName || '',
        to_user_id: fields.ToUserName || '',
        msgid: fields.MsgId || '',
        content: fields.Content || '',
        text: { content: fields.Content || '' },
      };
    } catch {
      return null;
    }
  }

  getPollTargets(eventBody: Record<string, unknown>): PollTarget[] {
    const userId = typeof eventBody.from_user_id === 'string' ? eventBody.from_user_id : '';
    return userId ? [{ receiveIdType: 'user_id', receiveId: userId }] : [];
  }

  isDuplicate(eventId: string): boolean {
    if (this.dedupeCache.has(`wecom:${eventId}`)) return true;
    this.dedupeCache.set(`wecom:${eventId}`, true);
    return false;
  }
}