/**
 * Test fixtures and helpers for Tool testing.
 * This module provides utilities for testing Tool implementations.
 */

import type { Tool, ToolContext } from '../tools/tool.js'
import { ToolResultBlock } from '../types/messages.js'
import type { JSONValue } from '../types/json.js'
import { AgentState } from '../agent/state.js'
import type { PlainToolResultBlock } from './slim-types.js'

/**
 * Helper to create a mock ToolContext for testing.
 *
 * @param toolUse - The tool use request
 * @param agentState - Optional initial agent state
 * @returns Mock ToolContext object
 */
export function createMockContext(
  toolUse: { name: string; toolUseId: string; input: JSONValue },
  agentState?: Record<string, JSONValue>
): ToolContext {
  return {
    toolUse,
    agent: {
      state: new AgentState(agentState),
      messages: [],
    },
  }
}

/**
 * Result function type for createMockTool - accepts plain objects or class instances.
 */
type ToolResultFn = () => PlainToolResultBlock | AsyncGenerator<never, PlainToolResultBlock, never>

/**
 * Helper to create a mock tool for testing.
 *
 * @param name - The name of the mock tool
 * @param resultFn - Function that returns a ToolResultBlock (plain object or class instance) or an AsyncGenerator
 * @returns Mock Tool object
 */
export function createMockTool(name: string, resultFn: ToolResultFn): Tool {
  return {
    name,
    description: `Mock tool ${name}`,
    toolSpec: {
      name,
      description: `Mock tool ${name}`,
      inputSchema: { type: 'object', properties: {} },
    },
    // eslint-disable-next-line require-yield
    async *stream(_context): AsyncGenerator<never, ToolResultBlock, never> {
      const result = resultFn()
      if (typeof result === 'object' && result !== null && Symbol.asyncIterator in result) {
        // For generators that throw errors
        const gen = result as AsyncGenerator<never, ToolResultBlock, never>
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
        return result as ToolResultBlock
      }
    },
  }
}

/**
 * Helper to create a simple mock tool with minimal configuration for testing.
 * This is a lighter-weight version of createMockTool for scenarios where the tool's
 * execution behavior is not relevant to the test.
 *
 * @param name - Optional name of the mock tool (defaults to a random UUID)
 * @returns Mock Tool object
 */
export function createRandomTool(name?: string): Tool {
  const toolName = name ?? globalThis.crypto.randomUUID()
  return createMockTool(
    toolName,
    () =>
      new ToolResultBlock({
        toolUseId: 'test-id',
        status: 'success' as const,
        content: [],
      })
  )
}
