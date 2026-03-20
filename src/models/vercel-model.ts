/**
 * Vercel LanguageModelV3 model provider implementation.
 *
 * This module provides integration with any Vercel v3 compatible model provider,
 * supporting streaming responses, tool use, and reasoning content.
 *
 * @see https://github.com/vercel/ai/tree/main/packages/provider/src/language-model/v3
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FilePart,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3ReasoningPart,
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'
import { APICallError } from '@ai-sdk/provider'
import type { SystemPrompt, StopReason } from '../types/messages.js'
import type { ToolChoice, ToolSpec } from '../tools/types.js'
import type { ModelStreamEvent, Usage } from './streaming.js'
import { Message, TextBlock } from '../types/messages.js'
import { Model, type BaseModelConfig, type StreamOptions } from './model.js'
import {
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
} from './streaming.js'
import { ContextWindowOverflowError, ModelError, ModelThrottledError } from '../errors.js'
import { toMimeType } from '../mime.js'
import { logger } from '../logging/logger.js'

/**
 * Error message patterns that indicate context window overflow.
 * These patterns are common across Vercel providers (Bedrock, OpenAI, Anthropic, etc.).
 */
const CONTEXT_WINDOW_OVERFLOW_PATTERNS = [
  'too many tokens',
  'context length',
  'context_length_exceeded',
  'max_tokens exceeded',
  'too many total text bytes',
  'input is too long for requested model',
  'prompt is too long',
  'input too long',
]

/**
 * Call option fields from LanguageModelV3CallOptions that can be configured.
 * Excludes prompt, tools, and toolChoice which are managed by the agent loop.
 */
type LanguageModelCallSettings = Omit<LanguageModelV3CallOptions, 'prompt' | 'tools' | 'toolChoice'>

/**
 * Configuration for the VercelModel adapter.
 *
 * Extends BaseModelConfig with all LanguageModelV3 call settings (temperature, topP, topK,
 * presencePenalty, frequencyPenalty, stopSequences, seed, etc.). When new fields are added
 * to the Language Model Specification, they become available here automatically.
 *
 * Note: `maxTokens` (from BaseModelConfig) maps to `maxOutputTokens` in the underlying call.
 * If both are set, `maxOutputTokens` takes precedence.
 */
export interface VercelModelConfig extends BaseModelConfig, LanguageModelCallSettings {}

/**
 * Adapter that wraps a LanguageModelV3 instance
 * for use as a Strands model provider.
 *
 * Implements the Model interface for any Vercel v3 compatible provider.
 * Supports streaming responses, tool use, and reasoning content.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { VercelModel } from '@strands-agents/sdk/vercel-model'
 * import { bedrock } from '@ai-sdk/amazon-bedrock'
 *
 * const agent = new Agent({
 *   model: new VercelModel(bedrock('us.anthropic.claude-sonnet-4-20250514-v1:0')),
 * })
 *
 * for await (const event of agent.stream('Hello!')) {
 *   if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
 *     process.stdout.write(event.delta.text)
 *   }
 * }
 * ```
 */
export class VercelModel extends Model<VercelModelConfig> {
  private _model: LanguageModelV3
  private _config: VercelModelConfig

  /**
   * Creates a new VercelModel instance.
   *
   * @param model - A LanguageModelV3 instance from any Vercel provider
   * @param config - Optional configuration overrides
   */
  constructor(model: LanguageModelV3, config?: Partial<VercelModelConfig>) {
    super()
    this._model = model
    const { modelId, maxTokens, ...callSettings } = config ?? {}
    this._config = {
      modelId: modelId ?? model.modelId,
      ...(maxTokens != null && { maxTokens }),
      ...callSettings,
    }
  }

  getConfig(): VercelModelConfig {
    return { ...this._config }
  }

