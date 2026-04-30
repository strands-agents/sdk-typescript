/**
 * Ledger context provider for comprehensive agent activity tracking.
 *
 * Tracks tool call history with inputs, outputs, timing, and success/failure status.
 * This audit trail enables steering handlers to make informed guidance decisions
 * based on agent behavior patterns and history.
 */

import { AfterInvocationEvent, AfterToolCallEvent, BeforeToolCallEvent } from '../../../hooks/events.js'
import type { LocalAgent } from '../../../types/agent.js'
import type { JSONValue } from '../../../types/json.js'
import type { SteeringContextData, SteeringProvider } from './provider.js'

/**
 * A single entry in the tool call ledger.
 */
interface LedgerToolCall {
  /** Tool input arguments. */
  args: JSONValue
  /** When the tool finished executing. */
  endTime?: string
  /** Error message if the tool failed. */
  error?: string | null
  /** Unique tool use identifier. */
  id: string
  /** Tool name. */
  name: string
  /** Tool execution result. */
  result?: JSONValue
  /** When the tool call was initiated. */
  startTime: string
  /** Current execution state: pending, success, or error. */
  status: 'pending' | 'success' | 'error'
}

/**
 * Context provider that tracks tool call history.
 *
 * Records every tool invocation with inputs, execution time, and success/failure status.
 * The ledger is available to steering handlers for pattern detection
 * (e.g., repeated failures, excessive retries).
 *
 * When the ledger exceeds maxEntries, the oldest entries are dropped.
 *
 * @example
 * ```typescript
 * const handler = new LLMSteeringHandler({
 *   systemPrompt: '...',
 *   model: new BedrockModel(),
 *   providers: [new ToolLedgerSteeringProvider()],
 * })
 * ```
 */
export class ToolLedgerSteeringProvider implements SteeringProvider {
  readonly name = 'strands:steering:toolLedger'
  private readonly _maxEntries: number = 100
  private readonly _toolCalls: LedgerToolCall[] = []

  constructor(options?: { maxEntries?: number }) {
    if (options?.maxEntries !== undefined) {
      this._maxEntries = options.maxEntries
    }
  }

  initAgent(agent: LocalAgent): void {
    // Rehydrate from appState if a previous session was restored
    const saved = agent.appState.get(this.name)
    if (Array.isArray(saved)) {
      this._toolCalls.push(...(saved as unknown as LedgerToolCall[]))
    }

    agent.addHook(BeforeToolCallEvent, (event) => {
      this._toolCalls.push({
        startTime: new Date().toISOString(),
        id: event.toolUse.toolUseId,
        name: event.toolUse.name,
        args: event.toolUse.input,
        status: 'pending',
      })
      if (this._toolCalls.length > this._maxEntries) {
        this._toolCalls.splice(0, this._toolCalls.length - this._maxEntries)
      }
    })

    agent.addHook(AfterToolCallEvent, (event) => {
      const toolUseId = event.toolUse.toolUseId
      for (let i = this._toolCalls.length - 1; i >= 0; i--) {
        const call = this._toolCalls[i]
        if (call?.id === toolUseId) {
          call.endTime = new Date().toISOString()
          call.status = event.result.status === 'success' ? 'success' : 'error'
          call.result = event.result.content.map((block) => block.toJSON()) as JSONValue
          call.error = event.error ? event.error.message : null
          break
        }
      }
    })

    agent.addHook(AfterInvocationEvent, (event) => {
      event.agent.appState.set(this.name, this._toolCalls as unknown as JSONValue)
    })
  }

  /**
   * Return the current ledger snapshot.
   */
  get context(): SteeringContextData {
    return {
      type: 'toolLedger',
      calls: this._toolCalls as unknown as JSONValue,
    }
  }
}
