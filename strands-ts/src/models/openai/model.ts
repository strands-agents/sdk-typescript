/**
 * OpenAI model provider implementation.
 *
 * Supports both the Chat Completions API (stateless) and the Responses API
 * (stateful, with server-managed conversation state). Selected via the `api`
 * option at construction time.
 *
 * @see https://platform.openai.com/docs/api-reference/chat
 * @see https://platform.openai.com/docs/api-reference/responses
 */

import OpenAI from 'openai'
import type { ResponseStreamEvent } from 'openai/resources/responses/responses'
import { Model } from '../model.js'
import type { StreamOptions } from '../model.js'
import type { Message } from '../../types/messages.js'
import type { ModelStreamEvent } from '../streaming.js'
import { ContextWindowOverflowError, ModelThrottledError } from '../../errors.js'
import { logger } from '../../logging/logger.js'
import { createOpenAIClient } from './client.js'
import { classifyOpenAIError } from './errors.js'
import { formatChatRequest, mapChatChunkToEvents } from './chat-adapter.js'
import {
  createResponsesStreamState,
  finalizeResponsesStream,
  formatResponsesRequest,
  mapResponsesEventToSDK,
  warnManagedParams,
} from './responses-adapter.js'
import type {
  ChatStreamState,
  OpenAIApi,
  OpenAIChatConfig,
  OpenAIModelConfig,
  OpenAIModelOptions,
  OpenAIResponsesConfig,
} from './types.js'

/**
 * OpenAI model provider.
 *
 * Construct with `api: 'chat'` (default) for Chat Completions, or
 * `api: 'responses'` for the Responses API. The `api` field is
 * construction-only — it cannot be changed via {@link OpenAIModel.updateConfig}.
 *
 * @example
 * ```typescript
 * // Chat Completions (default)
 * const model = new OpenAIModel({ modelId: 'gpt-5.4', apiKey: 'sk-...' })
 * ```
 *
 * @example
 * ```typescript
 * // Responses API (stateful by default — server tracks conversation state)
 * const model = new OpenAIModel({
 *   api: 'responses',
 *   modelId: 'gpt-4o',
 *   apiKey: 'sk-...',
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Responses API with built-in web search
 * const model = new OpenAIModel({
 *   api: 'responses',
 *   modelId: 'gpt-4o',
 *   params: { tools: [{ type: 'web_search' }] },
 * })
 * ```
 */
export class OpenAIModel extends Model<OpenAIModelConfig> {
  private readonly _api: OpenAIApi
  private _config: OpenAIModelConfig
  private _client: OpenAI

  constructor(options: OpenAIModelOptions) {
    super()
    const { apiKey, client, clientConfig, ...rest } = options
    const api: OpenAIApi = (rest as { api?: OpenAIApi }).api ?? 'chat'
    const { api: _ignored, ...modelConfig } = rest as { api?: OpenAIApi } & OpenAIModelConfig
    void _ignored

    if (api !== 'chat' && api !== 'responses') {
      throw new Error(`Unsupported OpenAI API: '${api}'. Supported values: 'chat', 'responses'`)
    }

    this._api = api
    this._config = modelConfig

    if (api === 'responses') {
      warnManagedParams(modelConfig.params)
    }

    this._client = createOpenAIClient({ apiKey, client, clientConfig })
  }

  /**
   * Whether this model manages conversation state server-side.
   *
   * `true` only for `api: 'responses'` with `stateful !== false`. Chat Completions
   * is always stateless.
   */
  override get stateful(): boolean {
    return this._api === 'responses' && this._config.stateful !== false
  }

  /**
   * Updates the model configuration.
   *
   * The `api` field is construction-only — if present in `modelConfig`, it is
   * stripped with a warning. Changing the API mode at runtime would invalidate
   * the invariants the agent builds on top of `stateful` (message history
   * management, `previous_response_id` chaining).
   */
  updateConfig(modelConfig: OpenAIModelConfig & { api?: OpenAIApi }): void {
    if ('api' in modelConfig && modelConfig.api !== undefined) {
      logger.warn(
        `api=<${modelConfig.api}> | 'api' is construction-only and cannot be changed via updateConfig — ignoring`
      )
    }
    const { api: _api, ...rest } = modelConfig
    void _api

    if (this._api === 'responses') {
      warnManagedParams(rest.params)
    }

    this._config = { ...this._config, ...rest }
  }

  getConfig(): OpenAIModelConfig {
    return this._config
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    if (!messages || messages.length === 0) {
      throw new Error('At least one message is required')
    }

    if (this._api === 'chat') {
      yield* this._streamChat(messages, options)
    } else {
      yield* this._streamResponses(messages, options)
    }
  }

  private async *_streamChat(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    try {
      const request = formatChatRequest(this._config as OpenAIChatConfig, messages, options)
      const stream = await this._client.chat.completions.create(request)

      const streamState: ChatStreamState = {
        messageStarted: false,
        textContentBlockStarted: false,
      }
      const activeToolCalls = new Map<number, boolean>()

      let bufferedUsage: {
        type: 'modelMetadataEvent'
        usage: { inputTokens: number; outputTokens: number; totalTokens: number }
      } | null = null

      for await (const chunk of stream) {
        if (!chunk.choices || chunk.choices.length === 0) {
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

        const events = mapChatChunkToEvents(chunk, streamState, activeToolCalls)
        for (const event of events) {
          if (event.type === 'modelMessageStopEvent' && bufferedUsage) {
            yield bufferedUsage
            bufferedUsage = null
          }
          yield event
        }
      }

      if (bufferedUsage) {
        yield bufferedUsage
      }
    } catch (error) {
      throw this._rewrapError(error)
    }
  }

  private async *_streamResponses(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    try {
      const request = formatResponsesRequest(this._config as OpenAIResponsesConfig, messages, options, this.stateful)
      const stream = await this._client.responses.create(request as Parameters<typeof this._client.responses.create>[0])

      const state = createResponsesStreamState()

      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        for (const sdkEvent of mapResponsesEventToSDK(event, state, this.stateful, options?.modelState)) {
          yield sdkEvent
        }
      }

      for (const sdkEvent of finalizeResponsesStream(state)) {
        yield sdkEvent
      }
    } catch (error) {
      throw this._rewrapError(error)
    }
  }

  private _rewrapError(error: unknown): unknown {
    const err = error as Error & { status?: number; code?: string }
    const kind = classifyOpenAIError(err)

    if (kind === 'throttling') {
      const message = err.message ?? 'Request was throttled by the model provider'
      logger.debug(`throttled | error_message=<${message}>`)
      return new ModelThrottledError(message, { cause: err })
    }

    if (kind === 'contextOverflow') {
      return new ContextWindowOverflowError(err.message)
    }

    return error
  }
}