  updateConfig(config: VercelModelConfig): void {
    this._config = { ...this._config, ...config }
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const prompt = formatMessages(messages, options?.systemPrompt)
    const tools = options?.toolSpecs ? formatTools(options.toolSpecs) : undefined
    const toolChoice = options?.toolChoice ? formatToolChoice(options.toolChoice) : undefined

    const { modelId: _, maxTokens, ...callSettings } = this._config

    const callOptions: LanguageModelV3CallOptions = {
      prompt,
      ...(tools && { tools }),
      ...(toolChoice && { toolChoice }),
      ...(maxTokens != null && { maxOutputTokens: maxTokens }),
      ...callSettings,
    }

    let result
    try {
      result = await this._model.doStream(callOptions)
    } catch (error) {
      throw classifyError(error)
    }

    const reader = result.stream.getReader()
    const incrementalToolCallIds = new Set<string>()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'tool-input-start') {
          incrementalToolCallIds.add(value.id)
        }
        if (value.type === 'tool-call' && incrementalToolCallIds.has(value.toolCallId)) {
          continue
        }
        yield* mapStreamPart(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
}

/**
 * Classifies an error from doStream into the appropriate Strands error type.
 *
 * @param error - The error thrown by the Vercel provider
 * @returns A classified error (ContextWindowOverflowError, ModelThrottledError, or ModelError)
 */
function classifyError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)

  if (APICallError.isInstance(error)) {
    if (error.statusCode === 429) {
      logger.debug(`throttled | error_message=<${message}>`)
      return new ModelThrottledError(message, { cause: error })
    }

    const searchText = (error.responseBody ?? message).toLowerCase()
    if (CONTEXT_WINDOW_OVERFLOW_PATTERNS.some((pattern) => searchText.includes(pattern))) {
      return new ContextWindowOverflowError(message)
    }
  }

  if (CONTEXT_WINDOW_OVERFLOW_PATTERNS.some((pattern) => message.toLowerCase().includes(pattern))) {
    return new ContextWindowOverflowError(message)
  }

  return new ModelError(`Language model stream error: ${message}`, { cause: error })
}

/**
 * Maps a single LanguageModelV3 stream part to zero or more Strands ModelStreamEvents.
 */
function* mapStreamPart(part: LanguageModelV3StreamPart): Generator<ModelStreamEvent> {
  switch (part.type) {
    case 'stream-start':
      yield new ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' })
      break

    case 'text-start':
      yield new ModelContentBlockStartEvent({ type: 'modelContentBlockStartEvent' })
      break

    case 'text-delta':
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: part.delta },
      })
      break

    case 'text-end':
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' })
      break

    case 'reasoning-start':
      yield new ModelContentBlockStartEvent({ type: 'modelContentBlockStartEvent' })
      break

    case 'reasoning-delta':
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'reasoningContentDelta', text: part.delta },
      })
      break

    case 'reasoning-end':
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' })
      break

    case 'tool-input-start':
      yield new ModelContentBlockStartEvent({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: part.toolName, toolUseId: part.id },
      })
      break

    case 'tool-input-delta':
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: part.delta },
      })
      break

    case 'tool-input-end':
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' })
      break

    // Some providers (e.g. Responses API) emit only the complete tool-call without incremental tool-input-* events.
    // Synthesize the start/delta/stop sequence so the aggregation logic builds ToolUseBlocks correctly.
    case 'tool-call':
      yield new ModelContentBlockStartEvent({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: part.toolName, toolUseId: part.toolCallId },
      })
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: part.input },
      })
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' })
      break

    case 'finish':
      yield new ModelMetadataEvent({
        type: 'modelMetadataEvent',
        usage: mapUsage(part.usage),
      })
      yield new ModelMessageStopEvent({
        type: 'modelMessageStopEvent',
        stopReason: mapFinishReason(part.finishReason),
      })
      break

    case 'error':
      throw new ModelError(
        `Language model stream error: ${part.error instanceof Error ? part.error.message : JSON.stringify(part.error)}`,
        { cause: part.error }
      )

    // Ignore: tool-call (complete, we use incremental), response-metadata, raw, source, file, tool-result, tool-approval-request
    default:
      break
  }
}

/**
 * Maps LanguageModelV3 finish reason to Strands StopReason.
 */
