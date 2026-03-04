/**
 * A2A agent that wraps a remote A2A agent as an AgentBase.
 *
 * Implements the AgentBase interface so it can be used anywhere a local Agent
 * can be used. The remote agent is invoked via the A2A protocol.
 * The A2A protocol is experimental, so breaking changes in the underlying SDK
 * may require breaking changes in this module.
 */

import type { AgentCard, Part, Task, Message as A2AMessage } from '@a2a-js/sdk'
import type { Client as A2AClientSdk } from '@a2a-js/sdk/client'
import { ClientFactory } from '@a2a-js/sdk/client'
import type { AgentBase } from '../agent/agent-base.js'
import type { InvokeArgs } from '../agent/agent.js'
import { AgentResult, type AgentStreamEvent } from '../types/agent.js'
import { Message, TextBlock, type ContentBlock, type ContentBlockData, type MessageData } from '../types/messages.js'
import { AgentResultEvent } from '../hooks/events.js'
import { AppState } from '../app-state.js'
import { logExperimentalWarning } from './experimental.js'

/**
 * Configuration options for creating an A2AAgent.
 */
export interface A2AAgentConfig {
  /** Base URL of the remote A2A agent */
  url: string
  /** Path to the agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string
  /** Override the agent name derived from the agent card */
  name?: string
  /** Override the agent description derived from the agent card */
  description?: string
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
   * Returns the agent name. Uses the config override if provided,
   * otherwise falls back to the name from the remote agent card.
   */
  get name(): string | undefined {
    return this._config.name ?? this._agentCard?.name
  }

  /**
   * Returns the agent description. Uses the config override if provided,
   * otherwise falls back to the description from the remote agent card.
   */
  get description(): string | undefined {
    return this._config.description ?? this._agentCard?.description
  }

  /**
   * Invokes the remote agent and returns the final result.
   *
   * Extracts text from the input args, sends it to the remote agent via
   * the A2A protocol, and wraps the response in an AgentResult.
   *
   * @param args - Arguments for invoking the agent
   * @returns Promise that resolves to the AgentResult
   */
  async invoke(args: InvokeArgs): Promise<AgentResult> {
    const text = this._extractTextFromA2AResponseFromArgs(args)
    const responseText = await this._sendMessage(text)

    const lastMessage = new Message({
      role: 'assistant',
      content: [new TextBlock(responseText)],
    })

    return new AgentResult({
      stopReason: 'endTurn',
      lastMessage,
    })
  }

  /**
   * Streams the remote agent execution, yielding events and returning the final result.
   *
   * @remarks
   * Currently calls invoke() and yields the result as a single AgentResultEvent.
   * TODO: Yield incremental A2A streaming events (TaskArtifactUpdateEvent, TaskStatusUpdateEvent)
   * as they arrive from the remote agent, matching the Python SDK's `stream_async` behavior.
   *
   * @param args - Arguments for invoking the agent
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  async *stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    const result = await this.invoke(args)
    yield new AgentResultEvent({ agent: { state: new AppState(), messages: [result.lastMessage] }, result })
    return result
  }

  /**
   * Sends a message to the remote A2A agent and returns the text response.
   *
   * @param text - The message text to send
   * @returns The agent's text response
   */
  private async _sendMessage(text: string): Promise<string> {
    const client = await this._getClient()

    const result = await client.sendMessage({
      message: {
        kind: 'message',
        messageId: globalThis.crypto.randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
    })

    return extractTextFromA2AResponse(result)
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
  private _extractTextFromA2AResponseFromArgs(args: InvokeArgs): string {
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
    return (args as (ContentBlock | ContentBlockData)[])
      .filter((b): b is TextBlock => ('type' in b ? b.type === 'textBlock' : 'text' in b))
      .map((b) => b.text)
      .join('\n')
  }
}

/**
 * Extracts text content from an A2A response (Task or Message).
 *
 * For Tasks: extracts text from artifacts first, then falls back to status message.
 * For Messages: extracts text from message parts.
 *
 * @param result - The A2A response
 * @returns Extracted text content
 */
export function extractTextFromA2AResponse(result: Task | A2AMessage): string {
  if (result.kind !== 'task') {
    return _textFromParts(result.parts)
  }

  // Try artifacts first, fall back to status message
  const parts = result.artifacts?.flatMap((a) => a.parts) ?? []
  return _textFromParts(parts) || _textFromParts(result.status?.message?.parts ?? [])
}

/**
 * Joins text from A2A parts, filtering out non-text parts.
 *
 * @param parts - Array of A2A parts
 * @returns Joined text content
 */
function _textFromParts(parts: Part[]): string {
  return parts
    .filter((p): p is Part & { kind: 'text'; text: string } => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
}
