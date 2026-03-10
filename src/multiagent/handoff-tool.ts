/**
 * Handoff tool for swarm-style agent coordination.
 *
 * Provides a `handoff_to_agent` tool that agents can call to transfer
 * control to another agent. This is an alternative to the Swarm's default
 * structured-output routing — use it when you want agents to explicitly
 * decide handoffs via tool calls rather than structured output.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { createHandoffTool } from '@strands-agents/sdk/multiagent'
 *
 * const agents = new Map([
 *   ['researcher', new Agent({ agentId: 'researcher', ... })],
 *   ['writer', new Agent({ agentId: 'writer', ... })],
 * ])
 *
 * const handoff = createHandoffTool({ agents })
 *
 * // Add to each agent's tools
 * for (const agent of agents.values()) {
 *   agent.toolRegistry.add(handoff)
 * }
 * ```
 */

import { z } from 'zod'
import { tool } from '../tools/zod-tool.js'
import type { Agent } from '../agent/agent.js'

import type { InvokableTool } from '../tools/tool.js'
import type { JSONValue } from '../types/json.js'

/**
 * Options for creating a handoff tool.
 */
export interface HandoffToolOptions {
  /** Map of agent ID → Agent instance. The tool validates targets against these keys. */
  agents: ReadonlyMap<string, Agent>
  /** Called when a handoff is requested. Use this to wire into your orchestration loop. */
  onHandoff: (handoff: HandoffRequest) => void
}

/**
 * A handoff request produced by the tool.
 */
export interface HandoffRequest {
  /** Target agent ID. */
  targetAgent: string
  /** Reason for the handoff. */
  reason: string
  /** Optional structured context to pass to the target. */
  context?: Record<string, unknown>
}

/**
 * Creates a `handoff_to_agent` tool for agent-to-agent coordination.
 *
 * The tool validates that the target agent exists and invokes the
 * `onHandoff` callback so the orchestrator can act on it.
 */
export function createHandoffTool(
  options: HandoffToolOptions
): InvokableTool<{ agent_name: string; reason: string; context?: Record<string, unknown> }, JSONValue> {
  const { agents, onHandoff } = options
  const agentIds = [...agents.keys()]

  return tool({
    name: 'handoff_to_agent',
    description: `Transfer control to another agent. Available agents: ${agentIds.join(', ')}`,
    inputSchema: z.object({
      agent_name: z.string().describe('Name of the agent to hand off to'),
      reason: z.string().describe('Why you are handing off'),
      context: z.record(z.string(), z.unknown()).optional().describe('Additional context to share'),
    }),
    callback({ agent_name, reason, context }) {
      if (!agents.has(agent_name)) {
        return {
          status: 'error',
          message: `Agent '${agent_name}' not found. Available: ${agentIds.join(', ')}`,
        }
      }

      const request: HandoffRequest = { targetAgent: agent_name, reason }
      if (context) request.context = context as Record<string, unknown>

      onHandoff(request)

      return {
        status: 'success',
        message: `Handing off to ${agent_name}: ${reason}`,
      }
    },
  })
}
