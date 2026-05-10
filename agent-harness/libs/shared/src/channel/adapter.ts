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

export interface ChannelAdapter {
  readonly channelType: string;

  getAccessToken(): Promise<string | null>;

  sendTextMessage(userId: string, text: string, opts?: SendMessageOptions): Promise<boolean>;

  downloadFile(fileKey: string, fileType?: string): Promise<DownloadFileResult | null>;

  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;

  decryptMessage?(rawBody: string): Record<string, unknown> | null;

  getPollTargets(eventBody: Record<string, unknown>): PollTarget[];
}