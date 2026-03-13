import type { InvokeArgs, InvokeOptions } from './agent.js'
import type { AgentData, AgentResult, AgentStreamEvent } from '../types/agent.js'

/**
 * Interface defining the contract for all agent types.
 *
 * Extends {@link AgentData} with invocation capabilities. Both `Agent`
 * (full orchestration agent) and `A2AAgent` (remote agent proxy)
 * implement this interface, enabling polymorphic usage across the SDK.
 */
export interface AgentBase extends AgentData {
  /**
   * Discriminator identifying this as an agent type.
   */
  readonly type: 'agent'

  /**
   * The unique identifier of the agent instance.
   */
  readonly id: string

  /**
   * Optional description of what the agent does.
   */
  readonly description?: string

  /**
   * Invokes the agent and returns the final result.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options (e.g. structured output schema)
   * @returns Promise that resolves to the final AgentResult
   */
  invoke(args: InvokeArgs, options?: InvokeOptions): Promise<AgentResult>

  /**
   * Streams the agent execution, yielding events and returning the final result.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options (e.g. structured output schema)
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  stream(args: InvokeArgs, options?: InvokeOptions): AsyncGenerator<AgentStreamEvent, AgentResult, undefined>
}
