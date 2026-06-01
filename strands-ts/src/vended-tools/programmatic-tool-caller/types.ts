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
 * Configuration for {@link createProgrammaticToolCaller}.
 *
 * All options are optional. Configuration supplied here takes precedence over
 * the corresponding environment variables, which are consulted only as a
 * Node.js fallback (and are ignored entirely in the browser, where `process`
 * is undefined). Passing config explicitly is the recommended, browser-safe
 * pattern — it mirrors how the other vended tools accept their options.
 */
export interface ProgrammaticToolCallerConfig {
  /**
   * Allow-list of tool names the generated code may call. When omitted, every
   * registered tool except `programmatic_tool_caller` is exposed.
   *
   * Falls back to the `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS` env var
   * (comma-separated) when unset and running under Node.js.
   */
  allowedTools?: string[]

  /**
   * Node.js built-in modules to expose inside the code, drawn from
   * {@link ALLOWED_EXTRA_MODULES}. Names with non-identifier characters are
   * normalized (`fs/promises` → `fs_promises`).
   *
   * Falls back to the `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` env var
   * (comma-separated) when unset and running under Node.js.
   */
  extraModules?: string[]
}

/**
 * Allow-list of Node.js built-in modules that may be exposed via the
 * {@link ProgrammaticToolCallerConfig.extraModules} option or the
 * `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` environment variable.
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
 * Additionally reserved: any module name actually injected via the
 * {@link ProgrammaticToolCallerConfig.extraModules} option or
 * `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` (computed at runtime).
 */
export const RESERVED_NAMESPACE_NAMES: ReadonlySet<string> = new Set(['console'])
