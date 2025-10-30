/**
 * Test fixtures and helpers for Tool testing.
 * This module provides utilities for testing Tool implementations.
 */

import type { ToolContext } from '../tools/tool'
import type { JSONValue } from '../types/json'

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
 * Helper to extract event data from stream events.
 *
 * @param events - Array of objects with data property
 * @returns Array of data from events (undefined for events without data)
 */
export function extractEventData(events: Array<{ data?: unknown }>): unknown[] {
  return events.map((e) => e.data)
}
