/**
 * Google model provider implementation.
 *
 * This module provides integration with Google's Gemini API,
 * supporting streaming responses and configurable model parameters.
 *
 * @see https://ai.google.dev/docs
 */

import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  type GenerateContentConfig,
  type GenerateContentParameters,
} from '@google/genai'
import { Model } from '../model.js'
import type { StreamOptions } from '../model.js'
import type { Message } from '../../types/messages.js'
import type { ModelStreamEvent } from '../streaming.js'
import { ContextWindowOverflowError, ModelThrottledError } from '../../errors.js'
import type { GoogleModelConfig, GoogleModelOptions, GoogleStreamState } from './types.js'
export type { GoogleModelConfig, GoogleModelOptions }
import { classifyGoogleError } from './errors.js'
import { formatMessages, mapChunkToEvents } from './adapters.js'

/**
 * Default Gemini model ID.
 */
const DEFAULT_GEMINI_MODEL_ID = 'gemini-2.5-flash'

/**
 * Google model provider implementation.
 *
 * Implements the Model interface for Google GenAI using the Generative AI API.
 * Supports streaming responses and comprehensive configuration.
 *
 * @example
 * ```typescript
 * const provider = new GoogleModel({
 *   apiKey: 'your-api-key',
 *   modelId: 'gemini-2.5-flash',
 *   params: { temperature: 0.7, maxOutputTokens: 1024 }
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
export class GoogleModel extends Model<GoogleModelConfig> {
  private _config: GoogleModelConfig
  private _client: GoogleGenAI

  /**
   * Creates a new GoogleModel instance.
   *
   * @param options - Configuration for model and client
   *
   * @example
   * ```typescript
   * // Minimal configuration with API key
   * const provider = new GoogleModel({
   *   apiKey: 'your-api-key'
   * })
   *
   * // With model configuration
   * const provider = new GoogleModel({
   *   apiKey: 'your-api-key',
   *   modelId: 'gemini-2.5-flash',
   *   params: { temperature: 0.8, maxOutputTokens: 2048 }
   * })
   *
   * // Using environment variable for API key
   * const provider = new GoogleModel({
   *   modelId: 'gemini-2.5-flash'
   * })
   *
   * // Using a pre-configured client instance
   * const client = new GoogleGenAI({ apiKey: 'your-api-key' })
   * const provider = new GoogleModel({
   *   client
   * })
   * ```
   */
  constructor(options?: GoogleModelOptions) {
    super()
    const { apiKey, client, clientConfig, ...modelConfig } = options || {}

    this._config = modelConfig

    if (client) {
      this._client = client
    } else {
      const resolvedApiKey = apiKey || GoogleModel._getEnvApiKey()

      if (!resolvedApiKey) {
        throw new Error(
          "Gemini API key is required. Provide it via the 'apiKey' option or set the GEMINI_API_KEY environment variable."
        )
      }

      this._client = new GoogleGenAI({
        apiKey: resolvedApiKey,
        ...clientConfig,
      })
    }
  }

  /**
   * Updates the model configuration.
   * Merges the provided configuration with existing settings.
   *
   * @param modelConfig - Configuration object with model-specific settings to update
   *
   * @example
   * ```typescript
   * // Update model parameters
   * provider.updateConfig({
   *   params: { temperature: 0.9, maxOutputTokens: 2048 }
   * })
   * ```
   */
  updateConfig(modelConfig: GoogleModelConfig): void {
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
  getConfig(): GoogleModelConfig {
    return this._config
  }

  /**
   * Streams a conversation with the Google model.
   * Returns an async iterable that yields streaming events as they occur.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   *
   * @throws \{ContextWindowOverflowError\} When input exceeds the model's context window
   *
   * @example
   * ```typescript
   * const provider = new GoogleModel({ apiKey: 'your-api-key' })
   * const messages: Message[] = [
   *   { role: 'user', content: [{ type: 'textBlock', text: 'What is 2+2?' }] }
   * ]
   *
   * for await (const event of provider.stream(messages)) {
   *   if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
   *     process.stdout.write(event.delta.text)
   *   }
   * }
   * ```
   */
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    if (!messages || messages.length === 0) {
      throw new Error('At least one message is required')
    }

    try {
      const params = this._formatRequest(messages, options)
      const stream = await this._client.models.generateContentStream(params)

      const streamState: GoogleStreamState = {
        messageStarted: false,
        textContentBlockStarted: false,
        reasoningContentBlockStarted: false,
        hasToolCalls: false,
        inputTokens: 0,
        outputTokens: 0,
      }

      for await (const chunk of stream) {
        yield* mapChunkToEvents(chunk, streamState)
      }

      if (streamState.inputTokens > 0 || streamState.outputTokens > 0) {
        yield {
          type: 'modelMetadataEvent',
          usage: {
            inputTokens: streamState.inputTokens,
            outputTokens: streamState.outputTokens,
            totalTokens: streamState.inputTokens + streamState.outputTokens,
          },
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }
      const errorType = classifyGoogleError(error)

      if (errorType === 'contextOverflow') {
        throw new ContextWindowOverflowError(error.message)
      }

      if (errorType === 'throttling') {
        throw new ModelThrottledError(error.message, { cause: error })
      }

      throw error
    }
  }

  /**
   * Gets API key from environment variables.
   */
  private static _getEnvApiKey(): string | undefined {
    return globalThis?.process?.env?.GEMINI_API_KEY
  }

  /**
   * Formats a request for the Google GenAI API.
   */
  private _formatRequest(messages: Message[], options?: StreamOptions): GenerateContentParameters {
    const contents = formatMessages(messages)
    const config: GenerateContentConfig = {}

    // Add system instruction
    if (options?.systemPrompt !== undefined) {
      if (typeof options.systemPrompt === 'string') {
        if (options.systemPrompt.trim().length > 0) {
          config.systemInstruction = options.systemPrompt
        }
      } else if (Array.isArray(options.systemPrompt) && options.systemPrompt.length > 0) {
        const textBlocks: string[] = []

        for (const block of options.systemPrompt) {
          if (block.type === 'textBlock') {
            textBlocks.push(block.text)
          }
        }

        if (textBlocks.length > 0) {
          config.systemInstruction = textBlocks.join('')
        }
      }
    }

    // Add tool specifications
    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      config.tools = [
        {
          functionDeclarations: options.toolSpecs.map((spec) => ({
            name: spec.name,
            description: spec.description,
            parametersJsonSchema: spec.inputSchema,
          })),
        },
      ]

      if (options.toolChoice) {
        if ('auto' in options.toolChoice) {
          config.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
        } else if ('any' in options.toolChoice) {
          config.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } }
        } else if ('tool' in options.toolChoice) {
          config.toolConfig = {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: [options.toolChoice.tool.name],
            },
          }
        }
      }
    }

    // Append built-in tools (e.g., GoogleSearch, CodeExecution)
    if (this._config.builtInTools && this._config.builtInTools.length > 0) {
      if (!config.tools) {
        config.tools = []
      }
      config.tools.push(...this._config.builtInTools)
    }

    // Spread params object for forward compatibility
    if (this._config.params) {
      Object.assign(config, this._config.params)
    }

    return {
      model: this._config.modelId ?? DEFAULT_GEMINI_MODEL_ID,
      contents,
      config,
    }
  }
}
