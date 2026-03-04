import type { InvokeArgs } from './agent.js'
import type { AgentResult, AgentStreamEvent } from '../types/agent.js'

/**
 * Interface defining the minimal contract for all agent types.
 *
 * Mirrors the Python SDK's `AgentBase` Protocol, adapted to TypeScript patterns.
 * Both `Agent` (full orchestration agent) and `A2AClient` (remote agent proxy)
 * implement this interface, enabling polymorphic usage across the SDK.
 */
export interface AgentBase {
  /**
   * Invokes the agent and returns the final result.
   *
   * @param args - Arguments for invoking the agent
   * @returns Promise that resolves to the final AgentResult
   */
  invoke(args: InvokeArgs): Promise<AgentResult>

  /**
   * Streams the agent execution, yielding events and returning the final result.
   *
   * @param args - Arguments for invoking the agent
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined>
}
