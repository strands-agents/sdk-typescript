/**
 * A2A agent that wraps a remote A2A agent as an InvokableAgent.
 *
 * Implements the InvokableAgent interface so it can be used anywhere a local Agent
 * can be used. The remote agent is invoked via the A2A protocol.
 * The A2A protocol is experimental, so breaking changes in the underlying SDK
 * may require breaking changes in this module.
 */

import type { AgentCard, Part } from '@a2a-js/sdk'
import type { Client as A2AClientSdk, ClientFactory as ClientFactoryType } from '@a2a-js/sdk/client'
import { ClientFactory } from '@a2a-js/sdk/client'
import type { InvocationState, InvokableAgent, InvokeArgs, InvokeOptions } from '../types/agent.js'
import { AgentResult } from '../types/agent.js'
import { Message, TextBlock, type ContentBlock, type ContentBlockData, type MessageData } from '../types/messages.js'
import type { StopReason } from '../types/messages.js'
import { A2AStreamUpdateEvent, A2AResultEvent, type A2AEventData, type A2AStreamEvent } from './events.js'
import { Interrupt } from '../interrupt.js'
import type { JSONValue } from '../types/json.js'
import { logger } from '../logging/logger.js'
import { logExperimentalWarning } from './logging.js'

/**
 * Maps A2A task states to Strands StopReason values.
 *
 * This is the single source of truth for state-to-stopReason mapping.
 * Terminal states map to 'endTurn', input states map to 'interrupt'.
 */
const STATE_TO_STOP_REASON: Record<string, StopReason> = {
  completed: 'endTurn',
  failed: 'endTurn',
  canceled: 'cancelled',
  rejected: 'endTurn',
  'input-required': 'interrupt',
  'auth-required': 'interrupt',
  unknown: 'endTurn',
}

/**
 * Terminal states that indicate the task is finished.
 * Derived from STATE_TO_STOP_REASON for single source of truth.
 */
const TERMINAL_STATES = new Set(
  Object.entries(STATE_TO_STOP_REASON)
    .filter(([, reason]) => reason === 'endTurn')
    .map(([state]) => state)
)

/**
 * Input-required states that indicate the task needs additional input.
 * Derived from STATE_TO_STOP_REASON for single source of truth.
 */
const INPUT_STATES = new Set(
  Object.entries(STATE_TO_STOP_REASON)
    .filter(([, reason]) => reason === 'interrupt')
    .map(([state]) => state)
)

/**
 * All complete states (terminal + input).
 */
const COMPLETE_STATES = new Set([...TERMINAL_STATES, ...INPUT_STATES])

/**
 * Configuration options for creating an A2AAgent.
 */
export interface A2AAgentConfig {
  /** Base URL of the remote A2A agent */
  url: string
  /** Path to the agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string
  /** Optional unique identifier. Defaults to the URL. */
  id?: string
  /** Optional name. If not provided, populated from the agent card after connection. */
  name?: string
  /** Optional description. If not provided, populated from the agent card after connection. */
  description?: string
  /** Optional custom A2A ClientFactory for authenticating requests (e.g. SigV4, bearer token). */
  clientFactory?: ClientFactoryType
}

/**
 * Wraps a remote A2A agent as an InvokableAgent.
 *
 * Implements `InvokableAgent` so it can be used polymorphically with local `Agent` instances.
 * On invocation, the agent lazily connects to the remote endpoint via the A2A protocol
 * and returns the response as an `AgentResult`.
 *
 * ## Task Lifecycle State Support
 *
 * The agent recognizes all A2A task lifecycle states and maps them to appropriate
 * `stopReason` values:
 * - `completed`, `failed`, `rejected`, `unknown` → `stopReason: 'endTurn'`
 * - `canceled` → `stopReason: 'cancelled'`
 * - `input-required`, `auth-required` → `stopReason: 'interrupt'`
 *
 * The task state is also included in the result's `invocationState` under the
 * key `a2aTaskState` for downstream consumers.
 *
 * @example
 * ```typescript
 * import { A2AAgent } from '@strands-agents/sdk/a2a'
 *
 * const remoteAgent = new A2AAgent({ url: 'http://localhost:9000' })
 * const result = await remoteAgent.invoke('Hello, remote agent!')
 * console.log(result.toString())
 * console.log(result.invocationState.a2aTaskState) // 'completed'
 * ```
 */
