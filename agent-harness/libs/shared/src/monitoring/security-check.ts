import { createLogger } from '../logging/logger'

const DEV_PASSWORDS = new Set([
  'dev_password',
  'dev_password_changeme',
  'redis_changeme',
  'minioadmin',
  'minioadmin_changeme',
  'clickhouse',
  'clickhouse_changeme',
])

export function checkProductionSecurity(): void {
  if (process.env.NODE_ENV !== 'production') return

  const logger = createLogger('security-check', { logFile: '' })
  const failures: string[] = []

  const check = (key: string, defaultValues: string[]) => {
    const val = process.env[key] || ''
    if (!val || defaultValues.some(d => val === d)) {
      failures.push(`${key} is not set or using a default/weak value`)
    }
  }

  check('POSTGRES_PASSWORD', ['dev_password', 'dev_password_changeme'])
  check('REDIS_PASSWORD', ['agent_harness_redis', 'redis_changeme'])
  check('MINIO_ROOT_PASSWORD', ['minioadmin', 'minioadmin_changeme'])
  check('CLICKHOUSE_PASSWORD', ['clickhouse', 'clickhouse_changeme'])
  check('LITELLM_MASTER_KEY', ['litellm-dev-key', ''])
  check('ADMIN_PASSWORD', [''])

  if (failures.length > 0) {
    logger.error('security.production.insecure', 'Production environment has insecure configuration', {
      failures,
      message: 'Set strong passwords via environment variables or use docker-compose.prod.yml'
    })
    throw new Error(
      `Production security check failed: ${failures.join('; ')}. ` +
      'Set strong passwords via environment variables or use docker-compose.prod.yml'
    )
  }

  const corsOrigins = process.env.CORS_ORIGINS || ''
  if (corsOrigins === '*' || corsOrigins.includes(':*')) {
    logger.error('security.cors.insecure', 'CORS wildcard origin is not safe for production', {
      cors_origins: corsOrigins
    })
    throw new Error('CORS wildcard origin is not safe for production')
  }
}
