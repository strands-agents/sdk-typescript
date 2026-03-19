import type { InvokeArgs } from '../types/agent.js'
import type { Message, MessageData } from '../types/messages.js'
import type { HookableEvent } from '../hooks/events.js'
import type { HookCallback, HookableEventConstructor, HookCleanup } from '../hooks/types.js'
import type { MultiAgentStreamEvent } from './events.js'
import type { MultiAgentResult } from './state.js'

/**
 * Input type for multi-agent orchestrators. Excludes `Message[]` and `MessageData[]`
 * from {@link InvokeArgs} since orchestrators route content blocks between nodes.
 */
export type MultiAgentInput = Exclude<InvokeArgs, Message[] | MessageData[]>

/**
 * Options for multi-agent orchestrator invocations.
 */
export interface MultiAgentOptions {
  /**
   * AbortSignal to cancel the orchestration.
   * When aborted, the orchestrator stops launching new nodes and returns
   * a result with status CANCELLED containing any partial results.
   */
  signal?: AbortSignal
}

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
   * @param options - Optional invocation options (e.g. abort signal)
   * @returns The aggregate result from all executed nodes
   */
  invoke(input: MultiAgentInput, options?: MultiAgentOptions): Promise<MultiAgentResult>

  /**
   * Execute the orchestrator and stream events as they occur.
   * @param input - Input to pass to the orchestrator
   * @param options - Optional invocation options (e.g. abort signal)
   * @returns Async generator yielding events and returning the final result
   */
  stream(input: MultiAgentInput, options?: MultiAgentOptions): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined>

  /**
   * Register a hook callback for a specific orchestrator event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   * @returns Cleanup function that removes the callback when invoked
   */
  addHook<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup
}
