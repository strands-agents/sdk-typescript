/**
 * Logging types and interfaces for the Strands SDK.
 *
 * This module defines the core types for the logging system, including
 * log levels, logger interface, and logging configuration.
 */

/**
 * Log level type.
 *
 * Levels are ordered from most to least verbose:
 * - `debug`: Detailed diagnostic information
 * - `info`: General informational messages
 * - `warn`: Warning messages for potential issues
 * - `error`: Error messages for failures
 * - `off`: Disable all logging
 */
export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug'

/**
 * Logger interface.
 *
 * Provides methods for logging at different severity levels.
 * All methods accept a message string followed by optional arguments.
 */
export interface Logger {
  /**
   * Log a debug message.
   *
   * @param message - The message to log
   * @param args - Optional additional arguments to log
   */
  debug(message: string, ...args: unknown[]): void

  /**
   * Log an info message.
   *
   * @param message - The message to log
   * @param args - Optional additional arguments to log
   */
  info(message: string, ...args: unknown[]): void

  /**
   * Log a warning message.
   *
   * @param message - The message to log
   * @param args - Optional additional arguments to log
   */
  warn(message: string, ...args: unknown[]): void

  /**
   * Log an error message.
   *
   * @param message - The message to log
   * @param args - Optional additional arguments to log
   */
  error(message: string, ...args: unknown[]): void
}

/**
 * Logging configuration interface.
 *
 * Used to configure the global logging behavior for all loggers.
 */
export interface LoggingConfig {
  /**
   * Global log level.
   *
   * This level applies to all loggers unless overridden by the `levels` property.
   * Defaults to 'warn' if not specified.
   */
  level: LogLevel

  /**
   * Custom logger implementation.
   *
   * If provided, this logger will be used instead of the global console.
   * The logger must implement the Logger interface.
   * Defaults to globalThis.console if not specified.
   */
  logger?: Logger

  /**
   * Per-module log level overrides.
   *
   * Allows setting different log levels for specific logger names.
   * Supports hierarchical matching (e.g., 'strands.models' affects 'strands.models.bedrock').
   *
   * @example
   * ```typescript
   * \{
   *   level: 'warn',
   *   levels: \{
   *     'strands.models': 'debug',           // All models get debug
   *     'strands.models.openai': 'error'     // OpenAI model gets error (more specific)
   *   \}
   * \}
   * ```
   */
  levels?: Record<string, LogLevel>
}
