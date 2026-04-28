/**
 * Type definitions for the sandbox-aware editor tool.
 */

/**
 * Configuration for the editor tool, stored in agent appState.
 *
 * Set via `agent.appState.set('strands_editor_tool', { maxFileSize: 2097152 })`.
 */
export interface EditorToolConfig {
  /**
   * Maximum file size in bytes for read operations.
   * @defaultValue 1048576 (1 MB)
   */
  maxFileSize?: number

  /**
   * When true, rejects relative paths and paths containing `..`.
   * When false, paths are passed through to the sandbox without validation.
   * @defaultValue false
   */
  requireAbsolutePaths?: boolean
}
