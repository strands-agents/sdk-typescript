/**
 * Programmatic Tool Caller — execute JavaScript code that calls the agent's
 * other tools as async functions, mirroring Python's `programmatic_tool_caller`
 * from `strands-agents/tools`.
 *
 * @see {@link https://github.com/strands-agents/tools/pull/387 | Python PR #387}
 */

export { programmaticToolCaller, createProgrammaticToolCaller } from './programmatic-tool-caller.js'
export type { ProgrammaticToolCallerInput, ProgrammaticToolCallerConfig } from './types.js'
export { ALLOWED_EXTRA_MODULES, RESERVED_NAMESPACE_NAMES } from './types.js'
