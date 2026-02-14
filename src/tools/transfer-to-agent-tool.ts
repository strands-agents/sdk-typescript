import { z } from 'zod'
import type { Tool } from './tool.js'
import { tool } from './zod-tool.js'

/**
 * Runtime hooks for transfer tool behavior.
 */
export interface TransferToolRuntime {
  resolveAllowedTargets: () => string[]
  queueTransfer: (targetAgentName: string) => void
}

/**
 * Creates the internal transfer tool used for native sub-agent handoff.
 */
export function createTransferToAgentTool(runtime: TransferToolRuntime): Tool {
  return tool({
    name: 'transfer_to_agent',
    description:
      'Transfer the conversation to another agent when that agent is better suited to answer the request.',
    inputSchema: z.object({
      agentName: z.string().describe('The target agent name.'),
    }),
    callback: ({ agentName }) => {
      const allowedTargets = runtime.resolveAllowedTargets()
      if (!allowedTargets.includes(agentName)) {
        throw new Error(`Agent '${agentName}' is not a valid transfer target`)
      }

      runtime.queueTransfer(agentName)
      return {
        success: true,
        action: 'transfer_to_agent',
        targetAgentName: agentName,
      }
    },
  })
}
