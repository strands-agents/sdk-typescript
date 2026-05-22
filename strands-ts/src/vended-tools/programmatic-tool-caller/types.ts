/**
 * Type definitions for the programmatic_tool_caller tool.
 */

/**
 * Input parameters for the programmatic_tool_caller tool.
 */
export interface ProgrammaticToolCallerInput {
  /**
   * JavaScript source to execute. The code is wrapped in
   * `(async () => { <code> })()` so top-level `await` is supported.
   */
  code: string
}

/**
 * Allow-list of Node.js built-in modules that may be exposed via
 * the `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` environment variable.
 *
 * These are the only modules the tool will resolve. Any module name
 * outside this list is logged and skipped — the namespace will simply
 * not contain that binding, mirroring the Python tool's
 * `importlib.import_module` failure path.
 */
export const ALLOWED_EXTRA_MODULES: ReadonlySet<string> = new Set([
  'fs',
  'fs/promises',
  'path',
  'crypto',
  'url',
  'util',
  'querystring',
  'os',
  'buffer',
  'stream',
  'events',
])

/**
 * Reserved namespace identifiers that no tool name may shadow.
 *
 * Always reserved: `console` (built-in capture buffer).
 * Additionally reserved: any module name actually injected via
 * `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` (computed at runtime).
 */
export const RESERVED_NAMESPACE_NAMES: ReadonlySet<string> = new Set(['console'])
