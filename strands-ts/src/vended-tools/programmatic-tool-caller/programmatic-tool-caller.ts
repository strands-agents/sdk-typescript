import { z } from 'zod'
// Snapshot `inspect` at module load to immunize the capture console against
// runtime mutation of the shared `util` namespace (e.g. when a user enables
// `util` via extra modules and reassigns `util.inspect`).
import { inspect as utilInspect } from 'util'
import { tool } from '../../tools/tool-factory.js'
import { logger } from '../../logging/logger.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'
import type { JSONValue } from '../../types/json.js'
import type { InvokableTool } from '../../tools/tool.js'
import type { Tool } from '../../tools/tool.js'
import type { Agent } from '../../agent/agent.js'
import { ALLOWED_EXTRA_MODULES, RESERVED_NAMESPACE_NAMES } from './types.js'
import type { ProgrammaticToolCallerConfig } from './types.js'

/**
 * Zod schema for programmatic_tool_caller input validation.
 */
const programmaticToolCallerInputSchema = z.object({
  code: z
    .string()
    .describe(
      'JavaScript source to execute. Wrapped in `(async () => { ... })()` so top-level `await` is supported. Tools are exposed as async functions; use `await myTool({ ... })` to call them.'
    ),
})

/**
 * Long-form tool description shown to the model. Mirrors the level of detail of
 * the Python `programmatic_tool_caller` docstring so the model understands how
 * to drive the tool, how output is captured, and what the calling conventions
 * are. Kept as a module constant for readability and single-sourcing.
 */
const PROGRAMMATIC_TOOL_CALLER_DESCRIPTION = [
  "Execute JavaScript code that calls the agent's other tools as async functions, instead of",
  'issuing one model round-trip per tool call. Ideal for loops, parallel fan-out, and',
  '"call N tools then aggregate" patterns.',
  '',
  'Calling tools:',
  '- Every registered tool is exposed as an async function under its underscore-normalized',
  '  name (`my-tool` -> `my_tool`); the original name is also bound when it is a valid JS',
  '  identifier. Call them with a single options object: `await my_tool({ arg: 1 })`.',
  '- A successful all-text tool result is returned as a string; an errored result throws,',
  '  so ordinary `try/catch` works. Mixed/binary results are returned as the raw content array.',
  '- Inner tool calls are NOT recorded in the conversation history; only this single',
  '  programmatic_tool_caller call is.',
  '',
  'Top-level `await` is supported (the code runs as the body of an async function), so you can',
  'use `await`, `Promise.all([...])`, `for`/`while` loops, and ordinary control flow directly.',
  '',
  'Output capture: anything written via `console.log/info/warn/error/debug/trace` is captured',
  "and returned as the tool result text (non-string values are formatted like Node's console).",
  'Code that produces no console output returns "(no output)". The function\'s return value is',
  'ignored — surface results with `console.log(...)`.',
  '',
  'Examples:',
  '  // Sequential',
  "  const a = await calculator({ expression: '1 + 1' })",
  "  const b = await calculator({ expression: '2 + 2' })",
  "  console.log('a:', a, 'b:', b)",
  '',
  '  // Parallel fan-out',
  "  const [x, y] = await Promise.all([search({ query: 'foo' }), search({ query: 'bar' })])",
  '  console.log(x, y)',
  '',
  '  // Loop and aggregate',
  '  let total = 0',
  '  for (let i = 1; i <= 5; i++) total += Number(await calculator({ expression: `${i} * ${i}` }))',
  "  console.log('sum of squares =', total)",
].join('\n')

/**
 * Identifier pattern for valid (non-quoted) JavaScript identifiers — used to
 * decide whether the original (hyphenated) tool name can be exposed as an
 * additional binding alongside its underscore-normalized form.
 */
