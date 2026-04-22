/**
 * Type definitions for the sandbox-aware shell tool.
 */

/**
 * Configuration for the shell tool, stored in agent appState.
 *
 * Set via `agent.appState.set('strands_shell_tool', { timeout: 60 })`.
 */
export interface ShellToolConfig {
  /**
   * Default timeout for shell commands in seconds.
   * Overridden by the per-call `timeout` parameter.
   * @defaultValue 120
   */
  timeout?: number
}

/**
 * Internal shell state tracked across calls for session continuity.
 * Stored in agent appState under `_strands_shell_state`.
 */
export interface ShellState {
  /**
   * Last known working directory from the shell session.
   */
  cwd?: string
}
