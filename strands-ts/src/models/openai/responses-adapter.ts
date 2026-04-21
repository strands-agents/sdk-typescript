/**
 * Responses API adapter for the OpenAI model provider.
 *
 * Built-in tool support status:
 * | Tool              | Support                                                  |
 * |-------------------|----------------------------------------------------------|
 * | web_search        | Full: includes URL citations                             |
 * | file_search       | Partial: works but file citation annotations not emitted |
 * | code_interpreter  | Partial: works but executed code/stdout not surfaced     |
 * | mcp               | Partial: works but approval flow not supported           |
 * | shell             | Partial: container mode only                             |
 * | image_generation  | Not supported                                            |
 *
 * @internal
 */

import type {
  ResponseStreamEvent,
  ResponseInputItem,
  ResponseFunctionToolCall,
  ResponseCreateParamsStreaming,
} from 'openai/resources/responses/responses'
import type { Message, StopReason, ToolResultBlock } from '../../types/messages.js'
import type { ImageBlock, DocumentBlock } from '../../types/media.js'
import { encodeBase64 } from '../../types/media.js'
import { toMimeType } from '../../mime.js'
import type { ModelStreamEvent } from '../streaming.js'
import type { StreamOptions } from '../model.js'
import { logger } from '../../logging/logger.js'
import { formatImageDataUrl } from './formatting.js'
import type { OpenAIResponsesConfig } from './types.js'

export const DEFAULT_RESPONSES_MODEL_ID = 'gpt-4o'

const MANAGED_PARAMS = new Set(['model', 'input', 'stream', 'store'])

/**
 * Logs a warning for each managed key present in `params`. The warning fires at
 * config time so callers notice before sending a request.
 *
 * @internal
 */
export function warnManagedParams(params: Record<string, unknown> | undefined): void {
  if (!params) return
  for (const key of Object.keys(params)) {
    if (MANAGED_PARAMS.has(key)) {
      logger.warn(
        `params_key=<${key}> | '${key}' is managed by the provider and will be ignored in params — use the dedicated config property instead`
      )
    }
  }
}

/**
 * Builds a Responses API streaming request body.
 *
 * @internal
 */
