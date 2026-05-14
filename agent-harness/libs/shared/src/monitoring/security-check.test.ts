import { checkProductionSecurity } from './security-check'

describe('security-check', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('checkProductionSecurity', () => {
    it('should not throw in non-production environment', () => {
      delete (process.env as Record<string, string>).NODE_ENV
      expect(() => checkProductionSecurity()).not.toThrow()
    })

    it('should not throw when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development'
      expect(() => checkProductionSecurity()).not.toThrow()
    })

    it('should throw with default passwords in production', () => {
      process.env.NODE_ENV = 'production'
      process.env.POSTGRES_PASSWORD = 'dev_password'
      process.env.REDIS_PASSWORD = 'redis_changeme'
      process.env.MINIO_ROOT_PASSWORD = 'minioadmin'
      process.env.LITELLM_MASTER_KEY = 'litellm-dev-key'
      process.env.ADMIN_PASSWORD = ''
      process.env.CORS_ORIGINS = 'http://localhost:3003'

      expect(() => checkProductionSecurity()).toThrow()
    })

    it('should not throw with strong passwords in production', () => {
      process.env.NODE_ENV = 'production'
      process.env.POSTGRES_PASSWORD = 'Str0ng!P@ssw0rd#2024'
      process.env.REDIS_PASSWORD = 'Str0ng!R3d1s#2024'
      process.env.MINIO_ROOT_PASSWORD = 'Str0ng!M1n10#2024'
      process.env.CLICKHOUSE_PASSWORD = 'Str0ng!Cl1ck#2024'
      process.env.LITELLM_MASTER_KEY = 'sk-strong-master-key-2024'
      process.env.ADMIN_PASSWORD = 'Str0ng!Adm1n#2024'
      process.env.CORS_ORIGINS = 'https://myapp.com'

      expect(() => checkProductionSecurity()).not.toThrow()
    })

    it('should throw with CORS wildcard in production', () => {
      process.env.NODE_ENV = 'production'
      process.env.POSTGRES_PASSWORD = 'Str0ng!P@ssw0rd#2024'
      process.env.REDIS_PASSWORD = 'Str0ng!R3d1s#2024'
      process.env.MINIO_ROOT_PASSWORD = 'Str0ng!M1n10#2024'
      process.env.CLICKHOUSE_PASSWORD = 'Str0ng!Cl1ck#2024'
      process.env.LITELLM_MASTER_KEY = 'sk-strong-master-key-2024'
      process.env.ADMIN_PASSWORD = 'Str0ng!Adm1n#2024'
      process.env.CORS_ORIGINS = '*'

      expect(() => checkProductionSecurity()).toThrow('CORS wildcard origin is not safe for production')
    })
  })
})