/**
 * OpenAI Responses API model provider implementation.
 *
 * This module provides integration with OpenAI's Responses API, which manages
 * conversation state server-side. Unlike the Chat Completions API, the Responses
 * API tracks context across turns, so the SDK sends only the latest message and
 * chains turns via `previous_response_id`.
 *
 * Built-in tool support status:
 * | Tool              | Support                                                  |
 * |-------------------|----------------------------------------------------------|
 * | web_search        | Full: includes URL citations                             |
 * | file_search       | Partial: works but file citation annotations not emitted |
 * | code_interpreter  | Partial: works but executed code/stdout not surfaced     |
 * | mcp              | Partial: works but approval flow not supported            |
 * | shell            | Partial: container mode only                              |
 * | image_generation | Not supported                                             |
 *
 * @see https://platform.openai.com/docs/api-reference/responses
 */

import OpenAI, { type ClientOptions } from 'openai'
import type { ApiKeySetter } from 'openai/client'
import type { ResponseStreamEvent, ResponseInputItem } from 'openai/resources/responses/responses'
import { Model } from './model.js'
import type { BaseModelConfig, StreamOptions } from './model.js'
import type { Message, StopReason, ToolResultBlock } from '../types/messages.js'
import type { ImageBlock, DocumentBlock } from '../types/media.js'
import { encodeBase64 } from '../types/media.js'
import { toMimeType } from '../mime.js'
import type { ModelStreamEvent } from './streaming.js'
import { ContextWindowOverflowError, ModelThrottledError } from '../errors.js'
import { logger } from '../logging/logger.js'

const DEFAULT_MODEL_ID = 'gpt-4o'

const CONTEXT_OVERFLOW_PATTERNS = ['context_length_exceeded', 'maximum context length', 'too many tokens']

const RATE_LIMIT_PATTERNS = ['rate_limit_exceeded', 'rate limit', 'too many requests']

/**
 * Configuration for the OpenAI Responses model provider.
 */
export interface OpenAIResponsesModelConfig extends BaseModelConfig {
  modelId?: string
  temperature?: number
  maxTokens?: number
  topP?: number

  /**
   * When `true` (default), the server manages conversation state: the request sets
   * `store: true` and chains turns via `previous_response_id`, the Agent clears its
   * local message history after each invocation, and a `conversationManager` cannot
   * be supplied. Set to `false` to use the Responses API in stateless mode, where
   * the full message history is sent on every turn.
   */
  stateful?: boolean

  /**
   * Additional parameters passed through to the Responses API request.
   * Use this for built-in tools (e.g. `{ tools: [{ type: 'web_search' }] }`)
   * and any other forward-compatible API parameters.
   *
   * Provider-managed fields (`model`, `input`, `stream`, `store`) cannot be
   * overridden via `params` — use the dedicated config properties (`modelId`,
   * `stateful`, etc.) instead.
   */
  params?: Record<string, unknown>
}

/**
 * Options for creating an OpenAIResponsesModel instance.
 */
export interface OpenAIResponsesModelOptions extends OpenAIResponsesModelConfig {
  apiKey?: string | ApiKeySetter
  client?: OpenAI
  clientConfig?: ClientOptions
}

/**
 * OpenAI Responses API model provider.
 *
 * This model is stateful — the server tracks conversation state across turns.
 * The agent automatically clears local message history after each invocation
 * and chains turns via `previous_response_id` stored in `modelState`.
 *
 * @example
 * ```typescript
 * const model = new OpenAIResponsesModel({ modelId: 'gpt-4o' })
 * const agent = new Agent({ model, systemPrompt: 'You are helpful.' })
 * const result = await agent.invoke('Hello!')
 * ```
 *
 * @example
 * ```typescript
 * // With built-in web search
 * const model = new OpenAIResponsesModel({
 *   modelId: 'gpt-4o',
 *   params: { tools: [{ type: 'web_search' }] },
 * })
 * ```
 */
export class OpenAIResponsesModel extends Model<OpenAIResponsesModelConfig> {
  private static readonly _MANAGED_PARAMS = new Set(['model', 'input', 'stream', 'store'])

  private static _warnManagedParams(params: Record<string, unknown> | undefined): void {
    if (!params) return
    for (const key of Object.keys(params)) {
      if (OpenAIResponsesModel._MANAGED_PARAMS.has(key)) {
        logger.warn(
          `params_key=<${key}> | '${key}' is managed by the provider and will be ignored in params — use the dedicated config property instead`
        )
      }
    }
  }

  private _config: OpenAIResponsesModelConfig
  private _client: OpenAI