export function formatResponsesRequest(
  config: OpenAIResponsesConfig,
  messages: Message[],
  options: StreamOptions | undefined,
  stateful: boolean
): ResponseCreateParamsStreaming {
  const input = formatResponsesMessages(messages)

  // User `params` are spread first so provider-managed fields (asserted
  // required by `ResponseCreateParamsStreaming` below) always win. The
  // managed-params warning fires at config time to surface the collision.
  const request = {
    ...(config.params ?? {}),
    model: config.modelId ?? DEFAULT_RESPONSES_MODEL_ID,
    input,
    stream: true as const,
    store: stateful,
  } as ResponseCreateParamsStreaming

  if (stateful) {
    const responseId = options?.modelState?.responseId as string | undefined
    if (responseId) {
      request.previous_response_id = responseId
    }
  }

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

  if (options?.toolSpecs && options.toolSpecs.length > 0) {
    const existingTools = request.tools ?? []
    request.tools = [
      ...existingTools,
      ...options.toolSpecs.map((spec) => ({
        type: 'function' as const,
        name: spec.name,
        description: spec.description ?? '',
        parameters: (spec.inputSchema ?? {}) as Record<string, unknown>,
        // `null` defers to the OpenAI server default. The SDK's typed
        // contract requires a value; omitting it (as the Python SDK does)
        // is not an option here.
        strict: null,
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

  if (config.temperature !== undefined) request.temperature = config.temperature
  if (config.maxTokens !== undefined) request.max_output_tokens = config.maxTokens
  if (config.topP !== undefined) request.top_p = config.topP

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
function formatResponsesMessages(messages: Message[]): ResponseInputItem[] {
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
          const formatted = formatImageInput(block as ImageBlock)
          if (formatted) contentItems.push(formatted)
          break
        }

        case 'documentBlock': {
          const formatted = formatDocumentInput(block as DocumentBlock)
          if (formatted) contentItems.push(formatted)
          break
        }

        case 'citationsBlock': {
          const citBlock = block as { content: Array<{ text: string }> }
          for (const c of citBlock.content) {
            contentItems.push({ type: 'output_text', text: c.text })
          }
          break
        }

        case 'toolUseBlock': {
          const toolBlock = block as { name: string; toolUseId: string; input: unknown }
          const call: ResponseFunctionToolCall = {
            type: 'function_call',
            call_id: toolBlock.toolUseId,
            name: toolBlock.name,
            arguments: JSON.stringify(toolBlock.input),
          }
          toolCallItems.push(call)
          break
        }

        case 'toolResultBlock': {
          const resultBlock = block as ToolResultBlock
          const output = formatToolResultOutput(resultBlock)
          const result: ResponseInputItem.FunctionCallOutput = {
            type: 'function_call_output',
            call_id: resultBlock.toolUseId,
            output,
          }
          toolResultItems.push(result)
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

    // Cast is needed because assistant messages here use `output_text` content
    // blocks, which the SDK's input types model as `ResponseOutputMessage` —
    // a response-shaped type that requires `id`/`status`/`annotations`. The API
    // accepts these fields as omitted on input, but the SDK types don't reflect that.
    if (contentItems.length > 0) {
      input.push({
        role,
        content: contentItems,
      } as unknown as ResponseInputItem)
    }

    input.push(...toolCallItems)
    input.push(...toolResultItems)
  }

  return input
}

function formatToolResultOutput(resultBlock: ToolResultBlock): string {
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

function formatImageInput(imageBlock: ImageBlock): Record<string, unknown> | undefined {
  const url = formatImageDataUrl(imageBlock)
  if (!url) return undefined
  return { type: 'input_image', image_url: url }
}

function formatDocumentInput(docBlock: DocumentBlock): Record<string, unknown> | undefined {
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

/**
 * Internal stream state for the Responses adapter. Tracks the active content
 * block kind so the adapter can emit stop/start events when content type
 * switches (text ↔ reasoning ↔ citations).
 *
 * @internal
 */
export interface ResponsesStreamState {
  dataType: string | null
  toolCalls: Map<string, { name: string; arguments: string; callId: string; itemId: string }>
  finalUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
  stopReason: StopReason
}

/**
 * Creates fresh stream state for a new Responses API stream.
 *
 * @internal
 */
export function createResponsesStreamState(): ResponsesStreamState {
  return {
    dataType: null,
    toolCalls: new Map(),
    finalUsage: null,
    stopReason: 'endTurn',
  }
}

/**
 * Maps a single Responses API stream event to zero or more SDK events. Mutates
 * `state` and, when `stateful` is `true`, writes `responseId` into `modelState`.
 *
 * @internal
 */
export function mapResponsesEventToSDK(
  event: ResponseStreamEvent,
  state: ResponsesStreamState,
  stateful: boolean,
  modelState: Record<string, unknown> | undefined
): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = []

  switch (event.type) {
    case 'response.created': {
      if (stateful && modelState) {
        modelState.responseId = event.response.id
      }
      events.push({ type: 'modelMessageStartEvent', role: 'assistant' as const })
      break
    }

    case 'response.output_text.delta': {
      events.push(...switchContent('text', state.dataType))
      state.dataType = 'text'
      events.push({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: event.delta },
      })
      break
    }

    case 'response.reasoning_text.delta':
    case 'response.reasoning_summary_text.delta': {
      events.push(...switchContent('reasoning', state.dataType))
      state.dataType = 'reasoning'
      events.push({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', text: event.delta },
      })
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
        events.push(...switchContent('citations', state.dataType))
        state.dataType = 'citations'
        events.push({
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
        })
      } else {
        logger.warn(`annotation_type=<${annotation.type as string}> | unsupported annotation type in responses api`)
      }
      break
    }

    case 'response.output_item.added': {
      const item = event.item as unknown as Record<string, unknown>
      if (item.type === 'function_call') {
        const callId = typeof item.call_id === 'string' ? item.call_id : undefined
        const name = typeof item.name === 'string' ? item.name : undefined
        const itemId = typeof item.id === 'string' ? item.id : undefined
        // All three identifiers are load-bearing: `itemId` keys subsequent
        // argument delta/done events, `callId` becomes the emitted toolUseId,
        // and `name` is the tool name. If any is missing, the tool call is
        // unusable — warn and skip rather than silently collapsing to empty
        // strings (which would also cause distinct calls to share a key).
        if (!callId || !name || !itemId) {
          logger.warn(
            `call_id=<${callId}> name=<${name}> item_id=<${itemId}> | function_call event missing required identifier — skipping`
          )
          break
        }
        state.toolCalls.set(itemId, { name, arguments: '', callId, itemId })
      }
      break
    }

    case 'response.function_call_arguments.delta': {
      const tc = state.toolCalls.get(event.item_id)
      if (tc) {
        tc.arguments += event.delta
      }
      break
    }

    case 'response.function_call_arguments.done': {
      const tc = state.toolCalls.get(event.item_id)
      if (tc) {
        tc.arguments = event.arguments
      }
      break
    }

    case 'response.incomplete': {
      const resp = event.response
      if (resp.usage) {
        state.finalUsage = {
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
          totalTokens: resp.usage.total_tokens,
        }
      }
      const details = resp.incomplete_details as { reason?: string } | null
      if (details?.reason === 'max_output_tokens') {
        state.stopReason = 'maxTokens'
      }
      break
    }

    case 'response.completed': {
      const resp = event.response
      if (resp.usage) {
        state.finalUsage = {
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

  return events
}

/**
 * Emits the terminal events for a Responses API stream: closes any open content
 * block, flushes accumulated tool calls, emits usage metadata, and finishes
 * with `modelMessageStopEvent`.
 *
 * @internal
 */
export function finalizeResponsesStream(state: ResponsesStreamState): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = []

  if (state.dataType !== null) {
    events.push({ type: 'modelContentBlockStopEvent' })
  }

  for (const [, tc] of state.toolCalls) {
    events.push({
      type: 'modelContentBlockStartEvent',
      start: { type: 'toolUseStart', name: tc.name, toolUseId: tc.callId },
    })
    events.push({
      type: 'modelContentBlockDeltaEvent',
      delta: { type: 'toolUseInputDelta', input: tc.arguments },
    })
    events.push({ type: 'modelContentBlockStopEvent' })
  }

  let stopReason = state.stopReason
  if (state.toolCalls.size > 0) {
    stopReason = 'toolUse'
  }

  if (state.finalUsage) {
    events.push({ type: 'modelMetadataEvent', usage: state.finalUsage })
  }

  events.push({ type: 'modelMessageStopEvent', stopReason })

  return events
}

function switchContent(newType: string, prevType: string | null): ModelStreamEvent[] {
  const events: ModelStreamEvent[] = []
  if (newType !== prevType) {
    if (prevType !== null) {
      events.push({ type: 'modelContentBlockStopEvent' })
    }
    events.push({ type: 'modelContentBlockStartEvent' })
  }
  return events
}
