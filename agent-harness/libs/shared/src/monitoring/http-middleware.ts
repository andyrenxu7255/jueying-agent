import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../logging/logger';
import { metricsRegistry } from '../metrics/metrics';

const logger = createLogger('http');

export interface HttpLogOptions {
  logRequestBody?: boolean;
  logResponseBody?: boolean;
  maxBodyLogChars?: number;
  excludePaths?: string[];
}

const defaultOptions: HttpLogOptions = {
  logRequestBody: false,
  logResponseBody: false,
  maxBodyLogChars: 1000,
  excludePaths: ['/health', '/metrics', '/favicon.ico']
};

function truncateBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  return body.slice(0, maxChars) + `...[truncated ${body.length - maxChars} chars]`;
}

interface RequestTracking {
  traceId: string;
  startTime: number;
  method: string;
  url: string;
  clientIp: string;
  requestBody?: string;
}

const activeRequests = new Map<IncomingMessage, RequestTracking>();

function getClientIp(req: IncomingMessage): string {
  const forwarded = (req.headers['x-forwarded-for'] as string) || '';
  return forwarded.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

export function httpRequestLogger(
  req: IncomingMessage,
  options?: HttpLogOptions
): string {
  const opts = { ...defaultOptions, ...options };
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
  const method = req.method || 'UNKNOWN';
  const url = req.url || '/';
  const clientIp = getClientIp(req);

  metricsRegistry.increment('http.requests.total', 1, { method, path: url.split('?')[0] });

  const tracking: RequestTracking = { traceId, startTime: performance.now(), method, url, clientIp };
  activeRequests.set(req, tracking);

  if (!opts.excludePaths?.some(p => url.startsWith(p))) {
    logger.info('http.request.start', `${method} ${url}`, {
      method,
      path: url.split('?')[0],
      query: url.includes('?') ? url.split('?')[1]?.slice(0, 200) : undefined,
      client_ip: clientIp,
      user_agent: (req.headers['user-agent'] as string)?.slice(0, 200),
      content_length: req.headers['content-length'],
      trace_id: traceId
    });
  }

  return traceId;
}

export async function httpResponseLogger(
  req: IncomingMessage,
  res: ServerResponse,
  responseBody?: string,
  options?: HttpLogOptions
): Promise<void> {
  const opts = { ...defaultOptions, ...options };
  const tracking = activeRequests.get(req);
  if (!tracking) return;

  activeRequests.delete(req);
  const durationMs = Math.round(performance.now() - tracking.startTime);
  const statusCode = res.statusCode || 0;
  const path = tracking.url.split('?')[0];

  metricsRegistry.observe('http.requests.duration_ms', durationMs, {
    method: tracking.method,
    path,
    status: String(statusCode)
  });

  if (statusCode >= 400) {
    metricsRegistry.increment('http.requests.errors', 1, {
      method: tracking.method,
      path,
      status: String(statusCode)
    });
  }

  if (statusCode >= 500) {
    metricsRegistry.increment('http.requests.server_errors', 1);
  }

  if (opts.excludePaths?.some(p => path.startsWith(p))) return;

  const detail: Record<string, unknown> = {
    method: tracking.method,
    path,
    status: statusCode,
    duration_ms: durationMs,
    client_ip: tracking.clientIp,
    trace_id: tracking.traceId,
    content_length: res.getHeader('content-length') || (responseBody ? Buffer.byteLength(responseBody) : undefined)
  };

  if (opts.logResponseBody && responseBody) {
    detail.response_body = truncateBody(responseBody, opts.maxBodyLogChars || 1000);
  }

  if (statusCode >= 500) {
    logger.error('http.request.error', `${tracking.method} ${path} → ${statusCode} (${durationMs}ms)`, detail);
  } else if (statusCode >= 400) {
    logger.warn('http.request.client_error', `${tracking.method} ${path} → ${statusCode} (${durationMs}ms)`, detail);
  } else {
    logger.info('http.request.complete', `${tracking.method} ${path} → ${statusCode} (${durationMs}ms)`, detail);
  }
}

export function httpErrorLogger(
  req: IncomingMessage,
  error: Error
): void {
  const tracking = activeRequests.get(req);
  const durationMs = tracking ? Math.round(performance.now() - tracking.startTime) : undefined;
  const method = tracking?.method || req.method || 'UNKNOWN';
  const url = tracking?.url || req.url || '/';
  const clientIp = tracking?.clientIp || getClientIp(req);

  metricsRegistry.increment('http.requests.errors', 1, { method, path: url.split('?')[0], status: 'exception' });

  logger.error('http.request.exception', `${method} ${url} crashed: ${error.message}`, {
    method,
    path: url.split('?')[0],
    client_ip: clientIp,
    error: error.message,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    duration_ms: durationMs,
    trace_id: tracking?.traceId
  });

  activeRequests.delete(req);
}
