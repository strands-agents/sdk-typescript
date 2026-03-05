/**
 * Test helpers for asserting on AgentMetrics in agent tests.
 */

import { expect } from 'vitest'
import { AgentMetrics } from '../telemetry/meter.js'

/**
 * Options for building an AgentMetrics matcher.
 */
export interface LoopMetricsMatcher {
  /**
   * Expected number of agent loop cycles.
   */
  cycleCount: number

  /**
   * Expected tool names that were invoked.
   */
  toolNames?: string[]
}

/**
 * Creates an asymmetric matcher that validates AgentMetrics structure and values.
 *
 * @param options - Expected metric values
 * @returns An asymmetric matcher suitable for use in expect().toEqual()
 */
export function expectLoopMetrics(options: LoopMetricsMatcher): AgentMetrics {
  const { cycleCount, toolNames = [] } = options

  const expectedToolMetrics: Record<string, unknown> = {}
  for (const name of toolNames) {
    expectedToolMetrics[name] = {
      callCount: expect.any(Number),
      successCount: expect.any(Number),
      errorCount: expect.any(Number),
      totalTime: expect.any(Number),
    }
  }

  return expect.objectContaining({
    cycleCount,
    toolMetrics: toolNames.length > 0 ? expect.objectContaining(expectedToolMetrics) : {},
    cycleDurations: expect.arrayContaining(Array.from({ length: cycleCount }, () => expect.any(Number))),
    accumulatedUsage: expect.objectContaining({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }),
    accumulatedMetrics: { latencyMs: expect.any(Number) },
  }) as AgentMetrics
}
