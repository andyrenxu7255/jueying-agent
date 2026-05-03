import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createLogger, metricsRegistry, httpRequestLogger, httpResponseLogger, analyze, writeAggregationReport } from '@agent-harness/shared';

/**
 * mobile-app 服务 - 移动端通知桥接服务
 *
 * 功能概述：
 *   1. 为移动端 App 提供统一的推送通知接口（对应 AH-7 移动端接入 故事线）
 *   2. 管理工作流完成、审批请求、告警等事件的推送通知
 *   3. 维护移动设备注册信息（device token 映射到用户）
 *   4. 支持多种推送通道（FCM / APNs / 企业微信通知）
 *   5. 提供通知历史查询和已读状态管理
 *
 * 核心场景：
 *   - 工作流完成后向相关人员发送推送通知（AH-5 自动总结报告）
 *   - 审批请求到达时通知审批人（AH-8 多人协作）
 *   - 系统异常告警推送（AH-6 自动排查告警）
 *   - 每日/每周报告推送（AH-5 每周简报推送到移动端）
 *
 * API 路由：
 *   POST   /internal/devices/register     - 注册移动设备
 *   DELETE /internal/devices/:device_token - 注销设备
 *   POST   /internal/notifications/send    - 发送通知
 *   GET    /internal/notifications/history - 获取通知历史
 *   PUT    /internal/notifications/:id/read- 标记通知已读
 *   GET    /internal/badges/:user_id       - 获取未读通知数
 */

const logger = createLogger('mobile-app', {
  logFile: process.env.LOG_FILE || 'logs/mobile-app.log'
});

const port = Number(process.env.PORT || 3009);

/* ---- 类型定义 ---- */

/** 移动设备注册信息 */
interface DeviceRegistration {
  /** Firebase Cloud Messaging token 或 APNs device token */
  device_token: string;
  /** 所属用户的 UUID 格式标识 */
  user_id: string;
  /** 平台类型 */
  platform: 'ios' | 'android' | 'web';
  /** 设备型号/名称 */
  device_name: string;
  /** App 版本号 */
  app_version: string;
  /** 推送通知是否开启 */
  notifications_enabled: boolean;
  /** 注册时间 */
  registered_at: string;
  /** 最后活跃时间 */
  last_active_at: string;
}

/** 推送通知记录 */
interface PushNotification {
  id: string;
  /** 目标用户 UUID */
  user_id: string;
  /** 通知标题 */
  title: string;
  /** 通知正文 */
  body: string;
  /** 通知类别 */
  category: 'workflow_complete' | 'approval_required' | 'alert' | 'report' | 'system' | 'general';
  /** 深层链接（如 workflow 详情页路径） */
  deep_link?: string;
  /** 关联的工作流实例引用 */
  workflow_ref?: string;
  /** 目标设备 token（为空时发给该用户全部设备） */
  device_token?: string;
  /** 读取状态 */
  read: boolean;
  /** 创建时间 */
  created_at: string;
  /** 读取时间 */
  read_at?: string;
  /** 发送状态 */
  send_status: 'pending' | 'sent' | 'failed';
  /** 发送失败原因 */
  send_error?: string;
}

/* ---- 存储层 ---- */

const deviceStore = new Map<string, DeviceRegistration[]>();
const notificationStore = new Map<string, PushNotification[]>();
const MAX_NOTIFICATIONS_PER_USER = 200;

let dbPool: InstanceType<typeof import('pg').Pool> | null = null;

async function getDbPool() {
  if (dbPool) return dbPool;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  try {
    const { Pool } = await import('pg');
    dbPool = new Pool({ connectionString: dbUrl, max: 4 });
    await dbPool.query('SELECT 1');
    logger.info('db.connected', 'Mobile-app connected to database');
    return dbPool;
  } catch (error) {
    logger.warn('db.connect_failed', 'Failed to connect to database', { error: String(error) });
    dbPool = null;
    return null;
  }
}

