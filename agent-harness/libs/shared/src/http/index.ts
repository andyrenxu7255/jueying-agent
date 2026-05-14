/**
 * HTTP 工具集
 *
 * 提供轻量 HTTP 请求/响应辅助函数，用于微服务间通信。
 * - readJson: 从 IncomingMessage 解析 JSON 请求体
 * - sendJson: 发送 JSON 响应
 * - postJson: POST 请求带超时控制
 * - extractPathname: 安全提取 URL 路径
 * - verifyInternalAuth: 验证内部服务间请求
 * - getInternalAuthHeaders: 获取内部服务请求头
 *
 * @module http-utils
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export async function readJson(req: import('node:http').IncomingMessage, maxBodySize: number = 10 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += chunk.length;
    if (totalSize > maxBodySize) {
      throw new Error('request_body_too_large');
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export function sendJson(res: import('node:http').ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  if (res.headersSent) return;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function sendError(
  res: import('node:http').ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  detail?: Record<string, unknown>
): void {
  sendJson(res, statusCode, {
    ok: false,
    error: { code, message, ...(detail ? { detail } : {}) }
  });
}

export async function postJson(url: string, payload: Record<string, unknown>, timeoutMs: number = 60000, extraHeaders?: Record<string, string>, retries: number = 0): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(extraHeaders || {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, status: 0, body: null };
    }
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return postJson(url, payload, timeoutMs, extraHeaders, retries - 1);
    }
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function extractPathname(urlLike: string | undefined): string {
  return new URL(urlLike || '/', 'http://localhost').pathname;
}

const INTERNAL_AUTH_HEADER = 'x-internal-auth';

export function getInternalAuthSecret(): string {
  return process.env.INTERNAL_AUTH_SECRET || '';
}

export function getInternalAuthHeaders(): Record<string, string> {
  const secret = getInternalAuthSecret();
  if (!secret) return {};
  const timestamp = String(Date.now());
  const nonce = randomBytes(12).toString('hex');
  const payload = `${timestamp}:${nonce}`;
  const signature = createHash('sha256').update(`${payload}:${secret}`).digest('hex');
  return {
    [INTERNAL_AUTH_HEADER]: `${timestamp}:${nonce}:${signature}`
  };
}

export function verifyInternalAuth(req: import('node:http').IncomingMessage): boolean {
  const secret = getInternalAuthSecret();
  if (!secret) {
    console.error('[SECURITY] INTERNAL_AUTH_SECRET not set - rejecting all internal requests');
    return false;
  }

  const authHeader = req.headers[INTERNAL_AUTH_HEADER];
  if (typeof authHeader !== 'string') {
    return false;
  }

  const parts = authHeader.split(':');
  if (parts.length !== 3) return false;

  const [timestamp, nonce, receivedSignature] = parts;
  const maxAge = 5 * 60 * 1000;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > maxAge) {
    return false;
  }

  const expectedSignature = createHash('sha256').update(`${timestamp}:${nonce}:${secret}`).digest('hex');
  const sigBuf = Buffer.from(receivedSignature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual
    ? timingSafeEqual(sigBuf, expBuf)
    : sigBuf.toString('hex') === expBuf.toString('hex');
}
