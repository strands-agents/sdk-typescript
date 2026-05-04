import { vi } from 'vitest'
import { FunctionTool, type FunctionToolCallback } from '@strands-agents/sdk'
export const getCapabilities = vi.fn().mockReturnValue([])
export const beforeInvocation = vi.fn().mockReturnValue({ cancel: false, cancelMessage: undefined })
export const afterInvocation = vi.fn().mockReturnValue({ resume: undefined })
export const beforeModelCall = vi.fn().mockReturnValue({ cancel: false, cancelMessage: undefined })
export const afterModelCall = vi.fn().mockReturnValue({ retry: false })
export const beforeTools = vi.fn().mockReturnValue({ cancel: false, cancelMessage: undefined })
export const afterTools = vi.fn().mockReturnValue({})
export const beforeToolCall = vi.fn().mockReturnValue({
  cancel: false,
  cancelMessage: undefined,
  toolUse: undefined,
  selectedToolName: undefined,
})
export const afterToolCall = vi.fn().mockReturnValue({ retry: false, result: undefined })

/** Factory for test tools with sensible defaults. */
export function testTool(
  overrides: { name?: string; description?: string; callback?: FunctionToolCallback } = {}
): FunctionTool {
  return new FunctionTool({
    name: overrides.name ?? 'test_tool',
    description: overrides.description ?? 'test',
    inputSchema: { type: 'object', properties: {} },
    callback: overrides.callback ?? (() => [{ text: 'ok' }]),
  })
}
