/**
 * Ledger context provider for comprehensive agent activity tracking.
 *
 * Tracks tool call history including inputs, outputs, timing, and status.
 * This audit trail enables steering handlers to make informed guidance
 * decisions based on agent behavior patterns.
 *
 * @experimental This API is experimental and may change in future releases.
 */

import type { JSONValue } from '../../../types/json.js'
import type { HookEventConstructor } from '../../../hooks/types.js'
import { AfterToolCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import { SteeringContext, SteeringContextCallback, SteeringContextProvider } from '../core/context.js'

/**
 * Ledger data structure tracked in the steering context.
 */
interface LedgerData {
  session_start: string
  tool_calls: ToolCallEntry[]
  conversation_history: JSONValue[]
  session_metadata: Record<string, JSONValue>
}

/**
 * Individual tool call entry in the ledger.
 */
interface ToolCallEntry {
  timestamp: string
  tool_use_id: string
  tool_name: string
  tool_args: JSONValue
  status: string
  completion_timestamp?: string
  result?: JSONValue
  error?: string | null
}

/**
 * Context callback that records tool calls to the ledger before execution.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class LedgerBeforeToolCall extends SteeringContextCallback<BeforeToolCallEvent> {
  readonly eventType: HookEventConstructor<BeforeToolCallEvent> = BeforeToolCallEvent

  private readonly _sessionStart: string

  constructor() {
    super()
    this._sessionStart = new Date().toISOString()
  }

  /**
   * Records a pending tool call entry to the ledger.
   *
   * @param event - The before tool call event
   * @param steeringContext - The steering context to update
   */
  update(event: BeforeToolCallEvent, steeringContext: SteeringContext): void {
    let ledger = steeringContext.get('ledger') as LedgerData | undefined

    if (ledger === undefined) {
      ledger = {
        session_start: this._sessionStart,
        tool_calls: [],
        conversation_history: [],
        session_metadata: {},
      }
    }

    const toolCallEntry: ToolCallEntry = {
      timestamp: new Date().toISOString(),
      tool_use_id: event.toolUse.toolUseId,
      tool_name: event.toolUse.name,
      tool_args: event.toolUse.input,
      status: 'pending',
    }

    ledger.tool_calls.push(toolCallEntry)
    steeringContext.set('ledger', ledger as unknown as JSONValue)
  }
}

/**
 * Context callback that updates the ledger after tool execution completes.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class LedgerAfterToolCall extends SteeringContextCallback<AfterToolCallEvent> {
  readonly eventType: HookEventConstructor<AfterToolCallEvent> = AfterToolCallEvent

  /**
   * Updates the matching pending tool call entry with completion data.
   *
   * @param event - The after tool call event
   * @param steeringContext - The steering context to update
   */
  update(event: AfterToolCallEvent, steeringContext: SteeringContext): void {
    const ledger = steeringContext.get('ledger') as LedgerData | undefined

    if (ledger === undefined || ledger.tool_calls.length === 0) {
      return
    }

    const toolUseId = event.toolUse.toolUseId

    // Search in reverse for the matching pending tool call
    for (let i = ledger.tool_calls.length - 1; i >= 0; i--) {
      const call = ledger.tool_calls[i]!
      if (call.tool_use_id === toolUseId && call.status === 'pending') {
        call.completion_timestamp = new Date().toISOString()
        call.status = event.result.status
        call.result = serializeToolResultContent(event.result.content)
        call.error = event.error !== undefined ? String(event.error) : null
        steeringContext.set('ledger', ledger as unknown as JSONValue)
        break
      }
    }
  }
}

/**
 * Combined ledger context provider for tracking tool call lifecycle.
 *
 * Provides both before and after tool call callbacks for comprehensive
 * tool activity tracking.
 *
 * @experimental This API is experimental and may change in future releases.
 */
export class LedgerProvider extends SteeringContextProvider {
  /**
   * Returns ledger context callbacks for before and after tool calls.
   *
   * @returns Array of ledger context callbacks
   */
  contextProviders(): SteeringContextCallback[] {
    return [new LedgerBeforeToolCall(), new LedgerAfterToolCall()]
  }
}

/**
 * Serializes tool result content to a JSON-compatible value.
 */
function serializeToolResultContent(content: ReadonlyArray<{ type: string; text?: string }>): JSONValue {
  return content.map((block) => {
    if (block.type === 'textBlock' && block.text !== undefined) {
      return block.text
    }
    return block.type
  })
}
