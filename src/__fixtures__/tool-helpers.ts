/**
 * Test fixtures and helpers for Tool testing.
 * This module provides utilities for testing Tool implementations.
 */

import type { Tool, ToolContext } from '../tools/tool.js'
import { ToolResultBlock, TextBlock } from '../types/messages.js'
import type { JSONValue } from '../types/json.js'
import { StateStore } from '../state-store.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import type { PlainToolResultBlock } from './slim-types.js'
import type { LocalAgent } from '../types/agent.js'

/**
 * Helper to create a mock ToolContext for testing.
 *
 * @param toolUse - The tool use request
 * @param appState - Optional initial app state
 * @returns Mock ToolContext object
 */
export function createMockContext(
  toolUse: { name: string; toolUseId: string; input: JSONValue },
  appState?: Record<string, JSONValue>
): ToolContext {
  return {
    toolUse,
    agent: {
      id: 'mock-agent',
      appState: new StateStore(appState),
      messages: [],
      toolRegistry: new ToolRegistry(),
      addHook: () => () => {},
    } as unknown as LocalAgent,
    interrupt: (): never => {
      throw new Error('interrupt() is not available in mock context')
    },
  }
}

/**
 * Result function type for createMockTool.
 * Can return a ToolResultBlock directly, or a simple value (string, etc.) that will be auto-wrapped.
 */
type ToolResultFn =
  | ((context: ToolContext) => PlainToolResultBlock | string | void)
  | ((context: ToolContext) => AsyncGenerator<never, PlainToolResultBlock, never>)

/**
 * Helper to create a mock tool for testing.
 *
 * @param name - The name of the mock tool
 * @param resultFn - Function that returns a ToolResultBlock, a string (auto-wrapped), or an AsyncGenerator
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
    async *stream(context): AsyncGenerator<never, ToolResultBlock, never> {
      const result = resultFn(context)
      if (typeof result === 'object' && result !== null && Symbol.asyncIterator in result) {
        const gen = result as AsyncGenerator<never, ToolResultBlock, never>
        let done = false
        while (!done) {
          const { value, done: isDone } = await gen.next()
          done = isDone ?? false
          if (done) {
            return value
          }
        }
        throw new Error('Generator ended unexpectedly')
      } else if (result instanceof ToolResultBlock) {
        return result
      } else {
        // Auto-wrap string or void into a ToolResultBlock
        const text = typeof result === 'string' ? result : 'mock result'
        return new ToolResultBlock({
          toolUseId: context.toolUse.toolUseId,
          status: 'success' as const,
          content: [new TextBlock(text)],
        })
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
  return createMockTool(toolName, () => {})
}