export class A2AAgent implements InvokableAgent {
  private _config: A2AAgentConfig
  private _client: A2AClientSdk | undefined
  private _agentCard: AgentCard | undefined

  /**
   * The unique identifier of the agent instance.
   */
  readonly id: string

  /**
   * The name of the agent.
   * If not provided in config, populated from the agent card after connection.
   */
  readonly name?: string

  /**
   * Optional description of what the agent does.
   * If not provided in config, populated from the agent card after connection.
   */
  readonly description?: string

  /**
   * Creates a new A2AAgent.
   *
   * @param config - Configuration for connecting to the remote agent
   */
  constructor(config: A2AAgentConfig) {
    this._config = config
    this.id = config.id ?? config.url
    if (config.name !== undefined) this.name = config.name
    if (config.description !== undefined) this.description = config.description
  }

  /**
   * Invokes the remote agent and returns the final result.
   *
   * Built on top of `stream()` — consumes the full event stream and returns the final result.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options. See {@link stream} for behavior.
   * @returns Promise that resolves to the AgentResult
   */
  async invoke(args: InvokeArgs, options?: InvokeOptions): Promise<AgentResult> {
    const gen = this.stream(args, options)
    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }
    return next.value
  }

  /**
   * Streams the remote agent execution, yielding A2A events as they arrive.
   *
   * Yields `A2AStreamUpdateEvent` for each raw A2A protocol event (Message, Task,
   * TaskStatusUpdateEvent, TaskArtifactUpdateEvent), followed by an `A2AResultEvent`
   * containing the final result built from the last complete event.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options. If `invocationState` is
   *   provided, it is returned on the resulting `AgentResult`. The remote
   *   agent runs in another process and cannot read or mutate it. Other
   *   fields on `options` are ignored.
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  async *stream(args: InvokeArgs, options?: InvokeOptions): AsyncGenerator<A2AStreamEvent, AgentResult, undefined> {
    const client = await this._getClient()
    const text = this._extractTextFromArgs(args)
    const invocationState = options?.invocationState ?? {}

    let lastEvent: A2AEventData | undefined
    let lastCompleteEvent: A2AEventData | undefined
    const artifactTexts = new Map<string, string[]>()

    const eventStream = client.sendMessageStream({
      message: {
        kind: 'message',
        messageId: globalThis.crypto.randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
    })

    for await (const event of eventStream) {
      lastEvent = event
      if (this._isCompleteEvent(event)) {
        lastCompleteEvent = event
      }
      if (event.kind === 'artifact-update') {
        const id = event.artifact.artifactId
        if (!event.append) {
          artifactTexts.set(id, [])
        }
        const chunks = artifactTexts.get(id) ?? []
        const chunkText = this._textFromParts(event.artifact.parts)
        if (chunkText) {
          chunks.push(chunkText)
          artifactTexts.set(id, chunks)
        }
      }
      yield new A2AStreamUpdateEvent(event)
    }

    const finalEvent = lastCompleteEvent ?? lastEvent
    const accumulatedText = [...artifactTexts.values()].map((chunks) => chunks.join('')).join('\n')
    const result = this._buildResult(finalEvent, invocationState, accumulatedText)

    yield new A2AResultEvent({ result })
    return result
  }

  /**
   * Returns the cached A2A SDK client, creating one lazily on first use.
   * Also fetches and caches the agent card for name/description.
   *
   * @returns The A2A SDK client
   */
  private async _getClient(): Promise<A2AClientSdk> {
    if (this._client) {
      return this._client
    }

    logExperimentalWarning()

    const factory = this._config.clientFactory ?? new ClientFactory()
    const client = await factory.createFromUrl(this._config.url, this._config.agentCardPath)
    this._agentCard = await client.getAgentCard()
    if (this.name === undefined && this._agentCard?.name) {
      ;(this as { name?: string }).name = this._agentCard.name
    }
    if (this.description === undefined && this._agentCard?.description) {
      ;(this as { description?: string }).description = this._agentCard.description
    }
    this._client = client
    return client
  }

  /**
   * Extracts a text string from InvokeArgs for sending to the remote agent.
   *
   * @param args - The invocation arguments
   * @returns The extracted text string
   */
  private _extractTextFromArgs(args: InvokeArgs): string {
    if (typeof args === 'string') return args
    if (!Array.isArray(args) || args.length === 0) return ''

    // Message[] or MessageData[] — find last user message's content
    if ('role' in args[0]!) {
      const messages = args as (Message | MessageData)[]
      const lastUser = messages
        .slice()
        .reverse()
        .find((m) => m.role === 'user')
      if (!lastUser) return ''
      args = lastUser instanceof Message ? lastUser.content : (lastUser.content as ContentBlockData[])
    }

    // ContentBlock[] or ContentBlockData[] — join text from all text blocks
    const blocks = args as (ContentBlock | ContentBlockData)[]
    const nonTextCount = blocks.filter((b) => ('type' in b ? b.type !== 'textBlock' : !('text' in b))).length
    if (nonTextCount > 0) {
      logger.warn(
        `non_text_blocks=<${nonTextCount}> | stripping non-text content blocks, A2AAgent does not yet support non-text content`
      )
    }

    return blocks
      .filter((b): b is TextBlock => ('type' in b ? b.type === 'textBlock' : 'text' in b))
      .map((b) => b.text)
      .join('\n')
  }

  /**
   * Checks whether an A2A streaming event represents a complete response.
   *
   * Recognizes all terminal and input-required states from the A2A task lifecycle:
   * - Terminal: completed, failed, canceled, rejected
   * - Input: input-required, auth-required
   *
   * @param event - The A2A streaming event
   * @returns True if the event is a terminal/complete event
   */
  private _isCompleteEvent(event: A2AEventData): boolean {
    if (event.kind === 'message') return true
    if (event.kind === 'task') return true
    if (event.kind === 'artifact-update') return event.lastChunk === true
    if (event.kind === 'status-update') {
      return COMPLETE_STATES.has(event.status.state)
    }
    return false
  }

  /**
   * Extracts the A2A task state from the final event.
   *
   * @param event - The final A2A event
   * @returns The task state string, or undefined if not available
   */
  private _extractTaskState(event: A2AEventData | undefined): string | undefined {
    if (!event) return undefined
    if (event.kind === 'task') return event.status?.state
    if (event.kind === 'status-update') return event.status.state
    return undefined
  }

  /**
   * Builds an AgentResult from the final A2A streaming event.
   *
   * Maps the A2A task state to the appropriate StopReason:
   * - completed/failed/rejected/unknown → 'endTurn'
   * - canceled → 'cancelled'
   * - input-required/auth-required → 'interrupt'
   *
   * @param event - The final A2A event, or undefined if no events were received
   * @param invocationState - Caller-provided invocation state, threaded through to the result
   * @param accumulatedText - Optional accumulated text from streaming artifacts
   * @returns The constructed AgentResult
   */
  private _buildResult(
    event: A2AEventData | undefined,
    invocationState: InvocationState,
    accumulatedText?: string
  ): AgentResult {
    const text = this._extractTextFromEvent(event) || accumulatedText || ''
    const lastMessage = new Message({
      role: 'assistant',
      content: [new TextBlock(text)],
    })

    // Determine stopReason from task state
    const taskState = this._extractTaskState(event)
    const stopReason: StopReason = taskState ? (STATE_TO_STOP_REASON[taskState] ?? 'endTurn') : 'endTurn'

    // Include task state in invocationState for downstream consumers
    const enrichedState: InvocationState = {
      ...invocationState,
      ...(taskState ? { a2aTaskState: taskState } : {}),
    }

    // Reconstruct Interrupt objects when task is input-required
    const interrupts = stopReason === 'interrupt' ? this._extractInterrupts(event, text) : undefined

    return new AgentResult({
      stopReason,
      lastMessage,
      invocationState: enrichedState,
      ...(interrupts ? { interrupts } : {}),
    })
  }

  /**
   * Extracts Interrupt objects from an A2A event.
   *
   * Looks for structured interrupt data in DataPart entries first (round-trip from
   * our executor), then falls back to creating a synthetic interrupt from the
   * status message text for interoperability with other A2A servers.
   *
   * @param event - The A2A event to extract interrupts from
   * @param fallbackText - Text to use for a synthetic interrupt if no structured data is found
   * @returns Array of Interrupt objects, or undefined if none found
   */
  private _extractInterrupts(event: A2AEventData | undefined, fallbackText: string): Interrupt[] | undefined {
    if (!event) return undefined

    // Extract parts from the event (status-update message parts or task status message parts)
    const parts = this._getStatusParts(event)

    // Look for structured interrupt data in DataPart entries
    for (const part of parts) {
      if (part.kind === 'data' && Array.isArray((part.data as Record<string, unknown>)?.interrupts)) {
        const rawInterrupts = (part.data as { interrupts: Array<{ id: string; name: string; reason?: unknown }> })
          .interrupts
        if (rawInterrupts.length > 0) {
          return rawInterrupts.map(
            (raw) =>
              new Interrupt({
                id: raw.id,
                name: raw.name,
                ...(raw.reason !== undefined ? { reason: raw.reason as JSONValue } : {}),
              })
          )
        }
      }
    }

    // Fallback: create a synthetic interrupt from the status text.
    // This handles A2A servers that don't send structured interrupt data.
    if (fallbackText) {
      return [
        new Interrupt({
          id: 'a2a-input-required',
          name: 'input-required',
          reason: fallbackText,
        }),
      ]
    }

    return undefined
  }

  /**
   * Extracts status message parts from an A2A event.
   *
   * @param event - The A2A event
   * @returns Array of parts from the status message, or empty array
   */
  private _getStatusParts(event: A2AEventData): Part[] {
    if (event.kind === 'status-update' && event.status.message) {
      return event.status.message.parts
    }
    if (event.kind === 'task' && event.status?.message) {
      return event.status.message.parts
    }
    return []
  }

  /**
   * Extracts text content from an A2A streaming event.
   *
   * @param event - The A2A streaming event
   * @returns Extracted text content
   */
  private _extractTextFromEvent(event: A2AEventData | undefined): string {
    if (!event) return ''
    if (event.kind === 'message') {
      return this._textFromParts(event.parts)
    }
    if (event.kind === 'task') {
      const parts = event.artifacts?.flatMap((a) => a.parts) ?? []
      return this._textFromParts(parts) || this._textFromParts(event.status?.message?.parts ?? [])
    }
    if (event.kind === 'artifact-update') {
      return this._textFromParts(event.artifact.parts)
    }
    if (event.kind === 'status-update' && event.status.message) {
      return this._textFromParts(event.status.message.parts)
    }
    return ''
  }

  /**
   * Joins text from A2A parts, filtering out non-text parts.
   *
   * @param parts - Array of A2A parts
   * @returns Joined text content
   */
  private _textFromParts(parts: Part[]): string {
    return parts
      .filter((p): p is Part & { kind: 'text'; text: string } => p.kind === 'text')
      .map((p) => p.text)
      .join('\n')
  }
}
