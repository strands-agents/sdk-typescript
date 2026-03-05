import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentMetrics } from '../meter.js'
import type { ToolUse } from '../../tools/types.js'

describe('AgentLoopMetrics', () => {
  const makeTool = (name: string, toolUseId: string): ToolUse => ({
    name,
    toolUseId,
    input: {},
  })

  let metrics: AgentMetrics

  beforeEach(() => {
    metrics = new AgentMetrics()
  })

  describe('getSummary', () => {
    it('returns complete zeroed summary for fresh instance', () => {
      expect(metrics.getSummary()).toStrictEqual({
        totalCycles: 0,
        totalDuration: 0,
        averageCycleTime: 0,
        toolUsage: {},
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        accumulatedMetrics: { latencyMs: 0 },
        agentInvocations: [],
      })
    })

    it('returns complete summary after a realistic agent execution', () => {
      vi.useFakeTimers()
      vi.setSystemTime(100_000)

      metrics.startNewInvocation()

      const c1 = metrics.startCycle()
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: { latencyMs: 100 },
      })
      metrics.addToolUsage({
        tool: makeTool('search', 'tid-1'),
        duration: 0.5,
        success: true,
      })
      vi.setSystemTime(103_000)
      metrics.endCycle(c1.startTime)

      vi.setSystemTime(200_000)
      const c2 = metrics.startCycle()
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        metrics: { latencyMs: 250 },
      })
      metrics.addToolUsage({
        tool: makeTool('search', 'tid-2'),
        duration: 1.5,
        success: false,
      })
      vi.setSystemTime(205_000)
      metrics.endCycle(c2.startTime)

      const summary = metrics.getSummary()

      expect(summary).toStrictEqual({
        totalCycles: 2,
        totalDuration: 8000,
        averageCycleTime: 4000,
        accumulatedUsage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        accumulatedMetrics: { latencyMs: 350 },
        toolUsage: {
          search: {
            callCount: 2,
            successCount: 1,
            errorCount: 1,
            totalTime: 2.0,
            averageTime: 1.0,
            successRate: 0.5,
          },
        },
        agentInvocations: [
          {
            usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
            cycles: [
              { agentLoopCycleId: 'cycle-1', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              { agentLoopCycleId: 'cycle-2', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
            ],
          },
        ],
      })

      vi.useRealTimers()
    })

    it('tracks multiple invocations independently', () => {
      metrics.startNewInvocation()
      metrics.startCycle()
      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })

      metrics.startNewInvocation()
      metrics.startCycle()
      metrics.updateUsage({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })

      expect(metrics.getSummary().agentInvocations).toStrictEqual([
        {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          cycles: [{ agentLoopCycleId: 'cycle-1', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }],
        },
        {
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          cycles: [{ agentLoopCycleId: 'cycle-2', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } }],
        },
      ])
    })
  })

  describe('startNewInvocation', () => {
    it('appends an invocation with empty cycles and zeroed usage', () => {
      metrics.startNewInvocation()

      expect(metrics.agentInvocations).toStrictEqual([
        { cycles: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ])
    })

    it('latestAgentInvocation returns the most recently added invocation', () => {
      metrics.startNewInvocation()
      metrics.startNewInvocation()

      expect(metrics.agentInvocations).toHaveLength(2)
      expect(metrics.latestAgentInvocation).toBe(metrics.agentInvocations[1])
    })
  })

  describe('startCycle', () => {
    it('returns cycle id and start time', () => {
      vi.spyOn(Date, 'now').mockReturnValue(100_000)

      const result = metrics.startCycle()

      expect(result).toStrictEqual({
        cycleId: 'cycle-1',
        startTime: 100_000,
      })
      expect(metrics.cycleCount).toBe(1)
      vi.restoreAllMocks()
    })

    it('adds cycle entry to the latest invocation', () => {
      metrics.startNewInvocation()
      metrics.startCycle()

      expect(metrics.latestAgentInvocation!.cycles).toStrictEqual([
        { agentLoopCycleId: 'cycle-1', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ])
    })

    it('does not fail when no invocation exists', () => {
      const result = metrics.startCycle()

      expect(result.cycleId).toBe('cycle-1')
      expect(metrics.agentInvocations).toStrictEqual([])
    })
  })

  describe('endCycle', () => {
    it('records duration', () => {
      vi.spyOn(Date, 'now').mockReturnValue(200_000)

      metrics.endCycle(100_000)

      expect(metrics.cycleDurations).toStrictEqual([100_000])
      vi.restoreAllMocks()
    })
  })

  describe('addToolUsage', () => {
    it('records success', () => {
      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-1'),
        duration: 1.5,
        success: true,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 1, successCount: 1, errorCount: 0, totalTime: 1.5 },
      })
    })

    it('records failure', () => {
      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-1'),
        duration: 0.5,
        success: false,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 1, successCount: 0, errorCount: 1, totalTime: 0.5 },
      })
    })

    it('accumulates across multiple calls to the same tool', () => {
      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-1'),
        duration: 1.0,
        success: true,
      })
      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-2'),
        duration: 2.0,
        success: false,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 2, successCount: 1, errorCount: 1, totalTime: 3.0 },
      })
    })

    it('tracks different tools independently', () => {
      metrics.addToolUsage({
        tool: makeTool('toolA', 'id-1'),
        duration: 1.0,
        success: true,
      })
      metrics.addToolUsage({
        tool: makeTool('toolB', 'id-2'),
        duration: 2.0,
        success: false,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        toolA: { callCount: 1, successCount: 1, errorCount: 0, totalTime: 1.0 },
        toolB: { callCount: 1, successCount: 0, errorCount: 1, totalTime: 2.0 },
      })
    })
  })

  describe('updateUsage', () => {
    it('accumulates basic token counts', () => {
      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      metrics.updateUsage({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 30,
        outputTokens: 15,
        totalTokens: 45,
      })
    })

    it('accumulates cache tokens across calls', () => {
      metrics.updateUsage({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadInputTokens: 3,
        cacheWriteInputTokens: 2,
      })
      metrics.updateUsage({
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
        cacheReadInputTokens: 4,
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 15,
        outputTokens: 7,
        totalTokens: 22,
        cacheReadInputTokens: 7,
        cacheWriteInputTokens: 2,
      })
    })

    it('omits cache fields when source has none', () => {
      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
    })

    it('propagates to invocation and current cycle usage', () => {
      metrics.startNewInvocation()
      metrics.startCycle()

      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })

      const invocation = metrics.latestAgentInvocation!
      expect(invocation).toStrictEqual({
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        cycles: [{ agentLoopCycleId: 'cycle-1', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }],
      })
    })

    it('does not fail when no invocation exists', () => {
      expect(() => {
        metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      }).not.toThrow()

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
    })
  })

  describe('updateFromMetadata', () => {
    it('accumulates usage and latency from metadata', () => {
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        metrics: { latencyMs: 100 },
      })
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
        metrics: { latencyMs: 200 },
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 15,
        outputTokens: 10,
        totalTokens: 25,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 300 })
    })

    it('handles usage-only metadata', () => {
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })

    it('handles metrics-only metadata', () => {
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        metrics: { latencyMs: 250 },
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 250 })
    })

    it('is a no-op when metadata has neither usage nor metrics', () => {
      metrics.updateFromMetadata({ type: 'modelMetadataEvent' })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })
  })
})
