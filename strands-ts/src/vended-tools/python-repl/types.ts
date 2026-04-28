/**
 * Type definitions for the sandbox-aware Python REPL tool.
 */

/**
 * Configuration for the Python REPL tool, stored in agent appState.
 *
 * Set via `agent.appState.set('strands_python_repl_tool', { timeout: 60 })`.
 */
export interface PythonReplToolConfig {
  /**
   * Default timeout for code execution in seconds.
   * Overridden by the per-call `timeout` parameter.
   * @defaultValue 30
   */
  timeout?: number
}
