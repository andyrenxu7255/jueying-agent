/**
 * Structured Logger — 结构化日志系统
 *
 * JSON 格式输出到 stdout/stderr，支持:
 * - 四级日志: debug / info / warn / error
 * - 文件持久化 (可选，含日志轮转 50MB)
 * - 上下文追踪: trace_id / workflow_instance_id / workflow_stage_id
 * - 敏感数据自动脱敏
 * - debug 级别速率限制 (60条/10秒)
 * - timed() 性能计时包装器
 *
 * @module logger
 */

import { hostname } from 'node:os';
import { appendFileSync, renameSync } from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  pid: number;
  host: string;
  trace_id?: string;
  workflow_instance_id?: string;
  workflow_stage_id?: string;
  event: string;
  message: string;
  duration_ms?: number;
  detail?: Record<string, unknown>;
}

interface LoggerOptions {
  level?: LogLevel;
  logFile?: string;
  maxLogSizeBytes?: number;
  flushIntervalMs?: number;
}

const LOG_FILE_SIZE_LIMIT = 50 * 1024 * 1024;

const rateLimitState = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 10000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const state = rateLimitState.get(key);
  if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (state.count >= RATE_LIMIT_MAX) return false;
  state.count += 1;
  return true;
}

function scrubSensitive(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = /password|secret|token|api_key|authorization|credential/i;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.test(key)) {
      result[key] = '***REDACTED***';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = scrubSensitive(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class Logger {
  private service: string;
  private level: LogLevel;
  private context: { trace_id?: string; workflow_instance_id?: string; workflow_stage_id?: string };
  private pid: number;
  private host: string;
  private logFilePath: string | null;
  private logBuffer: string[];
  private flushTimer: ReturnType<typeof setInterval> | null;
  private bytesWritten: number;

  constructor(
    service: string,
    options: LoggerOptions = {},
    context: { trace_id?: string; workflow_instance_id?: string; workflow_stage_id?: string } = {}
  ) {
    const envLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.service = service;
    this.level = options.level || envLevel;
    this.context = context;
    this.pid = process.pid;
    this.host = hostname();
    this.logFilePath = options.logFile || null;
    this.logBuffer = [];
    this.flushTimer = null;
    this.bytesWritten = 0;

    if (this.logFilePath) {
      this.flushTimer = setInterval(() => this.flushToFile(), options.flushIntervalMs || 5000);
      if (this.flushTimer.unref) this.flushTimer.unref();
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private emit(entry: LogEntry): void {
    const line = JSON.stringify(entry);
    const target: 'stdout' | 'stderr' = entry.level === 'error' || entry.level === 'warn' ? 'stderr' : 'stdout';

    if (target === 'stderr') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }

    if (this.logFilePath) {
      this.logBuffer.push(line);
      if (this.logBuffer.length >= 20) {
        this.flushToFile();
      }
    }
  }

  private flushToFile(): void {
    if (!this.logFilePath || this.logBuffer.length === 0) return;

    const content = this.logBuffer.join('\n') + '\n';
    this.logBuffer = [];

    try {
      if (this.bytesWritten + Buffer.byteLength(content) > LOG_FILE_SIZE_LIMIT) {
        const rotated = this.logFilePath.replace(/\.log$/, `.${Date.now()}.log`);
        try { renameSync(this.logFilePath, rotated); } catch { /* ignore */ }
        this.bytesWritten = 0;
      }
      appendFileSync(this.logFilePath, content);
      this.bytesWritten += Buffer.byteLength(content);
    } catch {
      process.stderr.write(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: this.service,
        event: 'log.write_failed',
        message: 'Failed to write log to file',
        detail: { path: this.logFilePath }
      }) + '\n');
    }
  }

  private log(
    level: LogLevel,
    event: string,
    message: string,
    detail?: Record<string, unknown>,
    durationMs?: number
  ): void {
    if (!this.shouldLog(level)) return;

    const rateLimitKey = `${this.service}:${event}:${level}`;
    if (level === 'debug' && !checkRateLimit(rateLimitKey)) return;

    const safeDetail = detail ? scrubSensitive(detail) : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      pid: this.pid,
      host: this.host,
      event,
      message,
    };

    if (this.context.trace_id) entry.trace_id = this.context.trace_id;
    if (this.context.workflow_instance_id) entry.workflow_instance_id = this.context.workflow_instance_id;
    if (this.context.workflow_stage_id) entry.workflow_stage_id = this.context.workflow_stage_id;
    if (durationMs !== undefined) entry.duration_ms = durationMs;
    if (safeDetail && Object.keys(safeDetail).length > 0) entry.detail = safeDetail;

    this.emit(entry);
  }

  debug(event: string, message: string, detail?: Record<string, unknown>): void {
    this.log('debug', event, message, detail);
  }

  info(event: string, message: string, detail?: Record<string, unknown>): void {
    this.log('info', event, message, detail);
  }

  warn(event: string, message: string, detail?: Record<string, unknown>): void {
    this.log('warn', event, message, detail);
  }

  error(event: string, message: string, detail?: Record<string, unknown>): void {
    this.log('error', event, message, detail);
  }

  timed<T>(
    event: string,
    message: string,
    fn: () => T | Promise<T>,
    detail?: Record<string, unknown>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = fn();
      const end = performance.now();
      if (result instanceof Promise) {
        return result.then(
          (val) => { this.log('info', event, message, detail, Math.round(end - start)); return val; },
          (err) => { this.log('error', event, `${message} failed: ${(err as Error).message}`, detail, Math.round(end - start)); throw err; }
        );
      }
      this.log('info', event, message, detail, Math.round(end - start));
      return Promise.resolve(result);
    } catch (err) {
      const end = performance.now();
      this.log('error', event, `${message} failed: ${(err as Error).message}`, detail, Math.round(end - start));
      throw err;
    }
  }

  withContext(context: { trace_id?: string; workflow_instance_id?: string; workflow_stage_id?: string }): Logger {
    const c = new Logger(this.service, { level: this.level, logFile: this.logFilePath || undefined }, {
      ...this.context,
      ...context
    });
    return c;
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    this.flushToFile();
  }
}

export function createLogger(service: string, options?: LoggerOptions): Logger {
  return new Logger(service, options);
}

