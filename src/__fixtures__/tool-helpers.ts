/**
 * Test fixtures and helpers for Tool testing.
 * This module provides utilities for testing Tool implementations.
 */

import type { Tool } from '../tools/tool.js'
import type { ToolContext } from '../tools/tool.js'
import type { ToolResult } from '../tools/types.js'
import type { JSONValue } from '../types/json.js'

/**
 * Helper to create a mock ToolContext for testing.
 *
 * @param input - The input data for the tool
 * @param invocationState - Optional invocation state
 * @returns Mock ToolContext object
 */
export function createMockContext(input: JSONValue, invocationState: Record<string, unknown> = {}): ToolContext {
  return {
    toolUse: {
      name: 'testTool',
      toolUseId: 'test-123',
      input: input,
    },
    invocationState,
  }
}

/**
 * Helper to create a mock tool for testing.
 *
 * @param name - The name of the mock tool
 * @param resultFn - Function that returns a ToolResult or an AsyncGenerator that yields nothing and returns a ToolResult
 * @returns Mock Tool object
 */
export function createMockTool(
  name: string,
  resultFn: () => ToolResult | AsyncGenerator<never, ToolResult, never>
): Tool {
  return {
    toolName: name,
    description: `Mock tool ${name}`,
    toolSpec: {
      name,
      description: `Mock tool ${name}`,
      inputSchema: { type: 'object', properties: {} },
    },
    // eslint-disable-next-line require-yield
    async *stream(_context): AsyncGenerator<never, ToolResult, never> {
      const result = resultFn()
      if (typeof result === 'object' && result !== null && Symbol.asyncIterator in result) {
        // For generators that throw errors
        const gen = result as AsyncGenerator<never, ToolResult, never>
        let done = false
        while (!done) {
          const { value, done: isDone } = await gen.next()
          done = isDone ?? false
          if (done) {
            return value
          }
        }
        // This should never be reached but TypeScript needs a return
        throw new Error('Generator ended unexpectedly')
      } else {
        return result as ToolResult
      }
    },
  }
}
