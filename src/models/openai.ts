/**
 * OpenAI model provider implementation.
 *
 * This module provides integration with OpenAI's Chat Completions API,
 * supporting streaming responses, tool use, and configurable model parameters.
 *
 * @see https://platform.openai.com/docs/api-reference/chat/create
 */

import OpenAI, { type ClientOptions } from 'openai'
import type { Model, BaseModelConfig, StreamOptions } from '../models/model'
import type { Message } from '../types/messages'
import type { ModelStreamEvent } from '../models/streaming'

/**
 * Configuration interface for OpenAI model provider.
 *
 * Extends BaseModelConfig with OpenAI-specific configuration options
 * for model parameters and request settings.
 *
 * @example
 * ```typescript
 * const config: OpenAIModelConfig = {
 *   modelId: 'gpt-4o',
 *   temperature: 0.7,
 *   maxTokens: 1024
 * }
 * ```
 */
export interface OpenAIModelConfig extends BaseModelConfig {
  /**
   * OpenAI model identifier (e.g., gpt-4o, gpt-3.5-turbo).
   */
  modelId: string

  /**
   * Controls randomness in generation (0 to 2).
   */
  temperature?: number

  /**
   * Maximum number of tokens to generate in the response.
   */
  maxTokens?: number

  /**
   * Controls diversity via nucleus sampling (0 to 1).
   */
  topP?: number

  /**
   * Reduces repetition of token sequences (-2.0 to 2.0).
   */
  frequencyPenalty?: number

  /**
   * Encourages the model to talk about new topics (-2.0 to 2.0).
   */
  presencePenalty?: number

  /**
   * Additional parameters to pass through to the OpenAI API.
   * This field provides forward compatibility for any new parameters
   * that OpenAI introduces. All properties in this object will be
   * spread into the API request.
   *
   * @example
   * ```typescript
   * // Pass stop sequences
   * { params: { stop: ['END', 'STOP'] } }
   *
   * // Pass any future OpenAI parameters
   * { params: { newParameter: 'value' } }
   * ```
   */
  params?: Record<string, unknown>
}

/**
 * Options interface for creating an OpenAIModel instance.
 */
export interface OpenAIModelOptions extends OpenAIModelConfig {
  /**
   * OpenAI API key (falls back to OPENAI_API_KEY environment variable).
   */
  apiKey?: string

  /**
   * Additional OpenAI client configuration.
   */
  clientConfig?: ClientOptions
}

/**
 * OpenAI model provider implementation.
 *
 * Implements the Model interface for OpenAI using the Chat Completions API.
 * Supports streaming responses, tool use, and comprehensive configuration.
 *
 * @example
 * ```typescript
 * const provider = new OpenAIModel({
 *   apiKey: 'sk-...',
 *   modelId: 'gpt-4o',
 *   temperature: 0.7,
 *   maxTokens: 1024
 * })
 *
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
export class OpenAIModel implements Model<OpenAIModelConfig, ClientOptions> {
  private _config: OpenAIModelConfig
  private _client: OpenAI

  /**
   * Creates a new OpenAIModel instance.
   *
   * @param options - Configuration for model and client (modelId is required)
   *
   * @example
   * ```typescript
   * // Minimal configuration with API key and model ID
   * const provider = new OpenAIModel({
   *   modelId: 'gpt-4o',
   *   apiKey: 'sk-...'
   * })
   *
   * // With additional model configuration
   * const provider = new OpenAIModel({
   *   modelId: 'gpt-4o',
   *   apiKey: 'sk-...',
   *   temperature: 0.8,
   *   maxTokens: 2048
   * })
   *
   * // Using environment variable for API key
   * const provider = new OpenAIModel({
   *   modelId: 'gpt-3.5-turbo'
   * })
   * ```
   */
  constructor(options: OpenAIModelOptions) {
    // Check if API key is available
    // eslint-disable-next-line no-undef
    if (!options.apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error(
        "OpenAI API key is required. Provide it via the 'apiKey' option or set the OPENAI_API_KEY environment variable."
      )
    }

    const { apiKey, clientConfig, ...modelConfig } = options

    // Initialize model config
    this._config = modelConfig

    // Initialize OpenAI client
    // Only include apiKey if explicitly provided, otherwise let client use env var
    this._client = new OpenAI({
      ...(apiKey ? { apiKey } : {}),
      ...clientConfig,
    })
  }

  /**
   * Updates the model configuration.
   * Merges the provided configuration with existing settings.
   *
   * @param modelConfig - Configuration object with model-specific settings to update
   *
   * @example
   * ```typescript
   * // Update temperature and maxTokens
   * provider.updateConfig({
   *   temperature: 0.9,
   *   maxTokens: 2048
   * })
   * ```
   */
  updateConfig(modelConfig: OpenAIModelConfig): void {
    this._config = { ...this._config, ...modelConfig }
  }

  /**
   * Retrieves the current model configuration.
   *
   * @returns The current configuration object
   *
   * @example
   * ```typescript
   * const config = provider.getConfig()
   * console.log(config.modelId)
   * ```
   */
  getConfig(): OpenAIModelConfig {
    return this._config
  }

  /**
   * Streams a conversation with the OpenAI model.
   * Returns an async iterable that yields streaming events as they occur.
   *
   * Note: This method will be implemented in Task 04.2.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   *
   * @throws Error indicating implementation pending in Task 04.2
   */
  // eslint-disable-next-line require-yield, @typescript-eslint/no-unused-vars
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    throw new Error('Not yet implemented - will be completed in Task 04.2')
  }
}
