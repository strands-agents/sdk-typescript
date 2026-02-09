import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Span } from '@opentelemetry/api'
import { StrandsTracer, getTracer, serialize } from '../tracer.js'
import { Message, TextBlock, ToolResultBlock, ToolUseBlock } from '../../types/messages.js'
import { AgentResult } from '../../types/agent.js'

// --- Mock span for verifying tracer behavior ---

interface MockSpanData {
  attributes: Record<string, unknown>
  events: Array<{ name: string; attributes?: Record<string, unknown> }>
  statusResult: { code: number; message?: string } | undefined
  exceptions: Error[]
  ended: boolean
}

function createMockSpan(): Span & MockSpanData {
  const data: MockSpanData = {
    attributes: {},
    events: [],
    statusResult: undefined,
    exceptions: [],
    ended: false,
  }

  const span = {
    ...data,
    spanContext: () => ({
      traceId: 'abcd1234abcd1234abcd1234abcd1234',
      spanId: 'abcd1234abcd1234',
      traceFlags: 1,
    }),
    setAttribute: vi.fn((key: string, value: unknown) => {
      data.attributes[key] = value
      return span
    }),
    setAttributes: vi.fn((attrs: Record<string, unknown>) => {
      Object.assign(data.attributes, attrs)
      return span
    }),
    addEvent: vi.fn((...args: unknown[]) => {
      data.events.push({ name: args[0] as string, attributes: args[1] as Record<string, unknown> })
      return span
    }),
    addLink: vi.fn(() => span),
    addLinks: vi.fn(() => span),
    setStatus: vi.fn((status: { code: number; message?: string }) => {
      data.statusResult = status
      return span
    }),
    updateName: vi.fn(() => span),
    end: vi.fn(() => {
      data.ended = true
    }),
    isRecording: vi.fn(() => true),
    recordException: vi.fn((...args: unknown[]) => {
      data.exceptions.push(args[0] as Error)
    }),
  } as unknown as Span & MockSpanData

  // Re-bind data properties so they're shared with the span object
  Object.defineProperty(span, 'attributes', { get: () => data.attributes })
  Object.defineProperty(span, 'events', { get: () => data.events })
  Object.defineProperty(span, 'statusResult', { get: () => data.statusResult })
  Object.defineProperty(span, 'exceptions', { get: () => data.exceptions })
  Object.defineProperty(span, 'ended', { get: () => data.ended })

  return span
}

// Mock @opentelemetry/api
const mockStartSpan = vi.fn()

vi.mock('@opentelemetry/api', () => {
  return {
    trace: {
      getTracerProvider: () => ({
        getTracer: () => ({
          startSpan: mockStartSpan,
        }),
      }),
      setSpan: (_context: unknown, span: unknown) => ({ __span: span }),
      getSpan: () => undefined,
    },
    context: {
      active: () => ({}),
    },
    SpanKind: {
      INTERNAL: 0,
      CLIENT: 3,
    },
    SpanStatusCode: {
      OK: 1,
      ERROR: 2,
      UNSET: 0,
    },
    INVALID_SPAN: { isRecording: () => false },
  }
})

describe('serialize', () => {
  it('serializes plain objects', () => {
    expect(serialize({ name: 'test', count: 42 })).toBe('{"name":"test","count":42}')
  })

  it('preserves non-ASCII characters', () => {
    expect(serialize('こんにちは')).toBe('"こんにちは"')
    expect(serialize('Hello 🌍')).toBe('"Hello 🌍"')
    expect(serialize('中文测试')).toBe('"中文测试"')
  })

  it('serializes Date objects as ISO strings', () => {
    const date = new Date('2024-01-15T12:00:00.000Z')
    const result = JSON.parse(serialize({ created: date }))
    expect(result.created).toBe('2024-01-15T12:00:00.000Z')
  })

  it('replaces functions with <replaced>', () => {
    const result = JSON.parse(serialize({ fn: () => {} }))
    expect(result.fn).toBe('<replaced>')
  })

  it('replaces symbols with <replaced>', () => {
    const result = JSON.parse(serialize({ sym: Symbol('test') }))
    expect(result.sym).toBe('<replaced>')
  })

  it('handles nested objects', () => {
    const result = JSON.parse(
      serialize({
        outer: {
          inner: { value: 'hello' },
          fn: () => {},
        },
      })
    )
    expect(result.outer.inner.value).toBe('hello')
    expect(result.outer.fn).toBe('<replaced>')
  })

  it('handles arrays with mixed content', () => {
    const result = JSON.parse(serialize([1, 'text', () => {}, null]))
    expect(result).toStrictEqual([1, 'text', '<replaced>', null])
  })

  it('handles circular references', () => {
    const obj: Record<string, unknown> = { name: 'test' }
    obj.self = obj
    const result = JSON.parse(serialize(obj))
    expect(result.name).toBe('test')
    expect(result.self).toBe('<circular>')
  })

  it('handles null and boolean values', () => {
    expect(serialize(null)).toBe('null')
    expect(serialize(true)).toBe('true')
    expect(serialize(false)).toBe('false')
  })

  it('handles undefined values', () => {
    const result = JSON.parse(serialize({ key: undefined }))
    expect(result.key).toBe('<replaced>')
  })
})