function mapFinishReason(finishReason: LanguageModelV3FinishReason): StopReason {
  switch (finishReason.unified) {
    case 'stop':
      return 'endTurn'
    case 'length':
      return 'maxTokens'
    case 'content-filter':
      return 'contentFiltered'
    case 'tool-calls':
      return 'toolUse'
    case 'error':
    case 'other':
      return 'endTurn'
  }
}

/**
 * Maps LanguageModelV3 usage to Strands Usage.
 */
function mapUsage(usage: LanguageModelV3Usage): Usage {
  const inputTokens = usage.inputTokens.total ?? 0
  const outputTokens = usage.outputTokens.total ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(usage.inputTokens.cacheRead != null && { cacheReadInputTokens: usage.inputTokens.cacheRead }),
    ...(usage.inputTokens.cacheWrite != null && { cacheWriteInputTokens: usage.inputTokens.cacheWrite }),
  }
}

/**
 * Converts Strands messages + system prompt to LanguageModelV3 prompt format.
 */
function formatMessages(messages: Message[], systemPrompt?: SystemPrompt): LanguageModelV3Prompt {
  const prompt: LanguageModelV3Prompt = []

  if (systemPrompt) {
    const text =
      typeof systemPrompt === 'string'
        ? systemPrompt
        : systemPrompt
            .filter(isTextBlock)
            .map((block) => block.text)
            .join('\n')
    if (text) {
      prompt.push({ role: 'system', content: text })
    }
  }

  // Build a global toolCallId -> toolName map across all messages
  const toolNameMap = new Map<string, string>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'toolUseBlock') {
        toolNameMap.set(block.toolUseId, block.name)
      }
    }
  }

  for (const message of messages) {
    if (message.role === 'user') {
      formatUserMessage(message, prompt, toolNameMap)
    } else if (message.role === 'assistant') {
      formatAssistantMessage(message, prompt, toolNameMap)
    }
  }

  return prompt
}

/**
 * Formats a Strands user message to LanguageModelV3 format.
 * Tool result blocks are extracted into separate tool messages.
 *
 * @param message - The user message to format
 * @param prompt - The prompt array to push formatted messages into
 * @param toolNameMap - Map of toolCallId to toolName for resolving tool result names
 */
function formatUserMessage(message: Message, prompt: LanguageModelV3Prompt, toolNameMap: Map<string, string>): void {
  const content: Array<LanguageModelV3TextPart | LanguageModelV3FilePart> = []
  const toolResults: LanguageModelV3ToolResultPart[] = []

  for (const block of message.content) {
    switch (block.type) {
      case 'textBlock':
        content.push({ type: 'text', text: block.text })
        break
      case 'imageBlock': {
        const source = block.source
        const mediaType = toMimeType(block.format) ?? `image/${block.format}`
        if (source.type === 'imageSourceBytes') {
          content.push({ type: 'file', data: source.bytes, mediaType })
        } else if (source.type === 'imageSourceUrl') {
          content.push({ type: 'file', data: new URL(source.url), mediaType })
        } else {
          logger.warn(`source_type=<${source.type}> | unsupported image source type, skipping`)
        }
        break
      }
      case 'documentBlock': {
        const source = block.source
        const mediaType = toMimeType(block.format) ?? `application/${block.format}`
        if (source.type === 'documentSourceBytes') {
          content.push({ type: 'file', data: source.bytes, mediaType })
        } else if (source.type === 'documentSourceText') {
          content.push({ type: 'text', text: source.text })
        } else if (source.type === 'documentSourceContentBlock') {
          for (const contentBlock of source.content) {
            content.push({ type: 'text', text: contentBlock.text })
          }
        } else {
          logger.warn(`source_type=<${source.type}> | unsupported document source type, skipping`)
        }
        break
      }
      case 'videoBlock': {
        const source = block.source
        if (source.type === 'videoSourceBytes') {
          content.push({
            type: 'file',
            data: source.bytes,
            mediaType: toMimeType(block.format) ?? `video/${block.format}`,
          })
        } else {
          logger.warn(`source_type=<${source.type}> | unsupported video source type, skipping`)
        }
        break
      }
      case 'toolResultBlock':
        toolResults.push({
          type: 'tool-result',
          toolCallId: block.toolUseId,
          toolName: toolNameMap.get(block.toolUseId) ?? '',
          output: formatToolResultOutput(block.status, block.content),
        })
        break
      default:
        break
    }
  }

  if (content.length > 0) {
    prompt.push({ role: 'user', content })
  }

  for (const result of toolResults) {
    prompt.push({ role: 'tool', content: [result] })
  }
}

