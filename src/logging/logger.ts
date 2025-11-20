/**
 * Logger factory and configuration.
 *
 * This module provides the core logging infrastructure for the Strands SDK,
 * including logger creation, configuration, and hierarchical level management.
 */

import type { Logger, LogLevel, LoggingConfig } from './types.js'

/**
 * Log level hierarchy for filtering.
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

/**
 * Valid log level values for validation.
 */
const VALID_LOG_LEVELS: LogLevel[] = ['off', 'error', 'warn', 'info', 'debug']

/**
 * Global configuration state.
 */
let globalConfig: LoggingConfig = {
  level: getDefaultLogLevel(),
  logger: globalThis.console,
  levels: {},
}

/**
 * Logger cache to avoid recreating loggers.
 * Uses Map for simple key-value caching.
 */
let loggerCache = new Map<string, Logger>()

/**
 * Gets the default log level from environment variable or defaults to 'warn'.
 *
 * @returns The default log level
 */
function getDefaultLogLevel(): LogLevel {
  try {
    // Only attempt to read env var in Node.js environment
    if (typeof process !== 'undefined' && process.env && process.env.STRANDS_LOG_LEVEL) {
      const envLevel = process.env.STRANDS_LOG_LEVEL as LogLevel
      if (VALID_LOG_LEVELS.includes(envLevel)) {
        return envLevel
      }
    }
  } catch {
    // Ignore errors (e.g., in browser environment)
  }
  return 'warn'
}

/**
 * Validates a log level.
 *
 * @param level - The log level to validate
 * @throws Error if the log level is invalid
 */
function validateLogLevel(level: unknown): asserts level is LogLevel {
  if (!VALID_LOG_LEVELS.includes(level as LogLevel)) {
    throw new Error(`Invalid log level: ${level}. Must be one of: ${VALID_LOG_LEVELS.join(', ')}`)
  }
}

/**
 * Configures global logging behavior.
 *
 * This function sets the global log level and optionally provides a custom
 * logger implementation. Configuration changes invalidate the logger cache,
 * causing all loggers to be recreated with the new configuration.
 *
 * @param config - The logging configuration
 * @throws Error if an invalid log level is provided
 *
 * @example
 * ```typescript
 * // Set global debug level
 * configureLogging(\{ level: 'debug' \})
 *
 * // Set per-module overrides
 * configureLogging(\{
 *   level: 'warn',
 *   levels: \{
 *     'strands.models': 'debug',
 *     'strands.models.openai': 'error'
 *   \}
 * \})
 *
 * // Use custom logger
 * configureLogging(\{
 *   level: 'info',
 *   logger: customLogger
 * \})
 * ```
 */
export function configureLogging(config: Partial<LoggingConfig>): void {
  // Validate log level if provided
  if (config.level !== undefined) {
    validateLogLevel(config.level)
  }

  // Validate per-module log levels if provided
  if (config.levels) {
    for (const [, level] of Object.entries(config.levels)) {
      validateLogLevel(level)
    }
  }

  // Update global configuration
  globalConfig = {
    level: config.level ?? globalConfig.level,
    logger: config.logger ?? globalConfig.logger ?? globalThis.console,
    levels: config.levels ?? {},
  }

  // Clear logger cache to force recreation with new config
  loggerCache.clear()
}

/**
 * Resolves the effective log level for a logger name.
 *
 * Implements hierarchical level resolution where more specific
 * module names override less specific ones.
 *
 * @param name - The logger name
 * @returns The effective log level for this logger
 *
 * @example
 * ```typescript
 * // With config: \{ level: 'warn', levels: \{ 'strands.models': 'debug' \} \}
 * resolveLevel('strands.models.bedrock')  // Returns 'debug' (parent match)
 * resolveLevel('strands.tools')           // Returns 'warn' (global default)
 * ```
 */
function resolveLevel(name: string): LogLevel {
  const { level: globalLevel, levels } = globalConfig

  if (!levels || Object.keys(levels).length === 0) {
    return globalLevel
  }

  // Find the most specific matching level override
  let matchedLevel: LogLevel | undefined
  let matchedLength = 0

  for (const [pattern, level] of Object.entries(levels)) {
    // Exact match or hierarchical match (pattern is prefix of name)
    if (name === pattern || name.startsWith(`${pattern}.`)) {
      // Keep the most specific (longest) match
      if (pattern.length > matchedLength) {
        matchedLevel = level
        matchedLength = pattern.length
      }
    }
  }

  return matchedLevel ?? globalLevel
}

/**
 * Creates a no-op logger method.
 *
 * @returns A function that does nothing
 */
function noop(): void {
  // Intentionally empty
}

/**
 * Creates a logger method that logs to the configured logger.
 *
 * @param name - The logger name
 * @param method - The log method name
 * @returns A function that logs the message
 */
function createLogMethod(
  name: string,
  method: 'debug' | 'info' | 'warn' | 'error'
): (message: string, ...args: unknown[]) => void {
  return (message: string, ...args: unknown[]): void => {
    const { logger } = globalConfig
    // Logger is always defined in globalConfig
    if (!logger) return

    const logMethod = logger[method]

    // Handle missing console methods gracefully
    if (typeof logMethod === 'function') {
      logMethod.call(logger, `[${name}]`, message, ...args)
    }
  }
}

/**
 * Creates a logger with the given name.
 *
 * Loggers are cached based on their name and the current configuration.
 * The same logger instance is returned for the same name until the
 * configuration changes.
 *
 * The logger respects hierarchical naming, where parent logger
 * configurations affect child loggers (e.g., 'strands.models' affects
 * 'strands.models.bedrock').
 *
 * @param name - The logger name (e.g., 'strands.models.bedrock')
 * @returns A logger instance
 *
 * @example
 * ```typescript
 * // Create a module-level logger
 * const logger = createLogger('strands.models.bedrock')
 *
 * // Use the logger
 * logger.debug('Debug message')
 * logger.info('Info message')
 * logger.warn('Warning message')
 * logger.error('Error message')
 * ```
 */
export function createLogger(name: string): Logger {
  // Check cache first
  const cached = loggerCache.get(name)
  if (cached) {
    return cached
  }

  // Resolve the effective log level for this logger
  const effectiveLevel = resolveLevel(name)
  const effectiveLevelNum = LOG_LEVELS[effectiveLevel]

  // Create logger methods based on effective level
  const logger: Logger = {
    debug: effectiveLevelNum >= LOG_LEVELS.debug ? createLogMethod(name, 'debug') : noop,
    info: effectiveLevelNum >= LOG_LEVELS.info ? createLogMethod(name, 'info') : noop,
    warn: effectiveLevelNum >= LOG_LEVELS.warn ? createLogMethod(name, 'warn') : noop,
    error: effectiveLevelNum >= LOG_LEVELS.error ? createLogMethod(name, 'error') : noop,
  }

  // Cache the logger
  loggerCache.set(name, logger)

  return logger
}
