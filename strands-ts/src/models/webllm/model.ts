/**
 * WebLLM model provider.
 *
 * Runs LLMs locally in the browser via WebGPU using `@mlc-ai/web-llm`. Models
 * are downloaded on first use and cached in browser storage (IndexedDB /
 * CacheStorage) for subsequent runs. Use the cache helpers (`downloadWebLLMModel`,
 * `isWebLLMModelCached`, `deleteWebLLMModel`, `listWebLLMModels`) to pre-download
 * models, check the cache, or evict models independently of an agent invocation.
 *
 * @see https://webllm.mlc.ai/
 */

import type { AppConfig, ChatOptions, InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'
import { Model, resolveConfigMetadata } from '../model.js'
import type { BaseModelConfig, StreamOptions } from '../model.js'
import type { Message, StopReason, ToolResultBlock } from '../../types/messages.js'
import type { ModelStreamEvent, Usage } from '../streaming.js'
import { normalizeError } from '../../errors.js'
import { logger } from '../../logging/logger.js'
import { warnOnce } from '../../logging/warn-once.js'
import { assertBrowserEnvironment, loadWebLLMModule } from './cache.js'

const DEFAULT_MODEL_ID = 'Llama-3.1-8B-Instruct-q4f32_1-MLC'

/**
 * Configuration for the WebLLM model provider.
 */
export interface WebLLMModelConfig extends BaseModelConfig {
  /**
   * WebLLM model identifier.
   * Must match a `model_id` in the active `AppConfig.model_list`
   * (defaults to {@link https://github.com/mlc-ai/web-llm/blob/main/src/config.ts | prebuiltAppConfig}).
   */
  modelId?: string

  /**
   * Controls randomness in generation (0.0 to 2.0).
   */
  temperature?: number

  /**
   * Maximum number of tokens to generate in the response.
   */
  maxTokens?: number

  /**
   * Controls diversity via nucleus sampling (0.0 to 1.0).
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
   * Additional parameters forwarded to `engine.chat.completions.create`.
   *
   * Provider-managed fields (`messages`, `stream`, `stream_options`, `tools`,
   * `tool_choice`, `temperature`, `max_tokens`, `top_p`, `frequency_penalty`,
   * `presence_penalty`) are overwritten by the provider even if set here.
   */
  params?: Record<string, unknown>
}

/**
 * Options for constructing a {@link WebLLMModel}.
 */
export interface WebLLMModelOptions extends WebLLMModelConfig {
  /**
   * Pre-constructed WebLLM engine. If provided, the model will not create its own
   * engine and will not call `reload()` — the caller is responsible for loading
   * the desired model. Use this to share a single engine across multiple model
   * instances or to use a web/service worker engine variant.
   */
  engine?: MLCEngineInterface

  /**
   * Custom WebLLM `AppConfig`. Needed when registering a model URL that is not
   * part of WebLLM's built-in prebuilt list, or when overriding the cache backend.
   * @see https://github.com/mlc-ai/web-llm#custom-models
   */
  appConfig?: AppConfig

  /**
   * Baseline `ChatConfig` overrides passed to `engine.reload()`
   * (e.g. `context_window_size`, `repetition_penalty`).
   * Not used when `engine` is provided.
   */
  chatOpts?: ChatOptions

  /**
   * Called during the initial model load/download with progress updates.
   * Only invoked when the model creates its own engine.
   */
  onProgress?: (report: InitProgressReport) => void
}

/**
 * Minimal structural shape of a WebLLM / OpenAI chat completion chunk.
 * We declare this locally rather than importing WebLLM's own type because
 * WebLLM doesn't expose OpenAI protocol types at its package root with
 * `verbatimModuleSyntax`-friendly resolution.
 */
interface ChatCompletionChunkLike {
  choices?: Array<{
    delta?: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
}

/**
 * Minimal structural shape for an OpenAI-style chat completion message param
 * (system/user/assistant/tool). WebLLM accepts OpenAI's message format.
 */
type ChatMessageParam =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * Minimal structural shape for a chat completion tool definition.
 */
interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * Parameters passed to `engine.chat.completions.create` for streaming WebLLM
 * chat completions. WebLLM's streaming overload is structurally identical to
 * OpenAI's streaming API.
 */
interface WebLLMChatCreateParams {
  messages: ChatMessageParam[]
  stream: true
  stream_options?: { include_usage: boolean }
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  tools?: ChatTool[]
  tool_choice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
}

/**
 * WebLLM model provider — on-device inference via WebGPU.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { WebLLMModel } from '@strands-agents/sdk/models/webllm'
 *
 * const model = new WebLLMModel({
 *   modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
 *   onProgress: (r) => console.log(r.text, r.progress),
 * })
 *
 * const agent = new Agent({ model })
 * const result = await agent.invoke('Hello!')
 * ```
 *
 * @example
 * ```typescript
 * // Share a pre-created engine (e.g. to use a web worker)
 * import { CreateWebWorkerMLCEngine } from '@mlc-ai/web-llm'
 * const engine = await CreateWebWorkerMLCEngine(worker, 'Phi-3.5-mini-instruct-q4f16_1-MLC')
 * const model = new WebLLMModel({ engine, modelId: 'Phi-3.5-mini-instruct-q4f16_1-MLC' })
 * ```
 */
export class WebLLMModel extends Model<WebLLMModelConfig> {
  private _config: WebLLMModelConfig
  private readonly _appConfig: AppConfig | undefined
  private readonly _chatOpts: ChatOptions | undefined
  private readonly _onProgress: ((report: InitProgressReport) => void) | undefined
  private readonly _externalEngine: MLCEngineInterface | undefined
  private _enginePromise: Promise<MLCEngineInterface> | undefined

  constructor(options?: WebLLMModelOptions) {
    super()
    const { engine, appConfig, chatOpts, onProgress, ...modelConfig } = options ?? {}

    this._config = { ...modelConfig }
    this._appConfig = appConfig
    this._chatOpts = chatOpts
    this._onProgress = onProgress
    this._externalEngine = engine

    if (modelConfig.modelId === undefined) {
      warnOnce(
        logger,
        `model_id=<${DEFAULT_MODEL_ID}> | using default WebLLM modelId, which is subject to change | set modelId explicitly to pin the value`
      )
    }
  }

  updateConfig(modelConfig: WebLLMModelConfig): void {
    this._config = { ...this._config, ...modelConfig }
  }

  getConfig(): WebLLMModelConfig {
    return resolveConfigMetadata(this._config, this._config.modelId ?? DEFAULT_MODEL_ID)
  }

  /**
   * Unloads the underlying WebLLM engine, freeing GPU memory. No-op if an
   * external engine was provided via the `engine` option — lifecycle of
   * externally-supplied engines is the caller's responsibility.
   */
  async unload(): Promise<void> {
    if (this._externalEngine) return
    if (!this._enginePromise) return
    try {
      const engine = await this._enginePromise
      await engine.unload()
    } catch (error) {
      logger.debug(`unload failed | error=<${error}>`)
    } finally {
      this._enginePromise = undefined
    }
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    if (!messages || messages.length === 0) {
      throw new Error('At least one message is required')
    }

    const engine = await this._getEngine()

    try {
      const request = this._formatRequest(messages, options)
      // WebLLM's typings for chat.completions.create are narrower than the
      // streaming variant we always use — cast to the streaming return type.
      const stream = (await engine.chat.completions.create(
        request as unknown as Parameters<typeof engine.chat.completions.create>[0]
      )) as unknown as AsyncIterable<ChatCompletionChunkLike>

      const state: StreamState = { messageStarted: false, textContentBlockStarted: false }
      const activeToolCalls = new Map<number, boolean>()
      let bufferedUsage: ModelStreamEvent | undefined
      let bufferedStop: ModelStreamEvent | undefined

      for await (const chunk of stream) {
        const usage = extractUsage(chunk)
        if (usage) {
          bufferedUsage = { type: 'modelMetadataEvent', usage }
        }

        for (const event of mapChunkToEvents(chunk, state, activeToolCalls)) {
          if (event.type === 'modelMessageStopEvent') {
            // Hold the stop event until the stream drains so any trailing
            // usage-only chunk produces metadata before stop.
            bufferedStop = event
          } else {
            yield event
          }
        }
      }

      if (bufferedUsage) yield bufferedUsage
      if (bufferedStop) yield bufferedStop
    } catch (error) {
      throw normalizeError(error)
    }
  }

  private async _getEngine(): Promise<MLCEngineInterface> {
    if (this._externalEngine) return this._externalEngine
    if (!this._enginePromise) {
      this._enginePromise = this._createEngine().catch((error) => {
        // Allow retry after a failed init
        this._enginePromise = undefined
        throw error
      })
    }
    return this._enginePromise
  }

  private async _createEngine(): Promise<MLCEngineInterface> {
    assertBrowserEnvironment()
    const mod = await loadWebLLMModule()
    const modelId = this._config.modelId ?? DEFAULT_MODEL_ID
    const engineConfig: Parameters<typeof mod.CreateMLCEngine>[1] = {}
    if (this._appConfig) engineConfig.appConfig = this._appConfig
    if (this._onProgress) engineConfig.initProgressCallback = this._onProgress
    return mod.CreateMLCEngine(modelId, engineConfig, this._chatOpts)
  }

  private _formatRequest(messages: Message[], options?: StreamOptions): WebLLMChatCreateParams {
    const request: WebLLMChatCreateParams = {
      ...(this._config.params ?? {}),
      messages: this._formatMessages(messages, options),
      stream: true,
      stream_options: { include_usage: true },
    }

    if (this._config.temperature !== undefined) request.temperature = this._config.temperature
    if (this._config.maxTokens !== undefined) request.max_tokens = this._config.maxTokens
    if (this._config.topP !== undefined) request.top_p = this._config.topP
    if (this._config.frequencyPenalty !== undefined) request.frequency_penalty = this._config.frequencyPenalty
    if (this._config.presencePenalty !== undefined) request.presence_penalty = this._config.presencePenalty

    if (options?.toolSpecs && options.toolSpecs.length > 0) {
      request.tools = options.toolSpecs.map((spec) => {
        if (!spec.name || !spec.description) {
          throw new Error('Tool specification must have both name and description')
        }
        return {
          type: 'function',
          function: {
            name: spec.name,
            description: spec.description,
            parameters: (spec.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
          },
        }
      })

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

    return request
  }

  private _formatMessages(messages: Message[], options?: StreamOptions): ChatMessageParam[] {
    const result: ChatMessageParam[] = []

    if (options?.systemPrompt !== undefined) {
      const systemText = extractSystemText(options.systemPrompt)
      if (systemText.length > 0) {
        result.push({ role: 'system', content: systemText })
      }
    }

    for (const message of messages) {
      if (message.role === 'user') {
        const toolResults = message.content.filter((b): b is ToolResultBlock => b.type === 'toolResultBlock')
        const textParts: string[] = []
        for (const block of message.content) {
          if (block.type === 'textBlock') {
            textParts.push(block.text)
          } else if (block.type !== 'toolResultBlock') {
            logger.warn(
              `block_type=<${block.type}> | webllm user messages only support text and tool results, skipping`
            )
          }
        }

        const text = textParts.join('').trim()
        if (text.length > 0) {
          result.push({ role: 'user', content: text })
        }

        for (const toolResult of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: toolResult.toolUseId,
            content: formatToolResultContent(toolResult),
          })
        }
      } else {
        const assistantText: string[] = []
        const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []

        for (const block of message.content) {
          if (block.type === 'textBlock') {
            assistantText.push(block.text)
          } else if (block.type === 'toolUseBlock') {
            toolCalls.push({
              id: block.toolUseId,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            })
          } else if (block.type === 'reasoningBlock') {
            if (block.text) assistantText.push(block.text)
          } else {
            logger.warn(
              `block_type=<${block.type}> | webllm assistant messages only support text and tool use, skipping`
            )
          }
        }

        const content = assistantText.join('').trim()
        if (content.length === 0 && toolCalls.length === 0) continue

        if (toolCalls.length > 0) {
          result.push({
            role: 'assistant',
            content,
            tool_calls: toolCalls,
          })
        } else {
          result.push({ role: 'assistant', content })
        }
      }
    }

    return result
  }
}

interface StreamState {
  messageStarted: boolean
  textContentBlockStarted: boolean
}

function mapChunkToEvents(
  chunk: ChatCompletionChunkLike,
  state: StreamState,
  activeToolCalls: Map<number, boolean>
): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = []
  const choice = chunk.choices?.[0]
  if (!choice) return events

  const delta = choice.delta

  if (delta?.role && !state.messageStarted) {
    state.messageStarted = true
    events.push({ type: 'modelMessageStartEvent', role: delta.role as 'user' | 'assistant' })
  }

  if (delta?.content && delta.content.length > 0) {
    if (!state.textContentBlockStarted) {
      state.textContentBlockStarted = true
      events.push({ type: 'modelContentBlockStartEvent' })
    }
    events.push({
      type: 'modelContentBlockDeltaEvent',
      delta: { type: 'textDelta', text: delta.content },
    })
  }

  if (delta?.tool_calls && delta.tool_calls.length > 0) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.index === undefined || typeof toolCall.index !== 'number') {
        logger.warn(`tool_call=<${JSON.stringify(toolCall)}> | received tool call with invalid index`)
        continue
      }

      if (toolCall.id && toolCall.function?.name) {
        events.push({
          type: 'modelContentBlockStartEvent',
          start: { type: 'toolUseStart', name: toolCall.function.name, toolUseId: toolCall.id },
        })
        activeToolCalls.set(toolCall.index, true)
      }

      if (toolCall.function?.arguments) {
        events.push({
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'toolUseInputDelta', input: toolCall.function.arguments },
        })
      }
    }
  }

  if (choice.finish_reason) {
    if (state.textContentBlockStarted) {
      events.push({ type: 'modelContentBlockStopEvent' })
      state.textContentBlockStarted = false
    }

    for (const [index] of activeToolCalls) {
      events.push({ type: 'modelContentBlockStopEvent' })
      activeToolCalls.delete(index)
    }

    events.push({ type: 'modelMessageStopEvent', stopReason: mapFinishReason(choice.finish_reason) })
  }

  return events
}

