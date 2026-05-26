import { createLogger } from '../logging/logger';
import { metricsRegistry } from '../metrics/metrics';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { totalmem, freemem } from 'node:os';

const logger = createLogger('log-aggregator');

export interface AggregationEntry {
  timestamp: string;
  total_requests: number;
  total_errors: number;
  error_rate_percent: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  db_queries: number;
  db_errors: number;
  db_avg_latency_ms: number;
  heap_used_mb: number;
  memory_used_percent: number;
  active_workflows?: number;
  critical_logs_last_interval: number;
}

export interface AnalysisReport {
  timestamp: string;
  interval_seconds: number;
  status: 'normal' | 'warning' | 'critical';
  summary: string;
  anomalies: string[];
  metrics: AggregationEntry;
  trends: {
    request_rate_trend: 'stable' | 'increasing' | 'decreasing';
    error_rate_trend: 'stable' | 'increasing' | 'decreasing';
    latency_trend: 'stable' | 'increasing' | 'decreasing';
    memory_trend: 'stable' | 'increasing' | 'decreasing';
  };
  top_slow_queries?: Array<{ query: string; duration_ms: number }>;
}

const history: AggregationEntry[] = [];
const MAX_HISTORY = 1440;
const criticalLogCounts = new Map<string, number>();
const OUTPUT_DIR = join(process.cwd(), 'logs', 'aggregation');

export function recordCriticalLog(eventType: string): void {
  criticalLogCounts.set(eventType, (criticalLogCounts.get(eventType) || 0) + 1);
}

export function aggregate(): AggregationEntry {
  const mem = process.memoryUsage();
  const osTotalMem = totalmem();
  const osFreeMem = freemem();

  const entry: AggregationEntry = {
    timestamp: new Date().toISOString(),
    total_requests: metricsRegistry.getCounter('http.requests.total'),
    total_errors: metricsRegistry.getCounter('http.requests.errors'),
    error_rate_percent: calculateErrorRate(),
    p50_latency_ms: metricsRegistry.getPercentile('http.requests.duration_ms', 0.5) || 0,
    p95_latency_ms: metricsRegistry.getPercentile('http.requests.duration_ms', 0.95) || 0,
    p99_latency_ms: metricsRegistry.getPercentile('http.requests.duration_ms', 0.99) || 0,
    db_queries: metricsRegistry.getCounter('db.query.total'),
    db_errors: metricsRegistry.getCounter('db.query.errors'),
    db_avg_latency_ms: metricsRegistry.getPercentile('db.query.duration_ms', 0.5) || 0,
    heap_used_mb: Math.round(mem.heapUsed / 1048576),
    memory_used_percent: Math.round(((osTotalMem - osFreeMem) / osTotalMem) * 100),
    critical_logs_last_interval: Array.from(criticalLogCounts.values()).reduce((a, b) => a + b, 0)
  };

  criticalLogCounts.clear();
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();

  return entry;
}

function calculateErrorRate(): number {
  const total = metricsRegistry.getCounter('http.requests.total');
  const errors = metricsRegistry.getCounter('http.requests.errors');
  if (total === 0) return 0;
  return Math.round((errors / total) * 10000) / 100;
}

function analyzeTrend(values: number[], windowSize: number = 5): 'stable' | 'increasing' | 'decreasing' {
  if (values.length < windowSize + 1) return 'stable';
  const recent = values.slice(-windowSize);
  const older = values.slice(-(windowSize * 2), -windowSize);
  if (older.length === 0) return 'stable';

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

  if (olderAvg === 0) return 'stable';
  const change = ((recentAvg - olderAvg) / olderAvg) * 100;
  if (change > 15) return 'increasing';
  if (change < -15) return 'decreasing';
  return 'stable';
}

export function analyze(): AnalysisReport {
  const current = aggregate();
  const anomalies: string[] = [];
  let overallStatus: AnalysisReport['status'] = 'normal';

  if (current.error_rate_percent > 5) {
    anomalies.push(`error_rate_elevated: ${current.error_rate_percent}%`);
    overallStatus = 'critical';
  } else if (current.error_rate_percent > 2) {
    anomalies.push(`error_rate_warning: ${current.error_rate_percent}%`);
    overallStatus = 'warning';
  }

  if (current.p95_latency_ms > 3000) {
    anomalies.push(`p95_latency_critical: ${current.p95_latency_ms}ms`);
    overallStatus = 'critical';
  } else if (current.p95_latency_ms > 1000) {
    anomalies.push(`p95_latency_warning: ${current.p95_latency_ms}ms`);
    if (overallStatus !== 'critical') overallStatus = 'warning';
  }

  if (current.heap_used_mb > 1024) {
    anomalies.push(`heap_usage_high: ${current.heap_used_mb}MB`);
    if (overallStatus !== 'critical') overallStatus = 'warning';
  }

  if (current.memory_used_percent > 90) {
    anomalies.push(`system_memory_critical: ${current.memory_used_percent}%`);
    overallStatus = 'critical';
  }

  if (current.db_errors > 5) {
    anomalies.push(`database_errors: ${current.db_errors} in last interval`);
    overallStatus = 'critical';
  }

  const requestHistory = history.map(h => h.total_requests);
  const errorHistory = history.map(h => h.total_errors);
  const latencyHistory = history.map(h => h.p50_latency_ms);
  const memoryHistory = history.map(h => h.heap_used_mb);

  const report: AnalysisReport = {
    timestamp: current.timestamp,
    interval_seconds: 15,
    status: overallStatus,
    summary: overallStatus === 'normal'
      ? 'System operating normally'
      : `${overallStatus.toUpperCase()}: ${anomalies.length} issue(s) detected`,
    anomalies,
    metrics: current,
    trends: {
      request_rate_trend: analyzeTrend(requestHistory),
      error_rate_trend: analyzeTrend(errorHistory),
      latency_trend: analyzeTrend(latencyHistory),
      memory_trend: analyzeTrend(memoryHistory)
    }
  };

  if (overallStatus !== 'normal') {
    logger.warn('log-analysis.anomaly', `Analysis: ${report.summary}`, {
      status: overallStatus,
      anomaly_count: anomalies.length,
      errors: current.total_errors,
      p95_ms: current.p95_latency_ms,
      error_rate: current.error_rate_percent
    });
  }

  return report;
}

export function writeAggregationReport(report: AnalysisReport): void {
  try {
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const date = new Date().toISOString().slice(0, 10);
    const reportPath = join(OUTPUT_DIR, `analysis-${date}.json`);

    let existing: AnalysisReport[] = [];
    try {
      const raw = readFileSync(reportPath, 'utf8');
      existing = JSON.parse(raw);
    } catch { /* file doesn't exist yet */ }

    existing.push(report);
    if (existing.length > 5760) existing = existing.slice(-5760);

    writeFileSync(reportPath, JSON.stringify(existing, null, 2));
  } catch (error) {
    logger.error('log-analysis.write_failed', 'Failed to write aggregation report', {
      error: (error as Error).message
    });
  }
}

export function getHistory(): AggregationEntry[] {
  return [...history];
}
