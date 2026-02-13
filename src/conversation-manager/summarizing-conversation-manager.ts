/**
 * Summarizing conversation history management with configurable options.
 *
 * This module provides a conversation manager that summarizes older context
 * instead of simply trimming it, helping preserve important information while
 * staying within context limits.
 */

import type { Agent } from '../agent/agent.js'
import { ContextWindowOverflowError } from '../errors.js'
import type { HookProvider } from '../hooks/types.js'
import type { HookRegistry } from '../hooks/registry.js'
import { AfterModelCallEvent } from '../hooks/events.js'
import { Message, TextBlock } from '../types/messages.js'
import type { StreamOptions } from '../models/model.js'

const DEFAULT_SUMMARIZATION_PROMPT = `You are a conversation summarizer. Provide a concise summary of the conversation history.

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

## Tools Executed
* Tool X: Result Y`

/**
 * Configuration for the summarizing conversation manager.
 */
export type SummarizingConversationManagerConfig = {
  /**
   * Ratio of messages to summarize vs keep when context overflow occurs.
   * Value between 0.1 and 0.8. Defaults to 0.3 (summarize 30% of oldest messages).
   */
  summaryRatio?: number

  /**
   * Minimum number of recent messages to always keep.
   * Defaults to 10 messages.
   */
  preserveRecentMessages?: number

  /**
   * Optional agent to use for summarization instead of the parent agent.
   * If provided, this agent can use tools as part of the summarization process.
   */
  summarizationAgent?: Agent

  /**
   * Optional system prompt override for summarization.
   * If not provided, uses the default summarization prompt.
   * Cannot be used together with summarizationAgent.
   */
  summarizationSystemPrompt?: string
}

/**
 * Implements a summarizing conversation manager.
 *
 * This manager provides a configurable option to summarize older context instead of
 * simply trimming it, helping preserve important information while staying within
 * context limits.
 *
 * As a HookProvider, it registers callbacks for:
 * - AfterModelCallEvent: Reduces context on overflow errors and requests retry
 */
export class SummarizingConversationManager implements HookProvider {
  private readonly _summaryRatio: number
  private readonly _preserveRecentMessages: number
  private readonly _summarizationAgent?: Agent
  private readonly _summarizationSystemPrompt?: string
  private _summaryMessage?: Message

  /**
   * Initialize the summarizing conversation manager.
   *
   * @param config - Configuration options for the summarizing manager.
   */
  constructor(config?: SummarizingConversationManagerConfig) {
    if (config?.summarizationAgent && config?.summarizationSystemPrompt) {
      throw new Error(
        'Cannot provide both summarizationAgent and summarizationSystemPrompt. Agents come with their own system prompt.'
      )
    }

    this._summaryRatio = Math.max(0.1, Math.min(0.8, config?.summaryRatio ?? 0.3))
    this._preserveRecentMessages = config?.preserveRecentMessages ?? 10

    if (config?.summarizationAgent !== undefined) {
      this._summarizationAgent = config.summarizationAgent
    }

    if (config?.summarizationSystemPrompt !== undefined) {
      this._summarizationSystemPrompt = config.summarizationSystemPrompt
    }
  }

