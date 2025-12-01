import {
  type ContentBlock,
  Message,
  ReasoningBlock,
  type Role,
  type SystemPrompt,
  TextBlock,
  ToolUseBlock,
} from '../types/messages.js'
import type { ToolChoice, ToolSpec } from '../tools/types.js'
import {
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  type ModelStreamEvent,
} from './streaming.js'
import { MaxTokensError } from '../errors.js'

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

  /**
   * Maximum number of tokens to generate in the response.
   *
   * @see Provider-specific documentation for exact behavior
   */
  maxTokens?: number

  /**
   * Controls randomness in generation.
   *
   * @see Provider-specific documentation for valid range
   */
  temperature?: number

  /**
   * Controls diversity via nucleus sampling.
   *
   * @see Provider-specific documentation for details
   */
  topP?: number
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
 * Result interface for the streamAggregated method.
 * Contains the complete message, stop reason, and optional metadata.
 */
export interface StreamAggregatedResult {
  /**
   * The complete message from the model.
   */
  message: Message

  /**
   * The reason why the model stopped generating.
   */
  stopReason: string

  /**
   * Optional metadata about the model invocation, including usage statistics and metrics.
   */
  metadata?: ModelMetadataEvent
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
export abstract class Model<T extends BaseModelConfig = BaseModelConfig> {
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
   * Converts event data to event class representation
   *
   * @param event_data - Interface representation of event
   * @returns Class representation of event
   */
  private _convert_to_class_event(event_data: ModelStreamEvent): ModelStreamEvent {
    switch (event_data.type) {
      case 'modelMessageStartEvent':
        return new ModelMessageStartEvent(event_data)
      case 'modelContentBlockStartEvent':
        return new ModelContentBlockStartEvent(event_data)
      case 'modelContentBlockDeltaEvent':
        return new ModelContentBlockDeltaEvent(event_data)
      case 'modelContentBlockStopEvent':
        return new ModelContentBlockStopEvent(event_data)
      case 'modelMessageStopEvent':
        return new ModelMessageStopEvent(event_data)
      case 'modelMetadataEvent':
        return new ModelMetadataEvent(event_data)
      default:
        throw new Error(`Unsupported event type: ${event_data}`)
    }
  }

  /**
   * Streams a conversation with aggregated content blocks and messages.
   * Returns an async generator that yields streaming events and content blocks, and returns the final message with stop reason and optional metadata.
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
   * - StreamAggregatedResult containing the complete message, stop reason, and optional metadata
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async generator yielding ModelStreamEvent | ContentBlock and returning a StreamAggregatedResult
   */
  async *streamAggregated(
    messages: Message[],
    options?: StreamOptions
  ): AsyncGenerator<ModelStreamEvent | ContentBlock, StreamAggregatedResult, undefined> {
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
    let errorToThrow: Error | undefined = undefined
    let stoppedMessage: Message | null = null
    let finalStopReason: string | null = null
    let metadata: ModelMetadataEvent | undefined = undefined

    for await (const event_data of this.stream(messages, options)) {
      const event = this._convert_to_class_event(event_data)
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
          try {
            if (toolUseId) {
              block = new ToolUseBlock({
                name: toolName,
                toolUseId: toolUseId,
                input: accumulatedToolInput ? JSON.parse(accumulatedToolInput) : {},
              })
              toolUseId = '' // Reset
              toolName = ''
            } else if (Object.keys(accumulatedReasoning).length > 0) {
              block = new ReasoningBlock({
                ...accumulatedReasoning,
              })
            } else {
              block = new TextBlock(accumulatedText)
            }
            contentBlocks.push(block)
            yield block
          } catch (e: unknown) {
            if (e instanceof SyntaxError) {
              console.error('Unable to parse JSON string.')
              errorToThrow = e
            }
          }
          break
        }

        case 'modelMessageStopEvent':
          // Store message and stop reason
          if (messageRole) {
            stoppedMessage = new Message({
              role: messageRole,
              content: [...contentBlocks],
            })
            finalStopReason = event.stopReason!
          }
          break

        case 'modelMetadataEvent':
          // Store metadata, keeping the last one if multiple events occur
          metadata = event
          break

        default:
          break
      }
    }

    if (!stoppedMessage || !finalStopReason) {
      // If we exit the loop without completing a message or stop reason, throw an error
      throw new Error('Stream ended without completing a message', {
        cause: errorToThrow,
      })
    }

    // Handle stop reason
    if (finalStopReason === 'maxTokens') {
      const maxTokensError = new MaxTokensError(
        'Model reached maximum token limit. This is an unrecoverable state that requires intervention.',
        stoppedMessage
      )
      if (errorToThrow !== undefined) {
        errorToThrow.cause = maxTokensError
      } else {
        errorToThrow = maxTokensError
      }
    }

    if (errorToThrow !== undefined) {
      throw errorToThrow
    }

    // Return the final message with stop reason and optional metadata
    const result: StreamAggregatedResult = {
      message: stoppedMessage,
      stopReason: finalStopReason,
    }
    if (metadata !== undefined) {
      result.metadata = metadata
    }
    return result
  }
}
