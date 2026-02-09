/**
 * Test helpers for invoking FunctionTools and building minimal context.
 */

import type { JSONValue } from '../../../types/json.js'
import type { Tool, ToolContext } from '../../tool.js'
import type { ToolResultBlock } from '../../../types/messages.js'

/**
 * Build a minimal ToolContext for testing.
 */
export function createMockToolContext(toolName: string, input: JSONValue, agent?: unknown): ToolContext {
  return {
    toolUse: {
      name: toolName,
      toolUseId: `test-${toolName}-1`,
      input,
    },
    agent: (agent ?? {}) as ToolContext['agent'],
    interrupt(): unknown {
      throw new Error('interrupt() not available in test context')
    },
  }
}

/**
 * Run a tool's stream to completion and return the final ToolResultBlock.
 */
export async function runToolStream(tool: Tool, context: ToolContext): Promise<ToolResultBlock> {
  const gen = tool.stream(context)
  let iterResult = await gen.next()
  while (!iterResult.done) {
    iterResult = await gen.next()
  }
  return iterResult.value
}

/**
 * Run a tool stream and collect all emitted events plus the final ToolResultBlock.
 */
export async function collectToolStream(
  tool: Tool,
  context: ToolContext
): Promise<{ events: unknown[]; result: ToolResultBlock }> {
  const events: unknown[] = []
  const gen = tool.stream(context)
  let iterResult = await gen.next()
  while (!iterResult.done) {
    events.push(iterResult.value)
    iterResult = await gen.next()
  }
  return { events, result: iterResult.value }
}

/**
 * Extract the first text string from a ToolResultBlock.
 */
export function getToolResultText(block: ToolResultBlock): string {
  for (const item of block.content) {
    if (item.type === 'textBlock') {
      return item.text
    }
    if (item.type === 'jsonBlock') {
      const json = item.json
      if (typeof json === 'object' && json !== null && 'content' in json) {
        const arr = (json as { content: Array<{ text?: string }> }).content
        return arr[0]?.text ?? JSON.stringify(json)
      }
      return JSON.stringify(json)
    }
  }
  return ''
}
