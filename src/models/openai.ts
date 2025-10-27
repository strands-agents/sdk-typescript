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
import { ContextWindowOverflowError } from '../errors'

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
   * Pre-configured OpenAI client instance.
   * If provided, this client will be used instead of creating a new one.
   */
  client?: OpenAI

  /**
   * Additional OpenAI client configuration.
   * Only used if client is not provided.
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
   *
   * // Using a pre-configured client instance
   * const client = new OpenAI({ apiKey: 'sk-...', timeout: 60000 })
   * const provider = new OpenAIModel({
   *   modelId: 'gpt-4o',
   *   client
   * })
   * ```
   */
  constructor(options: OpenAIModelOptions) {
    const { apiKey, client, clientConfig, ...modelConfig } = options

    // Initialize model config
    this._config = modelConfig

    // Use provided client or create a new one
    if (client) {
      this._client = client
    } else {
      // Check if API key is available when creating a new client
      // eslint-disable-next-line no-undef
      if (!apiKey && !process.env.OPENAI_API_KEY) {
        throw new Error(
          "OpenAI API key is required. Provide it via the 'apiKey' option or set the OPENAI_API_KEY environment variable."
        )
      }

      // Initialize OpenAI client
      // Only include apiKey if explicitly provided, otherwise let client use env var
      this._client = new OpenAI({
        ...(apiKey ? { apiKey } : {}),
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
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   *
   * @throws \{ContextWindowOverflowError\} When input exceeds the model's context window
   *
   * @example
   * ```typescript
   * const provider = new OpenAIModel({ modelId: 'gpt-4o', apiKey: 'sk-...' })
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
   *
   * @example
   * ```typescript
   * // With tool use
   * const options: StreamOptions = {
   *   systemPrompt: 'You are a helpful assistant',
   *   toolSpecs: [calculatorTool]
   * }
   *
   * for await (const event of provider.stream(messages, options)) {
   *   if (event.type === 'modelMessageStopEvent' && event.stopReason === 'toolUse') {
   *     console.log('Model wants to use a tool')
   *   }
   * }
   * ```
   */
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    try {
      // Format the request
      const request = this._formatRequest(messages, options)

      // Create streaming request with usage tracking
      const stream = await this._client.chat.completions.create(request)

      // Track message start state
      let messageStarted = false

      // Process streaming response
      for await (const chunk of stream) {
        if (!chunk.choices || chunk.choices.length === 0) {
          // Handle usage chunk (no choices)
          if (chunk.usage) {
            yield {
              type: 'modelMetadataEvent',
              usage: {
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              },
            }
          }
          continue
        }

        // Map chunk to SDK events
        const events = this._mapOpenAIChunkToSDKEvents(chunk, messageStarted)
        for (const event of events) {
          if (event.type === 'modelMessageStartEvent') {
            messageStarted = true
          }
          yield event
        }
      }
    } catch (error) {
      // Check for context window overflow
      const err = error as Error
      const errorMessage = err.message.toLowerCase()

      if (
        errorMessage.includes('maximum context length') ||
        errorMessage.includes('context_length_exceeded') ||
        errorMessage.includes('too many tokens')
      ) {
        throw new ContextWindowOverflowError(err.message)
      }

      // Re-throw other errors unchanged
      throw error
    }
  }

  /**
   * Formats a request for the OpenAI Chat Completions API.
   *
   * @param messages - Conversation messages
   * @param options - Stream options
   * @returns Formatted OpenAI request
   */
  private _formatRequest(
    messages: Message[],
    options?: StreamOptions
  ): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
    // Start with required fields
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: this._config.modelId,
      messages: [] as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
    }

    // Add system prompt if provided
    if (options?.systemPrompt) {
      request.messages.push({
        role: 'system',
        content: options.systemPrompt,
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam)
    }

    // Add formatted messages
    const formattedMessages = this._formatMessages(messages) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    request.messages.push(...formattedMessages)


    // Add model configuration parameters
    if (this._config.temperature !== undefined) {
      request.temperature = this._config.temperature
    }
    if (this._config.maxTokens !== undefined) {
      request.max_tokens = this._config.maxTokens
    }
    if (this._config.topP !== undefined) {
      request.top_p = this._config.topP
    }
    if (this._config.frequencyPenalty !== undefined) {
      request.frequency_penalty = this._config.frequencyPenalty
    }
    if (this._config.presencePenalty !== undefined) {
      request.presence_penalty = this._config.presencePenalty
    }

    // Add tool specifications if provided
    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      request.tools = options.toolSpecs.map((spec) => ({
        type: 'function' as const,
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.inputSchema as Record<string, unknown>,
        },
      }))

      // Add tool choice if specified
      if (options.toolChoice) {
        if ('auto' in options.toolChoice) {
          request.tool_choice = 'auto'
        } else if ('any' in options.toolChoice) {
          request.tool_choice = 'required'
        } else if ('tool' in options.toolChoice) {
          request.tool_choice = {
            type: 'function',
            function: { name: options.toolChoice.tool.name },
          }
        }
      }
    }

    // Spread params object last for forward compatibility
    if (this._config.params) {
      Object.assign(request, this._config.params)
    }

    return request
  }

  /**
   * Formats messages for OpenAI API.
   * Handles splitting tool results into separate messages.
   *
   * @param messages - SDK messages
   * @returns OpenAI-formatted messages
   */
  private _formatMessages(messages: Message[]): unknown[] {
    const openAIMessages: unknown[] = []

    for (const message of messages) {
      if (message.role === 'user') {
        // Separate tool results from other content
        const toolResults = message.content.filter((b) => b.type === 'toolResultBlock')
        const otherContent = message.content.filter((b) => b.type !== 'toolResultBlock')

        // Add non-tool-result content as user message
        if (otherContent.length > 0) {
          const contentText = otherContent
            .map((block) => {
              if (block.type === 'textBlock') {
                return block.text
              } else if (block.type === 'reasoningBlock') {
                throw new Error(
                  'Reasoning blocks are not supported by OpenAI. ' +
                    'This feature is specific to AWS Bedrock models.'
                )
              }
              return ''
            })
            .join('')

          openAIMessages.push({
            role: 'user',
            content: contentText,
          })
        }

        // Add each tool result as separate tool message
        for (const toolResult of toolResults) {
          if (toolResult.type === 'toolResultBlock') {
            // Format tool result content
            const contentText = toolResult.content
              .map((c) => {
                if (c.type === 'toolResultTextContent') {
                  return c.text
                } else if (c.type === 'toolResultJsonContent') {
                  return JSON.stringify(c.json)
                }
                return ''
              })
              .join('')

            openAIMessages.push({
              role: 'tool',
              tool_call_id: toolResult.toolUseId,
              content: contentText,
            })
          }
        }
      } else {
        // Handle assistant messages
        const toolUseCalls: unknown[] = []
        let textContent = ''

        for (const block of message.content) {
          if (block.type === 'textBlock') {
            textContent += block.text
          } else if (block.type === 'toolUseBlock') {
            toolUseCalls.push({
              id: block.toolUseId,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            })
          } else if (block.type === 'reasoningBlock') {
            throw new Error(
              'Reasoning blocks are not supported by OpenAI. ' + 'This feature is specific to AWS Bedrock models.'
            )
          }
        }

        const assistantMessage: { role: string; content: string; tool_calls?: unknown[] } = {
          role: 'assistant',
          content: textContent,
        }

        if (toolUseCalls.length > 0) {
          assistantMessage.tool_calls = toolUseCalls
        }

        openAIMessages.push(assistantMessage)
      }
    }

    return openAIMessages
  }

  /**
   * Converts a snake_case string to camelCase.
   *
   * @param str - Snake case string
   * @returns Camel case string
   */
  private _snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
  }

  /**
   * Maps an OpenAI chunk to SDK streaming events.
   *
   * @param chunk - OpenAI chunk
   * @param messageStarted - Whether message start event has been emitted
   * @returns Array of SDK streaming events
   */
  private _mapOpenAIChunkToSDKEvents(chunk: { choices: unknown[] }, messageStarted: boolean): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = []

    // Process first choice (OpenAI typically returns one choice in streaming)
    const choice = chunk.choices[0] as {
      delta?: {
        role?: string
        content?: string
        tool_calls?: Array<{
          index: number
          id?: string
          type?: string
          function?: {
            name?: string
            arguments?: string
          }
        }>
      }
      finish_reason?: string
      index: number
    }

    if (!choice.delta && !choice.finish_reason) {
      return events
    }

    const delta = choice.delta

    // Handle message start (role appears)
    if (delta?.role && !messageStarted) {
      events.push({
        type: 'modelMessageStartEvent',
        role: delta.role as 'user' | 'assistant',
      })
    }

    // Handle text content delta
    if (delta?.content) {
      events.push({
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'textDelta',
          text: delta.content,
        },
      })
    }

    // Handle tool calls
    if (delta?.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCall of delta.tool_calls) {
        // If tool call has id and name, it's the start of a new tool call
        if (toolCall.id && toolCall.function?.name) {
          events.push({
            type: 'modelContentBlockStartEvent',
            contentBlockIndex: toolCall.index,
            start: {
              type: 'toolUseStart',
              name: toolCall.function.name,
              toolUseId: toolCall.id,
            },
          })
        }

        // If tool call has arguments, it's a delta
        if (toolCall.function?.arguments) {
          events.push({
            type: 'modelContentBlockDeltaEvent',
            contentBlockIndex: toolCall.index,
            delta: {
              type: 'toolUseInputDelta',
              input: toolCall.function.arguments,
            },
          })
        }
      }
    }

    // Handle finish reason (message stop)
    if (choice.finish_reason) {
      // Map OpenAI stop reason to SDK stop reason
      const stopReasonMap: Record<string, string> = {
        stop: 'endTurn',
        tool_calls: 'toolUse',
        length: 'maxTokens',
        content_filter: 'contentFiltered',
      }

      const stopReason =
        stopReasonMap[choice.finish_reason] || this._snakeToCamel(choice.finish_reason)

      events.push({
        type: 'modelMessageStopEvent',
        stopReason,
      })
    }

    return events
  }
}
