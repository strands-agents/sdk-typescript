/**
 * OpenTelemetry integration.
 *
 * This module provides tracing capabilities using OpenTelemetry,
 * enabling trace data to be sent to OTLP endpoints.
 *
 * Uses a fully stateful approach via OpenTelemetry's context propagation.
 * Parent-child relationships are established automatically through
 * context.active(). Use context.with() to set a span as active before
 * creating child spans.
 *
 * @example
 * ```typescript
 * const tracer = new Tracer()
 * const parentSpan = tracer.startAgentSpan({ ... })
 *
 * // Run code with parentSpan as active context
 * await context.with(trace.setSpan(context.active(), parentSpan), async () => {
 *   // Child spans automatically parent to parentSpan
 *   const childSpan = tracer.startModelInvokeSpan({ messages })
 *   // ...
 *   tracer.endModelInvokeSpan(childSpan)
 * })
 *
 * tracer.endAgentSpan(parentSpan)
 * ```
 */

import { context, SpanStatusCode, SpanKind, trace } from '@opentelemetry/api'
import type { Span, Tracer as OtelTracer, SpanOptions, AttributeValue } from '@opentelemetry/api'
import { logger } from '../logging/index.js'
import type {
  EndAgentSpanOptions,
  EndModelSpanOptions,
  EndToolCallSpanOptions,
  EndAgentLoopSpanOptions,
  StartAgentSpanOptions,
  StartModelInvokeSpanOptions,
  StartToolCallSpanOptions,
  StartAgentLoopSpanOptions,
  Usage,
  Metrics,
} from './types.js'
import type { ContentBlock, Message } from '../types/messages.js'
import { jsonReplacer } from './json.js'
import { getServiceName } from './config.js'

/**
 * Tracer manages OpenTelemetry spans for agent operations.
 *
 * Uses a fully stateful approach via OpenTelemetry's context propagation.
 * Parent-child relationships are established automatically through context.active().
 *
 * To create nested spans, use context.with() to set the parent span as active:
 * ```typescript
 * const parent = tracer.startAgentSpan({ ... })
 * context.with(trace.setSpan(context.active(), parent), () => {
 *   const child = tracer.startModelInvokeSpan({ messages }) // auto-parents to parent
 * })
 * ```
 */
export class Tracer {
  /**
   * OpenTelemetry tracer instance obtained from the global API.
   */
  private readonly _tracer: OtelTracer

  /**
   * Whether to use latest experimental semantic conventions.
   *
   * Enabled via `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`.
   * Changes attribute names (e.g., `gen_ai.system` → `gen_ai.provider.name`) and
   * event formats (single `gen_ai.client.inference.operation.details` event vs
   * separate per-message events). Enable when your observability backend supports
   * newer GenAI conventions.
   *
   * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
   */
  private readonly _useLatestConventions: boolean

  /**
   * Whether to include full tool JSON schemas in span attributes.
   *
   * Enabled via `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_tool_definitions`.
   * Useful for debugging tool configuration issues. Disabled by default to
   * reduce span payload size and observability costs.
   *
   * Can be combined with other options:
   * `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental,gen_ai_tool_definitions`
   */
  private readonly _includeToolDefinitions: boolean

  /**
   * Custom attributes to include on all spans created by this tracer.
   */
  private readonly _traceAttributes: Record<string, AttributeValue>

  /**
   * Initialize the tracer with OpenTelemetry configuration.
   * Reads OTEL_SEMCONV_STABILITY_OPT_IN to determine convention version.
   * Gets tracer from the global API to ensure ground truth - works correctly
   * whether the user or Strands initialized the tracer provider.
   *
   * @param traceAttributes - Optional custom attributes to include on all spans
   */
  constructor(traceAttributes?: Record<string, AttributeValue>) {
    this._traceAttributes = traceAttributes ?? {}

    // Read semantic convention version from environment
    const optInValues = Tracer._parseSemconvOptIn()
    this._useLatestConventions = optInValues.has('gen_ai_latest_experimental')
    this._includeToolDefinitions = optInValues.has('gen_ai_tool_definitions')

    // Get tracer from global API to ensure ground truth
    this._tracer = trace.getTracer(getServiceName())
  }

