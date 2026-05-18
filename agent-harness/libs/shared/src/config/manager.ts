import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import YAML from 'yaml';

/**
 * Configuration Management
 * Reference: AH1-28 §28.2
 */

// Config Schema
const ConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535).default(3000),
    host: z.string().default('0.0.0.0'),
    graceful_shutdown_timeout_ms: z.number().int().default(10000)
  }),
  database: z.object({
    url: z.string(),
    pool_size: z.number().int().min(1).max(100).default(10),
    connection_timeout_ms: z.number().int().default(5000),
    statement_timeout_ms: z.number().int().default(30000),
    ssl: z.object({
      enabled: z.boolean().default(false),
      reject_unauthorized: z.boolean().default(true)
    }).optional()
  }),
  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
    key_prefix: z.string().default('ah:'),
    max_retries: z.number().int().default(3),
    retry_delay_ms: z.number().int().default(100)
  }),
  storage: z.object({
    backend: z.enum(['localfs', 'minio', 's3']).default('localfs'),
    local_root: z.string().default('.runtime/artifacts'),
    endpoint: z.string().optional(),
    access_key: z.string().optional(),
    secret_key: z.string().optional(),
    bucket: z.string().default('agent-harness'),
    region: z.string().default('us-east-1'),
    use_ssl: z.boolean().default(false)
  }),
  workflow: z.object({
    max_concurrent: z.number().int().default(20),
    default_timeout_sec: z.number().int().default(3600),
    checkpoint_interval_sec: z.number().int().default(60),
    max_retries: z.number().int().default(3),
    max_repairs: z.number().int().default(3)
  }),
  executor: z.object({
    max_concurrent_sessions: z.number().int().default(4),
    worktree_root: z.string().default('/var/lib/executor/worktrees'),
    default_timeout_sec: z.number().int().default(1800)
  }),
  retrieval: z.object({
    max_candidates: z.number().int().default(50),
    default_intent: z.enum(['object-status', 'evidence', 'relation', 'similar-case', 'dev-context']).default('object-status'),
    enable_graph: z.boolean().default(true),
    max_graph_hops: z.number().int().max(2).default(2),
    enable_rerank: z.boolean().default(true),
    embedding_mode: z.enum(['deterministic', 'provider']).default('provider'),
    rerank_mode: z.enum(['deterministic', 'provider']).default('provider'),
    embedding_provider_url: z.string().optional(),
    embedding_provider_api_key: z.string().optional(),
    embedding_provider_model: z.string().optional(),
    embedding_provider_timeout_ms: z.number().int().default(5000),
    rerank_provider_url: z.string().optional(),
    rerank_provider_api_key: z.string().optional(),
    rerank_provider_model: z.string().optional(),
    rerank_provider_timeout_ms: z.number().int().default(5000)
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['json', 'text']).default('json'),
    output: z.enum(['stdout', 'file']).default('stdout')
  }),
  metrics: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().default(9090)
  }),
  tracing: z.object({
    enabled: z.boolean().default(false),
    sample_rate: z.number().min(0).max(1).default(0.1),
    endpoint: z.string().optional()
  })
});

export type Config = z.infer<typeof ConfigSchema>;

function findConfigRoot(startDir: string): string {
  let current = resolve(startDir);
  let parent = dirname(current);
  while (parent !== current) {
    if (existsSync(resolve(current, 'config/default.yaml'))) {
      return current;
    }
    current = parent;
    parent = dirname(current);
  }
  if (existsSync(resolve(current, 'config/default.yaml'))) {
    return current;
  }
  return resolve(startDir);
}

// Config Manager
export class ConfigManager {
  private config: Config;
  private watchers: Set<(config: Config) => void> = new Set();

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    // Priority: env vars > production.yaml > default.yaml > code defaults
    const configs: Partial<Config>[] = [];
    const configRoot = process.env.AGENT_HARNESS_CONFIG_ROOT
      ? resolve(process.env.AGENT_HARNESS_CONFIG_ROOT)
      : findConfigRoot(process.cwd());

    // 1. Default config
    const defaultConfigPath = resolve(configRoot, 'config/default.yaml');
    if (existsSync(defaultConfigPath)) {
      configs.push(YAML.parse(readFileSync(defaultConfigPath, 'utf-8')) as Partial<Config>);
    }

