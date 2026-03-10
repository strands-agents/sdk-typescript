import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Meter, AgentMetrics } from '../meter.js'
import type { ToolUse } from '../../tools/types.js'

describe('Meter', () => {
  const makeTool = (name: string, toolUseId: string): ToolUse => ({
    name,
    toolUseId,
    input: {},
  })

  let meter: Meter

  beforeEach(() => {
    meter = new Meter()
  })

  describe('metrics getter', () => {
    it('returns an AgentMetrics instance', () => {
      expect(meter.metrics).toBeInstanceOf(AgentMetrics)
    })

    it('returns zeroed snapshot for fresh instance', () => {
      const snapshot = meter.metrics
      expect(snapshot.cycleCount).toBe(0)
      expect(snapshot.toolMetrics).toStrictEqual({})
      expect(snapshot.agentInvocations).toStrictEqual([])
      expect(snapshot.accumulatedUsage).toStrictEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
      expect(snapshot.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })

    it('returns complete snapshot after a realistic agent execution', () => {
      vi.useFakeTimers()
      vi.setSystemTime(100_000)

      meter.startNewInvocation()

      const c1 = meter.startCycle()
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: { latencyMs: 100 },
      })
      meter.endToolCall({
        tool: makeTool('search', 'tid-1'),
        duration: 0.5,
        success: true,
      })
      vi.setSystemTime(103_000)
      meter.endCycle(c1.startTime)

      vi.setSystemTime(200_000)
      const c2 = meter.startCycle()
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        metrics: { latencyMs: 250 },
      })
      meter.endToolCall({
        tool: makeTool('search', 'tid-2'),
        duration: 1.5,
        success: false,
      })
      vi.setSystemTime(205_000)
      meter.endCycle(c2.startTime)

      const snapshot = meter.metrics

      expect(snapshot.cycleCount).toBe(2)
      expect(snapshot.accumulatedUsage).toStrictEqual({ inputTokens: 30, outputTokens: 15, totalTokens: 45 })
      expect(snapshot.accumulatedMetrics).toStrictEqual({ latencyMs: 350 })
      expect(snapshot.toolMetrics).toStrictEqual({
        search: {
          callCount: 2,
          successCount: 1,
          errorCount: 1,
          totalTime: 2.0,
        },
      })
      expect(snapshot.agentInvocations).toStrictEqual([
        {
          usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
          cycles: [
            { cycleId: 'cycle-1', duration: 3000, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
            { cycleId: 'cycle-2', duration: 5000, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
          ],
        },
      ])

      vi.useRealTimers()
    })

    it('tracks multiple invocations independently', () => {
      meter.startNewInvocation()
      meter.startCycle()
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })

      meter.startNewInvocation()
      meter.startCycle()
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      })

      expect(meter.metrics.agentInvocations).toStrictEqual([
        {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          cycles: [{ cycleId: 'cycle-1', duration: 0, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }],
        },
        {
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          cycles: [{ cycleId: 'cycle-2', duration: 0, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } }],
        },
      ])
    })
  })

  describe('startNewInvocation', () => {
    it('appends an invocation with empty cycles and zeroed usage', () => {
      meter.startNewInvocation()

      expect(meter.metrics.agentInvocations).toStrictEqual([
        { cycles: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ])
    })

    it('latestAgentInvocation returns the most recently added invocation', () => {
      meter.startNewInvocation()
      meter.startNewInvocation()

      const snapshot = meter.metrics
      expect(snapshot.agentInvocations).toHaveLength(2)
      expect(snapshot.latestAgentInvocation).toBe(snapshot.agentInvocations[1])
    })
  })

  describe('startCycle', () => {
    it('returns cycle id and start time', () => {
      vi.spyOn(Date, 'now').mockReturnValue(100_000)

      const result = meter.startCycle()

      expect(result).toStrictEqual({
        cycleId: 'cycle-1',
        startTime: 100_000,
      })
      expect(meter.metrics.cycleCount).toBe(1)
      vi.restoreAllMocks()
    })

    it('adds cycle entry to the latest invocation', () => {
      meter.startNewInvocation()
      meter.startCycle()

      expect(meter.metrics.latestAgentInvocation!.cycles).toStrictEqual([
        { cycleId: 'cycle-1', duration: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ])
    })

    it('does not fail when no invocation exists', () => {
      const result = meter.startCycle()

      expect(result.cycleId).toBe('cycle-1')
      expect(meter.metrics.agentInvocations).toStrictEqual([])
    })
  })

  describe('endCycle', () => {
    it('records duration on the latest cycle', () => {
      vi.spyOn(Date, 'now').mockReturnValue(200_000)

      meter.startNewInvocation()
      meter.startCycle()
      meter.endCycle(100_000)

      expect(meter.metrics.latestAgentInvocation!.cycles[0]!.duration).toBe(100_000)
      vi.restoreAllMocks()
    })
  })

  describe('endToolCall', () => {
    it('records success', () => {
      meter.endToolCall({
        tool: makeTool('myTool', 'id-1'),
        duration: 1.5,
        success: true,
      })

      expect(meter.metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 1, successCount: 1, errorCount: 0, totalTime: 1.5 },
      })
    })

    it('records failure', () => {
      meter.endToolCall({
        tool: makeTool('myTool', 'id-1'),
        duration: 0.5,
        success: false,
      })

      expect(meter.metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 1, successCount: 0, errorCount: 1, totalTime: 0.5 },
      })
    })

    it('accumulates across multiple calls to the same tool', () => {
      meter.endToolCall({
        tool: makeTool('myTool', 'id-1'),
        duration: 1.0,
        success: true,
      })
      meter.endToolCall({
        tool: makeTool('myTool', 'id-2'),
        duration: 2.0,
        success: false,
      })

      expect(meter.metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 2, successCount: 1, errorCount: 1, totalTime: 3.0 },
      })
    })

    it('tracks different tools independently', () => {
      meter.endToolCall({
        tool: makeTool('toolA', 'id-1'),
        duration: 1.0,
        success: true,
      })
      meter.endToolCall({
        tool: makeTool('toolB', 'id-2'),
        duration: 2.0,
        success: false,
      })

      expect(meter.metrics.toolMetrics).toStrictEqual({
        toolA: { callCount: 1, successCount: 1, errorCount: 0, totalTime: 1.0 },
        toolB: { callCount: 1, successCount: 0, errorCount: 1, totalTime: 2.0 },
      })
    })
  })

  describe('updateCycle', () => {
    it('accumulates usage and latency from metadata', () => {
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        metrics: { latencyMs: 100 },
      })
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
        metrics: { latencyMs: 200 },
      })

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 15,
        outputTokens: 10,
        totalTokens: 25,
      })
      expect(meter.metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 300 })
    })

    it('accumulates cache tokens across calls', () => {
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cacheReadInputTokens: 3,
          cacheWriteInputTokens: 2,
        },
      })
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: {
          inputTokens: 5,
          outputTokens: 2,
          totalTokens: 7,
          cacheReadInputTokens: 4,
        },
      })

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 15,
        outputTokens: 7,
        totalTokens: 22,
        cacheReadInputTokens: 7,
        cacheWriteInputTokens: 2,
      })
    })

    it('handles usage-only metadata', () => {
      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
      expect(meter.metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })

    it('handles metrics-only metadata', () => {
      meter.updateCycle({
        type: 'modelMetadataEvent',
        metrics: { latencyMs: 250 },
      })

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(meter.metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 250 })
    })

    it('propagates usage to invocation and current cycle', () => {
      meter.startNewInvocation()
      meter.startCycle()

      meter.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })

      const invocation = meter.metrics.latestAgentInvocation!
      expect(invocation).toStrictEqual({
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        cycles: [{ cycleId: 'cycle-1', duration: 0, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }],
      })
    })

    it('is a no-op when metadata is undefined', () => {
      meter.updateCycle(undefined)

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(meter.metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })

    it('is a no-op when called with no arguments', () => {
      meter.updateCycle()

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(meter.metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })

    it('is a no-op when metadata has neither usage nor metrics', () => {
      meter.updateCycle({ type: 'modelMetadataEvent' })

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(meter.metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })

    it('does not fail when no invocation exists', () => {
      expect(() => {
        meter.updateCycle({
          type: 'modelMetadataEvent',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        })
      }).not.toThrow()

      expect(meter.metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
    })
  })
})

