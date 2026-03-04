/**
 * A2A client that wraps a remote A2A agent as an AgentBase.
 *
 * Implements the AgentBase interface so it can be used anywhere a local Agent
 * can be used. The remote agent is invoked via the A2A protocol.
 * The A2A protocol is experimental, so breaking changes in the underlying SDK
 * may require breaking changes in this module.
 */

import type { AgentCard, Task, Message as A2AMessage } from '@a2a-js/sdk'
import type { Client as A2AClientSdk } from '@a2a-js/sdk/client'
import { ClientFactory } from '@a2a-js/sdk/client'
import type { AgentBase } from '../agent/agent-base.js'
import type { InvokeArgs } from '../agent/agent.js'
import { AgentResult, type AgentStreamEvent } from '../types/agent.js'
import { Message, TextBlock, type ContentBlock, type ContentBlockData, type MessageData } from '../types/messages.js'
import { AgentResultEvent } from '../hooks/events.js'
import { AgentState } from '../agent/state.js'
import { logger } from '../logging/logger.js'

let _experimentalWarningLogged = false

/**
 * Configuration options for creating an A2AClient.
 */
export interface A2AClientConfig {
  /** Base URL of the remote A2A agent */
  url: string
  /** Path to the agent card endpoint (default: '/.well-known/agent-card.json') */
  agentCardPath?: string
  /** Override the agent name derived from the agent card */
  name?: string
}

/**
 * Wraps a remote A2A agent as an AgentBase.
 *
 * Implements `AgentBase` so it can be used polymorphically with local `Agent` instances.
 * On invocation, the client sends messages to the remote agent via the A2A protocol
 * and returns the response as an `AgentResult`.
 *
 * @example
 * ```typescript
 * import { A2AClient } from '@strands-agents/sdk/a2a'
 *
 * const remoteAgent = new A2AClient({ url: 'http://localhost:9000' })
 * const result = await remoteAgent.invoke('Hello, remote agent!')
 * console.log(result.toString())
 * ```
 */
export class A2AClient implements AgentBase {
  private _config: A2AClientConfig
  private _client: A2AClientSdk | undefined
  private _agentCard: AgentCard | undefined

  /**
   * Creates a new A2AClient.
   *
   * @param config - Configuration for connecting to the remote agent
   */
  constructor(config: A2AClientConfig) {
    this._config = config
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
    const text = this._extractTextFromArgs(args)
    const responseText = await this.sendMessage(text)

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
   * In the current implementation, this calls invoke() and yields the result as an
   * AgentResultEvent. True streaming will be added in a future version.
   *
   * @param args - Arguments for invoking the agent
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  async *stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    const result = await this.invoke(args)
    yield new AgentResultEvent({ agent: { state: new AgentState(), messages: [result.lastMessage] }, result })
    return result
  }

  /**
   * Connects to the remote A2A agent by fetching its agent card.
   * Connection is lazy and only performed once unless reconnect is true.
   *
   * @param reconnect - Force reconnection even if already connected
   */
  async connect(reconnect?: boolean): Promise<void> {
    if (this._client && !reconnect) {
      return
    }

    this._logExperimentalWarning()

    const factory = new ClientFactory()
    const client = await factory.createFromUrl(this._config.url, this._config.agentCardPath)
    this._agentCard = await client.getAgentCard()
    this._client = client
  }

  /**
   * Disconnects from the remote agent and clears cached state.
   */
  async disconnect(): Promise<void> {
    this._client = undefined
    this._agentCard = undefined
  }

  /**
   * Sends a message to the remote A2A agent and returns the text response.
   *
   * @param text - The message text to send
   * @returns The agent's text response
   */
  async sendMessage(text: string): Promise<string> {
    await this.connect()

    const result = await this._client!.sendMessage({
      message: {
        kind: 'message',
        messageId: globalThis.crypto.randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
    })

    return extractText(result)
  }

  /**
   * Extracts a text string from InvokeArgs for sending to the remote agent.
   *
   * @param args - The invocation arguments
   * @returns The extracted text string
   */
  private _extractTextFromArgs(args: InvokeArgs): string {
    if (typeof args === 'string') {
      return args
    }

    if (Array.isArray(args) && args.length > 0) {
      const firstElement = args[0]!

      // Check if it's Message[] or MessageData[]
      if ('role' in firstElement && typeof firstElement.role === 'string') {
        // Message[] or MessageData[] — extract text from the last user message
        const messages = args as (Message | MessageData)[]
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i]!
          if (msg.role === 'user') {
            const content = msg instanceof Message ? msg.content : (msg.content as ContentBlockData[])
            return this._extractTextFromContent(content)
          }
        }
        return ''
      }

      // ContentBlock[] or ContentBlockData[]
      return this._extractTextFromContent(args as (ContentBlock | ContentBlockData)[])
    }

    return ''
  }

  /**
   * Extracts text from an array of content blocks.
   *
   * @param content - Array of content blocks or content block data
   * @returns Joined text from all text blocks
   */
  private _extractTextFromContent(content: (ContentBlock | ContentBlockData)[]): string {
    const texts: string[] = []
    for (const block of content) {
      if ('type' in block && block.type === 'textBlock' && 'text' in block) {
        texts.push((block as TextBlock).text)
      } else if ('text' in block && !('type' in block)) {
        // ContentBlockData with text field (TextBlockData)
        texts.push(block.text as string)
      }
    }
    return texts.join('\n')
  }

  private _logExperimentalWarning(): void {
    if (!_experimentalWarningLogged) {
      _experimentalWarningLogged = true
      logger.warn(
        'The A2A protocol is experimental. Breaking changes in the underlying SDK may require breaking changes in this module.'
      )
    }
  }
}

/**
 * Sanitizes a name for use as a tool name.
 * Replaces non-alphanumeric characters with underscores, truncates to 64 characters,
 * and falls back to 'a2a_agent' if the result is empty.
 *
 * @param name - The name to sanitize
 * @returns A valid tool name
 */
export function sanitizeToolName(name: string): string {
  const sanitized = name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64)

  return sanitized || 'a2a_agent'
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
export function extractText(result: Task | A2AMessage): string {
  if (result.kind === 'task') {
    // Try artifacts first
    if (result.artifacts && result.artifacts.length > 0) {
      const texts: string[] = []
      for (const artifact of result.artifacts) {
        for (const part of artifact.parts) {
          if (part.kind === 'text') {
            texts.push(part.text)
          }
        }
      }
      if (texts.length > 0) {
        return texts.join('\n')
      }
    }

    // Fall back to status message
    if (result.status?.message?.parts) {
      const texts: string[] = []
      for (const part of result.status.message.parts) {
        if (part.kind === 'text') {
          texts.push(part.text)
        }
      }
      return texts.join('\n')
    }

    return ''
  }

  // Message type
  const texts: string[] = []
  for (const part of result.parts) {
    if (part.kind === 'text') {
      texts.push(part.text)
    }
  }
  return texts.join('\n')
}
