/**
 * Sandbox-aware Python REPL tool implementation with streaming support.
 *
 * Executes Python code in the agent's sandbox using
 * `sandbox.executeCodeStreaming(code, 'python')`. Each chunk of stdout/stderr
 * is yielded as a `ToolStreamEvent` in real time, allowing UI consumers to
 * display live output from code execution.
 *
 * The tool is an async generator: `StreamChunk` objects from the sandbox
 * are yielded during execution, and the final return value is the formatted
 * result string that becomes the `ToolResult`.
 *
 * Configuration keys (set via `agent.appState.set('strands_python_repl_tool', {...})`):
 * - `timeout` (number): Default timeout in seconds for code execution.
 *   Overridden by the per-call `timeout` parameter. Default: 30.
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

import { tool } from '../../tools/tool-factory.js'
import { z } from 'zod'
import type { ExecutionResult, StreamChunk } from '../../sandbox/base.js'
import type { ToolContext } from '../../tools/tool.js'
import type { PythonReplToolConfig } from './types.js'

/**
 * State key for Python REPL tool configuration in agent.appState.
 */
const STATE_KEY = 'strands_python_repl_tool'

/**
 * State key for internal Python REPL state.
 */
const REPL_STATE_KEY = '_strands_python_repl_state'

/**
 * Default timeout for code execution (seconds).
 */
const DEFAULT_TIMEOUT = 30

/**
 * Zod schema for Python REPL input validation.
 */
const pythonReplInputSchema = z.object({
  code: z.string().describe('The Python code to execute'),
  timeout: z.number().positive().optional().describe('Maximum execution time in seconds (default: 30)'),
  reset: z.boolean().optional().describe('If true, signal the sandbox to reset execution state'),
})

/**
 * Sandbox-aware Python REPL tool for executing Python code.
 *
 * Code is executed via the agent's sandbox using
 * `sandbox.executeCodeStreaming(code, 'python')`. Each chunk of stdout/stderr
 * is yielded as a streaming event that UI consumers can display in real time.
 *
 * @example
 * ```typescript
 * import { pythonRepl } from '@strands-agents/sdk/vended-tools/python-repl'
 * import { Agent, HostSandbox } from '@strands-agents/sdk'
 *
 * const agent = new Agent({
 *   tools: [pythonRepl],
 *   sandbox: new HostSandbox({ workingDir: '/tmp/workspace' }),
 * })
 *
 * // Configure timeout via appState
 * agent.appState.set('strands_python_repl_tool', { timeout: 60 })
 *
 * await agent.invoke('Generate a histogram of random numbers')
 * ```
 */
export const pythonRepl = tool({
  name: 'python_repl',
  description:
    "Execute Python code in the agent's sandbox with live output streaming. " +
    'Code runs via sandbox.executeCodeStreaming(). Use reset to clear execution state.',
  inputSchema: pythonReplInputSchema,
  callback: async function* (input, context?: ToolContext) {
    if (!context) {
      throw new Error('Tool context is required for Python REPL operations')
    }

    const config: PythonReplToolConfig = (context.agent.appState.get(STATE_KEY) as PythonReplToolConfig) ?? {}
    const sandbox = context.agent.sandbox

    // Handle reset
    if (input.reset) {
      try {
        context.agent.appState.delete(REPL_STATE_KEY)
      } catch {
        // Ignore if key doesn't exist
      }
      if (!input.code || !input.code.trim()) {
        return 'Python REPL state reset.'
      }
    }

    // Resolve timeout: per-call > config > default
    const effectiveTimeout = input.timeout ?? config.timeout ?? DEFAULT_TIMEOUT

    // Execute via sandbox streaming
    let result: ExecutionResult | undefined
    try {
      for await (const chunk of sandbox.executeCodeStreaming(input.code, 'python', {
        timeout: effectiveTimeout,
      })) {
        if ('streamType' in chunk) {
          // Yield each StreamChunk — the SDK wraps it as ToolStreamEvent
          yield chunk as StreamChunk
        } else if ('exitCode' in chunk) {
          result = chunk as ExecutionResult
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return `Error: Code execution timed out after ${effectiveTimeout} seconds.`
      }
      if (error instanceof Error && error.message.includes('NotImplementedError')) {
        return 'Error: Sandbox does not support code execution (NoOpSandbox).'
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }

    if (!result) {
      return 'Error: Sandbox did not return an execution result.'
    }

    // Format output
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
        output = `Code execution failed with exit code: ${result.exitCode}`
      }
    }

    // Handle output files (images, charts, etc.)
    if (result.outputFiles && result.outputFiles.length > 0) {
      const fileNames = result.outputFiles.map((f) => f.name)
      if (output) {
        output += `\n\nGenerated files: ${fileNames.join(', ')}`
      } else {
        output = `Generated files: ${fileNames.join(', ')}`
      }
    }

    return output || '(no output)'
  },
})
