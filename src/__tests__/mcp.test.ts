import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { McpClient } from '../mcp.js'
import { McpTool } from '../tools/mcp-tool.js'
import { JsonBlock, type TextBlock, type ToolResultBlock } from '../types/messages.js'
import type { AgentData } from '../types/agent.js'
import type { ToolContext } from '../tools/tool.js'
import { context, propagation, trace, TraceFlags } from '@opentelemetry/api'
import type { SpanContext } from '@opentelemetry/api'

/**
 * Helper to create a mock async generator that yields a result message.
 * This simulates the behavior of callToolStream returning a stream that ends with a result.
 */
function createMockCallToolStream(result: unknown) {
  return async function* () {
    yield { type: 'result', result }
  }
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return {
      connect: vi.fn(),
      close: vi.fn(),
      listTools: vi.fn(),
      callTool: vi.fn(),
      experimental: {
        tasks: {
          callToolStream: vi.fn(),
        },
      },
    }
  }),
}))

vi.mock('../tools/tool.js', () => ({
  Tool: class {},
  createErrorResult: (err: unknown, toolUseId: string) => ({
    type: 'toolResultBlock',
    status: 'error',
    toolUseId,
    content: [{ type: 'textBlock', text: err instanceof Error ? err.message : String(err) }],
  }),
}))

/**
 * Executes a tool stream to completion and returns the final result.
 */
async function runTool<T>(gen: AsyncGenerator<unknown, T, unknown>): Promise<T> {
  let result = await gen.next()
  while (!result.done) {
    result = await gen.next()
  }
  return result.value as T
}

/**
 * Mock an active span with a valid trace ID via trace.getSpan,
 * and stub propagation.inject to populate the carrier with a traceparent.
 */
