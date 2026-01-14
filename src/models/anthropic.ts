import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { Model, type BaseModelConfig, type StreamOptions } from '../models/model.js'
import type { Message, ContentBlock } from '../types/messages.js'
import type { ModelStreamEvent } from '../models/streaming.js'
import { ContextWindowOverflowError, normalizeError } from '../errors.js'
import type { ImageBlock, DocumentBlock } from '../types/media.js'
import { encodeBase64 } from '../types/media.js'
import { logger } from '../logging/logger.js'
import type { ApiKeySetter } from '@anthropic-ai/sdk/client'

const DEFAULT_ANTHROPIC_MODEL_ID = 'claude-sonnet-4-5-20250929'
const CONTEXT_WINDOW_OVERFLOW_ERRORS = ['prompt is too long', 'max_tokens exceeded', 'input too long']
const TEXT_FILE_FORMATS = ['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'html', 'yml', 'yaml', 'js', 'ts', 'py']

/**
 * Configuration interface for Anthropic model provider.
 */
export interface AnthropicModelConfig extends BaseModelConfig {
  /**
   * Maximum number of tokens to generate. Required by Anthropic API.
   * Defaults to 4096 if not specified.
   */
  maxTokens?: number

  /**
   * Custom stop sequences.
   */
  stopSequences?: string[]

  /**
   * Additional parameters to pass to the API (e.g., top_k, metadata).
   */
  params?: Record<string, unknown>
}

/**
 * Options for creating an AnthropicModel instance.
 */
export interface AnthropicModelOptions extends AnthropicModelConfig {
  /**
   * Anthropic API key.
   * If not provided, looks for ANTHROPIC_API_KEY environment variable.
   */
  apiKey?: string | ApiKeySetter

  /**
   * Pre-configured Anthropic client instance.
   */
  client?: Anthropic

  /**
   * Additional client configuration options.
   */
  clientConfig?: ClientOptions
}

/**
 * Anthropic model provider implementation.
 *
 * Implements the Model interface for Anthropic using the Messages API.
 * Supports streaming, tools, prompt caching, and reasoning (thinking) blocks.
 */
export class AnthropicModel extends Model<AnthropicModelConfig> {
  private _config: AnthropicModelConfig
  private _client: Anthropic

  /**
   * Creates a new AnthropicModel instance.
   *
   * @param options - Configuration for model and client
   */
  constructor(options?: AnthropicModelOptions) {
    super()
    const { apiKey, client, clientConfig, ...modelConfig } = options || {}

    this._config = {
      modelId: DEFAULT_ANTHROPIC_MODEL_ID,
      maxTokens: 4096,
      ...modelConfig,
    }

    if (client) {
      this._client = client
    } else {
      const hasEnvKey =
        typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.ANTHROPIC_API_KEY

      if (!apiKey && !hasEnvKey) {
        throw new Error(
          "Anthropic API key is required. Provide it via the 'apiKey' option or set the ANTHROPIC_API_KEY environment variable."
        )
      }

      this._client = new Anthropic({
        ...(apiKey ? { apiKey } : {}),
        ...clientConfig,
        defaultHeaders: {
          ...clientConfig?.defaultHeaders,
          'anthropic-beta': 'pdfs-2024-09-25',
        },
      })
    }
  }

  /**
   * Updates the model configuration.
   */
  updateConfig(modelConfig: AnthropicModelConfig): void {
    this._config = { ...this._config, ...modelConfig }
  }

  /**
   * Retrieves the current model configuration.
   */
  getConfig(): AnthropicModelConfig {
    return this._config
  }

  /**
   * Streams a conversation with the Anthropic model.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   */
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    try {
      const request = this._formatRequest(messages, options)
      const stream = this._client.messages.stream(request)

      let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      let stopReason = 'endTurn'

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            usage.inputTokens = event.message.usage.input_tokens
            yield {
              type: 'modelMessageStartEvent',
              role: event.message.role,
            }
            break

          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              yield {
                type: 'modelContentBlockStartEvent',
                start: {
                  type: 'toolUseStart',
                  name: event.content_block.name,
                  toolUseId: event.content_block.id,
                },
              }
            } else if (event.content_block.type === 'thinking') {
              yield { type: 'modelContentBlockStartEvent' }
              if (event.content_block.thinking) {
                yield {
                  type: 'modelContentBlockDeltaEvent',
                  delta: {
                    type: 'reasoningContentDelta',
                    text: event.content_block.thinking,
                    signature: event.content_block.signature,
                  },
                }
              }
            } else if (event.content_block.type === 'redacted_thinking') {
              yield { type: 'modelContentBlockStartEvent' }
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: {
                  type: 'reasoningContentDelta',
                  redactedContent: event.content_block.data as unknown as Uint8Array,
                },
              }
            } else {
              yield { type: 'modelContentBlockStartEvent' }
              if (event.content_block.type === 'text' && event.content_block.text) {
                yield {
                  type: 'modelContentBlockDeltaEvent',
                  delta: { type: 'textDelta', text: event.content_block.text },
                }
              }
            }
            break

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: { type: 'textDelta', text: event.delta.text },
              }
            } else if (event.delta.type === 'input_json_delta') {
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: { type: 'toolUseInputDelta', input: event.delta.partial_json },
              }
            } else if (event.delta.type === 'thinking_delta') {
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: { type: 'reasoningContentDelta', text: event.delta.thinking },
              }
            } else if (event.delta.type === 'signature_delta') {
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: { type: 'reasoningContentDelta', signature: event.delta.signature },
              }
            }
            break

          case 'content_block_stop':
            yield { type: 'modelContentBlockStopEvent' }
            break

          case 'message_delta':
            if (event.usage) {
              usage.outputTokens = event.usage.output_tokens
            }
            if (event.delta.stop_reason) {
              stopReason = this._mapStopReason(event.delta.stop_reason)
            }
            break

          case 'message_stop':
            usage.totalTokens = usage.inputTokens + usage.outputTokens
            yield {
              type: 'modelMetadataEvent',
              usage,
            }
            yield {
              type: 'modelMessageStopEvent',
              stopReason,
            }
            break
        }
      }
    } catch (unknownError) {
      const error = normalizeError(unknownError)

      if (CONTEXT_WINDOW_OVERFLOW_ERRORS.some((msg) => error.message.includes(msg))) {
        throw new ContextWindowOverflowError(error.message)
      }

      throw error
    }
  }

  /**
   * Formats the request payload for the Anthropic SDK.
   */
  private _formatRequest(messages: Message[], options?: StreamOptions): Anthropic.MessageStreamParams {
    if (!this._config.modelId) throw new Error('Model ID is required')

    const request: Anthropic.MessageStreamParams = {
      model: this._config.modelId,
      max_tokens: this._config.maxTokens ?? 1024,
      messages: this._formatMessages(messages),
      stream: true,
    }

    if (options?.systemPrompt) {
      if (typeof options.systemPrompt === 'string') {
        request.system = options.systemPrompt
      } else if (Array.isArray(options.systemPrompt)) {
        // Lookahead strategy: Consolidate cachePointBlock into the preceding textBlock's cache_control property
        const systemBlocks: Anthropic.TextBlockParam[] = []
        for (let i = 0; i < options.systemPrompt.length; i++) {
          const block = options.systemPrompt[i]
          if (!block) continue

          if (block.type === 'textBlock') {
            const nextBlock = options.systemPrompt[i + 1]
            const cacheControl = nextBlock?.type === 'cachePointBlock' ? { type: 'ephemeral' as const } : undefined

            systemBlocks.push({
              type: 'text',
              text: block.text,
              ...(cacheControl && { cache_control: cacheControl }),
            })

            if (cacheControl) i++
          } else if (block.type === 'guardContentBlock') {
            logger.warn('guardContentBlock is not supported in Anthropic system prompt')
          }
        }
        if (systemBlocks.length > 0) request.system = systemBlocks
      }
    }

    if (options?.toolSpecs?.length) {
      request.tools = options.toolSpecs.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }))

      if (options.toolChoice) {
        if ('auto' in options.toolChoice) {
          request.tool_choice = { type: 'auto' }
        } else if ('any' in options.toolChoice) {
          request.tool_choice = { type: 'any' }
        } else if ('tool' in options.toolChoice) {
          request.tool_choice = { type: 'tool', name: options.toolChoice.tool.name }
        }
      }
    }

    if (this._config.temperature !== undefined) request.temperature = this._config.temperature
    if (this._config.topP !== undefined) request.top_p = this._config.topP
    if (this._config.stopSequences !== undefined) request.stop_sequences = this._config.stopSequences
    if (this._config.params) Object.assign(request, this._config.params)

    return request
  }

  /**
   * Formats messages for Anthropic, handling prompt caching lookahead.
   */
  private _formatMessages(messages: Message[]): Anthropic.MessageParam[] {
    return messages.map((msg) => {
      // Role mapping: Anthropic uses 'user' role for tool results.
      const role = (msg.role as string) === 'tool' ? 'user' : msg.role

      const content: Anthropic.ContentBlockParam[] = []

      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i]
        if (!block) continue

        // Lookahead strategy: attach cache_control to current block if next block is a cache point
        const nextBlock = msg.content[i + 1]
        const hasCachePoint = nextBlock?.type === 'cachePointBlock'

        const formattedBlock = this._formatContentBlock(block)

        if (formattedBlock) {
          if (hasCachePoint && this._isCacheableBlock(formattedBlock)) {
            // @ts-expect-error - strict types may not explicitly allow cache_control on all discriminated union members yet
            formattedBlock.cache_control = { type: 'ephemeral' }
            i++
          }
          content.push(formattedBlock)
        }
      }

      return {
        role: role as 'user' | 'assistant',
        content,
      }
    })
  }

  private _isCacheableBlock(block: Anthropic.ContentBlockParam | Anthropic.ToolResultBlockParam): boolean {
    return ['text', 'image', 'tool_use', 'tool_result', 'document'].includes(block.type)
  }

  private _formatContentBlock(
    block: ContentBlock
  ): Anthropic.ContentBlockParam | Anthropic.ToolResultBlockParam | undefined {
    switch (block.type) {
      case 'textBlock':
        return { type: 'text', text: block.text }

      case 'imageBlock': {
        const imgBlock = block as ImageBlock
        let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

        switch (imgBlock.format) {
          case 'jpeg':
          case 'jpg':
            mediaType = 'image/jpeg'
            break
          case 'png':
            mediaType = 'image/png'
            break
          case 'gif':
            mediaType = 'image/gif'
            break
          case 'webp':
            mediaType = 'image/webp'
            break
          default:
            throw new Error(`Unsupported image format for Anthropic: ${imgBlock.format}`)
        }

        if (imgBlock.source.type === 'imageSourceBytes') {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: encodeBase64(imgBlock.source.bytes),
            },
          }
        }
        logger.warn('Anthropic provider requires image bytes. URLs not fully supported.')
        return undefined
      }

      case 'documentBlock': {
        const docBlock = block as DocumentBlock

        if (docBlock.format === 'pdf' && docBlock.source.type === 'documentSourceBytes') {
          return {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: encodeBase64(docBlock.source.bytes),
            },
          } as unknown as Anthropic.ContentBlockParam
        }

        // Anthropic doesn't support txt/md/csv as "documents", so we convert them to text content.
        if (TEXT_FILE_FORMATS.includes(docBlock.format)) {
          let textContent: string | undefined

          if (docBlock.source.type === 'documentSourceText') {
            textContent = docBlock.source.text
          } else if (docBlock.source.type === 'documentSourceBytes') {
            if (typeof TextDecoder !== 'undefined') {
              textContent = new TextDecoder().decode(docBlock.source.bytes)
            } else {
              logger.warn(`Cannot decode bytes for ${docBlock.format} document: TextDecoder missing.`)
            }
          }

          if (textContent) {
            return {
              type: 'text',
              text: textContent,
            }
          }
        }

        logger.warn(`Unsupported document format or source for Anthropic: ${docBlock.format}`)
        return undefined
      }

      case 'toolUseBlock':
        return {
          type: 'tool_use',
          id: block.toolUseId,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }

      case 'toolResultBlock': {
        const innerContent = block.content
          .map((c) => {
            if (c.type === 'textBlock') return { type: 'text' as const, text: c.text }
            if (c.type === 'jsonBlock') return { type: 'text' as const, text: JSON.stringify(c.json) }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((c as any).type === 'imageBlock') {
              const img = this._formatContentBlock(c)
              if (img && img.type === 'image') return img
            }
            return undefined
          })
          .filter((c): c is NonNullable<typeof c> => !!c)

        let contentVal: string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>

        const firstItem = innerContent[0]
        if (innerContent.length === 1 && firstItem && firstItem.type === 'text') {
          contentVal = firstItem.text
        } else {
          contentVal = innerContent
        }

        return {
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: contentVal,
          is_error: block.status === 'error',
        } as Anthropic.ToolResultBlockParam
      }

      case 'reasoningBlock':
        if (block.text && block.signature) {
          return {
            type: 'thinking',
            thinking: block.text,
            signature: block.signature,
          } as unknown as Anthropic.ContentBlockParam
        } else if (block.redactedContent) {
          return {
            type: 'redacted_thinking',
            data: block.redactedContent,
          } as unknown as Anthropic.ContentBlockParam
        }
        return undefined

      case 'cachePointBlock':
        return undefined

      default:
        return undefined
    }
  }

  private _mapStopReason(anthropicReason: string): string {
    switch (anthropicReason) {
      case 'end_turn':
        return 'endTurn'
      case 'max_tokens':
        return 'maxTokens'
      case 'stop_sequence':
        return 'stopSequence'
      case 'tool_use':
        return 'toolUse'
      default:
        logger.warn(`Unknown stop reason: ${anthropicReason}`)
        return anthropicReason
    }
  }
}