/**
 * Formats a Strands assistant message to LanguageModelV3 format.
 * Tool results are extracted into separate tool messages (one per result).
 *
 * @param message - The assistant message to format
 * @param prompt - The prompt array to push formatted messages into
 * @param toolNameMap - Map of toolCallId to toolName for resolving tool result names
 */
function formatAssistantMessage(
  message: Message,
  prompt: LanguageModelV3Prompt,
  toolNameMap: Map<string, string>
): void {
  const assistantContent: Array<LanguageModelV3TextPart | LanguageModelV3ReasoningPart | LanguageModelV3ToolCallPart> =
    []

  const toolResults: LanguageModelV3ToolResultPart[] = []

  for (const block of message.content) {
    switch (block.type) {
      case 'textBlock':
        assistantContent.push({ type: 'text', text: block.text })
        break
      case 'reasoningBlock':
        if (block.text) {
          assistantContent.push({ type: 'reasoning', text: block.text })
        }
        break
      case 'toolUseBlock':
        assistantContent.push({
          type: 'tool-call',
          toolCallId: block.toolUseId,
          toolName: block.name,
          input: block.input,
        })
        break
      case 'toolResultBlock':
        toolResults.push({
          type: 'tool-result',
          toolCallId: block.toolUseId,
          toolName: toolNameMap.get(block.toolUseId) ?? '',
          output: formatToolResultOutput(block.status, block.content),
        })
        break
      default:
        break
    }
  }

  if (assistantContent.length > 0) {
    prompt.push({ role: 'assistant', content: assistantContent })
  }

  // Each tool result gets its own tool message to preserve ordering
  for (const result of toolResults) {
    prompt.push({ role: 'tool', content: [result] })
  }
}

/**
 * Formats tool result content to LanguageModelV3 ToolResultOutput.
 */
function formatToolResultOutput(
  status: string,
  content: ReadonlyArray<{ type: string; text?: string; json?: unknown }>
): LanguageModelV3ToolResultOutput {
  if (status === 'error') {
    const errorText = content
      .filter((c): c is { type: string; text: string } => 'text' in c && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
    return { type: 'error-text', value: errorText || 'Tool execution failed' }
  }

  if (content.length === 1) {
    const item = content[0]!
    if ('text' in item && typeof item.text === 'string') {
      return { type: 'text', value: item.text }
    }
    if ('json' in item && item.json != null) {
      return { type: 'json', value: item.json as Parameters<typeof JSON.stringify>[0] }
    }
  }

  const text = content
    .filter((c): c is { type: string; text: string } => 'text' in c && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
  return { type: 'text', value: text || '' }
}

/**
 * Converts Strands ToolSpec[] to LanguageModelV3 FunctionTool[].
 */
function formatTools(toolSpecs: ToolSpec[]): LanguageModelV3FunctionTool[] {
  return toolSpecs.map((spec) => ({
    type: 'function' as const,
    name: spec.name,
    description: spec.description,
    inputSchema: (spec.inputSchema ?? {
      type: 'object',
      properties: {},
    }) as LanguageModelV3FunctionTool['inputSchema'],
  }))
}

/**
 * Converts Strands ToolChoice to LanguageModelV3 ToolChoice.
 */
function formatToolChoice(toolChoice: ToolChoice): LanguageModelV3ToolChoice {
  if ('auto' in toolChoice) return { type: 'auto' }
  if ('any' in toolChoice) return { type: 'required' }
  if ('tool' in toolChoice) return { type: 'tool', toolName: toolChoice.tool.name }
  return { type: 'auto' }
}

/**
 * Type guard for TextBlock instances in system prompt content.
 */
function isTextBlock(block: unknown): block is TextBlock {
  return typeof block === 'object' && block !== null && 'text' in block && typeof (block as TextBlock).text === 'string'
}
