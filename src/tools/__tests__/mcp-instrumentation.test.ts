import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { instrumentMcpClient } from '../mcp-instrumentation.js'
import type { McpClient } from '../../mcp.js'
import type { McpTool } from '../mcp-tool.js'
import type { JSONValue } from '../../types/json.js'
import { context, propagation, trace, TraceFlags } from '@opentelemetry/api'
import type { SpanContext } from '@opentelemetry/api'

const MOCK_TOOL = { name: 'test-tool' } as McpTool

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

describe('mcp-instrumentation', () => {
  let mockMcpClient: McpClient
  let originalCallTool: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalCallTool = vi.fn().mockResolvedValue({ result: 'success' })
    mockMcpClient = {
      callTool: originalCallTool,
    } as unknown as McpClient
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('instrumentMcpClient', () => {
    it('should not instrument the same client twice', () => {
      instrumentMcpClient(mockMcpClient)
      const firstCallTool = mockMcpClient.callTool

      instrumentMcpClient(mockMcpClient)

      expect(mockMcpClient.callTool).toBe(firstCallTool)
    })

    it('should call original callTool with unmodified args when no active span', async () => {
      instrumentMcpClient(mockMcpClient)

      const args = { key: 'value' }
      await mockMcpClient.callTool(MOCK_TOOL, args)

      expect(originalCallTool).toHaveBeenCalledWith(MOCK_TOOL, { key: 'value' })
    })

    it('should wrap null args with _meta containing trace context', async () => {
      instrumentMcpClient(mockMcpClient)
      mockActiveSpan()

      await mockMcpClient.callTool(MOCK_TOOL, null)

      expect(originalCallTool).toHaveBeenCalledWith(MOCK_TOOL, {
        _meta: { traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01' },
      })
    })

    it('should wrap undefined args with _meta containing trace context', async () => {
      instrumentMcpClient(mockMcpClient)
      mockActiveSpan()

      await mockMcpClient.callTool(MOCK_TOOL, undefined as unknown as JSONValue)

      expect(originalCallTool).toHaveBeenCalledWith(MOCK_TOOL, {
        _meta: { traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01' },
      })
    })

    it('should merge _meta into object args preserving original properties', async () => {
      instrumentMcpClient(mockMcpClient)
      mockActiveSpan()

      await mockMcpClient.callTool(MOCK_TOOL, { key: 'value' })

      expect(originalCallTool).toHaveBeenCalledWith(MOCK_TOOL, {
        key: 'value',
        _meta: { traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01' },
      })
    })

    it('should fall back to original call with unmodified args on error', async () => {
      instrumentMcpClient(mockMcpClient)

      vi.spyOn(context, 'active').mockImplementation(() => {
        throw new Error('Context error')
      })

      await mockMcpClient.callTool(MOCK_TOOL, { key: 'value' })

      expect(originalCallTool).toHaveBeenCalledWith(MOCK_TOOL, { key: 'value' })
    })

    it('should skip context injection when span has empty trace ID', async () => {
      instrumentMcpClient(mockMcpClient)
      mockActiveSpan('', TraceFlags.NONE)

      await mockMcpClient.callTool(MOCK_TOOL, { key: 'value' })

      expect(originalCallTool).toHaveBeenCalledWith(MOCK_TOOL, { key: 'value' })
    })
  })
})
