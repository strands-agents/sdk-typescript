import type { InvokeArgs } from '../types/agent.js'
import type { HookableEvent } from '../hooks/events.js'
import type { HookCallback, HookableEventConstructor, HookCleanup } from '../hooks/types.js'
import type { MultiAgentStreamEvent } from './events.js'
import type { MultiAgentResult } from './state.js'

/**
 * Interface for any multi-agent orchestrator that can stream execution.
 * Implement this interface to create custom orchestration patterns that can be
 * composed as nodes within other orchestrators via {@link MultiAgentNode}.
 */
export interface MultiAgent {
  /** Unique identifier for this orchestrator. */
  readonly id: string

  /**
   * Execute the orchestrator and return the final result.
   * @param input - Input to pass to the orchestrator
   * @returns The aggregate result from all executed nodes
   */
  invoke(input: InvokeArgs): Promise<MultiAgentResult>

  /**
   * Execute the orchestrator and stream events as they occur.
   * @param input - Input to pass to the orchestrator
   * @returns Async generator yielding events and returning the final result
   */
  stream(input: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined>

  /**
   * Register a hook callback for a specific orchestrator event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   * @returns Cleanup function that removes the callback when invoked
   */
  addHook<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup
}