describe('StrandsTracer', () => {
  let tracer: StrandsTracer
  let mockSpan: ReturnType<typeof createMockSpan>

  beforeEach(async () => {
    tracer = new StrandsTracer()
    mockSpan = createMockSpan()
    mockStartSpan.mockReturnValue(mockSpan)
    await tracer.initialize()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initialize', () => {
    it('initializes only once', async () => {
      const freshTracer = new StrandsTracer()
      await freshTracer.initialize()
      await freshTracer.initialize()

      // Second init should be a no-op; tracer should still work
      const span = freshTracer.startAgentSpan({
        messages: [],
        agentName: 'test',
      })
      expect(span).toBe(mockSpan)
    })
  })

  describe('startAgentSpan', () => {
    it('creates span with correct name and attributes', () => {
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      tracer.startAgentSpan({
        messages,
        agentName: 'TestAgent',
        modelId: 'claude-3',
        tools: ['calculator', 'search'],
      })

      expect(mockStartSpan).toHaveBeenCalledWith(
        'invoke_agent TestAgent',
        expect.objectContaining({ kind: 0 }),
        undefined
      )

      expect(mockSpan.attributes['gen_ai.operation.name']).toBe('invoke_agent')
      expect(mockSpan.attributes['gen_ai.system']).toBe('strands-agents')
      expect(mockSpan.attributes['gen_ai.agent.name']).toBe('TestAgent')
      expect(mockSpan.attributes['gen_ai.request.model']).toBe('claude-3')
      expect(mockSpan.attributes['gen_ai.agent.tools']).toBe(serialize(['calculator', 'search']))
    })

    it('adds custom trace attributes', () => {
      tracer.startAgentSpan({
        messages: [],
        agentName: 'TestAgent',
        customTraceAttributes: { 'custom.key': 'custom-value' },
      })

      expect(mockSpan.attributes['custom.key']).toBe('custom-value')
    })

    it('adds message events in standard convention', () => {
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      tracer.startAgentSpan({ messages, agentName: 'TestAgent' })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.user.message',
        })
      )
    })

    it('adds tool result messages with correct event name', () => {
      const messages = [
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-1',
              status: 'success',
              content: [new TextBlock('result')],
            }),
          ],
        }),
      ]

      tracer.startAgentSpan({ messages, agentName: 'TestAgent' })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.tool.message',
        })
      )
    })

    it('includes tool definitions when opt-in enabled', async () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_tool_definitions')

      const freshTracer = new StrandsTracer()
      await freshTracer.initialize()

      freshTracer.startAgentSpan({
        messages: [],
        agentName: 'TestAgent',
        toolsConfig: {
          calculator: {
            description: 'Performs math',
            inputSchema: { type: 'object' },
          },
        },
      })

      expect(mockSpan.attributes['gen_ai.tool.definitions']).toBeDefined()

      vi.unstubAllEnvs()
    })

    it('does not include tool definitions by default', () => {
      tracer.startAgentSpan({
        messages: [],
        agentName: 'TestAgent',
        toolsConfig: {
          calculator: { description: 'Performs math' },
        },
      })

      expect(mockSpan.attributes['gen_ai.tool.definitions']).toBeUndefined()
    })

    it('creates span with parent span when parentSpan provided', () => {
      const parentSpan = createMockSpan()
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      tracer.startAgentSpan({
        messages,
        agentName: 'TestAgent',
        parentSpan,
      })

      expect(mockStartSpan).toHaveBeenCalledWith(
        'invoke_agent TestAgent',
        expect.anything(),
        expect.objectContaining({ __span: parentSpan })
      )
    })
  })

  describe('endAgentSpan', () => {
    it('ends span with OK status when no error', () => {
      const result = new AgentResult({
        stopReason: 'endTurn',
        lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Done')] }),
      })

      tracer.endAgentSpan({ span: mockSpan, response: result })

      expect(mockSpan.statusResult).toStrictEqual({ code: 1 })
      expect(mockSpan.ended).toBe(true)
    })

    it('ends span with ERROR status on error', () => {
      const error = new Error('Something went wrong')

      tracer.endAgentSpan({ span: mockSpan, error })

      expect(mockSpan.statusResult).toStrictEqual({ code: 2, message: 'Error: Something went wrong' })
      expect(mockSpan.exceptions).toHaveLength(1)
      expect(mockSpan.ended).toBe(true)
    })

    it('sets usage attributes from response metrics', () => {
      const result = new AgentResult({
        stopReason: 'endTurn',
        lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Done')] }),
        metrics: {
          accumulatedUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cacheReadInputTokens: 10,
            cacheWriteInputTokens: 5,
          },
        },
      })

      tracer.endAgentSpan({ span: mockSpan, response: result })

      expect(mockSpan.attributes['gen_ai.usage.input_tokens']).toBe(100)
      expect(mockSpan.attributes['gen_ai.usage.output_tokens']).toBe(50)
      expect(mockSpan.attributes['gen_ai.usage.total_tokens']).toBe(150)
      expect(mockSpan.attributes['gen_ai.usage.cache_read_input_tokens']).toBe(10)
      expect(mockSpan.attributes['gen_ai.usage.cache_write_input_tokens']).toBe(5)
    })

    it('adds choice event in standard convention', () => {
      const result = new AgentResult({
        stopReason: 'endTurn',
        lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Done')] }),
      })

      tracer.endAgentSpan({ span: mockSpan, response: result })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.choice',
          attributes: expect.objectContaining({
            finish_reason: 'endTurn',
          }),
        })
      )
    })
  })

  describe('startModelInvokeSpan', () => {
    it('creates span with correct name and attributes', () => {
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      tracer.startModelInvokeSpan({ messages, modelId: 'claude-3' })

      expect(mockStartSpan).toHaveBeenCalledWith('chat', expect.objectContaining({ kind: 0 }), undefined)

      expect(mockSpan.attributes['gen_ai.operation.name']).toBe('chat')
      expect(mockSpan.attributes['gen_ai.request.model']).toBe('claude-3')
    })

    it('creates span with parent span', () => {
      const parentSpan = createMockSpan()
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      tracer.startModelInvokeSpan({ messages, parentSpan })

      // Should have been called with a context (not undefined)
      expect(mockStartSpan).toHaveBeenCalledWith(
        'chat',
        expect.anything(),
        expect.objectContaining({ __span: parentSpan })
      )
    })
  })

  describe('endModelInvokeSpan', () => {
    it('sets usage and metrics attributes', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Response')] })

      tracer.endModelInvokeSpan({
        span: mockSpan,
        message,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cacheReadInputTokens: 10,
          cacheWriteInputTokens: 5,
        },
        metrics: { latencyMs: 500 },
        stopReason: 'endTurn',
      })

      expect(mockSpan.attributes['gen_ai.usage.input_tokens']).toBe(100)
      expect(mockSpan.attributes['gen_ai.usage.output_tokens']).toBe(50)
      expect(mockSpan.attributes['gen_ai.usage.total_tokens']).toBe(150)
      expect(mockSpan.attributes['gen_ai.usage.cache_read_input_tokens']).toBe(10)
      expect(mockSpan.attributes['gen_ai.usage.cache_write_input_tokens']).toBe(5)
      expect(mockSpan.attributes['gen_ai.server.request.duration']).toBe(500)
    })

    it('adds choice event with stop reason', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Response')] })

      tracer.endModelInvokeSpan({
        span: mockSpan,
        message,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: { latencyMs: 100 },
        stopReason: 'endTurn',
      })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.choice',
          attributes: expect.objectContaining({
            finish_reason: 'endTurn',
          }),
        })
      )
    })
  })

  describe('startToolCallSpan', () => {
    it('creates span with correct name and attributes', () => {
      tracer.startToolCallSpan({
        toolUse: { name: 'calculator', toolUseId: 'tool-1', input: { a: 1, b: 2 } },
      })

      expect(mockStartSpan).toHaveBeenCalledWith(
        'execute_tool calculator',
        expect.objectContaining({ kind: 0 }),
        undefined
      )

      expect(mockSpan.attributes['gen_ai.operation.name']).toBe('execute_tool')
      expect(mockSpan.attributes['gen_ai.tool.name']).toBe('calculator')
      expect(mockSpan.attributes['gen_ai.tool.call.id']).toBe('tool-1')
    })

    it('adds tool message event in standard convention', () => {
      tracer.startToolCallSpan({
        toolUse: { name: 'calculator', toolUseId: 'tool-1', input: { a: 1 } },
      })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.tool.message',
          attributes: expect.objectContaining({
            role: 'tool',
            id: 'tool-1',
          }),
        })
      )
    })
  })

  describe('endToolCallSpan', () => {
    it('ends span with tool status attribute', () => {
      tracer.endToolCallSpan({
        span: mockSpan,
        toolResult: { toolUseId: 'tool-1', status: 'success', content: 'Result' },
      })

      expect(mockSpan.attributes['gen_ai.tool.status']).toBe('success')
      expect(mockSpan.statusResult).toStrictEqual({ code: 1 })
      expect(mockSpan.ended).toBe(true)
    })

    it('ends span with error', () => {
      const error = new Error('Tool failed')

      tracer.endToolCallSpan({ span: mockSpan, error })

      expect(mockSpan.statusResult).toStrictEqual({ code: 2, message: 'Error: Tool failed' })
      expect(mockSpan.exceptions).toHaveLength(1)
      expect(mockSpan.ended).toBe(true)
    })

    it('ends span when toolResult is undefined', () => {
      tracer.endToolCallSpan({ span: mockSpan })

      expect(mockSpan.statusResult).toStrictEqual({ code: 1 })
      expect(mockSpan.ended).toBe(true)
    })
  })

  describe('startNodeSpan', () => {
    it('creates span with nodeId and nodeType', () => {
      tracer.startNodeSpan({ nodeId: 'node-1', nodeType: 'agent' })

      expect(mockStartSpan).toHaveBeenCalledWith('invoke_node node-1', expect.objectContaining({ kind: 0 }), undefined)
      expect(mockSpan.attributes['gen_ai.agent.name']).toBe('node-1')
      expect(mockSpan.attributes['multi_agent.node.type']).toBe('agent')
    })

    it('creates span with parent span', () => {
      const parentSpan = createMockSpan()
      tracer.startNodeSpan({ nodeId: 'node-2', nodeType: 'multiagent', parentSpan })

      expect(mockStartSpan).toHaveBeenCalledWith(
        'invoke_node node-2',
        expect.anything(),
        expect.objectContaining({ __span: parentSpan })
      )
    })

    it('adds custom trace attributes', () => {
      tracer.startNodeSpan({
        nodeId: 'node-3',
        nodeType: 'agent',
        customTraceAttributes: { 'custom.key': 'value' },
      })
      expect(mockSpan.attributes['custom.key']).toBe('value')
    })
  })

  describe('endNodeSpan', () => {
    it('ends span with status and execution time', () => {
      tracer.endNodeSpan({
        span: mockSpan,
        status: 'completed',
        executionTime: 150,
      })

      expect(mockSpan.attributes['multi_agent.node.status']).toBe('completed')
      expect(mockSpan.attributes['multi_agent.node.execution_time_ms']).toBe(150)
      expect(mockSpan.statusResult).toStrictEqual({ code: 1 })
      expect(mockSpan.ended).toBe(true)
    })

    it('ends span with error', () => {
      const error = new Error('Node failed')
      tracer.endNodeSpan({
        span: mockSpan,
        status: 'failed',
        executionTime: 50,
        error,
      })

      expect(mockSpan.attributes['multi_agent.node.status']).toBe('failed')
      expect(mockSpan.statusResult).toStrictEqual({ code: 2, message: 'Error: Node failed' })
      expect(mockSpan.exceptions).toHaveLength(1)
      expect(mockSpan.ended).toBe(true)
    })
  })

  describe('startEventLoopCycleSpan', () => {
    it('creates span with cycle ID', () => {
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      tracer.startEventLoopCycleSpan({ cycleId: 1, messages })

      expect(mockStartSpan).toHaveBeenCalledWith(
        'execute_event_loop_cycle',
        expect.objectContaining({ kind: 0 }),
        undefined
      )

      expect(mockSpan.attributes['event_loop.cycle_id']).toBe('1')
    })

    it('creates span with parent span', () => {
      const parentSpan = createMockSpan()
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      tracer.startEventLoopCycleSpan({ cycleId: 1, messages, parentSpan })

      expect(mockStartSpan).toHaveBeenCalledWith(
        'execute_event_loop_cycle',
        expect.anything(),
        expect.objectContaining({ __span: parentSpan })
      )
    })
  })

  describe('endEventLoopCycleSpan', () => {
    it('ends span without tool result', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Response')] })

      tracer.endEventLoopCycleSpan({ span: mockSpan, message })

      expect(mockSpan.ended).toBe(true)
    })

    it('adds choice event with tool result in standard convention', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
      const toolResultMessage = new Message({
        role: 'user',
        content: [
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('42')],
          }),
        ],
      })

      tracer.endEventLoopCycleSpan({ span: mockSpan, message, toolResultMessage })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.choice',
          attributes: expect.objectContaining({
            message: expect.any(String),
            'tool.result': expect.any(String),
          }),
        })
      )
    })
  })

  describe('no-op behavior', () => {
    it('returns no-op span before initialization', () => {
      const uninitializedTracer = new StrandsTracer()

      const span = uninitializedTracer.startAgentSpan({
        messages: [],
        agentName: 'TestAgent',
      })

      // Should be a no-op span
      expect(span.isRecording()).toBe(false)
      expect(span.spanContext().traceId).toBe('00000000000000000000000000000000')
    })

    it('no-op methods do not throw', () => {
      const uninitializedTracer = new StrandsTracer()

      // All of these should be silent no-ops
      uninitializedTracer.endAgentSpan({ span: createMockSpan() })
      uninitializedTracer.endEventLoopCycleSpan({
        span: createMockSpan(),
        message: new Message({ role: 'assistant', content: [new TextBlock('test')] }),
      })
      uninitializedTracer.endModelInvokeSpan({
        span: createMockSpan(),
        message: new Message({ role: 'assistant', content: [new TextBlock('test')] }),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        metrics: { latencyMs: 0 },
        stopReason: 'endTurn',
      })
      uninitializedTracer.endToolCallSpan({ span: createMockSpan() })
    })
  })

  describe('latest GenAI conventions', () => {
    let latestTracer: StrandsTracer

    beforeEach(async () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      latestTracer = new StrandsTracer()
      await latestTracer.initialize()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('uses gen_ai.provider.name instead of gen_ai.system', () => {
      latestTracer.startAgentSpan({ messages: [], agentName: 'TestAgent' })

      expect(mockSpan.attributes['gen_ai.provider.name']).toBe('strands-agents')
      expect(mockSpan.attributes['gen_ai.system']).toBeUndefined()
    })

    it('uses gen_ai.client.inference.operation.details for agent span messages', () => {
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      latestTracer.startAgentSpan({ messages, agentName: 'TestAgent' })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.client.inference.operation.details',
          attributes: expect.objectContaining({
            'gen_ai.input.messages': expect.any(String),
          }),
        })
      )
    })

    it('uses gen_ai.client.inference.operation.details for endAgentSpan', () => {
      const result = new AgentResult({
        stopReason: 'endTurn',
        lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Done')] }),
      })

      latestTracer.endAgentSpan({ span: mockSpan, response: result })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.client.inference.operation.details',
          attributes: expect.objectContaining({
            'gen_ai.output.messages': expect.any(String),
          }),
        })
      )
    })

    it('uses gen_ai.client.inference.operation.details for model invoke start', () => {
      const messages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      latestTracer.startModelInvokeSpan({ messages })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.client.inference.operation.details',
          attributes: expect.objectContaining({
            'gen_ai.input.messages': expect.any(String),
          }),
        })
      )
    })

    it('uses gen_ai.client.inference.operation.details for model invoke end', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Response')] })

      latestTracer.endModelInvokeSpan({
        span: mockSpan,
        message,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: { latencyMs: 100 },
        stopReason: 'endTurn',
      })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.client.inference.operation.details',
          attributes: expect.objectContaining({
            'gen_ai.output.messages': expect.any(String),
          }),
        })
      )
    })

    it('uses gen_ai.client.inference.operation.details for tool call start', () => {
      latestTracer.startToolCallSpan({
        toolUse: { name: 'calc', toolUseId: 'tool-1', input: {} },
      })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.client.inference.operation.details',
          attributes: expect.objectContaining({
            'gen_ai.input.messages': expect.any(String),
          }),
        })
      )
    })

    it('uses gen_ai.client.inference.operation.details for tool call end', () => {
      latestTracer.endToolCallSpan({
        span: mockSpan,
        toolResult: { toolUseId: 'tool-1', status: 'success', content: 'Result' },
      })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.client.inference.operation.details',
          attributes: expect.objectContaining({
            'gen_ai.output.messages': expect.any(String),
          }),
        })
      )
    })

    it('maps content blocks to OTel parts format', () => {
      const messages = [
        new Message({
          role: 'assistant',
          content: [new TextBlock('Hello'), new ToolUseBlock({ name: 'calc', toolUseId: 'tool-1', input: { a: 1 } })],
        }),
      ]

      latestTracer.startAgentSpan({ messages, agentName: 'TestAgent' })

      // Verify the event contains properly mapped parts
      const detailsEvent = mockSpan.events.find((e) => e.name === 'gen_ai.client.inference.operation.details')
      expect(detailsEvent).toBeDefined()
      const inputMessages = JSON.parse(detailsEvent!.attributes!['gen_ai.input.messages'] as string)
      expect(inputMessages[0].parts).toContainEqual({ type: 'text', content: 'Hello' })
      expect(inputMessages[0].parts).toContainEqual(
        expect.objectContaining({ type: 'tool_call', name: 'calc', id: 'tool-1' })
      )
    })

    it('uses gen_ai.client.inference.operation.details for cycle span end with tool result', () => {
      const message = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
      const toolResultMessage = new Message({
        role: 'user',
        content: [
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('42')],
          }),
        ],
      })

      latestTracer.endEventLoopCycleSpan({ span: mockSpan, message, toolResultMessage })

      expect(mockSpan.events).toContainEqual(
        expect.objectContaining({
          name: 'gen_ai.client.inference.operation.details',
          attributes: expect.objectContaining({
            'gen_ai.output.messages': expect.any(String),
          }),
        })
      )
    })
  })
})