async function ensureTables(pool: InstanceType<typeof import('pg').Pool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mobile_device (
      device_token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
      device_name TEXT,
      app_version TEXT,
      notifications_enabled BOOLEAN NOT NULL DEFAULT true,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_device_user ON mobile_device (user_id);

    CREATE TABLE IF NOT EXISTS mobile_notification (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      deep_link TEXT,
      workflow_ref TEXT,
      device_token TEXT,
      read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at TIMESTAMPTZ,
      send_status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_notification_user ON mobile_notification (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mobile_notification_unread ON mobile_notification (user_id, read) WHERE read = false;
  `);
}

/* ---- HTTP 工具 ---- */

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function generateId(): string {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

/* ---- 核心业务逻辑 ---- */

/**
 * 注册移动设备
 *
 * 存储策略：
 *   同一用户可以有多个设备（手机 + 平板等）
 *   同一 device_token 重复注册时更新设备信息而非重复插入
 *
 * @param device - 设备注册信息
 * @returns 注册成功的设备信息
 */
function registerDevice(device: Omit<DeviceRegistration, 'registered_at' | 'last_active_at'>): DeviceRegistration {
  const now = new Date().toISOString();
  const existing = deviceStore.get(device.user_id) || [];

  // 清除该 device_token 在其他用户名下的旧注册（防止 token 转移）
  for (const [uid, devices] of deviceStore) {
    if (uid !== device.user_id) {
      const filtered = devices.filter(d => d.device_token !== device.device_token);
      if (filtered.length !== devices.length) {
        deviceStore.set(uid, filtered);
      }
    }
  }

  const existingIdx = existing.findIndex(d => d.device_token === device.device_token);
  const registered: DeviceRegistration = {
    ...device,
    registered_at: existingIdx >= 0 ? existing[existingIdx].registered_at : now,
    last_active_at: now
  };

  if (existingIdx >= 0) {
    existing[existingIdx] = registered;
  } else {
    existing.push(registered);
  }

  deviceStore.set(device.user_id, existing);

  const pool = dbPool;
  if (pool) {
    pool.query(
      `INSERT INTO mobile_device (device_token, user_id, platform, device_name, app_version, notifications_enabled, registered_at, last_active_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (device_token) DO UPDATE SET
         user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
         device_name = EXCLUDED.device_name, app_version = EXCLUDED.app_version,
         notifications_enabled = EXCLUDED.notifications_enabled, last_active_at = EXCLUDED.last_active_at`,
      [registered.device_token, registered.user_id, registered.platform, registered.device_name, registered.app_version, registered.notifications_enabled, registered.registered_at, registered.last_active_at]
    ).catch(err => logger.warn('device.persist_failed', 'DB persist failed', { error: String(err) }));
  }

  logger.info('device.registered', 'Mobile device registered', {
    user_id: device.user_id,
    platform: device.platform
  });

  return registered;
}

/**
 * 注销移动设备
 *
 * @param deviceToken - 设备的唯一推送 Token
 * @returns 是否成功找到并注销
 */
function unregisterDevice(deviceToken: string): boolean {
  for (const [userId, devices] of deviceStore) {
    const idx = devices.findIndex(d => d.device_token === deviceToken);
    if (idx >= 0) {
      devices.splice(idx, 1);
      deviceStore.set(userId, devices);
      const pool = dbPool;
      if (pool) {
        pool.query('DELETE FROM mobile_device WHERE device_token = $1', [deviceToken]).catch(() => {});
      }
      logger.info('device.unregistered', 'Mobile device unregistered', { device_token: deviceToken.slice(0, 10) + '...' });
      return true;
    }
  }
  return false;
}

/**
 * 发送推送通知
 *
 * 发送策略：
 *   1. 将通知记录写入内存和 DB（持久化）
 *   2. 查找目标用户的所有已注册设备
 *   3. 异步尝试通过外部推送服务发送（FCM/APNs/Web Push）
 *   4. 推送失败时标记 send_status = 'failed'，不影响通知记录的存在
 *
 * @param notification - 通知内容（不含 id 和自动字段）
 * @returns 创建的通知记录
 */
async function sendNotification(notification: Omit<PushNotification, 'id' | 'read' | 'created_at' | 'read_at' | 'send_status' | 'send_error'>): Promise<PushNotification> {
  const id = generateId();
  const now = new Date().toISOString();

  const record: PushNotification = {
    ...notification,
    id,
    read: false,
    created_at: now,
    send_status: 'pending'
  };

  let userNotifications = notificationStore.get(notification.user_id) || [];
  userNotifications.push(record);

  if (userNotifications.length > MAX_NOTIFICATIONS_PER_USER) {
    userNotifications = userNotifications.slice(-MAX_NOTIFICATIONS_PER_USER);
  }
  notificationStore.set(notification.user_id, userNotifications);

  const pool = dbPool;
  if (pool) {
    pool.query(
      `INSERT INTO mobile_notification (id, user_id, title, body, category, deep_link, workflow_ref, device_token, read, created_at, send_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, notification.user_id, notification.title, notification.body, notification.category, notification.deep_link || null, notification.workflow_ref || null, notification.device_token || null, false, now, 'pending']
    ).catch(err => logger.warn('notification.persist_failed', 'DB persist failed', { error: String(err) }));
  }

  void attemptPushDelivery(record);

  logger.info('notification.sent', 'Push notification created', {
    notification_id: id,
    user_id: notification.user_id,
    category: notification.category
  });

  return record;
}

/**
 * 尝试通过外部推送通道递送通知
 *
 * 递送流程（异步 fire-and-forget）：
 *   1. 获取目标用户的已注册设备列表
 *   2. 筛选通知开启的设备
 *   3. 对外部推送服务发起 HTTP 请求
 *   4. 更新 send_status
 *
 * 当前为占位实现，实际环境中通过 FCM/APNs SDK 或 Web Push API 发送
 */
async function attemptPushDelivery(notification: PushNotification): Promise<void> {
  const pushServiceUrl = process.env.PUSH_SERVICE_URL || '';

  try {
    const devices = deviceStore.get(notification.user_id) || [];
    const targetDevices = notification.device_token
      ? devices.filter(d => d.device_token === notification.device_token)
      : devices.filter(d => d.notifications_enabled);

    if (targetDevices.length === 0) {
      notification.send_status = 'failed';
      notification.send_error = 'no_available_target_devices';
      return;
    }

    if (pushServiceUrl) {
      const payload = {
        tokens: targetDevices.map(d => d.device_token),
        notification: {
          title: notification.title,
          body: notification.body,
          data: {
            category: notification.category,
            deep_link: notification.deep_link,
            workflow_ref: notification.workflow_ref,
            notification_id: notification.id
          }
        }
      };

      const response = await fetch(`${pushServiceUrl}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        notification.send_status = 'sent';
      } else {
        notification.send_status = 'failed';
        notification.send_error = `push_service_http_${response.status}`;
      }
    } else {
      // 无推送服务 URL 时标记为 sent（仅记录，不做实际推送）
      notification.send_status = 'sent';
    }
  } catch (error) {
    notification.send_status = 'failed';
    notification.send_error = String(error);
    logger.warn('notification.push_failed', 'Push delivery failed', {
      notification_id: notification.id,
      error: String(error)
    });
  }
}

/**
 * 获取用户的通知历史
 *
 * @param userId - 用户 UUID
 * @param limit - 返回数量上限（默认 20，最大 100）
 * @param offset - 分页偏移
 * @param unreadOnly - 是否仅返回未读通知
 * @returns 通知列表及未读总数
 */
function getNotificationHistory(userId: string, limit = 20, offset = 0, unreadOnly = false): {
  notifications: PushNotification[];
  total: number;
  unread_count: number;
} {
  let notifications = notificationStore.get(userId) || [];
  const total = notifications.length;
  const unreadCount = notifications.filter(n => !n.read).length;

  if (unreadOnly) {
    notifications = notifications.filter(n => !n.read);
  }

  notifications = notifications
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(offset, offset + Math.min(limit, 100));

  return { notifications, total, unread_count: unreadCount };
}

/**
 * 标记通知为已读
 *
 * 更新策略：
 *   同时更新内存存储和 DB 中的 read 字段
 *
 * @param notificationId - 通知 UUID
 * @returns 更新后的通知记录，不存在时返回 null
 */
function markAsRead(notificationId: string): PushNotification | null {
  for (const [, notifications] of notificationStore) {
    const found = notifications.find(n => n.id === notificationId);
    if (found && !found.read) {
      found.read = true;
      found.read_at = new Date().toISOString();

      const pool = dbPool;
      if (pool) {
        pool.query(
          'UPDATE mobile_notification SET read = true, read_at = $1 WHERE id = $2',
          [found.read_at, notificationId]
        ).catch(() => {});
      }

      return found;
    }
    if (found) return found;
  }
  return null;
}

/**
 * 获取用户未读通知徽标数
 *
 * @param userId - 用户 UUID
 * @returns 未读通知数量，用于 App 角标展示
 */
function getUnreadBadgeCount(userId: string): number {
  const notifications = notificationStore.get(userId) || [];
  return notifications.filter(n => !n.read).length;
}

/* ---- HTTP 路由 ---- */

const server = createServer(async (req, res) => {
  httpRequestLogger(req);
  let responseBody = '';
  const captureWrite = res.write.bind(res);
  const captureEnd = res.end.bind(res);
  const chunks: Buffer[] = [];

  res.write = function (chunk: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    return (captureWrite as typeof res.write)(chunk as Parameters<typeof res.write>[0], encoding as Parameters<typeof res.write>[1], cb as Parameters<typeof res.write>[2]);
  } as typeof res.write;

  res.end = function (chunk?: unknown, encoding?: unknown, cb?: unknown) {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
    responseBody = Buffer.concat(chunks).toString('utf-8').slice(0, 2000);
    return (captureEnd as typeof res.end)(chunk as Parameters<typeof res.end>[0], encoding as Parameters<typeof res.end>[1], cb as Parameters<typeof res.end>[2]);
  } as typeof res.end;

  try {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/health/live' || pathname === '/health/ready') {
      sendJson(res, 200, { ok: true, service: 'mobile-app', devices_tracked: deviceStore.size, notifications_stored: notificationStore.size });
      return;
    }

    if (pathname === '/internal/devices/register' && req.method === 'POST') {
      const body = await readJson(req);
      const deviceToken = String(body.device_token || '');
      const userId = String(body.user_id || '');

      if (!deviceToken || !userId) {
        sendJson(res, 400, { ok: false, error: 'missing_required_fields', required: ['device_token', 'user_id'] });
        return;
      }

      const device = registerDevice({
        device_token: deviceToken,
        user_id: userId,
        platform: String(body.platform || 'web') as DeviceRegistration['platform'],
        device_name: String(body.device_name || 'unknown'),
        app_version: String(body.app_version || '1.0.0'),
        notifications_enabled: body.notifications_enabled !== false
      });

      sendJson(res, 201, { ok: true, device });
      return;
    }

    if (pathname.startsWith('/internal/devices/') && req.method === 'DELETE') {
      const deviceToken = pathname.split('/internal/devices/')[1];
      if (!deviceToken) { sendJson(res, 400, { ok: false, error: 'missing_device_token' }); return; }

      const removed = unregisterDevice(deviceToken);
      sendJson(res, removed ? 200 : 404, { ok: removed, removed });
      return;
    }

    if (pathname === '/internal/notifications/send' && req.method === 'POST') {
      const body = await readJson(req);
      const userId = String(body.user_id || '');
      const title = String(body.title || '');
      const bodyText = String(body.body || '');

      if (!userId || !title || !bodyText) {
        sendJson(res, 400, { ok: false, error: 'missing_required_fields', required: ['user_id', 'title', 'body'] });
        return;
      }

      const notification = await sendNotification({
        user_id: userId,
        title,
        body: bodyText,
        category: String(body.category || 'general') as PushNotification['category'],
        deep_link: body.deep_link as string | undefined,
        workflow_ref: body.workflow_ref as string | undefined,
        device_token: body.device_token as string | undefined
      });

      sendJson(res, 201, { ok: true, notification });
      return;
    }

    if (pathname === '/internal/notifications/history' && req.method === 'GET') {
      const userId = parsedUrl.searchParams.get('user_id') || '';
      if (!userId) { sendJson(res, 400, { ok: false, error: 'missing_user_id' }); return; }

      const limit = Math.min(Number(parsedUrl.searchParams.get('limit') || 20), 100);
      const offset = Number(parsedUrl.searchParams.get('offset') || 0);
      const unreadOnly = parsedUrl.searchParams.get('unread_only') === 'true';

      const result = getNotificationHistory(userId, limit, offset, unreadOnly);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname.startsWith('/internal/notifications/') && pathname.endsWith('/read') && req.method === 'PUT') {
      const notificationId = pathname.split('/')[3];
      if (!notificationId) { sendJson(res, 400, { ok: false, error: 'missing_notification_id' }); return; }

      const updated = markAsRead(notificationId);
      if (!updated) { sendJson(res, 404, { ok: false, error: 'notification_not_found' }); return; }

      sendJson(res, 200, { ok: true, notification: updated });
      return;
    }

    if (pathname.startsWith('/internal/badges/') && req.method === 'GET') {
      const userId = pathname.split('/internal/badges/')[1];
      if (!userId) { sendJson(res, 400, { ok: false, error: 'missing_user_id' }); return; }

      const count = getUnreadBadgeCount(userId);
      sendJson(res, 200, { ok: true, user_id: userId, unread_count: count });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    logger.error('request.unhandled_error', 'Unhandled request error', { error: (error as Error).message });
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
  await httpResponseLogger(req, res, responseBody);
});

/* ---- 生命周期 ---- */

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

server.listen(port, async () => {
  logger.info('service.started', 'Mobile-app service started', { port });
  void getDbPool().then(async (pool) => {
    if (pool) await ensureTables(pool);
  });

  aggregationInterval = setInterval(() => {
    const report = analyze();
    if (report.status !== 'normal') writeAggregationReport(report);
  }, 15000);
  if (aggregationInterval.unref) aggregationInterval.unref();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (aggregationInterval) { clearInterval(aggregationInterval); aggregationInterval = null; }
    writeAggregationReport(analyze());
    metricsRegistry.shutdown();
    server.close(async () => { await logger.shutdown(); process.exit(0); });
  });
}
