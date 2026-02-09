/**
 * Multi-agent type definitions.
 *
 * Provides the input type and streaming event union for multi-agent orchestration.
 */

import type { InterruptResponseContent } from '../types/interrupt.js'
import type { ContentBlock } from '../types/messages.js'
import type {
  MultiAgentHandoffEvent,
  MultiAgentNodeCancelEvent,
  MultiAgentNodeInputEvent,
  MultiAgentNodeInterruptEvent,
  MultiAgentNodeStartEvent,
  MultiAgentNodeStopEvent,
  MultiAgentNodeStreamEvent,
  MultiAgentResultEvent,
} from './streaming-events.js'

/**
 * Input type for multi-agent orchestration.
 *
 * Supports multiple input formats:
 * - `string` — Text task description
 * - `ContentBlock[]` — Rich content blocks
 * - `InterruptResponseContent[]` — Responses to interrupts when resuming
 */
export type MultiAgentInput = string | ContentBlock[] | InterruptResponseContent[]

/**
 * Options for multi-agent invocation (invoke or stream).
 * Passed through to lifecycle hooks and to underlying agent stream calls.
 */
export type MultiAgentInvokeOptions = {
  /**
   * Opaque context passed to BeforeMultiAgentInvocationEvent, BeforeNodeCallEvent,
   * AfterNodeCallEvent, and to each node's executor.stream(task, options).
   */
  invocationState?: Record<string, unknown>
}

/**
 * Union type of all streaming events emitted during multi-agent execution.
 *
 * This is a discriminated union where each event has a unique `type` field,
 * allowing for type-safe event handling using switch statements.
 */
export type MultiAgentStreamEvent =
  | MultiAgentNodeStartEvent
  | MultiAgentNodeStopEvent
  | MultiAgentNodeInputEvent
  | MultiAgentNodeStreamEvent
  | MultiAgentHandoffEvent
  | MultiAgentNodeCancelEvent
  | MultiAgentNodeInterruptEvent
  | MultiAgentResultEvent
