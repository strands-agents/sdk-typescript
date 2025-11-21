import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { McpClient } from '../mcp.js'
import { McpTool } from '../tools/mcp-tool.js'
import { JsonBlock, type TextBlock, type ToolResultBlock } from '../types/messages.js'
import type { AgentData } from '../types/agent.js'
import type { ToolContext } from '../tools/tool.js'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return {
      connect: vi.fn(),
      close: vi.fn(),
      listTools: vi.fn(),
      callTool: vi.fn(),
    }
  }),
}))

vi.mock('../tools/tool.js', () => ({
  // Mock the abstract base class
  Tool: class {},
  // Mock helper to return a valid ToolResultBlock structure without prepending "Error: "
  createErrorResult: (err: unknown, toolUseId: string) => ({
    type: 'toolResultBlock',
    status: 'error',
    toolUseId,
    content: [{ type: 'textBlock', text: err instanceof Error ? err.message : String(err) }],
  }),
}))

vi.mock('../../__fixtures__/environment.js', () => ({ isNode: true }))

/**
 * Executes a tool stream to completion and returns the final result.
 * We use a Generic <T> and cast the return value to ensure TypeScript
 * knows the result is defined (and matches the Tool's return type).
 */
async function runTool<T>(gen: AsyncGenerator<unknown, T, unknown>): Promise<T> {
  let result = await gen.next()
  while (!result.done) {
    result = await gen.next()
  }
  // Force cast because we know our McpTool always returns a value when done
  return result.value as T
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

  describe('McpClient', () => {
    let client: McpClient
    let sdkClientMock: any

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

    it('delegates invocation to SDK client', async () => {
      const tool = new McpTool({ name: 'calc', description: '', inputSchema: {}, client })
      sdkClientMock.callTool.mockResolvedValue({ content: [] })

      await client.callTool(tool, { op: 'add' })

      expect(sdkClientMock.connect).toHaveBeenCalled()
      expect(sdkClientMock.callTool).toHaveBeenCalledWith({
        name: 'calc',
        arguments: { op: 'add' },
      })
    })

    it('validates tool arguments', async () => {
      const tool = new McpTool({ name: 't', description: '', inputSchema: {}, client })
      await expect(client.callTool(tool, ['invalid-array'])).rejects.toThrow(/JSON Object/)
    })

    it('cleans up resources', () => {
      client[Symbol.dispose]()
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

    const context: ToolContext = {
      toolUse: { toolUseId: 'id-123', name: 'weather', input: { city: 'NYC' } },
      agent: {} as AgentData,
    }

    it('returns text results on success', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({
        content: [{ type: 'text', text: 'Sunny' }],
      })

      // runTool<ToolResultBlock> explicitly tells TS the return type
      const result = await runTool<ToolResultBlock>(tool.stream(context))

      expect(result).toBeDefined()
      expect(result.status).toBe('success')
      expect((result.content[0] as TextBlock).text).toBe('Sunny')
    })

    it('returns structured data results on success', async () => {
      const data = { temperature: 72 }
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({
        content: [{ type: 'data', value: data }],
      })

      const result = await runTool<ToolResultBlock>(tool.stream(context))
      const content = result.content[0] as JsonBlock

      expect(content).toBeInstanceOf(JsonBlock)
      expect(content.json).toEqual(expect.objectContaining({ value: data }))
    })

    it('provides default message for empty output', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({ content: [] })

      const result = await runTool<ToolResultBlock>(tool.stream(context))

      expect((result.content[0] as TextBlock).text).toContain('completed successfully')
    })

    it('handles protocol-level errors', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'Service Unavailable' }],
      })

      const result = await runTool<ToolResultBlock>(tool.stream(context))

      expect(result.status).toBe('error')
      expect((result.content[0] as TextBlock).text).toBe('Service Unavailable')
    })

    it('catches and wraps client exceptions', async () => {
      vi.mocked(mockClientWrapper.callTool).mockRejectedValue(new Error('Network Error'))

      const result = await runTool<ToolResultBlock>(tool.stream(context))

      expect(result.status).toBe('error')
      expect((result.content[0] as TextBlock).text).toBe('Network Error')
    })

    it('validates SDK response format', async () => {
      vi.mocked(mockClientWrapper.callTool).mockResolvedValue({ content: null })

      const result = await runTool<ToolResultBlock>(tool.stream(context))

      expect(result.status).toBe('error')
      expect((result.content[0] as TextBlock).text).toContain('missing content array')
    })
  })
})
