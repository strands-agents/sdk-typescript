/**
 * Summarizing conversation history management.
 *
 * This module provides a conversation manager that uses an LLM to generate summaries
 * of older messages when the context window overflows, preserving key information
 * while reducing token usage.
 */

import { ContextWindowOverflowError } from '../errors.js'
import type { JSONValue } from '../types/json.js'
import { Message, TextBlock, ToolResultBlock, ToolUseBlock } from '../types/messages.js'
import type { SystemPrompt } from '../types/messages.js'
import type { HookRegistry } from '../hooks/registry.js'
import { AfterModelCallEvent } from '../hooks/events.js'
import { ConversationManager } from './conversation-manager.js'

/**
 * Default system prompt used for conversation summarization.
 */
export const DEFAULT_SUMMARIZATION_PROMPT = `You are a conversation summarizer. Provide a concise summary of the conversation history.

Format Requirements:
- You MUST create a structured and concise summary in bullet-point format.
- You MUST NOT respond conversationally.
- You MUST NOT address the user directly.
- You MUST NOT comment on tool availability.

Assumptions:
- You MUST NOT assume tool executions failed unless otherwise stated.

Task:
Your task is to create a structured summary document:
- It MUST contain bullet points with key topics and questions covered
- It MUST contain bullet points for all significant tools executed and their results
- It MUST contain bullet points for any code or technical information shared
- It MUST contain a section of key insights gained
- It MUST format the summary in the third person

Example format:

## Conversation Summary
* Topic 1: Key information
* Topic 2: Key information
*
## Tools Executed
* Tool X: Result Y`

/**
 * Forward reference for an agent that can be used for summarization.
 * Avoids circular imports with the Agent module.
 */
interface SummarizationAgent {
  invoke(args: string): Promise<{ toString(): string }>
}

/**
 * Forward reference for a model that can generate summaries.
 * Only requires the streamAggregated method used during summarization.
 */
interface SummarizationModel {
  streamAggregated(
    messages: Message[],
    options: { systemPrompt?: SystemPrompt }
  ): AsyncGenerator<unknown, { message: Message; stopReason: string }, undefined>
}

/**
 * Configuration for the summarizing conversation manager.
 */
export interface SummarizingConversationManagerConfig {
  /**
   * Ratio of messages to summarize when context overflow occurs.
   * Clamped to range [0.1, 0.8]. Defaults to 0.3 (summarize 30% of oldest messages).
   */
  summaryRatio?: number

  /**
   * Minimum number of recent messages to always preserve.
   * Defaults to 10 messages.
   */
  preserveRecentMessages?: number

  /**
   * Dedicated agent to use for summarization instead of the parent agent's model.
   * If provided, `summarizationSystemPrompt` must not be set (the agent has its own prompt).
   */
  summarizationAgent?: SummarizationAgent

  /**
   * Custom system prompt for summarization.
   * Mutually exclusive with `summarizationAgent`.
   * Defaults to DEFAULT_SUMMARIZATION_PROMPT.
   */
  summarizationSystemPrompt?: string
}

/**
 * Implements a summarizing conversation manager that uses an LLM to generate
 * structured summaries of older messages when the context window overflows.
 *
 * Unlike the sliding window manager which simply trims messages, this manager
 * preserves information through summarization. Proactive management is a no-op;
 * summarization only occurs on context overflow.
 *
 * As a HookProvider, it registers a callback for:
 * - AfterModelCallEvent: Reduces context via summarization on overflow errors and requests retry
 *
 * @example
 * ```typescript
 * // Using the parent agent's model for summarization
 * const manager = new SummarizingConversationManager()
 * const agent = new Agent({
 *   model: new BedrockModel({ modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0' }),
 *   conversationManager: manager,
 * })
 *
 * // Using a dedicated summarization agent
 * const summaryAgent = new Agent({
 *   model: new BedrockModel({ modelId: 'anthropic.claude-3-haiku-20240307-v1:0' }),
 * })
 * const manager = new SummarizingConversationManager({
 *   summarizationAgent: summaryAgent,
 * })
 * ```
 */
export class SummarizingConversationManager extends ConversationManager {
  private readonly _summaryRatio: number
  private readonly _preserveRecentMessages: number
  private readonly _summarizationAgent: SummarizationAgent | undefined
  private readonly _summarizationSystemPrompt: string

