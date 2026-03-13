/**
 * A2A agent that wraps a remote A2A agent as an AgentBase.
 *
 * Implements the AgentBase interface so it can be used anywhere a local Agent
 * can be used. The remote agent is invoked via the A2A protocol.
 * The A2A protocol is experimental, so breaking changes in the underlying SDK
 * may require breaking changes in this module.
 */

import type { AgentCard, Part } from '@a2a-js/sdk'
import type { Client as A2AClientSdk } from '@a2a-js/sdk/client'
import { ClientFactory } from '@a2a-js/sdk/client'
import type { AgentBase } from '../agent/agent-base.js'
import type { InvokeArgs, InvokeOptions } from '../agent/agent.js'
import { AgentResult, type AgentStreamEvent } from '../types/agent.js'
import { Message, TextBlock, type ContentBlock, type ContentBlockData, type MessageData } from '../types/messages.js'
import { AgentResultEvent } from '../hooks/events.js'
import { A2AStreamUpdateEvent, type A2AEventData } from './events.js'
import { AppState } from '../app-state.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { logger } from '../logging/logger.js'
import { logExperimentalWarning } from './logging.js'

/**
 * Configuration options for creating an A2AAgent.
 */
export interface A2AAgentConfig {
  /** Base URL of the remote A2A agent */
  url: string
  /** Path to the agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string
}

/**
 * Wraps a remote A2A agent as an AgentBase.
 *
 * Implements `AgentBase` so it can be used polymorphically with local `Agent` instances.
 * On invocation, the agent lazily connects to the remote endpoint via the A2A protocol
 * and returns the response as an `AgentResult`.
 *
 * @example
 * ```typescript
 * import { A2AAgent } from '@strands-agents/sdk/a2a'
 *
 * const remoteAgent = new A2AAgent({ url: 'http://localhost:9000' })
 * const result = await remoteAgent.invoke('Hello, remote agent!')
 * console.log(result.toString())
 * ```
 */
export class A2AAgent implements AgentBase {
  private _config: A2AAgentConfig
  private _client: A2AClientSdk | undefined
  private _agentCard: AgentCard | undefined

  /**
   * Creates a new A2AAgent.
   *
   * @param config - Configuration for connecting to the remote agent
   */
  constructor(config: A2AAgentConfig) {
    this._config = config
  }

  /**
   * Invokes the remote agent and returns the final result.
   *
   * Built on top of `stream()` — consumes the full event stream and returns the final result.
   *
   * @param args - Arguments for invoking the agent
   * @param options - Optional invocation options (unused for remote agents)
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
   * TaskStatusUpdateEvent, TaskArtifactUpdateEvent), followed by an `AgentResultEvent`
   * containing the final result built from the last complete event.
   *
   * @param args - Arguments for invoking the agent
   * @param _options - Optional invocation options (unused for remote agents)
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  async *stream(args: InvokeArgs, _options?: InvokeOptions): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    const client = await this._getClient()
    const text = this._extractTextFromArgs(args)

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
    const result = this._buildResult(finalEvent, accumulatedText)

    yield new AgentResultEvent({
      agent: {
        state: new AppState(),
        messages: [result.lastMessage],
        toolRegistry: new ToolRegistry(),
        addHook: (): (() => void) => () => {},
      },
      result,
    })
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

    const factory = new ClientFactory()
    const client = await factory.createFromUrl(this._config.url, this._config.agentCardPath)
    this._agentCard = await client.getAgentCard()
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
      logger.info(`non_text_blocks=<${nonTextCount}> | stripping non-text content blocks, a2a only supports text`)
    }

    return blocks
      .filter((b): b is TextBlock => ('type' in b ? b.type === 'textBlock' : 'text' in b))
      .map((b) => b.text)
      .join('\n')
  }

  /**
   * Checks whether an A2A streaming event represents a complete response.
   *
   * @param event - The A2A streaming event
   * @returns True if the event is a terminal/complete event
   */
  private _isCompleteEvent(event: A2AEventData): boolean {
    if (event.kind === 'message') return true
    if (event.kind === 'task') return true
    if (event.kind === 'artifact-update') return event.lastChunk === true
    if (event.kind === 'status-update') return event.status.state === 'completed'
    return false
  }

  /**
   * Builds an AgentResult from the final A2A streaming event.
   *
   * @param event - The final A2A event, or undefined if no events were received
   * @returns The constructed AgentResult
   */
  private _buildResult(event: A2AEventData | undefined, accumulatedText?: string): AgentResult {
    const text = this._extractTextFromEvent(event) || accumulatedText || ''
    const lastMessage = new Message({
      role: 'assistant',
      content: [new TextBlock(text)],
    })
    return new AgentResult({ stopReason: 'endTurn', lastMessage })
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
