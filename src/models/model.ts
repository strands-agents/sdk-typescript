import {
  type Message,
  type ContentBlock,
  type Role,
  type SystemPrompt,
  Message as MessageClass,
  TextBlock,
  ToolUseBlock,
  ReasoningBlock,
} from '../types/messages.js'
import type { ToolSpec, ToolChoice } from '../tools/types.js'
import {
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  type ModelStreamEvent,
  type ModelStreamEventData,
} from './streaming.js'

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
  abstract stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEventData>

  /**
   * Converts event data to event class representation
   *
   * @param event_data - Interface representation of event
   * @returns Class representation of event
   */
  private _convert_to_class_event(event_data: ModelStreamEventData): ModelStreamEvent {
    if ('modelMessageStartEvent' in event_data) {
      return new ModelMessageStartEvent(event_data.modelMessageStartEvent)
    } else if ('modelContentBlockStartEvent' in event_data) {
      return new ModelContentBlockStartEvent(event_data.modelContentBlockStartEvent)
    } else if ('modelContentBlockDeltaEvent' in event_data) {
      return new ModelContentBlockDeltaEvent()
    } else if ('modelContentBlockStopEvent' in event_data) {
      return new ModelContentBlockStopEvent(event_data.modelContentBlockStopEvent)
    } else if ('modelMessageStopEvent' in event_data) {
      return new ModelMessageStopEvent(event_data.modelMessageStopEvent)
    } else if ('modelMetadataEvent' in event_data) {
      return new ModelMetadataEvent(event_data.modelMetadataEvent)
    } else {
      throw new Error(`Unsupported event type: ${event_data}`)
    }
  }

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
  ): AsyncGenerator<ModelStreamEvent | ContentBlock, { message: MessageClass; stopReason: string }, never> {
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

    for await (const event_data of this.stream(messages, options)) {
      const event = this._convert_to_class_event(event_data)
      if (event !== undefined) {
        yield event // Pass through immediately

        // Aggregation logic based on event type
        const type = event.type
        switch (type) {
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
              const toolUseBlock = new ToolUseBlock({
                name: toolName,
                toolUseId: toolUseId,
                input: JSON.parse(accumulatedToolInput),
              })
              block = { toolUseBlock }

              toolUseId = '' // Reset
              toolName = ''
            } else if (Object.keys(accumulatedReasoning).length > 0) {
              const reasoningBlock = new ReasoningBlock(accumulatedReasoning)
              block = { reasoningBlock }
            } else {
              const textBlock = new TextBlock({ text: accumulatedText })
              block = { textBlock }
            }
            contentBlocks.push(block)
            yield block
            break
          }
          case 'modelMessageStopEvent':
            // Complete message - will be returned at the end
            if (messageRole) {
              const message = new MessageClass({
                role: messageRole,
                content: [...contentBlocks],
              })
              return { message, stopReason: event.stopReason }
            }
            break
          case 'modelMetadataEvent':
            // TODO: Add metadata metrics support: https://github.com/strands-agents/sdk-typescript/issues/70
            break
        }
      }
    }

    // If we exit the loop without returning a message, throw an error
    throw new Error('Stream ended without completing a message')
  }
}