  /**
   * Creates a new SummarizingConversationManager.
   *
   * @param config - Configuration options
   */
  constructor(config?: SummarizingConversationManagerConfig) {
    super()

    if (config?.summarizationAgent !== undefined && config?.summarizationSystemPrompt !== undefined) {
      throw new Error(
        'Cannot provide both summarizationAgent and summarizationSystemPrompt. Agents come with their own system prompt.'
      )
    }

    this._summaryRatio = Math.max(0.1, Math.min(0.8, config?.summaryRatio ?? 0.3))
    this._preserveRecentMessages = config?.preserveRecentMessages ?? 10
    this._summarizationAgent = config?.summarizationAgent
    this._summarizationSystemPrompt = config?.summarizationSystemPrompt ?? DEFAULT_SUMMARIZATION_PROMPT
  }

  /**
   * Registers callbacks with the hook registry.
   *
   * Registers:
   * - AfterModelCallEvent callback to handle context overflow via summarization
   *
   * @param registry - The hook registry to register callbacks with
   */
  public registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(AfterModelCallEvent, async (event) => {
      if (event.error instanceof ContextWindowOverflowError) {
        const model = this._extractModel(event.agent)
        await this._reduceContext(event.agent.messages, model)
        event.retry = true
      }
    })
  }

  /**
   * Extracts the model from an agent instance via runtime property check.
   * The hook event provides AgentData, but the full Agent has a model property.
   *
   * @param agent - The agent data from the hook event
   * @returns The model if available, undefined otherwise
   */
  private _extractModel(agent: unknown): SummarizationModel | undefined {
    if (agent !== null && typeof agent === 'object' && 'model' in agent) {
      const candidate = (agent as Record<string, unknown>).model
      if (candidate !== null && typeof candidate === 'object' && 'streamAggregated' in candidate) {
        return candidate as SummarizationModel
      }
    }
    return undefined
  }

  /**
   * Reduces context by summarizing older messages.
   *
   * @param messages - The message array to reduce (modified in-place)
   * @param model - The model to use for summarization, if available
   */
  private async _reduceContext(messages: Message[], model: SummarizationModel | undefined): Promise<void> {
    // Calculate how many messages to summarize
    let messagesToSummarizeCount = Math.max(1, Math.floor(messages.length * this._summaryRatio))

    // Ensure we preserve recent messages
    messagesToSummarizeCount = Math.min(messagesToSummarizeCount, messages.length - this._preserveRecentMessages)

    if (messagesToSummarizeCount <= 0) {
      throw new ContextWindowOverflowError('Cannot summarize: insufficient messages for summarization')
    }

    // Adjust split point to avoid breaking ToolUse/ToolResult pairs
    messagesToSummarizeCount = this._adjustSplitPointForToolPairs(messages, messagesToSummarizeCount)

    if (messagesToSummarizeCount <= 0) {
      throw new ContextWindowOverflowError('Cannot summarize: insufficient messages for summarization')
    }

    // Extract messages to summarize
    const messagesToSummarize = messages.slice(0, messagesToSummarizeCount)

    // Generate summary
    const summaryMessage = await this._generateSummary(messagesToSummarize, model)

    // Replace the summarized messages with the summary
    messages.splice(0, messagesToSummarizeCount, summaryMessage)
  }

  /**
   * Generates a summary of the provided messages.
   *
   * When a dedicated summarization agent is provided, delegates to it.
   * Otherwise, uses the parent agent's model directly to avoid concurrency conflicts.
   *
   * @param messagesToSummarize - The messages to summarize
   * @param model - The parent agent's model for direct summarization, if available
   * @returns A user message containing the conversation summary
   */
  private async _generateSummary(
    messagesToSummarize: Message[],
    model: SummarizationModel | undefined
  ): Promise<Message> {
    // Use dedicated summarization agent if provided
    if (this._summarizationAgent) {
      const conversationText = this._messagesToText(messagesToSummarize)
      const result = await this._summarizationAgent.invoke(`Please summarize this conversation:\n\n${conversationText}`)
      return new Message({
        role: 'user',
        content: [new TextBlock(result.toString())],
      })
    }

    if (!model) {
      throw new Error(
        'No summarization agent provided and parent agent model is not accessible. ' +
          'Provide a summarizationAgent in the SummarizingConversationManager config.'
      )
    }

    // Build messages for the model: the conversation to summarize + a summarization request
    const summarizationMessages = [
      ...messagesToSummarize,
      new Message({
        role: 'user',
        content: [new TextBlock('Please summarize this conversation.')],
      }),
    ]

    const systemPrompt: SystemPrompt = [new TextBlock(this._summarizationSystemPrompt)]

    // Invoke the model directly (bypasses agent loop and concurrency lock)
    const gen = model.streamAggregated(summarizationMessages, { systemPrompt })
    let result = await gen.next()
    while (!result.done) {
      result = await gen.next()
    }

    // Convert assistant response to user message (summary replaces old messages as context)
    const assistantMessage = result.value.message
    return new Message({
      role: 'user',
      content: assistantMessage.content,
    })
  }

  /**
   * Converts messages to a text representation for the summarization agent.
   * Includes tool input and result content to preserve key information.
   *
   * @param messages - Messages to convert
   * @returns Text representation of the messages
   */
  private _messagesToText(messages: Message[]): string {
    return messages
      .map((msg) => {
        const textParts = msg.content
          .map((block) => {
            if (block.type === 'textBlock') {
              return (block as TextBlock).text
            }
            if (block.type === 'toolUseBlock') {
              const toolUse = block as ToolUseBlock
              const inputStr = typeof toolUse.input === 'string' ? toolUse.input : JSON.stringify(toolUse.input)
              return `[Tool Use: ${toolUse.name}(${inputStr})]`
            }
            if (block.type === 'toolResultBlock') {
              const toolResult = block as ToolResultBlock
              const contentStr = toolResult.content.map((c) => ('text' in c ? c.text : JSON.stringify(c))).join('; ')
              return `[Tool Result (${toolResult.status}): ${contentStr}]`
            }
            return `[${block.type}]`
          })
          .join(' ')
        return `${msg.role}: ${textParts}`
      })
      .join('\n')
  }

  /**
   * Adjusts the split point to avoid breaking ToolUse/ToolResult pairs.
   *
   * Uses the same forward-search logic as SlidingWindowConversationManager for consistency.
   *
   * @param messages - The full list of messages
   * @param splitPoint - The initially calculated split point
   * @returns The adjusted split point
   */
  private _adjustSplitPointForToolPairs(messages: Message[], splitPoint: number): number {
    if (splitPoint > messages.length) {
      throw new ContextWindowOverflowError('Split point exceeds message array length')
    }

    if (splitPoint === messages.length) {
      return splitPoint
    }

    // Find the next valid split point
    while (splitPoint < messages.length) {
      const message = messages[splitPoint]!

      // Oldest remaining message cannot be a toolResult (needs preceding toolUse)
      const hasToolResult = message.content.some((block) => block.type === 'toolResultBlock')
      if (hasToolResult) {
        splitPoint++
        continue
      }

      // Oldest remaining message can be a toolUse only if a toolResult immediately follows
      const hasToolUse = message.content.some((block) => block.type === 'toolUseBlock')
      if (hasToolUse) {
        const nextMessage = messages[splitPoint + 1]
        const nextHasToolResult = nextMessage?.content.some((block) => block.type === 'toolResultBlock')
        if (!nextHasToolResult) {
          splitPoint++
          continue
        }
      }

      // Valid split point found
      break
    }

    if (splitPoint >= messages.length) {
      throw new ContextWindowOverflowError('Unable to trim conversation context!')
    }

    return splitPoint
  }

  /**
   * Returns the current state of the summarizing conversation manager.
   *
   * @returns A record containing the manager class name and configuration
   */
  public getState(): Record<string, JSONValue> {
    return {
      __name__: 'SummarizingConversationManager',
      summaryRatio: this._summaryRatio,
      preserveRecentMessages: this._preserveRecentMessages,
    }
  }

  /**
   * Restores state from a previously saved session.
   * The summarizing manager has no per-session state to restore beyond configuration.
   *
   * @param _state - The previously saved state (unused)
   * @returns null (no messages to prepend)
   */
  public restoreFromSession(_state: Record<string, JSONValue>): Message[] | null {
    return null
  }
}
