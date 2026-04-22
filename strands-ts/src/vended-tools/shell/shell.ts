/**
 * Sandbox-aware shell tool implementation with streaming support.
 *
 * Executes shell commands in the agent's sandbox with persistent state tracking.
 * The tool uses `sandbox.executeStreaming()` so that stdout/stderr chunks are
 * yielded as `ToolStreamEvent`s in real time. This allows UI consumers to display
 * live output from sandbox execution.
 *
 * The tool is an async generator: each `StreamChunk` from the sandbox is yielded
 * directly (the SDK wraps it in a `ToolStreamEvent`), and the final return value
 * is the formatted result string (which becomes the `ToolResult`).
 *
 * Configuration keys (set via `agent.appState.set('strands_shell_tool', {...})`):
 * - `timeout` (number): Default timeout in seconds. Overridden by the per-call
 *   `timeout` parameter. Default: 120.
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

import { tool } from '../../tools/tool-factory.js'
import { z } from 'zod'
import type { ExecuteOptions, ExecutionResult, StreamChunk } from '../../sandbox/base.js'
import type { ToolContext } from '../../tools/tool.js'
import type { ShellToolConfig, ShellState } from './types.js'

/**
 * State key for shell tool configuration in agent.appState.
 */
const STATE_KEY = 'strands_shell_tool'

/**
 * State key for internal shell state (e.g., tracked cwd).
 */
const SHELL_STATE_KEY = '_strands_shell_state'

/**
 * Default timeout for shell commands (seconds).
 */
const DEFAULT_TIMEOUT = 120

/**
 * Zod schema for shell tool input validation.
 */
const shellInputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z.number().positive().optional().describe('Maximum execution time in seconds (default: 120)'),
  restart: z.boolean().optional().describe('If true, reset shell state by clearing the tracked working directory'),
})

/**
 * Build ExecuteOptions, only including cwd when it is defined.
 * This satisfies exactOptionalPropertyTypes — we never pass `cwd: undefined`.
 */
function buildOptions(timeout: number, cwd: string | undefined): ExecuteOptions {
  const opts: ExecuteOptions = { timeout }
  if (cwd !== undefined) {
    opts.cwd = cwd
  }
  return opts
}

/**
 * Sandbox-aware shell tool for executing commands in the agent's sandbox.
 *
 * Unlike the legacy `bash` tool that uses `child_process.spawn` directly,
 * this tool delegates to `context.agent.sandbox.executeStreaming()`, making
 * it work transparently with any sandbox implementation (host, Docker, SSH,
 * cloud environments).
 *
 * Commands are streamed in real time — each chunk of stdout/stderr is yielded
 * as a `ToolStreamEvent` that UI consumers can display live.
 *
 * The tool tracks the working directory across calls via agent appState,
 * enabling session continuity (e.g., `cd /tmp` in one call persists to the next).
 *
 * @example
 * ```typescript
 * import { shell } from '@strands-agents/sdk/vended-tools/shell'
 * import { Agent, HostSandbox } from '@strands-agents/sdk'
 *
 * const agent = new Agent({
 *   tools: [shell],
 *   sandbox: new HostSandbox({ workingDir: '/tmp/workspace' }),
 * })
 *
 * // Configure timeout via appState
 * agent.appState.set('strands_shell_tool', { timeout: 60 })
 *
 * await agent.invoke('Run the test suite')
 * ```
 */
export const shell = tool({
  name: 'shell',
  description:
    "Execute a shell command in the agent's sandbox with live output streaming. " +
    'The sandbox preserves working directory across calls. Use restart to reset shell state.',
  inputSchema: shellInputSchema,
  callback: async function* (input, context?: ToolContext) {
    if (!context) {
      throw new Error('Tool context is required for shell operations')
    }

    const config: ShellToolConfig = (context.agent.appState.get(STATE_KEY) as ShellToolConfig) ?? {}
    const sandbox = context.agent.sandbox

    // Handle restart
    if (input.restart) {
      try {
        context.agent.appState.delete(SHELL_STATE_KEY)
      } catch {
        // Ignore if key doesn't exist
      }
      if (!input.command || !input.command.trim()) {
        return 'Shell state reset.'
      }
    }

    // Resolve timeout: per-call > config > default
    const effectiveTimeout = input.timeout ?? config.timeout ?? DEFAULT_TIMEOUT

    // Get tracked working directory from state (for session continuity)
    const shellState: ShellState = (context.agent.appState.get(SHELL_STATE_KEY) as ShellState) ?? {}
    const cwd = shellState.cwd

    // Execute via sandbox streaming
    let result: ExecutionResult | undefined
    try {
      for await (const chunk of sandbox.executeStreaming(input.command, buildOptions(effectiveTimeout, cwd))) {
        if ('streamType' in chunk) {
          // Yield each StreamChunk — the SDK wraps it as ToolStreamEvent
          yield chunk as StreamChunk
        } else if ('exitCode' in chunk) {
          result = chunk as ExecutionResult
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return `Error: Command timed out after ${effectiveTimeout} seconds.`
      }
      if (error instanceof Error && error.message.includes('NotImplementedError')) {
        return 'Error: Sandbox does not support command execution (NoOpSandbox).'
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }

    if (!result) {
      return 'Error: Sandbox did not return an execution result.'
    }

    // Track working directory changes (best-effort)
    try {
      const cwdResult = await sandbox.execute('pwd', buildOptions(5, cwd))
      if (cwdResult.exitCode === 0) {
        const newCwd = cwdResult.stdout.trim()
        if (newCwd) {
          context.agent.appState.set(SHELL_STATE_KEY, { cwd: newCwd })
        }
      }
    } catch {
      // Best-effort cwd tracking
    }

    // Format final output (becomes the ToolResult)
    const outputParts: string[] = []
    if (result.stdout) {
      outputParts.push(result.stdout)
    }
    if (result.stderr) {
      outputParts.push(result.stderr)
    }

    let output = outputParts.join('\n').trimEnd()

    if (result.exitCode !== 0) {
      if (output) {
        output += `\n\nExit code: ${result.exitCode}`
      } else {
        output = `Command failed with exit code: ${result.exitCode}`
      }
    }

    return output || '(no output)'
  },
})
