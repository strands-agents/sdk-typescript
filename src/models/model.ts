import type { Message, ContentBlock, Role, SystemPrompt } from '../types/messages.js'
import type { ToolSpec, ToolChoice } from '../tools/types.js'
import type { ModelStreamEvent } from './streaming.js'

/**
 * Base configuration interface for all model providers.
 *
 * This interface defines the common configuration properties that all
 * model providers should support. Provider-specific configurations
 * should extend this interface.
 */
export interface BaseModelConfig {
  /**
   * The model identifier.
   * This typically specifies which model to use from the provider's catalog.
   */
  modelId?: string
}

/**
 * Options interface for configuring streaming model invocation.
 */
export interface StreamOptions {
  /**
   * System prompt to guide the model's behavior.
   * Can be a simple string or an array of content blocks for advanced caching.
   */
  systemPrompt?: SystemPrompt

  /**
   * Array of tool specifications that the model can use.
   */
  toolSpecs?: ToolSpec[]

  /**
   * Controls how the model selects tools to use.
   */
  toolChoice?: ToolChoice
}

/**
 * Base abstract class for model providers.
 * Defines the contract that all model provider implementations must follow.
 *
 * Model providers handle communication with LLM APIs and implement streaming
 * responses using async iterables.
 *
 * @typeParam T - Model configuration type extending BaseModelConfig
 */
export abstract class Model<T extends BaseModelConfig> {
  /**
   * Updates the model configuration.
   * Merges the provided configuration with existing settings.
   *
   * @param modelConfig - Configuration object with model-specific settings to update
   */
  abstract updateConfig(modelConfig: T): void

  /**
   * Retrieves the current model configuration.
   *
   * @returns The current configuration object
   */
  abstract getConfig(): T

  /**
   * Streams a conversation with the model.
   * Returns an async iterable that yields streaming events as they occur.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   */
  abstract stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent>

  /**
   * Streams a conversation with aggregated content blocks and messages.
   * Returns an async generator that yields streaming events and content blocks, and returns the final message with stop reason.
   *
   * This method enhances the basic stream() by collecting streaming events into complete
   * ContentBlock and Message objects, which are needed by the agentic loop for tool execution
   * and conversation management.
   *
   * The method yields:
   * - ModelStreamEvent - Original streaming events (passed through)
   * - ContentBlock - Complete content block (emitted when block completes)
   *
   * The method returns:
   * - Object containing the complete message and stop reason
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async generator yielding ModelStreamEvent | ContentBlock and returning an object with message and stopReason
   */
  async *streamAggregated(
    messages: Message[],
    options?: StreamOptions
  ): AsyncGenerator<ModelStreamEvent | ContentBlock, { message: Message; stopReason: string }, never> {
    // State maintained in closure
    let messageRole: Role | null = null
    const contentBlocks: ContentBlock[] = []
    let accumulatedText = ''
    let accumulatedToolInput = ''
    let toolName = ''
    let toolUseId = ''
    let accumulatedReasoning: {
      text?: string
      signature?: string
      redactedContent?: Uint8Array
    } = {}

    for await (const event of this.stream(messages, options)) {
      yield event // Pass through immediately

      // Aggregation logic based on event type
      switch (event.type) {
        case 'modelMessageStartEvent':
          messageRole = event.role
          contentBlocks.length = 0 // Reset
          break

        case 'modelContentBlockStartEvent':
          if (event.start?.type === 'toolUseStart') {
            toolName = event.start.name
            toolUseId = event.start.toolUseId
          }
          accumulatedToolInput = ''
          accumulatedText = ''
          accumulatedReasoning = {}
          break

        case 'modelContentBlockDeltaEvent':
          switch (event.delta.type) {
            case 'textDelta':
              accumulatedText += event.delta.text
              break
            case 'toolUseInputDelta':
              accumulatedToolInput += event.delta.input
              break
            case 'reasoningContentDelta':
              if (event.delta.text) accumulatedReasoning.text = (accumulatedReasoning.text ?? '') + event.delta.text
              if (event.delta.signature) accumulatedReasoning.signature = event.delta.signature
              if (event.delta.redactedContent) accumulatedReasoning.redactedContent = event.delta.redactedContent
              break
          }
          break

        case 'modelContentBlockStopEvent': {
          // Finalize and emit complete ContentBlock
          let block: ContentBlock
          if (toolUseId) {
            block = {
              type: 'toolUseBlock',
              name: toolName,
              toolUseId: toolUseId,
              input: JSON.parse(accumulatedToolInput),
            }
            toolUseId = '' // Reset
            toolName = ''
          } else if (Object.keys(accumulatedReasoning).length > 0) {
            block = {
              type: 'reasoningBlock',
              ...accumulatedReasoning,
            }
          } else {
            block = {
              type: 'textBlock',
              text: accumulatedText,
            }
          }
          contentBlocks.push(block)
          yield block
          break
        }

        case 'modelMessageStopEvent':
          // Complete message and return with stop reason
          if (messageRole) {
            const message: Message = {
              type: 'message',
              role: messageRole,
              content: [...contentBlocks],
            }
            return { message, stopReason: event.stopReason! }
          }
          break

        default:
          break
      }
    }

    // If we exit the loop without returning a message, throw an error
    throw new Error('Stream ended without completing a message')
  }
}
