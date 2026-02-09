/**
 * OpenTelemetry tracing integration.
 *
 * Provides automatic tracing of agent lifecycle: agent spans, event loop cycle spans,
 * model invocation spans, and tool execution spans. Uses `\@opentelemetry/api` as an
 * optional dependency — when not installed, all tracing operations are silent no-ops.
 */

import type { Context, Span, Tracer as OTelTracer } from '@opentelemetry/api'
import type { Message, StopReason } from '../types/messages.js'
import type { Usage, Metrics } from '../models/streaming.js'
import type { AgentResult } from '../types/agent.js'
import type { AttributeValue } from './types.js'

/**
 * Resolved OpenTelemetry API module type.
 * Mirrors the exports we use from `\@opentelemetry/api`.
 */
interface OTelModule {
  trace: {
    getTracerProvider(): { getTracer(name: string): OTelTracer }
    setSpan(context: OTelContext, span: Span): OTelContext
    getSpan(context: OTelContext): Span | undefined
  }
  context: {
    active(): OTelContext
  }
  SpanKind: {
    INTERNAL: number
    CLIENT: number
  }
  SpanStatusCode: {
    OK: number
    ERROR: number
    UNSET: number
  }
  INVALID_SPAN: Span
}

/**
 * Re-export of the OTel Context type for use in the module interface.
 */
type OTelContext = Context

/**
 * No-op span implementation for when OpenTelemetry is not available.
 */
class NoOpSpan implements Span {
  spanContext(): ReturnType<Span['spanContext']> {
    return {
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: 0,
    }
  }
  setAttribute(): this {
    return this
  }
  setAttributes(): this {
    return this
  }
  addEvent(): this {
    return this
  }
  addLink(): this {
    return this
  }
  addLinks(): this {
    return this
  }
  setStatus(): this {
    return this
  }
  updateName(): this {
    return this
  }
  end(): void {}
  isRecording(): boolean {
    return false
  }
  recordException(): void {}
}

const NO_OP_SPAN = new NoOpSpan()

/**
 * Serializes an object to JSON, replacing non-serializable values.
 *
 * Handles dates (ISO strings), functions, symbols, and circular references
 * by replacing them with safe string representations.
 *
 * @param obj - The object to serialize
 * @returns JSON string representation
 */
export function serialize(obj: unknown): string {
  const seen = new WeakSet()

  const replacer = (_key: string, value: unknown): unknown => {
    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString()
    }

    // Handle non-serializable types
    if (typeof value === 'function' || typeof value === 'symbol') {
      return '<replaced>'
    }

    if (value === undefined) {
      return '<replaced>'
    }

    // Handle circular references
    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) {
        return '<circular>'
      }
      seen.add(value)
    }

    return value
  }

  return JSON.stringify(obj, replacer)
}

/**
 * Provides OpenTelemetry tracing for the Strands agent lifecycle.
 *
 * When `\@opentelemetry/api` is installed and a TracerProvider is configured,
 * creates real spans for agent invocations, model calls, and tool executions.
 * When OpenTelemetry is not available, all methods are silent no-ops.
 *
 * Supports both standard and latest GenAI semantic conventions via the
 * OTEL_SEMCONV_STABILITY_OPT_IN environment variable.
 */
export class StrandsTracer {
  private _otel: OTelModule | undefined
  private _tracer: OTelTracer | undefined
  private _initialized = false
  private _useLatestGenAIConventions = false
  private _includeToolDefinitions = false

