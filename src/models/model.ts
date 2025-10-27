import type { Message, ContentBlock, Role } from '../types/messages'
import type { ToolSpec, ToolChoice } from '../tools/types'
import type { ModelStreamEvent } from './streaming'

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
   */
  systemPrompt?: string

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
 * Base interface for model providers.
 * Defines the contract that all model provider implementations must follow.
 *
 * Model providers handle communication with LLM APIs and implement streaming
 * responses using async iterables.
 *
 * @typeParam T - Model configuration type extending BaseModelConfig
 * @typeParam _C - Client configuration type for provider-specific client setup (used by implementations)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Model<T extends BaseModelConfig, _C = unknown> {
  /**
   * Updates the model configuration.
   * Merges the provided configuration with existing settings.
   *
   * @param modelConfig - Configuration object with model-specific settings to update
   */
  updateConfig(modelConfig: T): void

  /**
   * Retrieves the current model configuration.
   *
   * @returns The current configuration object
   */
  getConfig(): T

  /**
   * Streams a conversation with the model.
   * Returns an async iterable that yields streaming events as they occur.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   */
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent>

  /**
   * Streams a conversation with aggregated content blocks and messages.
   * Returns an async iterable that yields streaming events, complete content blocks, and complete messages.
   *
   * This method enhances the basic stream() by collecting streaming events into complete
   * ContentBlock and Message objects, which are needed by the agentic loop for tool execution
   * and conversation management.
   *
   * The method yields a union of three types (all with discriminator `type` field):
   * - ModelStreamEvent - Original streaming events (passed through)
   * - ContentBlock - Complete content block (emitted when block completes)
   * - Message - Complete message (emitted when message completes)
   *
   * All returned types support type-safe switch-case handling via the `type` discriminator field.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable yielding ModelStreamEvent | ContentBlock | Message
   *
   * @throws \{StreamAggregationError\} When stream ends unexpectedly or contains malformed events
   */
  streamAggregated(
    messages: Message[],
    options?: StreamOptions
  ): AsyncIterable<ModelStreamEvent | ContentBlock | Message>
}

/**
 * Helper function that wraps a streaming model to provide aggregated content blocks and messages.
 * This implements the aggregation logic that collects streaming events into complete objects.
 *
 * @param streamFn - Function that returns an async iterable of streaming events
 * @returns Async iterable yielding ModelStreamEvent | ContentBlock | Message
 */
export async function* aggregateStream(
  streamFn: () => AsyncIterable<ModelStreamEvent>
): AsyncIterable<ModelStreamEvent | ContentBlock | Message> {
  // State maintained in closure
  let messageRole: Role | null = null
  const contentBlocks: ContentBlock[] = []
  let accumulatedText = ''
  let accumulatedToolInput = ''
  let toolName = ''
  let toolUseId = ''
  const accumulatedReasoning: {
    text?: string
    signature?: string
    redactedContent?: Uint8Array
  } = {}

  for await (const event of streamFn()) {
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
          accumulatedToolInput = ''
        } else {
          accumulatedText = ''
        }
        // Reset reasoning accumulator
        Object.keys(accumulatedReasoning).forEach(
          (key) => delete accumulatedReasoning[key as keyof typeof accumulatedReasoning]
        )
        break

      case 'modelContentBlockDeltaEvent':
        switch (event.delta.type) {
          case 'textDelta':
            accumulatedText += event.delta.text
            break
          case 'toolUseInputDelta':
            accumulatedToolInput += event.delta.input
            break
          case 'reasoningDelta':
            if (event.delta.reasoningContent.text)
              accumulatedReasoning.text = (accumulatedReasoning.text ?? '') + event.delta.reasoningContent.text
            if (event.delta.reasoningContent.signature)
              accumulatedReasoning.signature = event.delta.reasoningContent.signature
            if (event.delta.reasoningContent.redactedContent)
              accumulatedReasoning.redactedContent = event.delta.reasoningContent.redactedContent
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
        // Emit complete Message
        if (messageRole) {
          const message: Message = {
            type: 'message',
            role: messageRole,
            content: [...contentBlocks],
          }
          yield message
          messageRole = null
        }
        break

      case 'modelMetadataEvent':
        // Pass through - already yielded above
        break
    }
  }
}
