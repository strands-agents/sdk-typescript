/**
 * OpenAI model provider implementation.
 *
 * This module provides integration with OpenAI's Chat Completions API,
 * supporting streaming responses, tool use, and configurable model parameters.
 *
 * @see https://platform.openai.com/docs/api-reference/chat/create
 */

import OpenAI, { type ClientOptions } from 'openai'
import { Model } from '../models/model.js'
import type { BaseModelConfig, StreamOptions } from '../models/model.js'
import type { Message } from '../types/messages.js'
import type { ModelStreamEvent } from '../models/streaming.js'
import { ContextWindowOverflowError } from '../errors.js'

/**
 * Error message patterns that indicate context window overflow.
 * Used to detect when input exceeds the model's context window.
 *
 * @see https://platform.openai.com/docs/guides/error-codes
 */
const OPENAI_CONTEXT_WINDOW_OVERFLOW_PATTERNS = [
  'maximum context length',
  'context_length_exceeded',
  'too many tokens',
  'context length',
]

/**
 * Type representing an OpenAI streaming chat choice.
 * Used for type-safe handling of streaming responses.
 */
type OpenAIChatChoice = {
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
export class OpenAIModel extends Model<OpenAIModelConfig> {
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
    super()
    const { apiKey, client, clientConfig, ...modelConfig } = options

    // Initialize model config
    this._config = modelConfig

    // Use provided client or create a new one
    if (client) {
      this._client = client
    } else {
      // Check if API key is available when creating a new client
      // In browsers, apiKey must be provided directly
      // In Node.js, can use OPENAI_API_KEY environment variable as fallback
      const hasEnvKey =
        typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.OPENAI_API_KEY
      if (!apiKey && !hasEnvKey) {
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
    // Validate messages array is not empty
    if (!messages || messages.length === 0) {
      throw new Error('At least one message is required')
    }

    try {
      // Format the request
      const request = this._formatRequest(messages, options)

      // Create streaming request with usage tracking
      const stream = await this._client.chat.completions.create(request)

      // Track streaming state (Use mutable object for proper state tracking)
      const streamState = {
        messageStarted: false,
        textContentBlockStarted: false,
      }

      // Track active tool calls for stop events
      const activeToolCalls = new Map<number, boolean>()

      // Buffer usage to emit before message stop
      let bufferedUsage: {
        type: 'modelMetadataEvent'
        usage: {
          inputTokens: number
          outputTokens: number
          totalTokens: number
        }
      } | null = null

      // Process streaming response
      for await (const chunk of stream) {
        if (!chunk.choices || chunk.choices.length === 0) {
          // Handle usage chunk (no choices)
          // Buffer usage to emit before message stop
          if (chunk.usage) {
            bufferedUsage = {
              type: 'modelMetadataEvent',
              usage: {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
                totalTokens: chunk.usage.total_tokens ?? 0,
              },
            }
          }
          continue
        }

        // Map chunk to SDK events
        const events = this._mapOpenAIChunkToSDKEvents(chunk, streamState, activeToolCalls)
        for (const event of events) {
          // Emit buffered usage before message stop
          if (event.type === 'modelMessageStopEvent' && bufferedUsage) {
            yield bufferedUsage
            bufferedUsage = null
          }

          yield event
        }
      }

      // Emit any remaining buffered usage
      if (bufferedUsage) {
        yield bufferedUsage
      }
    } catch (error) {
      const err = error as Error

      // Check for context window overflow using simple pattern matching
      if (OPENAI_CONTEXT_WINDOW_OVERFLOW_PATTERNS.some((pattern) => err.message?.toLowerCase().includes(pattern))) {
        throw new ContextWindowOverflowError(err.message)
      }

      // Re-throw other errors unchanged
      throw err
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

    // Handle system prompt (string or array format)
    if (options?.systemPrompt !== undefined) {
      if (typeof options.systemPrompt === 'string') {
        // String path: validate and add as-is
        if (options.systemPrompt.trim().length > 0) {
          request.messages.push({
            role: 'system',
            content: options.systemPrompt,
          })
        }
      } else if (Array.isArray(options.systemPrompt) && options.systemPrompt.length > 0) {
        // Array path: extract text blocks and warn about cache points
        const textBlocks: string[] = []
        let hasCachePoints = false

        for (const block of options.systemPrompt) {
          if (block.type === 'textBlock') {
            textBlocks.push(block.text)
          } else if (block.type === 'cachePointBlock') {
            hasCachePoints = true
          }
        }

        if (hasCachePoints) {
          console.warn('Cache points are not supported in OpenAI system prompts and will be ignored.')
        }

        if (textBlocks.length > 0) {
          request.messages.push({
            role: 'system',
            content: textBlocks.join(''),
          })
        }
      }
    }

    // Add formatted messages
    const formattedMessages = this._formatMessages(messages)
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

    // Add tool specifications with validation
    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      request.tools = options.toolSpecs.map((spec) => {
        if (!spec.name || !spec.description) {
          throw new Error('Tool specification must have both name and description')
        }
        return {
          type: 'function' as const,
          function: {
            name: spec.name,
            description: spec.description,
            parameters: spec.inputSchema as Record<string, unknown>,
          },
        }
      })

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

    // Validate n parameter (number of completions) - only n=1 supported for streaming
    if ('n' in request && request.n !== undefined && request.n !== null && request.n > 1) {
      throw new Error('Streaming with n > 1 is not supported')
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
  private _formatMessages(messages: Message[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const openAIMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []

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
                  'Reasoning blocks are not supported by OpenAI. ' + 'This feature is specific to AWS Bedrock models.'
                )
              }
              return ''
            })
            .join('')

          // Validate content is not empty before adding
          if (contentText.trim().length > 0) {
            openAIMessages.push({
              role: 'user',
              content: contentText,
            })
          }
        }

        // Add each tool result as separate tool message
        // OpenAI only supports text content in tool result messages, not JSON
        for (const toolResult of toolResults) {
          if (toolResult.type === 'toolResultBlock') {
            // Format tool result content - convert all to text string
            // Note: OpenAI tool messages only accept string content (not structured JSON)
            const contentText = toolResult.content
              .map((c) => {
                if (c.type === 'toolResultTextContent') {
                  return c.text
                } else if (c.type === 'toolResultJsonContent') {
                  try {
                    return JSON.stringify(c.json)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  } catch (error: any) {
                    const dataPreview =
                      typeof c.json === 'object' && c.json !== null
                        ? `object with keys: ${Object.keys(c.json).slice(0, 5).join(', ')}`
                        : typeof c.json
                    return `[JSON Serialization Error: ${error.message}. Data type: ${dataPreview}]`
                  }
                }
                return ''
              })
              .join('')

            // Validate content is not empty
            if (!contentText || contentText.trim().length === 0) {
              throw new Error(
                `Tool result for toolUseId "${toolResult.toolUseId}" has empty content. ` +
                  'OpenAI requires tool messages to have non-empty content.'
              )
            }

            // Prepend error indicator if status is error
            const finalContent = toolResult.status === 'error' ? `[ERROR] ${contentText}` : contentText

            openAIMessages.push({
              role: 'tool',
              tool_call_id: toolResult.toolUseId,
              content: finalContent,
            })
          }
        }
      } else {
        // Handle assistant messages
        const toolUseCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = []
        // Use array + join pattern for efficient string concatenation
        const textParts: string[] = []

        for (const block of message.content) {
          if (block.type === 'textBlock') {
            textParts.push(block.text)
          } else if (block.type === 'toolUseBlock') {
            try {
              toolUseCalls.push({
                id: block.toolUseId,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (error: any) {
              throw new Error(`Failed to serialize tool input for "${block.name}": ${error.message}`)
            }
          } else if (block.type === 'reasoningBlock') {
            throw new Error(
              'Reasoning blocks are not supported by OpenAI. ' + 'This feature is specific to AWS Bedrock models.'
            )
          }
        }

        // Trim text content to avoid whitespace-only messages
        const textContent = textParts.join('').trim()

        const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: textContent,
        }

        if (toolUseCalls.length > 0) {
          assistantMessage.tool_calls = toolUseCalls
        }

        // Only add if message has content or tool calls
        if (textContent.length > 0 || toolUseCalls.length > 0) {
          openAIMessages.push(assistantMessage)
        }
      }
    }

    return openAIMessages
  }

  /**
   * Converts a snake_case string to camelCase.
   * Used for mapping OpenAI stop reasons to SDK format.
   *
   * @param str - Snake case string (e.g., 'content_filter')
   * @returns Camel case string (e.g., 'contentFilter')
   *
   * @example
   * ```typescript
   * _snakeToCamel('context_length_exceeded') // => 'contextLengthExceeded'
   * _snakeToCamel('tool_calls') // => 'toolCalls'
   * ```
   */
  private _snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
  }

  /**
   * Maps an OpenAI chunk to SDK streaming events.
   *
   * @param chunk - OpenAI chunk
   * @param streamState - Mutable state object tracking message and content block state
   * @param activeToolCalls - Map tracking active tool calls by index
   * @returns Array of SDK streaming events
   */
  private _mapOpenAIChunkToSDKEvents(
    chunk: { choices: unknown[] },
    streamState: { messageStarted: boolean; textContentBlockStarted: boolean },
    activeToolCalls: Map<number, boolean>
  ): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = []

    // Use named constant for text content block index
    const TEXT_CONTENT_BLOCK_INDEX = 0

    // Validate choices array has at least one element
    if (!chunk.choices || chunk.choices.length === 0) {
      return events
    }

    const choice = chunk.choices[0]

    // Validate choice is an object
    if (!choice || typeof choice !== 'object') {
      console.warn('Invalid choice format in OpenAI chunk:', choice)
      return events
    }

    // Process first choice (OpenAI typically returns one choice in streaming)
    const typedChoice = choice as OpenAIChatChoice

    if (!typedChoice.delta && !typedChoice.finish_reason) {
      return events
    }

    const delta = typedChoice.delta

    // Handle message start (role appears) - update mutable state
    if (delta?.role && !streamState.messageStarted) {
      streamState.messageStarted = true
      events.push({
        type: 'modelMessageStartEvent',
        role: delta.role as 'user' | 'assistant',
      })
    }

    // Handle text content delta with contentBlockIndex and start event
    if (delta?.content && delta.content.length > 0) {
      // Emit start event on first text delta
      if (!streamState.textContentBlockStarted) {
        streamState.textContentBlockStarted = true
        events.push({
          type: 'modelContentBlockStartEvent',
          contentBlockIndex: TEXT_CONTENT_BLOCK_INDEX,
        })
      }

      // Include contentBlockIndex for text deltas
      events.push({
        type: 'modelContentBlockDeltaEvent',
        contentBlockIndex: TEXT_CONTENT_BLOCK_INDEX,
        delta: {
          type: 'textDelta',
          text: delta.content,
        },
      })
    }

    // Handle tool calls
    if (delta?.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCall of delta.tool_calls) {
        // Validate tool call index
        if (toolCall.index === undefined || typeof toolCall.index !== 'number') {
          console.warn('Received tool call with invalid index:', toolCall)
          continue
        }

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
          // Track active tool calls
          activeToolCalls.set(toolCall.index, true)
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
    if (typedChoice.finish_reason) {
      // Emit stop event for text content if it was started
      if (streamState.textContentBlockStarted) {
        events.push({
          type: 'modelContentBlockStopEvent',
          contentBlockIndex: TEXT_CONTENT_BLOCK_INDEX,
        })
        streamState.textContentBlockStarted = false
      }

      // Emit stop events for all active tool calls and delete during iteration
      for (const [index] of activeToolCalls) {
        events.push({
          type: 'modelContentBlockStopEvent',
          contentBlockIndex: index,
        })
        activeToolCalls.delete(index)
      }

      // Map OpenAI stop reason to SDK stop reason
      const stopReasonMap: Record<string, string> = {
        stop: 'endTurn',
        tool_calls: 'toolUse',
        length: 'maxTokens',
        content_filter: 'contentFiltered',
      }

      // Log unknown stop reasons
      let stopReason = stopReasonMap[typedChoice.finish_reason]
      if (!stopReason) {
        const fallbackReason = this._snakeToCamel(typedChoice.finish_reason)
        console.warn(
          `Unknown OpenAI stop reason: "${typedChoice.finish_reason}". ` +
            `Using camelCase conversion as fallback: "${fallbackReason}". ` +
            'Please report this to update the stop reason mapping.'
        )
        stopReason = fallbackReason
      }

      events.push({
        type: 'modelMessageStopEvent',
        stopReason,
      })
    }

    return events
  }
}
