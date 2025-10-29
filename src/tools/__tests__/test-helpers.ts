import type { ToolContext, ToolStreamEvent, ToolStreamGenerator } from '../tool'
import type { ToolResult } from '../types'
import type { JSONValue } from '../../types/json'

/**
 * Consumes an async generator and collects all yielded values.
 *
 * @param generator - AsyncGenerator to consume
 * @returns Array of all yielded values
 */
export async function collectGeneratorEvents<T>(generator: AsyncGenerator<T, unknown, undefined>): Promise<T[]> {
  const events: T[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}

/**
 * Helper to create a mock ToolContext for testing.
 *
 * @param input - The input data for the tool
 * @param invocationState - Optional invocation state
 * @returns Mock ToolContext object
 */
export function createMockContext(input: unknown, invocationState: Record<string, unknown> = {}): ToolContext {
  return {
    toolUse: {
      name: 'testTool',
      toolUseId: 'test-123',
      input: input as JSONValue,
    },
    invocationState,
  }
}

/**
 * Collects stream events and extracts the final ToolResult return value.
 *
 * @param generator - The tool's stream generator
 * @returns Object containing yielded events and the final result
 */
export async function collectStreamEventsAndResult(
  generator: ToolStreamGenerator
): Promise<{ events: ToolStreamEvent[]; result: ToolResult }> {
  const events: ToolStreamEvent[] = []
  let result: ToolResult | undefined

  // Manually iterate to capture both yields and return value
  let next = await generator.next()
  while (!next.done) {
    events.push(next.value)
    next = await generator.next()
  }
  result = next.value

  return { events, result }
}

/**
 * Helper to extract event data from stream events.
 *
 * @param events - Array of ToolStreamEvent objects
 * @returns Array of data from events
 */
export function extractEventData(events: ToolStreamEvent[]): unknown[] {
  return events.map((e) => e.data)
}