describe('AgentMetrics', () => {
  describe('toJSON', () => {
    it('returns complete zeroed data for default instance', () => {
      const metrics = new AgentMetrics()
      expect(metrics.toJSON()).toStrictEqual({
        cycleCount: 0,
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        accumulatedMetrics: { latencyMs: 0 },
        agentInvocations: [],
        toolMetrics: {},
      })
    })

    it('returns data from provided metrics', () => {
      const metrics = new AgentMetrics({
        cycleCount: 2,
        toolMetrics: {
          search: { callCount: 2, successCount: 1, errorCount: 1, totalTime: 2.0 },
        },
        accumulatedUsage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        accumulatedMetrics: { latencyMs: 350 },
        agentInvocations: [
          {
            usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
            cycles: [
              { cycleId: 'cycle-1', duration: 3000, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              { cycleId: 'cycle-2', duration: 5000, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
            ],
          },
        ],
      })

      expect(metrics.toJSON()).toStrictEqual({
        cycleCount: 2,
        accumulatedUsage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        accumulatedMetrics: { latencyMs: 350 },
        agentInvocations: [
          {
            usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
            cycles: [
              { cycleId: 'cycle-1', duration: 3000, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              { cycleId: 'cycle-2', duration: 5000, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
            ],
          },
        ],
        toolMetrics: {
          search: { callCount: 2, successCount: 1, errorCount: 1, totalTime: 2.0 },
        },
      })
    })
  })

  describe('computed getters', () => {
    it('latestAgentInvocation returns the last invocation', () => {
      const metrics = new AgentMetrics({
        agentInvocations: [
          { cycles: [], usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
          { cycles: [], usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
        ],
      })

      expect(metrics.latestAgentInvocation).toBe(metrics.agentInvocations[1])
    })

    it('latestAgentInvocation returns undefined when empty', () => {
      const metrics = new AgentMetrics()
      expect(metrics.latestAgentInvocation).toBeUndefined()
    })

    it('accumulatedData returns usage and metrics together', () => {
      const metrics = new AgentMetrics({
        accumulatedUsage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        accumulatedMetrics: { latencyMs: 350 },
      })

      expect(metrics.accumulatedData).toStrictEqual({
        usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        metrics: { latencyMs: 350 },
      })
    })

    it('totalDuration sums cycle durations', () => {
      const metrics = new AgentMetrics({
        agentInvocations: [
          {
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            cycles: [
              { cycleId: 'cycle-1', duration: 3000, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
              { cycleId: 'cycle-2', duration: 5000, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
            ],
          },
        ],
      })
      expect(metrics.totalDuration).toBe(8000)
    })

    it('averageCycleTime computes average', () => {
      const metrics = new AgentMetrics({
        cycleCount: 2,
        agentInvocations: [
          {
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            cycles: [
              { cycleId: 'cycle-1', duration: 3000, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
              { cycleId: 'cycle-2', duration: 5000, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
            ],
          },
        ],
      })
      expect(metrics.averageCycleTime).toBe(4000)
    })

    it('averageCycleTime returns 0 when no cycles', () => {
      const metrics = new AgentMetrics()
      expect(metrics.averageCycleTime).toBe(0)
    })

    it('toolUsage adds computed averageTime and successRate', () => {
      const metrics = new AgentMetrics({
        toolMetrics: {
          search: { callCount: 2, successCount: 1, errorCount: 1, totalTime: 2.0 },
        },
      })

      expect(metrics.toolUsage).toStrictEqual({
        search: {
          callCount: 2,
          successCount: 1,
          errorCount: 1,
          totalTime: 2.0,
          averageTime: 1.0,
          successRate: 0.5,
        },
      })
    })
  })
})