  /**
   * Start an agent invocation span.
   * Returns the span which should be ended with endAgentSpan.
   * Parents to the current active span from context.active().
   *
   * @param options - Options for starting the agent span
   */
  startAgentSpan(options: StartAgentSpanOptions): Span | null {
    const { messages, agentName, agentId, modelId, tools, traceAttributes, toolsConfig, systemPrompt } = options

    try {
      const spanName = `invoke_agent ${agentName}`
      const attributes = this._getCommonAttributes('invoke_agent')
      attributes['gen_ai.agent.name'] = agentName
      attributes['name'] = spanName
      if (agentId) attributes['gen_ai.agent.id'] = agentId
      if (modelId) attributes['gen_ai.request.model'] = modelId

      if (tools && tools.length > 0) {
        const toolNames = tools.map((t) => t.name)
        attributes['gen_ai.agent.tools'] = JSON.stringify(toolNames, jsonReplacer)
      }

      if (this._includeToolDefinitions && toolsConfig) {
        attributes['gen_ai.tool.definitions'] = JSON.stringify(toolsConfig, jsonReplacer)
      }

      if (systemPrompt !== undefined) {
        attributes['system_prompt'] = JSON.stringify(systemPrompt, jsonReplacer)
      }

      const mergedAttributes = { ...attributes, ...this._traceAttributes, ...traceAttributes }
      const span = this._startSpan(spanName, mergedAttributes, SpanKind.INTERNAL)

      this._addEventMessages(span, messages)

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start agent span`)
      return null
    }
  }

  /**
   * End an agent invocation span.
   *
   * @param span - The span to end, or null if span creation failed
   * @param options - Options for ending the span including response, error, and usage data
   */
  endAgentSpan(span: Span | null, options: EndAgentSpanOptions = {}): void {
    if (!span) return

    const { response, error, accumulatedUsage, stopReason } = options

    try {
      const attributes: Record<string, AttributeValue> = {}
      if (accumulatedUsage) this._setUsageAttributes(attributes, accumulatedUsage)
      if (response !== undefined) this._addResponseEvent(span, response, stopReason)

      this._endSpan(span, attributes, error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end agent span`)
    }
  }

  /**
   * Start a model invocation span.
   * Parents to the current active span from context.active().
   *
   * @param options - Options for starting the model invocation span
   */
  startModelInvokeSpan(options: StartModelInvokeSpanOptions): Span | null {
    const { messages, modelId } = options

    try {
      const attributes = this._getCommonAttributes('chat')
      if (modelId) attributes['gen_ai.request.model'] = modelId

      const span = this._startSpan('chat', attributes, SpanKind.INTERNAL)
      this._addEventMessages(span, messages)

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start model invoke span`)
      return null
    }
  }

  /**
   * End a model invocation span.
   *
   * @param span - The span to end, or null if span creation failed
   * @param options - Options for ending the span including usage, metrics, error, and output
   */
  endModelInvokeSpan(span: Span | null, options: EndModelSpanOptions = {}): void {
    if (!span) return

    const { usage, metrics, error, output, stopReason } = options

    try {
      if (output !== undefined) this._addOutputEvent(span, output, stopReason)

      const attributes: Record<string, AttributeValue> = {}
      if (usage) {
        this._setUsageAttributes(attributes, usage)
        if (metrics) this._setMetricsAttributes(attributes, metrics)
      }

      this._endSpan(span, attributes, error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end model invoke span`)
    }
  }

  /**
   * Start a tool call span.
   * Parents to the current active span from context.active().
   *
   * @param options - Options for starting the tool call span
   */
  startToolCallSpan(options: StartToolCallSpanOptions): Span | null {
    const { tool } = options

    try {
      const attributes = this._getCommonAttributes('execute_tool')
      attributes['gen_ai.tool.name'] = tool.name
      attributes['gen_ai.tool.call.id'] = tool.toolUseId

      const span = this._startSpan(`execute_tool ${tool.name}`, attributes, SpanKind.INTERNAL)

      if (this._useLatestConventions) {
        this._addEvent(span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.input.messages': JSON.stringify(
            [
              {
                role: 'tool',
                parts: [{ type: 'tool_call', name: tool.name, id: tool.toolUseId, arguments: tool.input }],
              },
            ],
            jsonReplacer
          ),
        })
      } else {
        this._addEvent(span, 'gen_ai.tool.message', {
          role: 'tool',
          content: JSON.stringify(tool.input, jsonReplacer),
          id: tool.toolUseId,
        })
      }

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start tool call span`)
      return null
    }
  }

  /**
   * End a tool call span.
   *
   * @param span - The span to end, or null if span creation failed
   * @param options - Options for ending the tool call span
   */
  endToolCallSpan(span: Span | null, options: EndToolCallSpanOptions = {}): void {
    if (!span) return

    const { toolResult, error } = options

    try {
      const attributes: Record<string, AttributeValue> = {}

      if (toolResult) {
        const statusStr = typeof toolResult.status === 'string' ? toolResult.status : String(toolResult.status)
        attributes['gen_ai.tool.status'] = statusStr

        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': JSON.stringify(
              [
                {
                  role: 'tool',
                  parts: [{ type: 'tool_call_response', id: toolResult.toolUseId, response: toolResult.content }],
                },
              ],
              jsonReplacer
            ),
          })
        } else {
          this._addEvent(span, 'gen_ai.choice', {
            message: JSON.stringify(toolResult.content, jsonReplacer),
            id: toolResult.toolUseId,
          })
        }
      }

      this._endSpan(span, attributes, error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end tool call span`)
    }
  }

  /**
   * Start an agent loop cycle span.
   * Parents to the current active span from context.active().
   *
   * @param options - Options for starting the agent loop span
   */
  startAgentLoopSpan(options: StartAgentLoopSpanOptions): Span | null {
    const { cycleId, messages } = options

    try {
      const attributes: Record<string, AttributeValue> = { 'agent_loop.cycle_id': cycleId }
      const span = this._startSpan('execute_agent_loop_cycle', attributes)
      this._addEventMessages(span, messages)
      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start agent loop cycle span`)
      return null
    }
  }

  /**
   * End an agent loop cycle span.
   *
   * @param span - The span to end, or null if span creation failed
   * @param options - Options for ending the agent loop span
   */
  endAgentLoopSpan(span: Span | null, options: EndAgentLoopSpanOptions = {}): void {
    if (!span) return
    try {
      this._endSpan(span, {}, options.error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end agent loop cycle span`)
    }
  }

  /**
   * Create a span parented to the current active context.
   */
  private _startSpan(spanName: string, attributes?: Record<string, AttributeValue>, spanKind?: SpanKind): Span {
    const options: SpanOptions = {}

    if (attributes) {
      const otelAttributes: Record<string, AttributeValue | undefined> = {}
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null) otelAttributes[key] = value
      }
      options.attributes = otelAttributes
    }

    if (spanKind !== undefined) options.kind = spanKind

    const span = this._tracer.startSpan(spanName, options, context.active())

    try {
      span.setAttribute('gen_ai.event.start_time', new Date().toISOString())
    } catch (err) {
      logger.warn(`error=<${err}> | failed to set start time attribute`)
    }

    return span
  }

  /**
   * End a span with the given attributes and optional error.
   */
  private _endSpan(span: Span, attributes?: Record<string, AttributeValue>, error?: Error): void {
    try {
      const endAttributes: Record<string, AttributeValue> = { 'gen_ai.event.end_time': new Date().toISOString() }
      if (attributes) Object.assign(endAttributes, attributes)

      this._setAttributes(span, endAttributes)

      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
      } else {
        span.setStatus({ code: SpanStatusCode.OK })
      }

      span.end()
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end span`)
    }
  }

  /**
   * Set attributes on a span.
   */
  private _setAttributes(span: Span, attributes: Record<string, AttributeValue>): void {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) {
        try {
          span.setAttribute(key, value)
        } catch (err) {
          logger.warn(`error=<${err}>, key=<${key}> | failed to set span attribute`)
        }
      }
    }
  }

  /**
   * Add an event to a span.
   */
  private _addEvent(span: Span, eventName: string, eventAttributes?: Record<string, AttributeValue>): void {
    try {
      if (!eventAttributes) {
        span.addEvent(eventName)
        return
      }
      const otelAttributes: Record<string, AttributeValue | undefined> = {}
      for (const [key, value] of Object.entries(eventAttributes)) {
        if (value !== undefined && value !== null) otelAttributes[key] = value
      }
      span.addEvent(eventName, otelAttributes)
    } catch (err) {
      logger.warn(`error=<${err}>, event=<${eventName}> | failed to add span event`)
    }
  }

  /**
   * Get common attributes based on semantic convention version.
   * The attribute name changed between OTEL semconv versions:
   * - Stable: 'gen_ai.system'
   * - Latest experimental: 'gen_ai.provider.name'
   */
  private _getCommonAttributes(operationName: string): Record<string, AttributeValue> {
    const attributes: Record<string, AttributeValue> = {
      'gen_ai.operation.name': operationName,
    }

    if (this._useLatestConventions) {
      attributes['gen_ai.provider.name'] = getServiceName()
    } else {
      attributes['gen_ai.system'] = getServiceName()
    }

    return attributes
  }

  /**
   * Add message events to a span.
   * Uses different event formats based on semantic convention version:
   * - Latest: Single 'gen_ai.client.inference.operation.details' event with all messages
   * - Stable: Separate events per message (gen_ai.user.message, gen_ai.assistant.message, etc.)
   */
  private _addEventMessages(span: Span, messages: Message[]): void {
    try {
      if (!Array.isArray(messages)) return

      if (this._useLatestConventions) {
        const inputMessages = messages.map((m) => ({
          role: m.role,
          parts: Tracer._mapContentBlocksToOtelParts(m.content),
        }))
        this._addEvent(span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.input.messages': JSON.stringify(inputMessages, jsonReplacer),
        })
      } else {
        for (const message of messages) {
          this._addEvent(span, this._getEventNameForMessage(message), {
            content: JSON.stringify(message.content, jsonReplacer),
          })
        }
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to add message events`)
    }
  }

  /**
   * Get the event name for a message based on its type.
   */
  private _getEventNameForMessage(message: Message): string {
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block && typeof block === 'object' && 'type' in block && block.type === 'toolResultBlock') {
          return 'gen_ai.tool.message'
        }
      }
    }

    if (message.role === 'user') return 'gen_ai.user.message'
    if (message.role === 'assistant') return 'gen_ai.assistant.message'
    return 'gen_ai.message'
  }

  /**
   * Set usage attributes on an attributes object.
   * Sets both legacy (prompt_tokens/completion_tokens) and new (input_tokens/output_tokens)
   * attribute names for compatibility with different OTEL backends.
   */
  private _setUsageAttributes(attributes: Record<string, AttributeValue>, usage: Usage): void {
    attributes['gen_ai.usage.prompt_tokens'] = usage.inputTokens
    attributes['gen_ai.usage.input_tokens'] = usage.inputTokens
    attributes['gen_ai.usage.completion_tokens'] = usage.outputTokens
    attributes['gen_ai.usage.output_tokens'] = usage.outputTokens
    attributes['gen_ai.usage.total_tokens'] = usage.totalTokens

    if ((usage.cacheReadInputTokens ?? 0) > 0) {
      attributes['gen_ai.usage.cache_read_input_tokens'] = usage.cacheReadInputTokens!
    }
    if ((usage.cacheWriteInputTokens ?? 0) > 0) {
      attributes['gen_ai.usage.cache_write_input_tokens'] = usage.cacheWriteInputTokens!
    }
  }

  /**
   * Set metrics attributes on an attributes object.
   */
  private _setMetricsAttributes(attributes: Record<string, AttributeValue>, metrics: Metrics): void {
    if (metrics.latencyMs !== undefined && metrics.latencyMs > 0) {
      attributes['gen_ai.server.request.duration'] = metrics.latencyMs
    }
  }

  /**
   * Add response event to a span.
   */
  private _addResponseEvent(span: Span, response: Message, stopReason?: string): void {
    try {
      const finishReason = stopReason || 'end_turn'

      const textParts: string[] = []
      for (const block of response.content) {
        if (block.type === 'textBlock') {
          textParts.push(block.text)
        }
      }
      const messageText = textParts.join('\n')

      if (this._useLatestConventions) {
        this._addEvent(span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.output.messages': JSON.stringify(
            [{ role: 'assistant', parts: [{ type: 'text', content: messageText }], finish_reason: finishReason }],
            jsonReplacer
          ),
        })
      } else {
        this._addEvent(span, 'gen_ai.choice', { message: messageText, finish_reason: finishReason })
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to add response event`)
    }
  }

  /**
   * Add output event to a span for model invocation.
   */
  private _addOutputEvent(span: Span, message: Message, stopReason?: string): void {
    const finishReason = stopReason || 'unknown'

    if (this._useLatestConventions) {
      this._addEvent(span, 'gen_ai.client.inference.operation.details', {
        'gen_ai.output.messages': JSON.stringify(
          [
            {
              role: message.role,
              parts: Tracer._mapContentBlocksToOtelParts(message.content),
              finish_reason: finishReason,
            },
          ],
          jsonReplacer
        ),
      })
    } else {
      this._addEvent(span, 'gen_ai.choice', {
        finish_reason: finishReason,
        message: JSON.stringify(Tracer._mapContentBlocksToStableFormat(message.content), jsonReplacer),
      })
    }
  }

  /**
   * Parse the OTEL_SEMCONV_STABILITY_OPT_IN environment variable.
   */
  private static _parseSemconvOptIn(): Set<string> {
    const optInEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN ?? ''
    return new Set(
      optInEnv
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  }

  /**
   * Map content blocks to OTEL parts format (latest conventions).
   * Converts SDK content block types to OTEL semantic convention format.
   */
  private static _mapContentBlocksToOtelParts(contentBlocks: ContentBlock[]): Record<string, unknown>[] {
    if (!Array.isArray(contentBlocks)) return []

    return contentBlocks.map((block) => {
      switch (block.type) {
        case 'textBlock':
          return { type: 'text', content: block.text }
        case 'toolUseBlock':
          return { type: 'tool_call', name: block.name, id: block.toolUseId, arguments: block.input }
        case 'toolResultBlock':
          return { type: 'tool_call_response', id: block.toolUseId, response: block.content }
        default:
          return block as unknown as Record<string, unknown>
      }
    })
  }

  /**
   * Map content blocks to stable format (older conventions).
   * Simplifies content blocks to a minimal structure for legacy OTEL backends.
   */
  private static _mapContentBlocksToStableFormat(contentBlocks: ContentBlock[]): unknown[] {
    if (!Array.isArray(contentBlocks)) return []

    return contentBlocks
      .map((block) => {
        switch (block.type) {
          case 'textBlock':
            return { text: block.text }
          case 'toolUseBlock':
            return { type: 'toolUse', name: block.name, toolUseId: block.toolUseId, input: block.input }
          case 'toolResultBlock':
            return { type: 'toolResult', toolUseId: block.toolUseId, content: block.content }
          default:
            return null
        }
      })
      .filter(Boolean)
  }
}
