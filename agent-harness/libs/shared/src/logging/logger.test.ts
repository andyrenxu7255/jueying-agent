import { Logger, createLogger } from './logger'

describe('Logger', () => {
  describe('createLogger', () => {
    it('should create logger with service name', () => {
      const logger = createLogger('test-service')
      expect(logger).toBeInstanceOf(Logger)
    })
  })

  describe('log levels', () => {
    let logger: Logger

    beforeEach(() => {
      logger = createLogger('test-service')
    })

    it('should log info without throwing', () => {
      expect(() => logger.info('test.event', 'test message')).not.toThrow()
    })

    it('should log warn without throwing', () => {
      expect(() => logger.warn('test.warning', 'warning message')).not.toThrow()
    })

    it('should log error without throwing', () => {
      expect(() => logger.error('test.error', 'error message')).not.toThrow()
    })

    it('should log debug without throwing', () => {
      expect(() => logger.debug('test.debug', 'debug message')).not.toThrow()
    })

    it('should accept detail context', () => {
      expect(() => logger.info('test.detail', 'msg with detail', { key: 'value', count: 42 })).not.toThrow()
    })

    it('should redact sensitive keys in detail', () => {
      expect(() => logger.info('safe.event', 'has secret', { password: 'secret123', token: 'abc', normal: 'visible' })).not.toThrow()
    })
  })

  describe('withContext', () => {
    it('should return new logger with additional context', () => {
      const parent = createLogger('parent')
      const child = parent.withContext({ trace_id: 'trace-123' })
      expect(child).toBeInstanceOf(Logger)
      expect(child).not.toBe(parent)
    })
  })

  describe('timed', () => {
    let logger: Logger

    beforeEach(() => {
      logger = createLogger('timed-test')
    })

    it('should execute synchronous function and return result', async () => {
      const result = await logger.timed('timed.event', 'operation', () => 'result')
      expect(result).toBe('result')
    })

    it('should execute async function and return result', async () => {
      const result = await logger.timed('timed.async', 'async op', async () => {
        return 'async result'
      })
      expect(result).toBe('async result')
    })

    it('should propagate error from timed function', async () => {
      await expect(
        logger.timed('timed.error', 'failing op', () => {
          throw new Error('expected failure')
        })
      ).rejects.toThrow('expected failure')
    })

    it('should propagate error from async timed function', async () => {
      await expect(
        logger.timed('timed.async.error', 'async failing', async () => {
          throw new Error('async failure')
        })
      ).rejects.toThrow('async failure')
    })
  })

  describe('shutdown', () => {
    it('should shutdown without error', async () => {
      const logger = createLogger('shutdown-test')
      await expect(logger.shutdown()).resolves.toBeUndefined()
    })
  })
})