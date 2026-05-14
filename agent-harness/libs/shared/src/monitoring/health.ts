import { createLogger } from '../logging/logger';
import { metricsRegistry } from '../metrics/metrics';

const logger = createLogger('health');

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime_ms: number;
  timestamp: string;
  components: Record<string, ComponentHealth>;
  metrics_summary?: {
    total_requests: number;
    total_errors: number;
    avg_latency_ms: number;
    heap_used_mb: number;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checked_at: string;
  latency_ms?: number;
  error?: string;
  detail?: Record<string, unknown>;
}

type HealthChecker = () => Promise<Pick<ComponentHealth, 'status' | 'error' | 'detail'>>;

const checkers = new Map<string, HealthChecker>();

export function registerHealthCheck(name: string, check: HealthChecker): void {
  checkers.set(name, check);
  logger.info('health.checker.registered', `Health check registered: ${name}`, { checker_name: name });
}

export function clearHealthChecks(): void {
  checkers.clear();
}

export async function runHealthCheck(): Promise<HealthStatus> {
  const components: Record<string, ComponentHealth> = {};
  let overallStatus: HealthStatus['status'] = 'healthy';

  const checks = Array.from(checkers.entries());
  const results = await Promise.allSettled(
    checks.map(async ([name, check]) => {
      const start = performance.now();
      try {
        const result = await check();
        const latencyMs = Math.round(performance.now() - start);
        return { name, ...result, latency_ms: latencyMs };
      } catch (error) {
        const latencyMs = Math.round(performance.now() - start);
        return {
          name,
          status: 'unhealthy' as ComponentHealth['status'],
          error: (error as Error).message,
          latency_ms: latencyMs
        };
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { name, status, error, detail, latency_ms } = result.value;
      components[name] = {
        status,
        checked_at: new Date().toISOString(),
        latency_ms,
        error,
        detail
      };

      if (status === 'unhealthy') overallStatus = 'unhealthy';
      else if (status === 'degraded' && overallStatus !== 'unhealthy') overallStatus = 'degraded';
    }
  }

  if (overallStatus === 'unhealthy') {
    logger.error('health.unhealthy', 'System health check failed - unhealthy components detected', {
      unhealthy: Object.entries(components)
        .filter(([, c]) => c.status === 'unhealthy')
        .map(([n]) => n)
    });
  } else if (overallStatus === 'degraded') {
    logger.warn('health.degraded', 'System health check indicates degraded status', {
      degraded: Object.entries(components)
        .filter(([, c]) => c.status !== 'healthy')
        .map(([n, c]) => `${n}:${c.status}`)
    });
  }

  const mem = process.memoryUsage();

  return {
    status: overallStatus,
    uptime_ms: metricsRegistry.uptimeMs(),
    timestamp: new Date().toISOString(),
    components,
    metrics_summary: {
      total_requests: metricsRegistry.getCounter('http.requests.total'),
      total_errors: metricsRegistry.getCounter('http.requests.errors'),
      avg_latency_ms: metricsRegistry.getPercentile('http.requests.duration_ms', 0.5) || 0,
      heap_used_mb: Math.round(mem.heapUsed / 1048576)
    }
  };
}

export function setupDefaultHealthChecks(checkDb?: () => Promise<boolean>, checkRedis?: () => Promise<boolean>): void {
  registerHealthCheck('process', async () => ({
    status: 'healthy',
    detail: {
      pid: process.pid,
      uptime_ms: metricsRegistry.uptimeMs(),
      node_version: process.version,
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1048576)
    }
  }));

  if (checkDb) {
    registerHealthCheck('database', async () => {
      const ok = await checkDb();
      return {
        status: ok ? 'healthy' : 'unhealthy',
        error: ok ? undefined : 'database_connection_failed'
      };
    });
  }

  if (checkRedis) {
    registerHealthCheck('redis', async () => {
      const ok = await checkRedis();
      return {
        status: ok ? 'healthy' : 'degraded',
        error: ok ? undefined : 'redis_connection_failed'
      };
    });
  }
}
