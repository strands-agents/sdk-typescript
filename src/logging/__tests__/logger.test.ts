import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, configureLogging } from '../logger.js'

describe('createLogger', () => {
  beforeEach(() => {
    // Reset configuration to default before each test
    vi.restoreAllMocks()
    configureLogging({ level: 'warn', logger: globalThis.console })
  })

  afterEach(() => {
    // Restore all mocks
    vi.restoreAllMocks()
    // Reset to default configuration
    configureLogging({ level: 'warn', logger: globalThis.console })
  })

  describe('basic functionality', () => {
    it('creates logger with all required methods', () => {
      const logger = createLogger('test.logger')

      expect(logger).toBeDefined()
      expect(typeof logger.debug).toBe('function')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
    })

    it('calls console methods with correct log level', () => {
      const consoleSpy = vi.spyOn(globalThis.console, 'error')
      configureLogging({ level: 'error' })

      const logger = createLogger('test.logger')
      logger.error('Error message', 'arg1', 'arg2')

      expect(consoleSpy).toHaveBeenCalledWith('[test.logger]', 'Error message', 'arg1', 'arg2')
    })
  })

  describe('log level filtering', () => {
    it('filters logs below configured level', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')
      const infoSpy = vi.spyOn(globalThis.console, 'info')
      const warnSpy = vi.spyOn(globalThis.console, 'warn')
      const errorSpy = vi.spyOn(globalThis.console, 'error')

      configureLogging({ level: 'warn' })
      const logger = createLogger('test.logger')

      logger.debug('Debug message')
      logger.info('Info message')
      logger.warn('Warn message')
      logger.error('Error message')

      expect(debugSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith('[test.logger]', 'Warn message')
      expect(errorSpy).toHaveBeenCalledWith('[test.logger]', 'Error message')
    })

    it('disables all logging when level is off', () => {
      const errorSpy = vi.spyOn(globalThis.console, 'error')

      configureLogging({ level: 'off' })
      const logger = createLogger('test.logger')

      logger.error('Error message')

      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('enables all logging when level is debug', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')
      const infoSpy = vi.spyOn(globalThis.console, 'info')
      const warnSpy = vi.spyOn(globalThis.console, 'warn')
      const errorSpy = vi.spyOn(globalThis.console, 'error')

      configureLogging({ level: 'debug' })
      const logger = createLogger('test.logger')

      logger.debug('Debug message')
      logger.info('Info message')
      logger.warn('Warn message')
      logger.error('Error message')

      expect(debugSpy).toHaveBeenCalledWith('[test.logger]', 'Debug message')
      expect(infoSpy).toHaveBeenCalledWith('[test.logger]', 'Info message')
      expect(warnSpy).toHaveBeenCalledWith('[test.logger]', 'Warn message')
      expect(errorSpy).toHaveBeenCalledWith('[test.logger]', 'Error message')
    })
  })

  describe('hierarchical naming', () => {
    it('respects global level configuration', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')

      configureLogging({ level: 'debug' })
      const logger = createLogger('test.logger')

      logger.debug('Debug message')

      expect(debugSpy).toHaveBeenCalledWith('[test.logger]', 'Debug message')
    })

    it('respects per-module level overrides', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')

      configureLogging({
        level: 'warn',
        levels: {
          'test.logger': 'debug',
        },
      })
      const logger = createLogger('test.logger')

      logger.debug('Debug message')

      expect(debugSpy).toHaveBeenCalledWith('[test.logger]', 'Debug message')
    })

    it('respects hierarchical level overrides', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')

      configureLogging({
        level: 'warn',
        levels: {
          'strands.models': 'debug',
        },
      })
      const logger = createLogger('strands.models.bedrock')

      logger.debug('Debug message')

      expect(debugSpy).toHaveBeenCalledWith('[strands.models.bedrock]', 'Debug message')
    })

    it('gives precedence to more specific overrides', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')
      const infoSpy = vi.spyOn(globalThis.console, 'info')

      configureLogging({
        level: 'warn',
        levels: {
          'strands.models': 'debug',
          'strands.models.openai': 'error',
        },
      })

      const bedrockLogger = createLogger('strands.models.bedrock')
      const openaiLogger = createLogger('strands.models.openai')

      bedrockLogger.debug('Bedrock debug')
      openaiLogger.info('OpenAI info')

      expect(debugSpy).toHaveBeenCalledWith('[strands.models.bedrock]', 'Bedrock debug')
      expect(infoSpy).not.toHaveBeenCalled()
    })
  })

  describe('noop pattern', () => {
    it('uses noop functions for disabled levels', () => {
      configureLogging({ level: 'error' })
      const logger = createLogger('test.logger')

      // These should be no-ops and not throw
      expect(() => {
        logger.debug('Debug')
        logger.info('Info')
        logger.warn('Warn')
      }).not.toThrow()
    })

    it('noop functions have zero overhead', () => {
      configureLogging({ level: 'error' })
      const logger = createLogger('test.logger')

      const consoleSpy = vi.spyOn(globalThis.console, 'debug')

      // Call disabled method multiple times
      for (let i = 0; i < 100; i++) {
        logger.debug('Debug message', { expensive: 'data' })
      }

      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('custom logger implementation', () => {
    it('uses custom logger when provided', () => {
      const consoleSpy = vi.spyOn(globalThis.console, 'debug')
      const customLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }

      configureLogging({ level: 'debug', logger: customLogger })
      const logger = createLogger('test.logger')

      logger.debug('Debug message')

      expect(customLogger.debug).toHaveBeenCalledWith('[test.logger]', 'Debug message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('logger caching', () => {
    it('returns same logger instance for same name', () => {
      const logger1 = createLogger('test.logger')
      const logger2 = createLogger('test.logger')

      expect(logger1).toBe(logger2)
    })

    it('returns different logger instances for different names', () => {
      const logger1 = createLogger('test.logger1')
      const logger2 = createLogger('test.logger2')

      expect(logger1).not.toBe(logger2)
    })

    it('invalidates cache when configuration changes', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')

      configureLogging({ level: 'error' })
      createLogger('test.logger')

      // After config change, need to get new logger instance
      configureLogging({ level: 'debug' })
      const logger = createLogger('test.logger')
      logger.debug('Should appear')

      expect(debugSpy).toHaveBeenCalledTimes(1)
      expect(debugSpy).toHaveBeenCalledWith('[test.logger]', 'Should appear')
    })
  })

  describe('edge cases', () => {
    it('handles empty logger name', () => {
      const logger = createLogger('')
      expect(() => logger.info('Message')).not.toThrow()
    })

    it('handles logger name with special characters', () => {
      const logger = createLogger('test.logger-123_abc')
      expect(() => logger.info('Message')).not.toThrow()
    })

    it('handles multiple arguments of various types', () => {
      configureLogging({ level: 'error' })
      const errorSpy = vi.spyOn(globalThis.console, 'error')

      const logger = createLogger('test.logger')
      const obj = { key: 'value' }
      const arr = [1, 2, 3]

      logger.error('Message', obj, arr, 123, true, null, undefined)

      expect(errorSpy).toHaveBeenCalledWith('[test.logger]', 'Message', obj, arr, 123, true, null, undefined)
    })
  })
})

describe('configureLogging', () => {
  const originalEnv = typeof process !== 'undefined' ? process.env.STRANDS_LOG_LEVEL : undefined

  beforeEach(() => {
    // Reset environment variable
    if (typeof process !== 'undefined' && process.env) {
      delete process.env.STRANDS_LOG_LEVEL
    }
    // Reset configuration to default
    vi.restoreAllMocks()
    configureLogging({ level: 'warn', logger: globalThis.console })
  })

  afterEach(() => {
    // Restore environment variable
    if (typeof process !== 'undefined' && process.env) {
      if (originalEnv !== undefined) {
        process.env.STRANDS_LOG_LEVEL = originalEnv
      } else {
        delete process.env.STRANDS_LOG_LEVEL
      }
    }
    // Restore mocks
    vi.restoreAllMocks()
    // Reset configuration
    configureLogging({ level: 'warn', logger: globalThis.console })
  })

  describe('validation', () => {
    it('accepts valid log levels', () => {
      expect(() => configureLogging({ level: 'off' })).not.toThrow()
      expect(() => configureLogging({ level: 'error' })).not.toThrow()
      expect(() => configureLogging({ level: 'warn' })).not.toThrow()
      expect(() => configureLogging({ level: 'info' })).not.toThrow()
      expect(() => configureLogging({ level: 'debug' })).not.toThrow()
    })

    it('throws error for invalid log level', () => {
      expect(() => {
        // @ts-expect-error Testing invalid input
        configureLogging({ level: 'invalid' })
      }).toThrow('Invalid log level')
    })

    it('throws error for invalid per-module log level', () => {
      expect(() => {
        configureLogging({
          level: 'warn',
          levels: {
            // @ts-expect-error Testing invalid input
            'module.a': 'invalid',
          },
        })
      }).toThrow('Invalid log level')
    })

    it('handles missing console methods gracefully', () => {
      const originalDebug = globalThis.console.debug
      delete (globalThis.console as { debug?: unknown }).debug

      expect(() => {
        configureLogging({ level: 'debug' })
        const logger = createLogger('test')
        logger.debug('Debug message')
      }).not.toThrow()

      globalThis.console.debug = originalDebug
    })
  })

  describe('configuration changes', () => {
    it('allows configuration to be changed multiple times', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')

      configureLogging({ level: 'error', logger: globalThis.console })
      const logger = createLogger('test')
      logger.debug('Should not appear')

      configureLogging({ level: 'debug', logger: globalThis.console })
      // Need to get new logger after config change
      const logger2 = createLogger('test2')
      logger2.debug('Should appear')

      expect(debugSpy).toHaveBeenCalledTimes(1)
      expect(debugSpy).toHaveBeenCalledWith('[test2]', 'Should appear')
    })

    it('clears per-module overrides when not provided', () => {
      const debugSpy = vi.spyOn(globalThis.console, 'debug')

      configureLogging({
        level: 'warn',
        levels: { test: 'debug' },
        logger: globalThis.console,
      })
      const logger = createLogger('test')
      logger.debug('Should appear')

      configureLogging({ level: 'warn', logger: globalThis.console })
      // Need to get new logger after config change
      const logger2 = createLogger('test2')
      logger2.debug('Should not appear')

      expect(debugSpy).toHaveBeenCalledTimes(1)
    })
  })
})