describe('getTracer', () => {
  it('returns singleton instance', () => {
    const tracer1 = getTracer()
    const tracer2 = getTracer()
    expect(tracer1).toBe(tracer2)
  })
})

describe('startMultiAgentSpan', () => {
  it('returns no-op span when not initialized', () => {
    const tracer = new StrandsTracer()
    const span = tracer.startMultiAgentSpan({ input: 'test task', instanceName: 'swarm-1' })
    expect(span).toBeDefined()
    expect(span.isRecording()).toBe(false)
  })

  it('returns no-op span when otel not available', async () => {
    vi.doMock('@opentelemetry/api', () => {
      throw new Error('not installed')
    })
    const tracer = new StrandsTracer()
    await tracer.initialize()
    const span = tracer.startMultiAgentSpan({ input: 'test task', instanceName: 'graph-1' })
    expect(span.isRecording()).toBe(false)
  })
})

describe('endMultiAgentSpan', () => {
  it('does not throw when not initialized', () => {
    const tracer = new StrandsTracer()
    const span = tracer.startMultiAgentSpan({ input: 'test', instanceName: 'test' })
    expect(() => tracer.endMultiAgentSpan({ span, result: 'done' })).not.toThrow()
  })

  it('does not throw with error parameter', () => {
    const tracer = new StrandsTracer()
    const span = tracer.startMultiAgentSpan({ input: 'test', instanceName: 'test' })
    expect(() => tracer.endMultiAgentSpan({ span, error: new Error('failed') })).not.toThrow()
  })
})