  /**
   * Initializes the tracer by attempting to load `\@opentelemetry/api`.
   * Safe to call multiple times — only the first call performs the import.
   * If the import fails (package not installed), the tracer stays in no-op mode.
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      return
    }
    this._initialized = true

    try {
      this._otel = (await import('@opentelemetry/api')) as unknown as OTelModule
      this._tracer = this._otel.trace.getTracerProvider().getTracer('strands-agents')

      // Parse semantic convention opt-in
      const optInEnv = globalThis?.process?.env?.OTEL_SEMCONV_STABILITY_OPT_IN ?? ''
      const optInValues = new Set(optInEnv.split(',').map((v) => v.trim()))
      this._useLatestGenAIConventions = optInValues.has('gen_ai_latest_experimental')
      this._includeToolDefinitions = optInValues.has('gen_ai_tool_definitions')
    } catch {
      // @opentelemetry/api is not installed — remain in no-op mode
    }
  }

  /**
   * Starts a span for an agent invocation.
   *
   * @param params - Agent span parameters
   * @returns The created span (or a no-op span if OTel is unavailable)
   */
  startAgentSpan(params: {
    messages: Message[]
    agentName: string
    modelId?: string | undefined
    tools?: string[] | undefined
    customTraceAttributes?: Record<string, AttributeValue> | undefined
    toolsConfig?: Record<string, Record<string, unknown>> | undefined
    parentSpan?: Span | undefined
  }): Span {
    if (!this._otel || !this._tracer) {
      return NO_OP_SPAN
    }

    const attributes: Record<string, AttributeValue> = this._getCommonAttributes('invoke_agent')
    attributes['gen_ai.agent.name'] = params.agentName

    if (params.modelId !== undefined) {
      attributes['gen_ai.request.model'] = params.modelId
    }

    if (params.tools !== undefined) {
      attributes['gen_ai.agent.tools'] = serialize(params.tools)
    }

    if (this._includeToolDefinitions && params.toolsConfig !== undefined) {
      try {
        const toolDefinitions = Object.entries(params.toolsConfig).map(([name, spec]) => ({
          name,
          description: spec.description,
          inputSchema: spec.inputSchema,
          outputSchema: spec.outputSchema,
        }))
        attributes['gen_ai.tool.definitions'] = serialize(toolDefinitions)
      } catch {
        // Tool metadata serialization failed — skip attaching to span
      }
    }

    if (params.customTraceAttributes !== undefined) {
      Object.assign(attributes, params.customTraceAttributes)
    }

    const span = this._startSpan(`invoke_agent ${params.agentName}`, params.parentSpan, attributes)
    this._addEventMessages(span, params.messages)

    return span
  }