  /**
   * Registers callbacks with the hook registry.
   *
   * Registers:
   * - AfterModelCallEvent callback to handle context overflow and request retry
   *
   * @param registry - The hook registry to register callbacks with
   */
  public registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(AfterModelCallEvent, async (event) => {
      if (event.error instanceof ContextWindowOverflowError) {
        await this.reduceContext(event.agent as Agent)
        event.retry = true
      }
    })
  }

  /**
   * Reduce context using summarization.
   *
   * @param agent - The agent whose conversation history will be reduced.
   *
   * @throws ContextWindowOverflowError If the context cannot be summarized.
   */
  private async reduceContext(agent: Agent): Promise<void> {
    const messagesToSummarizeCount = this.calculateSummarizeCount(agent.messages.length)

    if (messagesToSummarizeCount <= 0) {
      throw new ContextWindowOverflowError('Cannot summarize: insufficient messages for summarization')
    }

    const adjustedCount = this.adjustSplitPointForToolPairs(agent.messages, messagesToSummarizeCount)

    if (adjustedCount <= 0) {
      throw new ContextWindowOverflowError('Cannot summarize: insufficient messages for summarization')
    }

    const messagesToSummarize = agent.messages.slice(0, adjustedCount)
    const remainingMessages = agent.messages.slice(adjustedCount)

    this._summaryMessage = await this.generateSummary(messagesToSummarize, agent)

    agent.messages.splice(0, agent.messages.length, this._summaryMessage, ...remainingMessages)
  }

  /**
   * Calculate how many messages to summarize.
   *
   * @param totalMessages - Total number of messages in conversation
   * @returns Number of messages to summarize
   */
  private calculateSummarizeCount(totalMessages: number): number {
    const count = Math.max(1, Math.floor(totalMessages * this._summaryRatio))
    return Math.max(0, Math.min(count, totalMessages - this._preserveRecentMessages))
  }

  /**
   * Adjust the split point to avoid breaking ToolUse/ToolResult pairs.
   *
   * @param messages - The full list of messages.
   * @param splitPoint - The initially calculated split point.
   * @returns The adjusted split point that doesn't break ToolUse/ToolResult pairs.
   *
   * @throws ContextWindowOverflowError If no valid split point can be found.
   */
  private adjustSplitPointForToolPairs(messages: Message[], splitPoint: number): number {
    if (splitPoint > messages.length) {
      throw new ContextWindowOverflowError('Split point exceeds message array length')
    }

    if (splitPoint === messages.length) {
      return splitPoint
    }

    while (splitPoint < messages.length) {
      const message = messages[splitPoint]
      if (!message) {
        break
      }

      const hasToolResult = message.content.some((block) => block.type === 'toolResultBlock')
      if (hasToolResult) {
        splitPoint++
        continue
      }

      const hasToolUse = message.content.some((block) => block.type === 'toolUseBlock')
      if (hasToolUse) {
        const nextMessage = messages[splitPoint + 1]
        const nextHasToolResult = nextMessage?.content.some((block) => block.type === 'toolResultBlock')

        if (!nextHasToolResult) {
          splitPoint++
          continue
        }
      }

      break
    }

    if (splitPoint >= messages.length) {
      throw new ContextWindowOverflowError('Unable to trim conversation context!')
    }

    return splitPoint
  }

  /**
   * Generate a summary of the provided messages.
   *
   * @param messages - The messages to summarize.
   * @param agent - The agent instance whose model will be used for summarization.
   * @returns A message containing the conversation summary.
   */
  private async generateSummary(messages: Message[], agent: Agent): Promise<Message> {
    if (this._summarizationAgent) {
      return this.generateSummaryWithAgent(messages)
    }
    return this.generateSummaryWithModel(messages, agent)
  }

  /**
   * Generate a summary using the dedicated summarization agent.
   *
   * @param messages - The messages to summarize.
   * @returns A message containing the conversation summary.
   */
  private async generateSummaryWithAgent(messages: Message[]): Promise<Message> {
    const summarizationAgent = this._summarizationAgent!
    const originalMessages = [...summarizationAgent.messages]

    try {
      summarizationAgent.messages.splice(0, summarizationAgent.messages.length, ...messages)
      const result = await summarizationAgent.invoke('Please summarize this conversation.')
      return new Message({
        role: 'user',
        content: result.lastMessage.content,
      })
    } finally {
      summarizationAgent.messages.splice(0, summarizationAgent.messages.length, ...originalMessages)
    }
  }

  /**
   * Generate a summary by calling the agent's model directly.
   *
   * @param messages - The messages to summarize.
   * @param agent - The parent agent whose model is used.
   * @returns A message containing the conversation summary.
   */
  private async generateSummaryWithModel(messages: Message[], agent: Agent): Promise<Message> {
    const systemPrompt = this._summarizationSystemPrompt ?? DEFAULT_SUMMARIZATION_PROMPT

    const summarizationMessages = [
      ...messages,
      new Message({
        role: 'user',
        content: [new TextBlock('Please summarize this conversation.')],
      }),
    ]

    const streamOptions: StreamOptions = {
      systemPrompt,
    }

    const streamGenerator = agent.model.streamAggregated(summarizationMessages, streamOptions)

    let result = await streamGenerator.next()
    while (!result.done) {
      result = await streamGenerator.next()
    }

    const { message } = result.value

    return new Message({
      role: 'user',
      content: message.content,
    })
  }
}