    // 2. Environment specific config
    const env = process.env.NODE_ENV || 'development';
    const envConfigPath = resolve(configRoot, `config/${env}.yaml`);
    if (existsSync(envConfigPath)) {
      configs.push(YAML.parse(readFileSync(envConfigPath, 'utf-8')) as Partial<Config>);
    }

    // 3. Environment variables override
    const envOverride = this.loadEnvOverrides();
    configs.push(envOverride);

    // Merge and validate
    const merged = this.deepMerge({}, ...configs);
    const expanded = this.expandEnvPlaceholders(merged);
    return ConfigSchema.parse(expanded);
  }

  private expandEnvPlaceholders(value: unknown): unknown {
    if (typeof value === 'string') {
      const exact = value.match(/^\$\{([A-Z0-9_]+)(?::-([^}]*))?\}$/);
      if (exact) {
        const envValue = process.env[exact[1]];
        return envValue !== undefined && envValue !== '' ? envValue : (exact[2] ?? '');
      }
      return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_match, key: string, fallback: string | undefined) => {
        const envValue = process.env[key];
        if (envValue !== undefined && envValue !== '') {
          return envValue;
        }
        return fallback ?? '';
      });
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.expandEnvPlaceholders(item));
    }

    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        output[key] = this.expandEnvPlaceholders(nested);
      }
      return output;
    }

    return value;
  }

  private loadEnvOverrides(): Partial<Config> {
    const overrides: Record<string, unknown> = {};

    if (process.env.DATABASE_URL) {
      overrides.database = { url: process.env.DATABASE_URL };
    }
    if (process.env.DB_SSL_ENABLED) {
      overrides.database = {
        ...(overrides.database as Record<string, unknown> || {}),
        ssl: {
          ...((overrides.database as Record<string, unknown> | undefined)?.ssl as Record<string, unknown> || {}),
          enabled: process.env.DB_SSL_ENABLED === 'true'
        }
      };
    }
    if (process.env.DB_SSL_REJECT_UNAUTHORIZED) {
      overrides.database = {
        ...(overrides.database as Record<string, unknown> || {}),
        ssl: {
          ...((overrides.database as Record<string, unknown> | undefined)?.ssl as Record<string, unknown> || {}),
          reject_unauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
        }
      };
    }
    if (process.env.REDIS_URL) {
      overrides.redis = { url: process.env.REDIS_URL };
    }
    if (process.env.LOG_LEVEL) {
      overrides.logging = { level: process.env.LOG_LEVEL };
    }
    if (process.env.SERVER_PORT) {
      overrides.server = { port: parseInt(process.env.SERVER_PORT, 10) };
    }

    return overrides;
  }

  private deepMerge(target: Record<string, unknown>, ...sources: Record<string, unknown>[]): Record<string, unknown> {
    for (const source of sources) {
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          target[key] = target[key] || {};
          this.deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
        } else {
          target[key] = source[key];
        }
      }
    }
    return target;
  }

  get(): Config {
    return this.config;
  }

  getPath<T>(path: string): T | undefined {
    const parts = path.split('.');
    let current: unknown = this.config;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current as T;
  }

  watch(callback: (config: Config) => void): void {
    this.watchers.add(callback);
  }

  unwatch(callback: (config: Config) => void): void {
    this.watchers.delete(callback);
  }

  reload(): void {
    this.config = this.loadConfig();
    this.watchers.forEach(cb => cb(this.config));
  }
}

/**
 * 配置管理器单例。
 * 按优先级加载: 环境变量 > NODE_ENV.yaml > default.yaml > 代码默认值。
 */
export const configManager = new ConfigManager();

/**
 * 获取数据库 SSL 配置。
 *
 * @param config - 可选，配置对象（默认使用 configManager 当前配置）。
 * @returns SSL 配置对象或 false（禁用 SSL）。
 */
export function getDatabaseSslConfig(config: Config = configManager.get()): false | { rejectUnauthorized: boolean } {
  const envEnabled = process.env.DB_SSL_ENABLED;
  const enabled = envEnabled
    ? envEnabled === 'true'
    : (process.env.NODE_ENV === 'production' ? true : Boolean(config.database.ssl?.enabled));

  if (!enabled) {
    return false;
  }

  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED
    ? process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
    : (config.database.ssl?.reject_unauthorized ?? true);

  return { rejectUnauthorized };
}