const VALID_JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * JavaScript reserved words and contextual keywords that cannot be used as
 * `AsyncFunction` parameter names. Using one as a parameter would cause
 * `new AsyncFunction(...)` to throw a SyntaxError on every execution,
 * affecting unrelated user code. Detected up-front so the offending tool
 * is skipped with a warning instead of breaking the whole tool.
 *
 * Source: ECMAScript reserved words (strict mode) + module-context reserved
 * (`await`) + `arguments` (illegal as a parameter name in strict mode, which
 * is the default for any function created via `new AsyncFunction`).
 */
const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

/**
 * Read an environment variable in a way that is safe in non-Node runtimes.
 *
 * In the browser `process` is undefined, so a bare `process.env.X` reference
 * throws `ReferenceError`. This helper returns `undefined` whenever `process`
 * or `process.env` is unavailable, letting the tool degrade gracefully to its
 * config-object / default behaviour outside Node.
 *
 * @param name - Environment variable name
 * @returns The trimmed value, or `undefined` when unset/unavailable
 */
function readEnv(name: string): string | undefined {
  const env = typeof process !== 'undefined' ? process.env : undefined
  const value = env?.[name]
  return value === undefined ? undefined : value.trim()
}

/**
 * Parse a comma-separated environment variable into a trimmed, non-empty list.
 *
 * @param name - Environment variable name
 * @returns The parsed list, or `undefined` when the variable is unset
 */
