/**
 * ChannelAdapter - 渠道抽象接口
 *
 * 原版问题：gateway-adapter 中飞书/企微 4对函数 80-95% 重复：
 *   - getToken: 飞书 50行 vs 企微 50行
 *   - sendMessage: 飞书 35行 vs 企微 35行
 *   - downloadFile: 飞书 30行 vs 企微 30行
 *   - pollWorkflow:  飞书 55行 vs 企微 55行（95%相同）
 *
 * 优化后：一个接口 + 两个适配器 + 一个通用轮询函数
 *
 * @module channel-adapter
 */

export interface SendMessageOptions {
  agentId?: string;
  msgType?: string;
}

export interface DownloadFileResult {
  buffer: Buffer;
  fileName: string;
}

export interface PollTarget {
  receiveIdType: string;
  receiveId: string;
}

/**
 * 渠道适配器接口。
 *
 * 每个渠道（飞书、企微、未来可能的钉钉/WhatsApp）实现此接口即可接入。
 * 新增渠道仅需 ~30行适配器代码，而非原版的 ~200行。
 */
export interface ChannelAdapter {
  /** 渠道标识 */
  readonly channelType: string;

  /** 获取访问令牌（自动缓存） */
  getAccessToken(): Promise<string | null>;

  /** 发送文本消息 */
  sendTextMessage(userId: string, text: string, opts?: SendMessageOptions): Promise<boolean>;

  /** 下载文件 */
  downloadFile(fileKey: string, fileType?: string): Promise<DownloadFileResult | null>;

  /** 验证 Webhook 签名 */
  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;

  /** 解密消息体（如企业微信加密模式） */
  decryptMessage?(rawBody: string): Record<string, unknown> | null;

  /** 获取轮询目标列表 */
  getPollTargets(eventBody: Record<string, unknown>): PollTarget[];
}