  /**
   * Ends an agent invocation span.
   *
   * @param params - Agent span end parameters
   */
  endAgentSpan(params: { span: Span; response?: AgentResult | undefined; error?: Error | undefined }): void {
    if (!this._otel) {
      return
    }

    const attributes: Record<string, AttributeValue> = {}

    if (params.response !== undefined) {
      if (this._useLatestGenAIConventions) {
        this._addEvent(params.span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.output.messages': serialize([
            {
              role: 'assistant',
              parts: [{ type: 'text', content: params.response.toString() }],
              finish_reason: String(params.response.stopReason),
            },
          ]),
        })
      } else {
        this._addEvent(params.span, 'gen_ai.choice', {
          message: params.response.toString(),
          finish_reason: String(params.response.stopReason),
        })
      }

      const accumulatedUsage = params.response.metrics?.accumulatedUsage
      if (accumulatedUsage !== undefined) {
        attributes['gen_ai.usage.prompt_tokens'] = accumulatedUsage.inputTokens
        attributes['gen_ai.usage.completion_tokens'] = accumulatedUsage.outputTokens
        attributes['gen_ai.usage.input_tokens'] = accumulatedUsage.inputTokens
        attributes['gen_ai.usage.output_tokens'] = accumulatedUsage.outputTokens
        attributes['gen_ai.usage.total_tokens'] = accumulatedUsage.totalTokens
        attributes['gen_ai.usage.cache_read_input_tokens'] = accumulatedUsage.cacheReadInputTokens ?? 0
        attributes['gen_ai.usage.cache_write_input_tokens'] = accumulatedUsage.cacheWriteInputTokens ?? 0
      }
    }

    this._endSpan(params.span, attributes, params.error)
  }

  /**
   * Starts a span for an event loop cycle.
   *
   * @param params - Cycle span parameters
   * @returns The created span (or a no-op span if OTel is unavailable)
   */
  startEventLoopCycleSpan(params: {
    cycleId: number
    messages: Message[]
    parentSpan?: Span | undefined
    customTraceAttributes?: Record<string, AttributeValue> | undefined
  }): Span {
    if (!this._otel || !this._tracer) {
      return NO_OP_SPAN
    }

    const attributes: Record<string, AttributeValue> = {
      'event_loop.cycle_id': String(params.cycleId),
    }

    if (params.customTraceAttributes !== undefined) {
      Object.assign(attributes, params.customTraceAttributes)
    }

    const span = this._startSpan('execute_event_loop_cycle', params.parentSpan, attributes)
    this._addEventMessages(span, params.messages)

    return span
  }

  /**
   * Ends an event loop cycle span.
   *
   * @param params - Cycle span end parameters
   */
  endEventLoopCycleSpan(params: { span: Span; message: Message; toolResultMessage?: Message | undefined }): void {
    if (!this._otel) {
      return
    }

    const eventAttributes: Record<string, string> = {
      message: serialize(params.message.content),
    }

    if (params.toolResultMessage !== undefined) {
      eventAttributes['tool.result'] = serialize(params.toolResultMessage.content)

      if (this._useLatestGenAIConventions) {
        this._addEvent(params.span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.output.messages': serialize([
            {
              role: params.toolResultMessage.role,
              parts: this._mapContentBlocksToOTelParts(params.toolResultMessage.content),
            },
          ]),
        })
      } else {
        this._addEvent(params.span, 'gen_ai.choice', eventAttributes)
      }
    }

    this._endSpan(params.span)
  }

  /**
   * Starts a span for a model invocation.
   *
   * @param params - Model span parameters
   * @returns The created span (or a no-op span if OTel is unavailable)
   */
  startModelInvokeSpan(params: {
    messages: Message[]
    parentSpan?: Span | undefined
    modelId?: string | undefined
    customTraceAttributes?: Record<string, AttributeValue> | undefined
  }): Span {
    if (!this._otel || !this._tracer) {
      return NO_OP_SPAN
    }

    const attributes: Record<string, AttributeValue> = this._getCommonAttributes('chat')

    if (params.customTraceAttributes !== undefined) {
      Object.assign(attributes, params.customTraceAttributes)
    }

    if (params.modelId !== undefined) {
      attributes['gen_ai.request.model'] = params.modelId
    }

    const span = this._startSpan('chat', params.parentSpan, attributes)
    this._addEventMessages(span, params.messages)

    return span
  }

  /**
   * Ends a model invocation span with results and metrics.
   *
   * @param params - Model span end parameters
   */
  endModelInvokeSpan(params: {
    span: Span
    message: Message
    usage: Usage
    metrics: Metrics
    stopReason: StopReason
  }): void {
    if (!this._otel) {
      return
    }

    params.span.setAttribute('gen_ai.event.end_time', new Date().toISOString())

    const attributes: Record<string, AttributeValue> = {
      'gen_ai.usage.prompt_tokens': params.usage.inputTokens,
      'gen_ai.usage.input_tokens': params.usage.inputTokens,
      'gen_ai.usage.completion_tokens': params.usage.outputTokens,
      'gen_ai.usage.output_tokens': params.usage.outputTokens,
      'gen_ai.usage.total_tokens': params.usage.totalTokens,
    }

    this._addOptionalUsageAndMetricsAttributes(attributes, params.usage, params.metrics)

    if (this._useLatestGenAIConventions) {
      this._addEvent(params.span, 'gen_ai.client.inference.operation.details', {
        'gen_ai.output.messages': serialize([
          {
            role: params.message.role,
            parts: this._mapContentBlocksToOTelParts(params.message.content),
            finish_reason: String(params.stopReason),
          },
        ]),
      })
    } else {
      this._addEvent(params.span, 'gen_ai.choice', {
        finish_reason: String(params.stopReason),
        message: serialize(params.message.content),
      })
    }

    this._setAttributes(params.span, attributes)
  }

  /**
   * Starts a span for a tool call execution.
   *
   * @param params - Tool span parameters
   * @returns The created span (or a no-op span if OTel is unavailable)
   */
  startToolCallSpan(params: {
    toolUse: { name: string; toolUseId: string; input: unknown }
    parentSpan?: Span | undefined
    customTraceAttributes?: Record<string, AttributeValue> | undefined
  }): Span {
    if (!this._otel || !this._tracer) {
      return NO_OP_SPAN
    }

    const attributes: Record<string, AttributeValue> = this._getCommonAttributes('execute_tool')
    attributes['gen_ai.tool.name'] = params.toolUse.name
    attributes['gen_ai.tool.call.id'] = params.toolUse.toolUseId

    if (params.customTraceAttributes !== undefined) {
      Object.assign(attributes, params.customTraceAttributes)
    }

    const spanName = `execute_tool ${params.toolUse.name}`
    const span = this._startSpan(spanName, params.parentSpan, attributes)

    if (this._useLatestGenAIConventions) {
      this._addEvent(span, 'gen_ai.client.inference.operation.details', {
        'gen_ai.input.messages': serialize([
          {
            role: 'tool',
            parts: [
              {
                type: 'tool_call',
                name: params.toolUse.name,
                id: params.toolUse.toolUseId,
                arguments: params.toolUse.input,
              },
            ],
          },
        ]),
      })
    } else {
      this._addEvent(span, 'gen_ai.tool.message', {
        role: 'tool',
        content: serialize(params.toolUse.input),
        id: params.toolUse.toolUseId,
      })
    }

    return span
  }

  /**
   * Ends a tool call span with results.
   *
   * @param params - Tool span end parameters
   */
  endToolCallSpan(params: {
    span: Span
    toolResult?: { toolUseId: string; status: string; content: unknown } | undefined
    error?: Error | undefined
  }): void {
    if (!this._otel) {
      return
    }

    const attributes: Record<string, AttributeValue> = {}

    if (params.toolResult !== undefined) {
      attributes['gen_ai.tool.status'] = String(params.toolResult.status)

      if (this._useLatestGenAIConventions) {
        this._addEvent(params.span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.output.messages': serialize([
            {
              role: 'tool',
              parts: [
                {
                  type: 'tool_call_response',
                  id: params.toolResult.toolUseId,
                  response: params.toolResult.content,
                },
              ],
            },
          ]),
        })
      } else {
        this._addEvent(params.span, 'gen_ai.choice', {
          message: serialize(params.toolResult.content),
          id: params.toolResult.toolUseId,
        })
      }
    }

    this._endSpan(params.span, attributes, params.error)
  }

  /**
   * Starts a span for a multi-agent orchestration invocation.
   *
   * @param params - Multi-agent span parameters
   * @returns The created span (or a no-op span if OTel is unavailable)
   */
  startMultiAgentSpan(params: {
    input: string | unknown[]
    instanceName: string
    customTraceAttributes?: Record<string, AttributeValue> | undefined
  }): Span {
    if (!this._otel || !this._tracer) {
      return NO_OP_SPAN
    }

    const operation = `invoke_${params.instanceName}`
    const attributes: Record<string, AttributeValue> = this._getCommonAttributes(operation)
    attributes['gen_ai.agent.name'] = params.instanceName

    if (params.customTraceAttributes !== undefined) {
      Object.assign(attributes, params.customTraceAttributes)
    }

    const span = this._startSpan(operation, undefined, attributes)

    if (this._useLatestGenAIConventions) {
      const parts =
        typeof params.input === 'string'
          ? [{ type: 'text', content: params.input }]
          : (params.input as unknown[]).map((item) => ({ type: 'text', content: serialize(item) }))
      this._addEvent(span, 'gen_ai.client.inference.operation.details', {
        'gen_ai.input.messages': serialize([{ role: 'user', parts }]),
      })
    } else {
      this._addEvent(span, 'gen_ai.user.message', {
        content: typeof params.input === 'string' ? params.input : serialize(params.input),
      })
    }

    return span
  }

  /**
   * Ends a multi-agent span with optional result.
   *
   * @param params - Multi-agent span end parameters
   */
  endMultiAgentSpan(params: { span: Span; result?: string | undefined; error?: Error | undefined }): void {
    if (!this._otel) {
      return
    }

    if (params.result !== undefined) {
      if (this._useLatestGenAIConventions) {
        this._addEvent(params.span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.output.messages': serialize([
            { role: 'assistant', parts: [{ type: 'text', content: params.result }] },
          ]),
        })
      } else {
        this._addEvent(params.span, 'gen_ai.choice', {
          message: params.result,
        })
      }
    }

    this._endSpan(params.span, undefined, params.error)
  }

  /**
   * Starts a span for a multi-agent node execution.
   *
   * @param params - Node span parameters
   * @returns The created span (or a no-op span if OTel is unavailable)
   */
  startNodeSpan(params: {
    nodeId: string
    nodeType: string
    parentSpan?: Span | undefined
    customTraceAttributes?: Record<string, AttributeValue> | undefined
  }): Span {
    if (!this._otel || !this._tracer) {
      return NO_OP_SPAN
    }

    const attributes: Record<string, AttributeValue> = this._getCommonAttributes('invoke_multi_agent_node')
    attributes['gen_ai.agent.name'] = params.nodeId
    attributes['multi_agent.node.type'] = params.nodeType

    if (params.customTraceAttributes !== undefined) {
      Object.assign(attributes, params.customTraceAttributes)
    }

    const spanName = `invoke_node ${params.nodeId}`
    return this._startSpan(spanName, params.parentSpan, attributes)
  }

  /**
   * Ends a multi-agent node span.
   *
   * @param params - Node span end parameters
   */
  endNodeSpan(params: {
    span: Span
    status: string
    executionTime?: number | undefined
    error?: Error | undefined
  }): void {
    if (!this._otel) {
      return
    }

    const attributes: Record<string, AttributeValue> = {
      'multi_agent.node.status': params.status,
    }
    if (params.executionTime !== undefined) {
      attributes['multi_agent.node.execution_time_ms'] = params.executionTime
    }

    this._endSpan(params.span, attributes, params.error)
  }

  // --- Private helpers ---

  /**
   * Creates a new span with common setup.
   */
  private _startSpan(spanName: string, parentSpan?: Span, attributes?: Record<string, AttributeValue>): Span {
    const otel = this._otel!
    const tracer = this._tracer!

    let spanContext: OTelContext | undefined
    if (parentSpan !== undefined && parentSpan.isRecording() && parentSpan !== otel.INVALID_SPAN) {
      spanContext = otel.trace.setSpan(otel.context.active(), parentSpan)
    }

    const span = tracer.startSpan(spanName, { kind: otel.SpanKind.INTERNAL }, spanContext)

    span.setAttribute('gen_ai.event.start_time', new Date().toISOString())

    if (attributes !== undefined) {
      this._setAttributes(span, attributes)
    }

    return span
  }

  /**
   * Sets multiple attributes on a span.
   */
  private _setAttributes(span: Span, attributes: Record<string, AttributeValue>): void {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value)
    }
  }

  /**
   * Ends a span with optional attributes and error handling.
   */
  private _endSpan(span: Span, attributes?: Record<string, AttributeValue>, error?: Error): void {
    const otel = this._otel
    if (!otel) {
      return
    }

    try {
      span.setAttribute('gen_ai.event.end_time', new Date().toISOString())

      if (attributes !== undefined) {
        this._setAttributes(span, attributes)
      }

      if (error !== undefined) {
        span.setStatus({ code: otel.SpanStatusCode.ERROR, message: String(error) })
        span.recordException(error)
      } else {
        span.setStatus({ code: otel.SpanStatusCode.OK })
      }
    } catch {
      // Span ending failed — swallow to avoid disrupting execution
    } finally {
      span.end()
    }
  }

  /**
   * Adds an event with attributes to a span.
   */
  private _addEvent(span: Span, eventName: string, eventAttributes: Record<string, string>): void {
    span.addEvent(eventName, eventAttributes)
  }

  /**
   * Returns common GenAI attributes based on the configured convention version.
   */
  private _getCommonAttributes(operationName: string): Record<string, AttributeValue> {
    const attributes: Record<string, AttributeValue> = {
      'gen_ai.operation.name': operationName,
    }

    if (this._useLatestGenAIConventions) {
      attributes['gen_ai.provider.name'] = 'strands-agents'
    } else {
      attributes['gen_ai.system'] = 'strands-agents'
    }

    return attributes
  }

  /**
   * Adds optional usage and metrics attributes if they have values.
   */
  private _addOptionalUsageAndMetricsAttributes(
    attributes: Record<string, AttributeValue>,
    usage: Usage,
    metrics: Metrics
  ): void {
    if (usage.cacheReadInputTokens !== undefined) {
      attributes['gen_ai.usage.cache_read_input_tokens'] = usage.cacheReadInputTokens
    }

    if (usage.cacheWriteInputTokens !== undefined) {
      attributes['gen_ai.usage.cache_write_input_tokens'] = usage.cacheWriteInputTokens
    }

    if (metrics.latencyMs > 0) {
      attributes['gen_ai.server.request.duration'] = metrics.latencyMs
    }
  }

  /**
   * Adds messages as events to a span using the appropriate convention format.
   */
  private _addEventMessages(span: Span, messages: Message[]): void {
    if (this._useLatestGenAIConventions) {
      const inputMessages = messages.map((message) => ({
        role: message.role,
        parts: this._mapContentBlocksToOTelParts(message.content),
      }))
      this._addEvent(span, 'gen_ai.client.inference.operation.details', {
        'gen_ai.input.messages': serialize(inputMessages),
      })
    } else {
      for (const message of messages) {
        const eventName = this._getEventNameForMessage(message)
        this._addEvent(span, eventName, {
          content: serialize(message.content),
        })
      }
    }
  }

  /**
   * Determines the appropriate OTel event name for a message.
   * Messages containing tool results use 'gen_ai.tool.message'.
   */
  private _getEventNameForMessage(message: Message): string {
    for (const block of message.content) {
      if (block.type === 'toolResultBlock') {
        return 'gen_ai.tool.message'
      }
    }
    return `gen_ai.${message.role}.message`
  }

  /**
   * Maps content blocks to the OpenTelemetry parts format for latest conventions.
   */
  private _mapContentBlocksToOTelParts(contentBlocks: Message['content']): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = []

    for (const block of contentBlocks) {
      if (block.type === 'textBlock') {
        parts.push({ type: 'text', content: block.text })
      } else if (block.type === 'toolUseBlock') {
        parts.push({
          type: 'tool_call',
          name: block.name,
          id: block.toolUseId,
          arguments: block.input,
        })
      } else if (block.type === 'toolResultBlock') {
        parts.push({
          type: 'tool_call_response',
          id: block.toolUseId,
          response: block.content,
        })
      } else {
        // Generic fallback for other content block types
        parts.push({ type: block.type })
      }
    }

    return parts
  }
}

// Singleton instance
let _tracerInstance: StrandsTracer | undefined

/**
 * Returns the global StrandsTracer singleton.
 * The tracer must be initialized via `initialize()` before spans will be created.
 *
 * @returns The global tracer instance
 */
export function getTracer(): StrandsTracer {
  if (_tracerInstance === undefined) {
    _tracerInstance = new StrandsTracer()
  }
  return _tracerInstance
}
