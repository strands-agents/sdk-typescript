/**
 * Sandbox-aware shell tool for executing commands in the agent's sandbox.
 *
 * @example
 * ```typescript
 * import { shell } from '@strands-agents/sdk/vended-tools/shell'
 * import { Agent } from '@strands-agents/sdk'
 *
 * const agent = new Agent({ tools: [shell] })
 * await agent.invoke('List all files in the current directory')
 * ```
 */

export { shell } from './shell.js'
export type { ShellToolConfig, ShellState } from './types.js'
