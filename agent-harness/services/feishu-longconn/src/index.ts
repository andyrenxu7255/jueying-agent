import * as http from 'node:http';
import * as Lark from '@larksuiteoapi/node-sdk';
import { createLogger, sendJson } from '@agent-harness/shared';

const logger = createLogger('feishu-longconn');

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const feishuDomain = process.env.FEISHU_DOMAIN || 'feishu';
const gatewayUrl = process.env.GATEWAY_URL || '';

const FEISHU_DOMAIN_MAP: Record<string, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com'
};

function resolveWsDomain(domain: string): string {
  return FEISHU_DOMAIN_MAP[domain] || domain;
}

async function forwardToGateway(eventBody: Record<string, unknown>): Promise<boolean> {
  const targetUrl = `${gatewayUrl}/channels/feishu/longconn/event`;
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(eventBody)
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn('gateway.forward.failed', 'Failed to forward event to gateway', {
        status: response.status,
        url: targetUrl,
        body: text
      });
      return false;
    }

    const body = await response.json() as { data?: { delivered?: boolean; delivered_via?: string; session_ref?: string } };
    logger.info('gateway.forward.success', 'Event forwarded to gateway', {
      url: targetUrl,
      delivered: body?.data?.delivered ?? false,
      deliveredVia: body?.data?.delivered_via ?? null,
      sessionRef: body?.data?.session_ref ?? null
    });
    return true;
  } catch (error) {
    logger.error('gateway.forward.error', 'Unexpected error forwarding to gateway', {
      url: targetUrl,
      error: String(error)
    });
    return false;
  }
}

if (!appId || !appSecret) {
  logger.error('config.missing', 'Missing FEISHU_APP_ID or FEISHU_APP_SECRET, service will idle until configured');

  const healthServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/health/live' || url.pathname === '/health/ready') {
      sendJson(res, 200, { ok: true, service: 'feishu-longconn', status: 'idle', reason: 'missing_credentials' });
    } else {
      sendJson(res, 404, { ok: false, error: 'not_found' });
    }
  });

  const healthPort = Number(process.env.PORT || process.env.SERVER_PORT || 3006);
  healthServer.listen(healthPort, () => {
    logger.info('service.idle', 'Feishu long connection service idling (missing credentials)', { port: healthPort });
  });

  process.on('SIGTERM', () => { healthServer.close(() => process.exit(0)); });
  process.on('SIGINT', () => { healthServer.close(() => process.exit(0)); });

  setInterval(() => {}, 24 * 60 * 60 * 1000);
} else {
  const wsDomain = resolveWsDomain(feishuDomain);
  logger.info('config.loaded', 'Feishu long connection service starting', {
    appId,
    domain: feishuDomain,
    wsDomain,
    gatewayUrl
  });

  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    domain: wsDomain,
    loggerLevel: Lark.LoggerLevel.info
  });

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const rawData = data as Record<string, unknown>;
        const message = (rawData?.message as Record<string, unknown>) || {};
        const sender = (rawData?.sender as Record<string, unknown>) || {};
        const senderId = (sender?.sender_id as Record<string, unknown>) || {};

        const header = {
          event_id: rawData?.event_id,
          tenant_key: rawData?.tenant_key,
          app_id: rawData?.app_id,
          event_type: rawData?.event_type,
          create_time: rawData?.create_time
        };

        const contentRaw = message?.content;

        let text = '';
        if (typeof contentRaw === 'string') {
          try {
            const parsed = JSON.parse(contentRaw);
            text = parsed?.text || '';
          } catch {
            text = contentRaw;
          }
        }

        logger.info('feishu.message.received', 'Received message from Feishu', {
          chatId: message?.chat_id,
          messageType: message?.message_type,
          text,
          openId: senderId?.open_id,
          unionId: senderId?.union_id
        });

        const eventBody = {
          header,
          event: {
            sender,
            message
          }
        };

        await forwardToGateway(eventBody);
      }
    })
  });

  logger.info('service.started', 'Feishu long connection service started');
}
