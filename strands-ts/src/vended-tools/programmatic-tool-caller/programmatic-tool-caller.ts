import { z } from 'zod'
import * as util from 'util'
import { tool } from '../../tools/tool-factory.js'
import { logger } from '../../logging/logger.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'
import type { JSONValue } from '../../types/json.js'
import type { Tool } from '../../tools/tool.js'
import type { Agent } from '../../agent/agent.js'
import { ALLOWED_EXTRA_MODULES, RESERVED_NAMESPACE_NAMES } from './types.js'

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
 * Identifier pattern for valid (non-quoted) JavaScript identifiers — used to
 * decide whether the original (hyphenated) tool name can be exposed as an
 * additional binding alongside its underscore-normalized form.
 */
const VALID_JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Reads `PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS` and returns the resolved
 * allow-list of tool names actually present in the registry, with the
 * `programmatic_tool_caller` tool itself always excluded.
 *
 * @param allTools - All registered tools in the agent's tool registry
 * @returns Set of tool names eligible for namespace injection
 */
function getAllowedTools(allTools: Tool[]): Set<string> {
  const registered = new Set(allTools.map((t) => t.name).filter((n) => n !== 'programmatic_tool_caller'))

  const envAllowed = (process.env.PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS ?? '').trim()
  if (!envAllowed) {
    return registered
  }

  const allowList = envAllowed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  return new Set([...registered].filter((name) => allowList.includes(name)))
}

/**
 * Resolves `PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES` against the
 * {@link ALLOWED_EXTRA_MODULES} allow-list and returns the resulting
 * {@link Record} of `name → module` bindings.
 *
 * Modules outside the allow-list are skipped with a warning, mirroring
 * the Python tool's `importlib.import_module` failure path.
 *
 * @returns Map of module name → loaded module
 */
async function loadExtraModules(): Promise<Record<string, unknown>> {
  const envExtras = (process.env.PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES ?? '').trim()
  if (!envExtras) {
    return {}
  }

  const requested = envExtras
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

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
      result[name] = 'default' in mod && mod.default !== undefined ? mod.default : mod
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
      .map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: null, breakLength: Infinity })))
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
        `Rename the tool(s) or exclude them via PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS.`
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
    const wrapper = createToolFunction(agent, toolName)
    const underscoreName = toolName.replaceAll('-', '_')

    namespace[underscoreName] = wrapper
    if (toolName !== underscoreName && VALID_JS_IDENTIFIER.test(toolName)) {
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
 * @returns A {@link ToolResultBlock} carrying the captured console output
 *          on success, or a stack trace on error
 */
async function executeProgrammaticCode(code: string, agent: Agent, toolUseId: string): Promise<ToolResultBlock> {
  // Friendly warning when consent is implicitly granted. The TS SDK does
  // not have a vended-tool-level interactive prompt helper (see bash.ts —
  // it also runs without user confirmation), so we follow the same
  // permissive behaviour and simply log a single warning line.
  const bypassConsent = (process.env.BYPASS_TOOL_CONSENT ?? '').toLowerCase() === 'true'
  if (!bypassConsent) {
    const preview = code.length > 200 ? `${code.slice(0, 200)}…` : code
    logger.warn(`code_preview=<${JSON.stringify(preview)}> | programmatic_tool_caller executing without confirmation`)
  }

  let extraModules: Record<string, unknown> = {}
  let namespace: Record<string, unknown> = {}
  try {
    extraModules = await loadExtraModules()
    const allowedToolNames = getAllowedTools(agent.toolRegistry.list())
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
 * Programmatic Tool Caller — execute JavaScript source with access to the
 * agent's other tools as async functions, mirroring Python's
 * `programmatic_tool_caller` from `strands-agents/tools` (PR #387).
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
 * @example
 * ```typescript
 * const agent = new Agent({ tools: [calculator, programmaticToolCaller] })
 * const result = await agent.tool.programmatic_tool_caller!.invoke({
 *   code: `
 *     const a = await calculator({ expression: '1 + 1' })
 *     const b = await calculator({ expression: '2 + 2' })
 *     console.log('a:', a, 'b:', b)
 *   `,
 * })
 * ```
 *
 * @see {@link https://github.com/strands-agents/tools/pull/387 | Python PR #387}
 */
export const programmaticToolCaller = tool({
  name: 'programmatic_tool_caller',
  description:
    "Execute JavaScript code with access to the agent's other tools as async functions. " +
    'Top-level `await` is supported. Use `await toolName({ ...input })` to invoke tools. ' +
    'Captured `console.log/info/warn/error` output is returned as the tool result text.',
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

    const result = await executeProgrammaticCode(input.code, agent, context.toolUse.toolUseId)

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