function parseCsvEnv(name: string): string[] | undefined {
  const raw = readEnv(name)
  if (raw === undefined || raw.length === 0) {
    return undefined
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Normalize a module name into a valid JavaScript identifier suitable for use
 * as an `AsyncFunction` parameter name. Non-identifier characters (e.g. `/`
 * in `fs/promises`) are replaced with `_`. This mirrors how the namespace
 * binding will be visible inside the user's code (e.g. `fs/promises`
 * imports become `fs_promises` bindings).
 *
 * Required because `new AsyncFunction(...names, code)` rejects parameter
 * names that aren't valid JS identifiers — `fs/promises` would raise
 * `SyntaxError: Arg string terminates parameters early`.
 */
function moduleNameToIdentifier(name: string): string {
  return name.replace(/[^A-Za-z0-9_$]/g, '_')
}

/**
 * Resolve the effective allow-list of tool names exposed to the user code.
 *
 * Precedence: `config.allowedTools` (explicit), then
 * `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS` env (Node fallback), then
 * all registered tools. The `programmatic_tool_caller` tool itself is always
 * excluded.
 *
 * @param allTools - All registered tools in the agent's tool registry
 * @param config - Effective tool configuration
 * @returns Set of tool names eligible for namespace injection
 */
function getAllowedTools(allTools: Tool[], config: ProgrammaticToolCallerConfig): Set<string> {
  const registered = new Set(allTools.map((t) => t.name).filter((n) => n !== 'programmatic_tool_caller'))

  const allowList = config.allowedTools ?? parseCsvEnv('PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS')
  if (allowList === undefined) {
    return registered
  }

  return new Set([...registered].filter((name) => allowList.includes(name)))
}

/**
 * Resolve the effective list of extra Node built-in modules to expose and load
 * them, returning a {@link Record} of normalized-name → module bindings.
 *
 * Precedence: `config.extraModules` (explicit), then
 * `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` env (Node fallback), then none.
 * Modules outside {@link ALLOWED_EXTRA_MODULES} are skipped with a warning,
 * mirroring the Python tool's `importlib.import_module` failure path.
 *
 * @param config - Effective tool configuration
 * @returns Map of normalized module name → loaded module
 */
async function loadExtraModules(config: ProgrammaticToolCallerConfig): Promise<Record<string, unknown>> {
  const requested = config.extraModules ?? parseCsvEnv('PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES') ?? []
  if (requested.length === 0) {
    return {}
  }

  const result: Record<string, unknown> = {}
  for (const name of requested) {
    if (!ALLOWED_EXTRA_MODULES.has(name)) {
      logger.warn(`module=<${name}> | extra module not in allow-list, skipping`)
      continue
    }
    try {
      // Dynamic import works for Node.js built-ins under both ESM and CJS.

      const mod = (await import(name)) as { default?: unknown } & Record<string, unknown>
      // ESM dynamic import of a CJS Node built-in returns a namespace whose
      // `default` is the module's primary export. Prefer it when present,
      // mirroring the developer expectation of `require('fs')`.
      const identifier = moduleNameToIdentifier(name)
      result[identifier] = 'default' in mod && mod.default !== undefined ? mod.default : mod
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(`module=<${name}>, error=<${message}> | failed to import extra module, skipping`)
    }
  }

  return result
}

/**
 * Build a console-like object that captures `.log()`, `.error()`, `.warn()`,
 * and `.info()` writes into a string buffer. Non-string values are coerced
 * via {@link util.inspect} (matching Node's own console formatting).
 *
 * The captured object also exposes `.debug()`, `.trace()`, and `.dir()` for
 * convenience — they all route to the same buffer with no special formatting.
 * Output is _never_ forwarded to the real stdout/stderr (test isolation).
 *
 * @returns A `{ console, getBuffer }` pair
 */
function createCaptureConsole(): { console: Record<string, (...args: unknown[]) => void>; getBuffer: () => string } {
  const lines: string[] = []

  const append = (args: unknown[]): void => {
    const formatted = args
      .map((a) => (typeof a === 'string' ? a : utilInspect(a, { depth: null, breakLength: Infinity })))
      .join(' ')
    lines.push(formatted)
  }

  const captureConsole: Record<string, (...args: unknown[]) => void> = {
    log: (...args: unknown[]) => append(args),
    info: (...args: unknown[]) => append(args),
    warn: (...args: unknown[]) => append(args),
    error: (...args: unknown[]) => append(args),
    debug: (...args: unknown[]) => append(args),
    trace: (...args: unknown[]) => append(args),
    dir: (obj: unknown) => append([obj]),
  }

  return {
    console: captureConsole,
    getBuffer: () => lines.join('\n'),
  }
}

/**
 * Auto-unwrap a {@link ToolResultBlock} into a value that user code can
 * naturally consume.
 *
 * - `status === 'error'` ➜ throw `Error(text)` so user `try/catch` works.
 * - `status === 'success'` with text-only content ➜ return `text` joined by `\n`.
 * - Mixed/non-text content ➜ return the raw `content` array unchanged.
 * - Empty content ➜ return empty string.
 *
 * Mirrors Python's `_execute_tool` semantics.
 *
 * @param result - The tool result block to unwrap
 * @returns The unwrapped value
 */
function unwrapToolResult(result: ToolResultBlock): unknown {
  const content = result.content ?? []

  if (result.status === 'error') {
    const errBlock = content.find((b) => b instanceof TextBlock) as TextBlock | undefined
    const errText = errBlock?.text ?? 'Unknown error'
    throw new Error(errText)
  }

  if (content.length === 0) {
    return ''
  }

  const allText = content.every((b) => b instanceof TextBlock)
  if (allText) {
    return (content as TextBlock[]).map((b) => b.text).join('\n')
  }

  return content
}

/**
 * Build the namespace bindings injected into the user-supplied async function.
 *
 * Returns a map of `name → value` for every binding that should be visible
 * inside the user code. Throws if any allowed tool name conflicts with a
 * reserved name (`console`, or any extra module actually injected).
 *
 * Each tool function is async and:
 * 1. Resolves the tool via `agent.toolRegistry.resolve(...)` (so `_` ↔ `-`
 *    aliases work, matching the rest of the SDK).
 * 2. Calls `agent.tool[resolvedName].invoke(input, { recordDirectToolCall: false })`.
 * 3. Auto-unwraps the {@link ToolResultBlock} via {@link unwrapToolResult}.
 *
 * @param agent - The agent providing the tool registry and `agent.tool` proxy
 * @param allowedToolNames - The names of tools that should be exposed
 * @param extraModules - Extra modules to inject under their original names
 * @returns A map of binding name → value
 * @throws If a tool name conflicts with a reserved namespace identifier
 */
function buildNamespace(
  agent: Agent,
  allowedToolNames: Set<string>,
  extraModules: Record<string, unknown>
): Record<string, unknown> {
  const namespace: Record<string, unknown> = {}

  // Compute the full set of reserved names (built-in + injected modules).
  const reservedNames = new Set<string>(RESERVED_NAMESPACE_NAMES)
  for (const name of Object.keys(extraModules)) {
    reservedNames.add(name)
  }

  // Detect conflicts BEFORE injecting anything so the error message can
  // enumerate every clashing tool in one go.
  const conflicts: string[] = []
  for (const toolName of allowedToolNames) {
    const underscoreName = toolName.replaceAll('-', '_')
    if (reservedNames.has(toolName) || reservedNames.has(underscoreName)) {
      conflicts.push(toolName)
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Tool name(s) ${JSON.stringify(conflicts.sort())} conflict with reserved namespace entries. ` +
        `Reserved names: ${JSON.stringify([...reservedNames].sort())}. ` +
        `Rename the tool(s) or exclude them via the allowedTools config (or PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS).`
    )
  }

  // Inject extra modules first so a (hypothetical) tool with a conflicting
  // name has already been rejected above.
  for (const [name, mod] of Object.entries(extraModules)) {
    namespace[name] = mod
  }

  // Inject one async function per allowed tool. We bind to the underscore-
  // normalized name (always a valid JS identifier) and additionally bind the
  // original name when it is a valid identifier on its own (e.g. names with
  // hyphens are exposed only via the underscore alias).
  for (const toolName of allowedToolNames) {
    const underscoreName = toolName.replaceAll('-', '_')

    // The underscore-normalized name is the canonical binding inside the
    // namespace. If it is not a valid JS identifier (e.g. tool name starts
    // with a digit, or matches a JS reserved word like `return`), the
    // `new AsyncFunction(...)` call below would throw a SyntaxError that
    // poisons EVERY execution — even code that doesn't reference this tool.
    // Skip with a warning instead so unrelated tools keep working.
    if (!VALID_JS_IDENTIFIER.test(underscoreName) || JS_RESERVED_WORDS.has(underscoreName)) {
      logger.warn(
        `tool=<${toolName}> | name is not a valid JS identifier (or is a reserved word) ` +
          `after underscore normalization (<${underscoreName}>); skipping namespace injection`
      )
      continue
    }

    const wrapper = createToolFunction(agent, toolName)
    namespace[underscoreName] = wrapper
    if (toolName !== underscoreName && VALID_JS_IDENTIFIER.test(toolName) && !JS_RESERVED_WORDS.has(toolName)) {
      namespace[toolName] = wrapper
    }
  }

  return namespace
}

/**
 * Create the async wrapper exposed inside the user's code for one tool.
 *
 * @param agent - The agent providing the tool caller proxy
 * @param toolName - The canonical (registry) name of the tool to wrap
 * @returns An async function suitable for namespace injection
 */
function createToolFunction(agent: Agent, toolName: string): (input?: Record<string, unknown>) => Promise<unknown> {
  return async (input?: Record<string, unknown>): Promise<unknown> => {
    const resolvedName = agent.toolRegistry.resolve(toolName).name
    const handle = agent.tool[resolvedName]
    if (!handle) {
      throw new Error(`Tool '${toolName}' not found in registry`)
    }
    const result = await handle.invoke((input ?? {}) as JSONValue, {
      recordDirectToolCall: false,
    })
    return unwrapToolResult(result)
  }
}

/**
 * Internal entry point — extracted from the `tool({...})` factory to keep
 * the callback small and to make the implementation directly unit-testable.
 *
 * @param code - JavaScript source to execute
 * @param agent - The agent whose tools are exposed
 * @param toolUseId - The tool-use ID for the returned {@link ToolResultBlock}
 * @param config - Effective tool configuration
 * @returns A {@link ToolResultBlock} carrying the captured console output
 *          on success, or a stack trace on error
 */
async function executeProgrammaticCode(
  code: string,
  agent: Agent,
  toolUseId: string,
  config: ProgrammaticToolCallerConfig
): Promise<ToolResultBlock> {
  let extraModules: Record<string, unknown> = {}
  let namespace: Record<string, unknown> = {}
  try {
    extraModules = await loadExtraModules(config)
    const allowedToolNames = getAllowedTools(agent.toolRegistry.list(), config)
    namespace = buildNamespace(agent, allowedToolNames, extraModules)
  } catch (err) {
    return errorResult(err, toolUseId)
  }

  // Set up the capture console — overrides any `console` an extra module
  // might (theoretically) have shadowed (Node built-ins don't).
  const { console: captureConsole, getBuffer } = createCaptureConsole()
  namespace.console = captureConsole

  // Compile + execute the user code as the body of an async function whose
  // parameters are the namespace bindings. This is the JS equivalent of the
  // Python `exec(compiled, namespace)` + `asyncio.run(__user_code__())` flow.
  // `new AsyncFunction(...)` is preferable to `eval` because it scopes the
  // bindings cleanly and surfaces SyntaxError up front rather than at runtime.
  const names = Object.keys(namespace)
  const values = names.map((n) => namespace[n])

  // Pull the AsyncFunction constructor off an `async function` instance.
  // It is not exposed as a global, so this is the canonical retrieval path.
  // The signature is the same as `Function`: variadic string arg names
  // followed by a final string body.
  type AsyncFunctionConstructor = new (...args: string[]) => (...args: unknown[]) => Promise<void>
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor

  let userFn: (...args: unknown[]) => Promise<void>
  try {
    // The body wraps the user code in a no-op IIFE-style block, allowing
    // bare top-level `return` and `break`/`continue` validation to behave
    // as inside a normal function body.
    userFn = new AsyncFunction(...names, code)
  } catch (err) {
    // SyntaxError lands here (compile-time).
    return errorResult(err, toolUseId)
  }

  try {
    await userFn(...values)
  } catch (err) {
    // Runtime errors land here.
    return errorResult(err, toolUseId)
  }

  const captured = getBuffer()
  const text = captured.length > 0 ? captured : '(no output)'

  return new ToolResultBlock({
    toolUseId,
    status: 'success',
    content: [new TextBlock(text)],
  })
}

/**
 * Build an error {@link ToolResultBlock} with a descriptive message and stack.
 *
 * @param err - The thrown value (Error or otherwise)
 * @param toolUseId - The tool-use ID for the returned block
 * @returns An error-status ToolResultBlock
 */
function errorResult(err: unknown, toolUseId: string): ToolResultBlock {
  const errorObj = err instanceof Error ? err : new Error(String(err))
  const stack = errorObj.stack ?? `${errorObj.name}: ${errorObj.message}`
  const text = `Execution error:\n${stack}`
  return new ToolResultBlock({
    toolUseId,
    status: 'error',
    content: [new TextBlock(text)],
    error: errorObj,
  })
}

/**
 * Runtime type guard: does this agent expose the `agent.tool` direct-tool-call
 * proxy? Always true for instances of {@link Agent}, but the public
 * `LocalAgent` interface (the type of `ToolContext.agent`) does not declare
 * the proxy, so we narrow with this predicate before reaching for it.
 */
function hasToolProxy(agent: unknown): agent is Agent {
  return (
    typeof agent === 'object' &&
    agent !== null &&
    'tool' in agent &&
    typeof (agent as Agent).tool === 'object' &&
    (agent as Agent).tool !== null
  )
}

/**
 * Create a `programmatic_tool_caller` tool bound to the supplied configuration.
 *
 * The returned tool executes model-authored JavaScript with the agent's other
 * tools exposed as async functions, mirroring Python's `programmatic_tool_caller`
 * from `strands-agents/tools` (PR #387).
 *
 * Top-level `await` is supported: the user code runs as the body of an
 * `AsyncFunction`. Each registered tool is exposed as an async function under
 * its underscore-normalized name (and, when a valid JS identifier, its
 * original name as well). Tool calls bypass the model loop and do _not_
 * mutate `agent.messages` (`recordDirectToolCall: false`).
 *
 * Output is captured by overriding `console.{log,info,warn,error,debug,trace,dir}`
 * inside the function scope. Real stdout/stderr are never written to.
 *
 * Configuration precedence is **config object, then environment variable, then default**.
 * Passing a config object is the recommended, browser-safe pattern; the env-var
 * fallback is consulted only under Node.js (it is ignored where `process` is
 * undefined).
 *
 * ## Human-in-the-loop / consent
 *
 * This tool intentionally has no internal confirmation prompt or
 * `BYPASS_TOOL_CONSENT` switch. Like every tool in the TS SDK, gating its
 * execution is the job of an {@link InterventionHandler}: implement
 * `beforeToolCall` and return `confirm(...)` / `deny(...)` to require approval
 * for `programmatic_tool_caller` (or any tool). This keeps the consent policy
 * in one composable place rather than baked into each tool.
 *
 * @param config - Optional allow-list / extra-module configuration
 * @returns An {@link InvokableTool} named `programmatic_tool_caller`
 *
 * @example
 * ```typescript
 * const ptc = createProgrammaticToolCaller({ allowedTools: ['calculator'] })
 * const agent = new Agent({ model, tools: [ptc, calculator] })
 * ```
 *
 * @see {@link https://github.com/strands-agents/tools/pull/387 | Python PR #387}
 */
export function createProgrammaticToolCaller(
  config: ProgrammaticToolCallerConfig = {}
): InvokableTool<{ code: string }, JSONValue> {
  return tool({
    name: 'programmatic_tool_caller',
    description: PROGRAMMATIC_TOOL_CALLER_DESCRIPTION,
    inputSchema: programmaticToolCallerInputSchema,
    callback: async (input, context) => {
      if (!context) {
        throw new Error('Tool context is required for programmatic_tool_caller')
      }

      // The Agent class implements LocalAgent and additionally exposes the
      // `tool` proxy. Direct tool calls require this surface, so we narrow
      // `context.agent` (typed as LocalAgent) to `Agent` via a runtime guard
      // rather than an unchecked double cast.
      if (!hasToolProxy(context.agent)) {
        throw new Error(
          'programmatic_tool_caller requires an agent that exposes the `agent.tool` proxy ' +
            '(see https://github.com/strands-agents/sdk-typescript/pull/985)'
        )
      }
      const agent = context.agent

      const result = await executeProgrammaticCode(input.code, agent, context.toolUse.toolUseId, config)

      // Convert the ToolResultBlock back to its data form so the surrounding
      // FunctionTool wrapper can re-wrap it. The factory ultimately produces
      // its own ToolResultBlock; here we propagate `status` and `content`
      // through `toJSON()` while preserving the `error` field.
      if (result.status === 'error') {
        // Re-throwing surfaces as an error ToolResultBlock with the original
        // message, but we want the captured stack trace. Returning the raw
        // `toolResult` payload keeps the formatted stack intact.
        const textBlock = result.content[0] as TextBlock | undefined
        const message = textBlock?.text ?? 'Execution error'
        const err = result.error ?? new Error(message)
        // Attach the formatted message so FunctionTool's createErrorResult
        // surfaces the full preview (caller sees stack trace in tool result).
        err.message = message
        throw err
      }

      const textBlock = result.content[0] as TextBlock
      return textBlock.text
    },
  })
}

/**
 * Default `programmatic_tool_caller` tool instance (no explicit config — uses
 * environment-variable fallbacks under Node, and exposes every registered
 * tool otherwise). Drop this directly into `new Agent({ tools: [...] })`.
 *
 * Use {@link createProgrammaticToolCaller} when you need to pin the allow-list
 * or extra modules in code (the browser-safe path).
 */
export const programmaticToolCaller = createProgrammaticToolCaller()
