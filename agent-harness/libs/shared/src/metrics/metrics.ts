import { createLogger } from '../logging/logger';
import { totalmem, freemem } from 'node:os';

const logger = createLogger('metrics');

export interface CounterMetric {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface HistogramBucket {
  le: number;
  count: number;
}

export interface HistogramMetric {
  name: string;
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels?: Record<string, string>;
}

export interface AlertThreshold {
  metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte';
  value: number;
  severity: 'warn' | 'error';
  message: string;
  cooldownMs?: number;
}

interface AlertState {
  lastFired: number;
  firedCount: number;
}

const DEFAULT_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

export class MetricsRegistry {
  private counters = new Map<string, number>();
  private counterLabels = new Map<string, Record<string, string>>();
  private histograms = new Map<string, { buckets: HistogramBucket[]; sum: number; count: number; labels?: Record<string, string> }>();
  private alertThresholds: AlertThreshold[] = [];
  private alertStates = new Map<string, AlertState>();
  private alertTimer: ReturnType<typeof setInterval> | null = null;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number;

  constructor() {
    this.startedAt = Date.now();
    this.alertTimer = setInterval(() => this.evaluateAlerts(), 15000);
    if (this.alertTimer.unref) this.alertTimer.unref();
    this.memoryTimer = setInterval(() => this.recordMemoryMetrics(), 30000);
    if (this.memoryTimer.unref) this.memoryTimer.unref();
  }

  increment(name: string, value = 1, labels?: Record<string, string>): void {
    const prev = this.counters.get(name) || 0;
    this.counters.set(name, prev + value);
    if (labels) this.counterLabels.set(name, labels);
  }

  observe(name: string, valueMs: number, labels?: Record<string, string>): void {
    let hist = this.histograms.get(name);
    if (!hist) {
      hist = {
        buckets: DEFAULT_BUCKETS.map(le => ({ le, count: 0 })),
        sum: 0,
        count: 0,
        labels
      };
      this.histograms.set(name, hist);
    }
    hist.sum += valueMs;
    hist.count += 1;
    for (const bucket of hist.buckets) {
      if (valueMs <= bucket.le) {
        bucket.count += 1;
      }
    }
  }

  registerAlert(threshold: AlertThreshold): void {
    this.alertThresholds.push(threshold);
  }

  private recordMemoryMetrics(): void {
    const mem = process.memoryUsage();
    this.observe('system.memory.rss_bytes', mem.rss);
    this.observe('system.memory.heap_used_bytes', mem.heapUsed);
    this.observe('system.memory.heap_total_bytes', mem.heapTotal);
    this.observe('system.memory.external_bytes', mem.external);

    const total = totalmem();
    const free = freemem();
    const usedPercent = ((total - free) / total) * 100;
    this.observe('system.memory.os_used_percent', usedPercent);

    if (usedPercent > 90) {
      logger.warn('metrics.memory.high_usage', `System memory usage critical: ${usedPercent.toFixed(1)}%`, {
        used_percent: Math.round(usedPercent),
        total_mb: Math.round(total / 1048576),
        free_mb: Math.round(free / 1048576)
      });
    }

    const heapUsedPercent = (mem.heapUsed / mem.heapTotal) * 100;
    const maxOldSpaceMb = Math.round(mem.heapTotal / 1048576);
    if (heapUsedPercent > 85 && maxOldSpaceMb > 200) {
      logger.warn('metrics.heap.high_usage', `Heap usage high: ${heapUsedPercent.toFixed(1)}%`, {
        heap_used_mb: Math.round(mem.heapUsed / 1048576),
        heap_total_mb: maxOldSpaceMb,
        heap_used_percent: Math.round(heapUsedPercent)
      });
    }
  }

  private evaluateAlerts(): void {
    const now = Date.now()
    for (const threshold of this.alertThresholds) {
      const alertKey = `${threshold.metric}:${threshold.operator}:${threshold.value}`
      const state = this.alertStates.get(alertKey)
      const cooldownMs = threshold.cooldownMs || 60000

      if (state && now - state.lastFired < cooldownMs) continue

      const counterValue = this.counters.get(threshold.metric) || 0
      const histogram = this.histograms.get(threshold.metric)
      const currentValue = histogram && histogram.count > 0
        ? histogram.sum / histogram.count
        : counterValue

      let triggered = false
      switch (threshold.operator) {
        case 'gt': triggered = currentValue > threshold.value; break
        case 'lt': triggered = currentValue < threshold.value; break
        case 'gte': triggered = currentValue >= threshold.value; break
        case 'lte': triggered = currentValue <= threshold.value; break
      }

      if (triggered) {
        const newState: AlertState = {
          lastFired: now,
          firedCount: (state?.firedCount || 0) + 1
        }
        this.alertStates.set(alertKey, newState)

        const logFn = threshold.severity === 'error' ? logger.error.bind(logger) : logger.warn.bind(logger)
        logFn(`alert.${threshold.metric}`, `[${threshold.severity.toUpperCase()}] ${threshold.message}`, {
          metric: threshold.metric,
          current_value: currentValue,
          threshold_value: threshold.value,
          operator: threshold.operator,
          fired_count: newState.firedCount
        })
      }
    }
  }

  snapshot(): CounterMetric[] {
    return Array.from(this.counters.entries()).map(([name, value]) => ({
      name,
      value,
      labels: this.counterLabels.get(name)
    }));
  }

  histogramSnapshot(): HistogramMetric[] {
    return Array.from(this.histograms.entries()).map(([name, hist]) => ({
      name,
      buckets: hist.buckets,
      sum: hist.sum,
      count: hist.count,
      labels: hist.labels
    }));
  }

  getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  getPercentile(name: string, p: number): number | null {
    const hist = this.histograms.get(name);
    if (!hist || hist.count === 0) return null;

    const targetCount = hist.count * p;
    let cumulative = 0;
    for (const bucket of hist.buckets) {
      cumulative += bucket.count;
      if (cumulative >= targetCount) return bucket.le;
    }
    return hist.buckets[hist.buckets.length - 1]?.le || null;
  }

  uptimeMs(): number {
    return Date.now() - this.startedAt;
  }

  shutdown(): void {
    if (this.alertTimer) { clearInterval(this.alertTimer); this.alertTimer = null; }
    if (this.memoryTimer) { clearInterval(this.memoryTimer); this.memoryTimer = null; }
  }
}

export const metricsRegistry = new MetricsRegistry();

