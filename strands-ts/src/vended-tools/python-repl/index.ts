/**
 * Sandbox-aware Python REPL tool for executing Python code.
 *
 * @example
 * ```typescript
 * import { pythonRepl } from '@strands-agents/sdk/vended-tools/python-repl'
 * import { Agent } from '@strands-agents/sdk'
 *
 * const agent = new Agent({ tools: [pythonRepl] })
 * await agent.invoke('Calculate the first 10 Fibonacci numbers')
 * ```
 */

export { pythonRepl } from './python-repl.js'
export type { PythonReplToolConfig } from './types.js'
