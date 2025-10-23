import type { Message, SystemPrompt } from '../types/messages'
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
}