  constructor(options: OpenAIResponsesModelOptions) {
    super()
    const { apiKey, client, clientConfig, ...modelConfig } = options
    this._config = modelConfig
    OpenAIResponsesModel._warnManagedParams(modelConfig.params)

    if (client) {
      this._client = client
    } else {
      const hasEnvKey =
        typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.OPENAI_API_KEY
      if (!apiKey && !hasEnvKey) {
        throw new Error(
          "OpenAI API key is required. Provide it via the 'apiKey' option or set the OPENAI_API_KEY environment variable."
        )
      }
      this._client = new OpenAI({
        ...(apiKey ? { apiKey } : {}),
        ...clientConfig,
      })
    }
  }

  override get stateful(): boolean {
    return this._config.stateful ?? true
  }

  updateConfig(modelConfig: OpenAIResponsesModelConfig): void {
    OpenAIResponsesModel._warnManagedParams(modelConfig.params)
    this._config = { ...this._config, ...modelConfig }
  }

  getConfig(): OpenAIResponsesModelConfig {
    return this._config
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    try {
      const request = this._formatRequest(messages, options)
      const stream = await this._client.responses.create(request as Parameters<typeof this._client.responses.create>[0])

      let dataType: string | null = null
      const toolCalls = new Map<string, { name: string; arguments: string; callId: string; itemId: string }>()
      let finalUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null
      let stopReason: StopReason = 'endTurn'

      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        switch (event.type) {
          case 'response.created': {
            if (this.stateful && options?.modelState) {
              options.modelState.responseId = event.response.id
            }
            yield { type: 'modelMessageStartEvent', role: 'assistant' as const }
            break
          }

          case 'response.output_text.delta': {
            for (const blockEvent of this._switchContent('text', dataType)) yield blockEvent
            dataType = 'text'
            yield {
              type: 'modelContentBlockDeltaEvent',
              delta: { type: 'textDelta', text: event.delta },
            }
            break
          }

          case 'response.reasoning_text.delta':
          case 'response.reasoning_summary_text.delta': {
            for (const blockEvent of this._switchContent('reasoning', dataType)) yield blockEvent
            dataType = 'reasoning'
            yield {
              type: 'modelContentBlockDeltaEvent',
              delta: { type: 'reasoningContentDelta', text: event.delta },
            }
            break
          }

          case 'response.output_text.annotation.added': {
            const annotation = event.annotation as Record<string, unknown>
            if (annotation.type === 'url_citation') {
              // Close the in-flight text block before the citation delta.
              // model.ts finalization picks ONE block kind per open block
              // (citations wins over text), so text + citation in the same
              // block drops the text on stop. Switching here forces a
              // separate CitationsBlock, and the next text delta will open
              // a fresh TextBlock.
              for (const blockEvent of this._switchContent('citations', dataType)) yield blockEvent
              dataType = 'citations'
              yield {
                type: 'modelContentBlockDeltaEvent',
                delta: {
                  type: 'citationsDelta',
                  citations: [
                    {
                      location: {
                        type: 'web' as const,
                        url: (annotation.url as string) ?? '',
                      },
                      source: (annotation.url as string) ?? '',
                      sourceContent: [],
                      title: (annotation.title as string) ?? '',
                    },
                  ],
                  content: [{ text: (annotation.cited_text as string) ?? '' }],
                },
              }
            } else {
              logger.warn(
                `annotation_type=<${annotation.type as string}> | unsupported annotation type in responses api`
              )
            }
            break
          }

          case 'response.output_item.added': {
            const item = event.item as unknown as Record<string, unknown>
            if (item.type === 'function_call') {
              const callId = (item.call_id as string) ?? ''
              const name = (item.name as string) ?? ''
              const itemId = (item.id as string) ?? ''
              toolCalls.set(itemId, { name, arguments: '', callId, itemId })
            }
            break
          }

          case 'response.function_call_arguments.delta': {
            const tc = toolCalls.get(event.item_id)
            if (tc) {
              tc.arguments += event.delta
            }
            break
          }

          case 'response.function_call_arguments.done': {
            const tc = toolCalls.get(event.item_id)
            if (tc) {
              tc.arguments = event.arguments
            }
            break
          }

          case 'response.incomplete': {
            const resp = event.response
            if (resp.usage) {
              finalUsage = {
                inputTokens: resp.usage.input_tokens,
                outputTokens: resp.usage.output_tokens,
                totalTokens: resp.usage.total_tokens,
              }
            }
            const details = resp.incomplete_details as { reason?: string } | null
            if (details?.reason === 'max_output_tokens') {
              stopReason = 'maxTokens'
            }
            break
          }

          case 'response.completed': {
            const resp = event.response
            if (resp.usage) {
              finalUsage = {
                inputTokens: resp.usage.input_tokens,
                outputTokens: resp.usage.output_tokens,
                totalTokens: resp.usage.total_tokens,
              }
            }
            break
          }

          default:
            break
        }
      }

      // Close any open content block
      if (dataType !== null) {
        yield { type: 'modelContentBlockStopEvent' }
      }

      // Emit accumulated tool calls as complete triplets
      for (const [, tc] of toolCalls) {
        yield {
          type: 'modelContentBlockStartEvent',
          start: { type: 'toolUseStart', name: tc.name, toolUseId: tc.callId },
        }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'toolUseInputDelta', input: tc.arguments },
        }
        yield { type: 'modelContentBlockStopEvent' }
      }

      // Determine final stop reason
      if (toolCalls.size > 0) {
        stopReason = 'toolUse'
      }

      if (finalUsage) {
        yield { type: 'modelMetadataEvent', usage: finalUsage }
      }

      yield { type: 'modelMessageStopEvent', stopReason }
    } catch (error) {
      const err = error as Error & { status?: number; code?: string }

      if (
        err.status === 429 ||
        err.code === 'rate_limit_exceeded' ||
        RATE_LIMIT_PATTERNS.some((p) => err.message?.toLowerCase().includes(p))
      ) {
        throw new ModelThrottledError(err.message ?? 'Request was throttled', { cause: err })
      }

      if (
        err.code === 'context_length_exceeded' ||
        CONTEXT_OVERFLOW_PATTERNS.some((p) => err.message?.toLowerCase().includes(p))
      ) {
        throw new ContextWindowOverflowError(err.message)
      }

      throw err
    }
  }

  /**
   * Returns events needed to transition between content block types.
   */
  private _switchContent(newType: string, prevType: string | null): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = []
    if (newType !== prevType) {
      if (prevType !== null) {
        events.push({ type: 'modelContentBlockStopEvent' })
      }
      events.push({ type: 'modelContentBlockStartEvent' })
    }
    return events
  }

  /**
   * Formats the full request for the Responses API.
   */
  private _formatRequest(messages: Message[], options?: StreamOptions): Record<string, unknown> {
    const input = this._formatMessages(messages)

    const stateful = this.stateful
    const request: Record<string, unknown> = {
      ...(this._config.params ?? {}),
      model: this._config.modelId ?? DEFAULT_MODEL_ID,
      input,
      stream: true,
      store: stateful,
    }

    // Chain to previous response for multi-turn (stateful mode only)
    if (stateful) {
      const responseId = options?.modelState?.responseId as string | undefined
      if (responseId) {
        request.previous_response_id = responseId
      }
    }

    // System prompt → instructions
    if (options?.systemPrompt !== undefined) {
      if (typeof options.systemPrompt === 'string') {
        request.instructions = options.systemPrompt
      } else if (Array.isArray(options.systemPrompt)) {
        const texts: string[] = []
        for (const block of options.systemPrompt) {
          if (block.type === 'textBlock') {
            texts.push(block.text)
          }
        }
        if (texts.length > 0) {
          request.instructions = texts.join('')
        }
      }
    }

    // Merge function tools with built-in tools from params
    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      const existingTools = (request.tools as unknown[]) ?? []
      request.tools = [
        ...existingTools,
        ...options.toolSpecs.map((spec) => ({
          type: 'function',
          name: spec.name,
          description: spec.description ?? '',
          parameters: spec.inputSchema,
        })),
      ]

      if (options.toolChoice) {
        if ('auto' in options.toolChoice) {
          request.tool_choice = 'auto'
        } else if ('any' in options.toolChoice) {
          request.tool_choice = 'required'
        } else if ('tool' in options.toolChoice) {
          request.tool_choice = { type: 'function', name: options.toolChoice.tool.name }
        }
      }
    }

    if (this._config.temperature !== undefined) request.temperature = this._config.temperature
    if (this._config.maxTokens !== undefined) request.max_output_tokens = this._config.maxTokens
    if (this._config.topP !== undefined) request.top_p = this._config.topP

    return request
  }

  /**
   * Formats SDK messages into Responses API input items.
   *
   * Per message, content blocks are split into three buckets:
   * - Text/media → grouped in `{ role, content: [...] }`
   * - Tool calls → separate `{ type: 'function_call', ... }` items
   * - Tool results → separate `{ type: 'function_call_output', ... }` items
   */
  private _formatMessages(messages: Message[]): ResponseInputItem[] {
    const input: ResponseInputItem[] = []

    for (const message of messages) {
      const role = message.role === 'assistant' ? 'assistant' : 'user'
      const contentItems: Array<Record<string, unknown>> = []
      const toolCallItems: ResponseInputItem[] = []
      const toolResultItems: ResponseInputItem[] = []

      for (const block of message.content) {
        switch (block.type) {
          case 'textBlock': {
            if (role === 'user') {
              contentItems.push({ type: 'input_text', text: block.text })
            } else {
              contentItems.push({ type: 'output_text', text: block.text })
            }
            break
          }

          case 'imageBlock': {
            const imgBlock = block as ImageBlock
            const formatted = this._formatImageInput(imgBlock)
            if (formatted) contentItems.push(formatted)
            break
          }

          case 'documentBlock': {
            const docBlock = block as DocumentBlock
            const formatted = this._formatDocumentInput(docBlock)
            if (formatted) contentItems.push(formatted)
            break
          }

          case 'citationsBlock': {
            // Flatten citation content into output_text
            const citBlock = block as { content: Array<{ text: string }> }
            for (const c of citBlock.content) {
              contentItems.push({ type: 'output_text', text: c.text })
            }
            break
          }

          case 'toolUseBlock': {
            const toolBlock = block as { name: string; toolUseId: string; input: unknown }
            toolCallItems.push({
              type: 'function_call',
              call_id: toolBlock.toolUseId,
              name: toolBlock.name,
              arguments: JSON.stringify(toolBlock.input),
            } as unknown as ResponseInputItem)
            break
          }

          case 'toolResultBlock': {
            const resultBlock = block as ToolResultBlock
            const output = this._formatToolResultOutput(resultBlock)
            toolResultItems.push({
              type: 'function_call_output',
              call_id: resultBlock.toolUseId,
              output,
            } as unknown as ResponseInputItem)
            break
          }

          case 'reasoningBlock': {
            logger.warn('block_type=<reasoningBlock> | reasoning blocks cannot be re-submitted to responses api')
            break
          }

          default: {
            logger.warn(
              `block_type=<${block.type}> | unsupported content type in responses api message formatting | skipping`
            )
          }
        }
      }

      // Add content message if there are content items
      if (contentItems.length > 0) {
        input.push({
          role,
          content: contentItems,
        } as unknown as ResponseInputItem)
      }

      // Add tool calls and results as separate items
      input.push(...toolCallItems)
      input.push(...toolResultItems)
    }

    return input
  }

  /**
   * Formats a tool result block's content into the output format expected by the Responses API.
   * Returns a string for text-only results, or the string representation for mixed content.
   */
  private _formatToolResultOutput(resultBlock: ToolResultBlock): string {
    const parts: string[] = []

    for (const c of resultBlock.content) {
      switch (c.type) {
        case 'textBlock':
          parts.push(c.text)
          break
        case 'jsonBlock': {
          const jsonBlock = c as { json: unknown }
          try {
            parts.push(JSON.stringify(jsonBlock.json))
          } catch {
            parts.push('[JSON serialization error]')
          }
          break
        }
        case 'imageBlock':
          parts.push('[image content]')
          break
        case 'documentBlock':
          parts.push('[document content]')
          break
        default:
          logger.warn(`block_type=<${c.type}> | unsupported tool result content type for responses api`)
      }
    }

    const text = parts.join('\n')
    if (resultBlock.status === 'error') {
      return `[ERROR] ${text}`
    }
    return text
  }

  /**
   * Formats an image block for the Responses API input.
   */
  private _formatImageInput(imageBlock: ImageBlock): Record<string, unknown> | undefined {
    if (imageBlock.source.type === 'imageSourceBytes') {
      const base64 = encodeBase64(imageBlock.source.bytes)
      const mimeType = toMimeType(imageBlock.format) || `image/${imageBlock.format}`
      return {
        type: 'input_image',
        image_url: `data:${mimeType};base64,${base64}`,
      }
    } else if (imageBlock.source.type === 'imageSourceUrl') {
      return {
        type: 'input_image',
        image_url: imageBlock.source.url,
      }
    }
    return undefined
  }

  /**
   * Formats a document block for the Responses API input.
   */
  private _formatDocumentInput(docBlock: DocumentBlock): Record<string, unknown> | undefined {
    if (docBlock.source.type === 'documentSourceBytes') {
      const base64 = encodeBase64(docBlock.source.bytes)
      const mimeType = toMimeType(docBlock.format) || `application/${docBlock.format}`
      return {
        type: 'input_file',
        file_data: `data:${mimeType};base64,${base64}`,
        filename: docBlock.name,
      }
    }
    logger.warn(`source_type=<${docBlock.source.type}> | only byte source documents supported in responses api`)
    return undefined
  }
}