function extractUsage(chunk: ChatCompletionChunkLike): Usage | undefined {
  if (!chunk.usage) return undefined
  return {
    inputTokens: chunk.usage.prompt_tokens ?? 0,
    outputTokens: chunk.usage.completion_tokens ?? 0,
    totalTokens: chunk.usage.total_tokens ?? 0,
  }
}

function mapFinishReason(finishReason: string): StopReason {
  switch (finishReason) {
    case 'stop':
      return 'endTurn'
    case 'tool_calls':
      return 'toolUse'
    case 'length':
      return 'maxTokens'
    case 'content_filter':
      return 'contentFiltered'
    default:
      logger.warn(`finish_reason=<${finishReason}> | unknown webllm stop reason, passing through`)
      return finishReason
  }
}

function extractSystemText(systemPrompt: StreamOptions['systemPrompt']): string {
  if (typeof systemPrompt === 'string') return systemPrompt.trim()
  if (!Array.isArray(systemPrompt)) return ''
  const parts: string[] = []
  for (const block of systemPrompt) {
    if (block.type === 'textBlock') {
      parts.push(block.text)
    } else if (block.type === 'cachePointBlock') {
      logger.warn('cache points are not supported in webllm system prompts, ignoring cache points')
    } else if (block.type === 'guardContentBlock') {
      logger.warn('guard content is not supported in webllm system prompts, removing guard content block')
    }
  }
  return parts.join('').trim()
}

function formatToolResultContent(toolResult: ToolResultBlock): string {
  const parts: string[] = []
  for (const block of toolResult.content) {
    if (block.type === 'textBlock') {
      parts.push(block.text)
    } else if (block.type === 'jsonBlock') {
      try {
        parts.push(JSON.stringify(block.json))
      } catch (error) {
        logger.warn(`tool_use_id=<${toolResult.toolUseId}> | failed to stringify json block | error=<${error}>`)
      }
    } else {
      logger.warn(
        `tool_use_id=<${toolResult.toolUseId}>, block_type=<${block.type}> | webllm tool results only support text and json, skipping`
      )
    }
  }

  const text = parts.join('').trim()
  if (text.length === 0) {
    return toolResult.status === 'error' ? '[ERROR] (empty)' : '(empty)'
  }
  return toolResult.status === 'error' ? `[ERROR] ${text}` : text
}
