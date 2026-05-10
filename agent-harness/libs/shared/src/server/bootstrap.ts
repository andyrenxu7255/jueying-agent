import { createServer, IncomingMessage, ServerResponse } from 'node:http';

export interface RouteHandler {
  (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): Promise<void> | void;
}

export interface MicroServiceConfig {
  name: string;
  port: number;
  routes: Record<string, { method?: string; handler: RouteHandler }>;
  healthChecks?: Array<() => Promise<boolean>>;
  onStart?: () => Promise<void> | void;
  onShutdown?: () => Promise<void> | void;
  logger?: {
    info: (event: string, msg: string, data?: Record<string, unknown>) => void;
    warn: (event: string, msg: string, data?: Record<string, unknown>) => void;
    error: (event: string, msg: string, data?: Record<string, unknown>) => void;
  };
}

export interface MicroServiceInstance {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  logger: MicroServiceConfig['logger'];
}

async function readBody(req: IncomingMessage, maxSize: number = 10 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    totalSize += buf.length;
    if (totalSize > maxSize) break;
    chunks.push(buf);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(raw: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json)
  });
  res.end(json);
}

function extractPathname(url: string | undefined): string {
  if (!url) return '/';
  try { return new URL(url, 'http://localhost').pathname; } catch { return '/'; }
}

export function createMicroService(config: MicroServiceConfig): MicroServiceInstance {
  const logger = config.logger || {
    info: () => {},
    warn: () => {},
    error: () => {}
  };

  const server = createServer(async (req, res) => {
    try {
      const pathname = extractPathname(req.url);
      const method = req.method || 'GET';

      if (pathname === '/health' || pathname === '/health/live' || pathname === '/health/ready') {
        sendJson(res, 200, { ok: true, service: config.name, uptime: process.uptime() });
        return;
      }

      for (const [routePattern, routeConfig] of Object.entries(config.routes)) {
        const match = pathname.match(new RegExp(`^${routePattern}$`));
        if (!match) continue;
        if (routeConfig.method && routeConfig.method !== method) continue;

        const rawBody = await readBody(req);
        const jsonBody = parseJson(rawBody);

        const params: Record<string, string> = {};
        const paramNames = (routePattern.match(/:(\w+)/g) || []).map(p => p.slice(1));
        paramNames.forEach((name, i) => { params[name] = match[i + 1] || ''; });

        const handlerBody: Record<string, unknown> = {
          ...(jsonBody || {}),
          ...params,
          _raw: rawBody,
          _pathname: pathname,
          _method: method
        };

        await routeConfig.handler(req, res, handlerBody);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      logger.error('request.unhandled_error', 'Unhandled request error', {
        error: (error as Error).message
      });
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: 'internal_error' });
      }
    }
  });

  return {
    async start() {
      server.listen(config.port, () => {
        logger.info('service.started', `${config.name} started`, { port: config.port });
        if (config.onStart) {
          Promise.resolve(config.onStart()).catch(e =>
            logger.error('service.start_error', 'Start hook failed', { error: String(e) })
          );
        }
      });

      process.on('SIGTERM', () => {
        logger.info('service.shutdown', `${config.name} shutting down`, { signal: 'SIGTERM' });
        if (config.onShutdown) Promise.resolve(config.onShutdown()).catch(() => {});
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10000);
      });
    },

    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },

    logger
  };
}