function mockActiveSpan(traceId: string = '1234567890abcdef1234567890abcdef', traceFlags = TraceFlags.SAMPLED): void {
  const mockSpan = {
    spanContext: () =>
      ({
        traceId,
        spanId: '1234567890abcdef',
        traceFlags,
      }) as SpanContext,
  }
  vi.spyOn(trace, 'getSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getSpan>)
  vi.spyOn(propagation, 'inject').mockImplementation((_context, carrier) => {
    if (carrier && typeof carrier === 'object') {
      ;(carrier as Record<string, string>).traceparent = `00-${traceId}-1234567890abcdef-01`
    }
  })
}

const mockTransport = {
  connect: vi.fn(),
  close: vi.fn(),
  send: vi.fn(),
} as unknown as Transport

describe('MCP Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('McpClient', () => {
    let client: McpClient
    let sdkClientMock: {
      connect: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      listTools: ReturnType<typeof vi.fn>
      callTool: ReturnType<typeof vi.fn>
      experimental: { tasks: { callToolStream: ReturnType<typeof vi.fn> } }
    }

    beforeEach(() => {
      client = new McpClient({
        applicationName: 'TestApp',
        transport: mockTransport,
      })
      sdkClientMock = vi.mocked(Client).mock.results[0]!.value
    })

    it('initializes SDK client with correct configuration', () => {
      expect(Client).toHaveBeenCalledWith({ name: 'TestApp', version: '0.0.1' })
    })

    it('injects trace context into tool arguments when active span exists', async () => {
      mockActiveSpan()
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client })
      sdkClientMock.callTool.mockResolvedValue({ content: [] })

      await client.callTool(tool, { op: 'add' })

      const callArgs = sdkClientMock.callTool.mock.calls[0]![0]
      expect(callArgs.arguments).toStrictEqual({
        op: 'add',
        _meta: { traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01' },
      })
    })

    it('merges trace context with existing _meta field', async () => {
      mockActiveSpan()
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client })
      sdkClientMock.callTool.mockResolvedValue({ content: [] })

      await client.callTool(tool, { op: 'add', _meta: { progressToken: 'tok-1' } })

      const callArgs = sdkClientMock.callTool.mock.calls[0]![0]
      expect(callArgs.arguments).toStrictEqual({
        op: 'add',
        _meta: {
          progressToken: 'tok-1',
          traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
        },
      })
    })

    it('passes args unchanged when no active span exists', async () => {
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client })
      sdkClientMock.callTool.mockResolvedValue({ content: [] })

      await client.callTool(tool, { op: 'add' })

      const callArgs = sdkClientMock.callTool.mock.calls[0]![0]
      expect(callArgs.arguments).toStrictEqual({ op: 'add' })
    })

    it('passes args unchanged when span has empty trace ID', async () => {
      mockActiveSpan('', TraceFlags.NONE)
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client })
      sdkClientMock.callTool.mockResolvedValue({ content: [] })

      await client.callTool(tool, { op: 'add' })

      const callArgs = sdkClientMock.callTool.mock.calls[0]![0]
      expect(callArgs.arguments).toStrictEqual({ op: 'add' })
    })

    it('passes args unchanged when context injection fails', async () => {
      vi.spyOn(context, 'active').mockImplementation(() => {
        throw new Error('Context error')
      })
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client })
      sdkClientMock.callTool.mockResolvedValue({ content: [] })

      await client.callTool(tool, { op: 'add' })

      const callArgs = sdkClientMock.callTool.mock.calls[0]![0]
      expect(callArgs.arguments).toStrictEqual({ op: 'add' })
    })

    it('skips trace context injection when disableMcpInstrumentation is true', async () => {
      mockActiveSpan()
      const noInstrClient = new McpClient({
        applicationName: 'TestApp',
        transport: mockTransport,
        disableMcpInstrumentation: true,
      })
      const noInstrSdkMock = vi.mocked(Client).mock.results.at(-1)!.value
      noInstrSdkMock.callTool.mockResolvedValue({ content: [] })

      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client: noInstrClient })

      await noInstrClient.callTool(tool, { op: 'add' })

      const callArgs = noInstrSdkMock.callTool.mock.calls[0]![0]
      expect(callArgs.arguments).toStrictEqual({ op: 'add' })
    })

    it('manages connection state lazily', async () => {
      await client.connect()
      expect(sdkClientMock.connect).toHaveBeenCalledTimes(1)

      await client.connect()
      expect(sdkClientMock.connect).toHaveBeenCalledTimes(1)
    })

    it('supports forced reconnection', async () => {
      await client.connect()
      await client.connect(true)

      expect(sdkClientMock.close).toHaveBeenCalled()
      expect(sdkClientMock.connect).toHaveBeenCalledTimes(2)
    })

    it('converts SDK tool specs to McpTool instances', async () => {
      sdkClientMock.listTools.mockResolvedValue({
        tools: [{ name: 'weather', description: 'Get weather', inputSchema: {} }],
      })

      const tools = await client.listTools()

      expect(sdkClientMock.connect).toHaveBeenCalled()
      expect(tools).toHaveLength(1)
      expect(tools[0]).toBeInstanceOf(McpTool)
      expect(tools[0]!.name).toBe('weather')
    })

    it('uses callTool when tasksConfig is undefined (default)', async () => {
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client })
      sdkClientMock.callTool.mockResolvedValue({ content: [] })

      await client.callTool(tool, { op: 'add' })

      expect(sdkClientMock.connect).toHaveBeenCalled()
      expect(sdkClientMock.callTool).toHaveBeenCalledWith({
        name: 'calc',
        arguments: { op: 'add' },
      })
      expect(sdkClientMock.experimental.tasks.callToolStream).not.toHaveBeenCalled()
    })

    it('uses callToolStream when tasksConfig is provided (empty object)', async () => {
      const resultsLengthBefore = vi.mocked(Client).mock.results.length
      const taskClient = new McpClient({
        applicationName: 'TestApp',
        transport: mockTransport,
        tasksConfig: {},
      })
      const taskSdkClientMock = vi.mocked(Client).mock.results[resultsLengthBefore]!.value
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client: taskClient })
      taskSdkClientMock.experimental.tasks.callToolStream.mockReturnValue(createMockCallToolStream({ content: [] })())

      await taskClient.callTool(tool, { op: 'add' })

      expect(taskSdkClientMock.connect).toHaveBeenCalled()
      expect(taskSdkClientMock.experimental.tasks.callToolStream).toHaveBeenCalledWith(
        { name: 'calc', arguments: { op: 'add' } },
        undefined,
        { timeout: 60000, maxTotalTimeout: 300000, resetTimeoutOnProgress: true }
      )
      expect(taskSdkClientMock.callTool).not.toHaveBeenCalled()
    })

    it('passes custom TTL and pollTimeout to callToolStream', async () => {
      const resultsLengthBefore = vi.mocked(Client).mock.results.length
      const taskClient = new McpClient({
        applicationName: 'TestApp',
        transport: mockTransport,
        tasksConfig: { ttl: 30000, pollTimeout: 120000 },
      })
      const taskSdkClientMock = vi.mocked(Client).mock.results[resultsLengthBefore]!.value
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client: taskClient })
      taskSdkClientMock.experimental.tasks.callToolStream.mockReturnValue(createMockCallToolStream({ content: [] })())

      await taskClient.callTool(tool, { op: 'add' })

      expect(taskSdkClientMock.experimental.tasks.callToolStream).toHaveBeenCalledWith(
        { name: 'calc', arguments: { op: 'add' } },
        undefined,
        { timeout: 30000, maxTotalTimeout: 120000, resetTimeoutOnProgress: true }
      )
    })

    it('validates tool arguments', async () => {
      const tool = new McpTool({ name: 't', description: '', inputSchema: {}, client })
      await expect(client.callTool(tool, ['invalid-array'])).rejects.toThrow(/JSON Object/)
    })

    it('cleans up resources', async () => {
      await client.disconnect()
      expect(sdkClientMock.close).toHaveBeenCalled()
      expect(mockTransport.close).toHaveBeenCalled()
    })
  })

  describe('McpTool', () => {
    const mockClientWrapper = { callTool: vi.fn() } as unknown as McpClient
    const tool = new McpTool({
      name: 'weather',
      description: 'Get weather',
      inputSchema: {},
      client: mockClientWrapper,
    })

    const toolContext: ToolContext = {
      toolUse: { toolUseId: 'id-123', name: 'weather', input: { city: 'NYC' } },
      agent: {} as AgentData,
    }

    it('returns text results on success', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({
        content: [{ type: 'text', text: 'Sunny' }],
      })

      const result = await runTool<ToolResultBlock>(tool.stream(toolContext))

      expect(result).toBeDefined()
      expect(result.status).toBe('success')
      expect((result.content[0] as TextBlock).text).toBe('Sunny')
    })

    it('returns structured data results on success', async () => {
      const data = { temperature: 72 }
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({
        content: [{ type: 'data', value: data }],
      })

      const result = await runTool<ToolResultBlock>(tool.stream(toolContext))
      const content = result.content[0] as JsonBlock

      expect(content).toBeInstanceOf(JsonBlock)
      expect(content.json).toEqual(expect.objectContaining({ value: data }))
    })

    it('provides default message for empty output', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({ content: [] })

      const result = await runTool<ToolResultBlock>(tool.stream(toolContext))

      expect((result.content[0] as TextBlock).text).toContain('completed successfully')
    })

    it('handles protocol-level errors', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'Service Unavailable' }],
      })

      const result = await runTool<ToolResultBlock>(tool.stream(toolContext))

      expect(result.status).toBe('error')
      expect((result.content[0] as TextBlock).text).toBe('Service Unavailable')
    })

    it('catches and wraps client exceptions', async () => {
      vi.mocked(mockClientWrapper.callTool).mockRejectedValue(new Error('Network Error'))

      const result = await runTool<ToolResultBlock>(tool.stream(toolContext))

      expect(result.status).toBe('error')
      expect((result.content[0] as TextBlock).text).toBe('Network Error')
    })

    it('validates SDK response format', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({ content: null })

      const result = await runTool<ToolResultBlock>(tool.stream(toolContext))

      expect(result.status).toBe('error')
      expect((result.content[0] as TextBlock).text).toContain('missing content array')
    })
  })
})
