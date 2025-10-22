import type { Message } from '@/types/messages'
import type { ToolSpec, ToolChoice } from '@/tools/types'
import type { ModelProviderStreamEvent } from '@/models/streaming'

/**
 * Base configuration interface for all model providers.
 *
 * This interface defines the common configuration properties that all
 * model providers should support. Provider-specific configurations
 * should extend this interface.
 *
 * @example
 * ```typescript
 * interface MyProviderConfig extends BaseModelConfig {
 *   apiKey: string
 *   maxRetries: number
 * }
 * ```
 */
export interface BaseModelConfig {
  /**
   * The model identifier.
   * This typically specifies which model to use from the provider's catalog.
   *
   * @example
   * ```typescript
   * // Bedrock model ID
   * modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0'
   *
   * // OpenAI model ID
   * modelId: 'gpt-4o'
   * ```
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
 * Constructor interface for model providers.
 * Defines the expected constructor signature for ModelProvider implementations.
 *
 * @typeParam T - Model configuration type extending BaseModelConfig
 * @typeParam C - Initialization options type
 *
 * @example
 * ```typescript
 * interface MyProviderOptions {
 *   modelConfig?: MyProviderConfig
 *   clientConfig?: MyClientConfig
 * }
 *
 * class MyProvider implements ModelProvider<MyProviderConfig, MyProviderOptions> {
 *   constructor(options?: MyProviderOptions) {
 *     // Initialize with options
 *   }
 * }
 * ```
 */
export interface ModelProviderConstructor<T extends BaseModelConfig, C = unknown> {
  new (initOptions?: C): ModelProvider<T, C>
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
 *
 * @example
 * ```typescript
 * interface MyProviderConfig extends BaseModelConfig {
 *   temperature: number
 *   maxTokens: number
 * }
 *
 * interface MyClientConfig {
 *   apiKey: string
 *   baseUrl?: string
 * }
 *
 * class MyProvider implements ModelProvider<MyProviderConfig, MyClientConfig> {
 *   private config: MyProviderConfig
 *
 *   constructor(options?: { modelConfig?: MyProviderConfig; clientConfig?: MyClientConfig }) {
 *     const modelConfig = options?.modelConfig || {}
 *     this.config = { ...modelConfig }
 *     // Initialize client with options?.clientConfig
 *   }
 *
 *   updateConfig(modelConfig: MyProviderConfig): void {
 *     this.config = { ...this.config, ...modelConfig }
 *   }
 *
 *   getConfig(): MyProviderConfig {
 *     return this.config
 *   }
 *
 *   async *stream(
 *     messages: Message[],
 *     options?: StreamOptions
 *   ): AsyncIterable<ModelProviderStreamEvent> {
 *     // Implementation for streaming from LLM
 *     yield { type: 'modelMessageStartEvent', role: 'assistant' }
 *     yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: 'Hello' } }
 *     yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ModelProvider<T extends BaseModelConfig, _C = unknown> {
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
   *
   * @example
   * ```typescript
   * const messages: Message[] = [
   *   { role: 'user', content: [{ type: 'textBlock', text: 'Hello!' }] }
   * ]
   *
   * for await (const event of provider.stream(messages)) {
   *   if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
   *     process.stdout.write(event.delta.text)
   *   }
   * }
   * ```
   */
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelProviderStreamEvent>
}
