/**
 * Test fixtures and helpers for Tool testing.
 * This module provides utilities for testing Tool implementations.
 */

import type { ToolContext, ToolStreamEvent, ToolStreamGenerator } from '../tools/tool'
import type { ToolResult } from '../tools/types'
import type { JSONValue } from '../types/json'
import { collectGenerator, collectIterator } from './model-test-helpers'

/**
 * Consumes an async generator and collects all yielded values.
 * This is a convenience wrapper around collectIterator for tool events.
 *
 * @param generator - AsyncGenerator to consume
 * @returns Array of all yielded values
 */
export async function collectGeneratorEvents<T>(generator: AsyncGenerator<T, unknown, undefined>): Promise<T[]> {
  return collectIterator(generator)
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
 * Uses collectGenerator from model-test-helpers for consistent behavior.
 *
 * @param generator - The tool's stream generator
 * @returns Object containing yielded events and the final result
 */
export async function collectStreamEventsAndResult(
  generator: ToolStreamGenerator
): Promise<{ events: ToolStreamEvent[]; result: ToolResult }> {
  const { items, result } = await collectGenerator(generator)
  return { events: items, result }
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
