/**
 * Sandbox-aware command execution tool.
 *
 * Runs shell commands in the agent's sandbox. The sandbox determines
 * where and how the command executes — locally, in a Docker container,
 * in a cloud runtime, etc. The tool doesn't care; it delegates to
 * `context.agent.sandbox.execute()`.
 */

import { tool } from '../../tools/tool-factory.js'
import { z } from 'zod'

const execInputSchema = z.object({
  command: z.string().min(1).describe('The shell command to execute.'),
  workdir: z
    .string()
    .optional()
    .describe('Working directory to run the command in. If not specified, uses the sandbox default.'),
  timeout: z.number().positive().optional().describe('Timeout in seconds.'),
})

/**
 * Sandbox-aware command execution tool.
 *
 * Runs shell commands in the agent's configured sandbox. Use `workdir`
 * to execute in a specific directory — equivalent to `cd <workdir> && <command>`.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { exec } from '@strands-agents/sdk/vended-tools/exec'
 *
 * const agent = new Agent({ tools: [exec] })
 * await agent.invoke('List all files in /tmp')
 * ```
 */
export const exec = tool({
  name: 'exec',
  description:
    'Execute a shell command in the sandbox. ' +
    'Use workdir to run in a specific directory. ' +
    'Commands run in a fresh process each time — use workdir instead of cd.',
  inputSchema: execInputSchema,
  callback: async (input, context) => {
    if (!context) {
      throw new Error('Tool context is required')
    }

    const sandbox = context.agent.sandbox
    const result = await sandbox.execute(input.command, { timeout: input.timeout, cwd: input.workdir })

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  },
})
