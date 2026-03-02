import type { InvokeArgs } from '../agent/agent.js'
import type { MultiAgentStreamEvent } from './events.js'
import type { MultiAgentResult } from './state.js'

/**
 * Interface for any multi-agent orchestrator that can stream execution.
 */
export interface MultiAgentBase {
  readonly id: string
  invoke(input: InvokeArgs): Promise<MultiAgentResult>
  stream(input: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined>
}
