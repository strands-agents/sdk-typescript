/**
 * Sandbox-aware code execution tool.
 *
 * Executes source code in a specified language through the agent's sandbox.
 * The sandbox determines where and how the code runs — the model picks
 * the language, writes the code, and gets the result.
 */

import { tool } from '../../tools/tool-factory.js'
import { z } from 'zod'

const codeInterpreterInputSchema = z.object({
  code: z.string().min(1).describe('The source code to execute.'),
  language: z.string().min(1).describe('The language interpreter to use (e.g., python3, node, ruby, bash).'),
  workdir: z
    .string()
    .optional()
    .describe('Working directory for code execution. If not specified, uses the sandbox default.'),
  timeout: z.number().positive().optional().describe('Timeout in seconds.'),
})

/**
 * Sandbox-aware code execution tool.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { codeInterpreter } from '@strands-agents/sdk/vended-tools/code-interpreter'
 *
 * const agent = new Agent({ tools: [codeInterpreter] })
 * await agent.invoke('Write a Python script that calculates the first 10 fibonacci numbers')
 * ```
 */
export const codeInterpreter = tool({
  name: 'codeInterpreter',
  description:
    'Execute source code in a specified language. ' +
    'The code runs in the sandbox via the language interpreter (e.g., python3 -c <code>). ' +
    'Use for computations, data processing, file generation, or any task better expressed as code.',
  inputSchema: codeInterpreterInputSchema,
  callback: async (input, context) => {
    if (!context) {
      throw new Error('Tool context is required')
    }

    const sandbox = context.agent.sandbox
    const result = await sandbox.executeCode(input.code, input.language, {
      timeout: input.timeout,
      cwd: input.workdir,
    })

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.outputFiles.length > 0 && {
        outputFiles: result.outputFiles.map((f) => ({ name: f.name, mimeType: f.mimeType })),
      }),
    }
  },
})
