import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metrics as otelMetrics } from '@opentelemetry/api'
import type { Meter as OtelMeter } from '@opentelemetry/api'
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
      expect(snapshot).toStrictEqual(
        new AgentMetrics({
          cycleCount: 0,
          toolMetrics: {},
          agentInvocations: [],
          accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          accumulatedMetrics: { latencyMs: 0 },
        })
      )
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

    it('does not fail when no invocation exists', () => {
      vi.spyOn(Date, 'now').mockReturnValue(200_000)

      meter.startCycle()

      expect(() => meter.endCycle(100_000)).not.toThrow()
      expect(meter.metrics.agentInvocations).toStrictEqual([])
      vi.restoreAllMocks()
    })

    it('does not fail when invocation has no cycles', () => {
      vi.spyOn(Date, 'now').mockReturnValue(200_000)

      meter.startNewInvocation()

      expect(() => meter.endCycle(100_000)).not.toThrow()
      expect(meter.metrics.latestAgentInvocation!.cycles).toStrictEqual([])
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

  describe('OTEL instrument emission', () => {
    // Per-instrument mocks for precise assertion
    let mockCycleCounter: { add: ReturnType<typeof vi.fn> }
    let mockInvocationCounter: { add: ReturnType<typeof vi.fn> }
    let mockToolCallCounter: { add: ReturnType<typeof vi.fn> }
    let mockToolErrorCounter: { add: ReturnType<typeof vi.fn> }
    let mockInputTokens: { add: ReturnType<typeof vi.fn> }
    let mockOutputTokens: { add: ReturnType<typeof vi.fn> }
    let mockCycleDuration: { record: ReturnType<typeof vi.fn> }
    let mockToolDuration: { record: ReturnType<typeof vi.fn> }
    let mockModelLatency: { record: ReturnType<typeof vi.fn> }
    let mockMeter: OtelMeter

    beforeEach(() => {
      mockCycleCounter = { add: vi.fn() }
      mockInvocationCounter = { add: vi.fn() }
      mockToolCallCounter = { add: vi.fn() }
      mockToolErrorCounter = { add: vi.fn() }
      mockInputTokens = { add: vi.fn() }
      mockOutputTokens = { add: vi.fn() }
      mockCycleDuration = { record: vi.fn() }
      mockToolDuration = { record: vi.fn() }
      mockModelLatency = { record: vi.fn() }

      const counterMap: Record<string, { add: ReturnType<typeof vi.fn> }> = {
        'gen_ai.agent.cycle.count': mockCycleCounter,
        'gen_ai.agent.invocation.count': mockInvocationCounter,
        'gen_ai.agent.tool.call.count': mockToolCallCounter,
        'gen_ai.agent.tool.error.count': mockToolErrorCounter,
        'gen_ai.agent.tokens.input': mockInputTokens,
        'gen_ai.agent.tokens.output': mockOutputTokens,
      }
      const histogramMap: Record<string, { record: ReturnType<typeof vi.fn> }> = {
        'gen_ai.agent.cycle.duration': mockCycleDuration,
        'gen_ai.agent.tool.duration': mockToolDuration,
        'gen_ai.agent.model.latency': mockModelLatency,
      }

      mockMeter = {
        createCounter: vi.fn().mockImplementation((name: string) => counterMap[name] ?? { add: vi.fn() }),
        createHistogram: vi.fn().mockImplementation((name: string) => histogramMap[name] ?? { record: vi.fn() }),
        createUpDownCounter: vi.fn(),
        createObservableCounter: vi.fn(),
        createObservableGauge: vi.fn(),
        createObservableUpDownCounter: vi.fn(),
        createGauge: vi.fn(),
      } as unknown as OtelMeter
      vi.spyOn(otelMetrics, 'getMeter').mockReturnValue(mockMeter)
    })

    it('creates all expected OTEL instruments on construction', () => {
      const m = new Meter()

      expect(mockMeter.createCounter).toHaveBeenCalledWith('gen_ai.agent.cycle.count', expect.any(Object))
      expect(mockMeter.createCounter).toHaveBeenCalledWith('gen_ai.agent.invocation.count', expect.any(Object))
      expect(mockMeter.createCounter).toHaveBeenCalledWith('gen_ai.agent.tool.call.count', expect.any(Object))
      expect(mockMeter.createCounter).toHaveBeenCalledWith('gen_ai.agent.tool.error.count', expect.any(Object))
      expect(mockMeter.createCounter).toHaveBeenCalledWith('gen_ai.agent.tokens.input', expect.any(Object))
      expect(mockMeter.createCounter).toHaveBeenCalledWith('gen_ai.agent.tokens.output', expect.any(Object))
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('gen_ai.agent.cycle.duration', expect.any(Object))
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('gen_ai.agent.tool.duration', expect.any(Object))
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('gen_ai.agent.model.latency', expect.any(Object))
      expect(m).toBeDefined()
    })

    it('emits invocation counter on startNewInvocation', () => {
      const m = new Meter()

      m.startNewInvocation()

      expect(mockInvocationCounter.add).toHaveBeenCalledTimes(1)
      expect(mockInvocationCounter.add).toHaveBeenCalledWith(1)
    })

    it('emits cycle counter on startCycle', () => {
      const m = new Meter()

      m.startCycle()

      expect(mockCycleCounter.add).toHaveBeenCalledTimes(1)
      expect(mockCycleCounter.add).toHaveBeenCalledWith(1)
    })

    it('emits cycle duration histogram on endCycle', () => {
      vi.spyOn(Date, 'now').mockReturnValue(5000)
      const m = new Meter()

      m.endCycle(3000)

      expect(mockCycleDuration.record).toHaveBeenCalledTimes(1)
      expect(mockCycleDuration.record).toHaveBeenCalledWith(2000)
      vi.restoreAllMocks()
    })

    it('emits tool call counter and duration on successful endToolCall', () => {
      const m = new Meter()

      m.endToolCall({ tool: makeTool('search', 'id-1'), duration: 150, success: true })

      expect(mockToolCallCounter.add).toHaveBeenCalledTimes(1)
      expect(mockToolCallCounter.add).toHaveBeenCalledWith(1, { 'gen_ai.tool.name': 'search' })
      expect(mockToolDuration.record).toHaveBeenCalledTimes(1)
      expect(mockToolDuration.record).toHaveBeenCalledWith(150, { 'gen_ai.tool.name': 'search' })
      expect(mockToolErrorCounter.add).not.toHaveBeenCalled()
    })

    it('emits tool call counter, error counter, and duration on failed endToolCall', () => {
      const m = new Meter()

      m.endToolCall({ tool: makeTool('search', 'id-1'), duration: 50, success: false })

      expect(mockToolCallCounter.add).toHaveBeenCalledTimes(1)
      expect(mockToolCallCounter.add).toHaveBeenCalledWith(1, { 'gen_ai.tool.name': 'search' })
      expect(mockToolErrorCounter.add).toHaveBeenCalledTimes(1)
      expect(mockToolErrorCounter.add).toHaveBeenCalledWith(1, { 'gen_ai.tool.name': 'search' })
      expect(mockToolDuration.record).toHaveBeenCalledTimes(1)
      expect(mockToolDuration.record).toHaveBeenCalledWith(50, { 'gen_ai.tool.name': 'search' })
    })

    it('emits input token counter, output token counter, and model latency on updateCycle', () => {
      const m = new Meter()

      m.updateCycle({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        metrics: { latencyMs: 200 },
      })

      expect(mockInputTokens.add).toHaveBeenCalledTimes(1)
      expect(mockInputTokens.add).toHaveBeenCalledWith(100)
      expect(mockOutputTokens.add).toHaveBeenCalledTimes(1)
      expect(mockOutputTokens.add).toHaveBeenCalledWith(50)
      expect(mockModelLatency.record).toHaveBeenCalledTimes(1)
      expect(mockModelLatency.record).toHaveBeenCalledWith(200)
    })

    it('does not emit token counters or latency when updateCycle has no usage or metrics', () => {
      const m = new Meter()

      m.updateCycle({ type: 'modelMetadataEvent' })

      expect(mockInputTokens.add).not.toHaveBeenCalled()
      expect(mockOutputTokens.add).not.toHaveBeenCalled()
      expect(mockModelLatency.record).not.toHaveBeenCalled()
    })

    it('does not emit any OTEL instruments when updateCycle is called with undefined', () => {
      const m = new Meter()

      m.updateCycle(undefined)

      expect(mockInputTokens.add).not.toHaveBeenCalled()
      expect(mockOutputTokens.add).not.toHaveBeenCalled()
      expect(mockModelLatency.record).not.toHaveBeenCalled()
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

  describe('toJSON roundtrip', () => {
    it('reconstructs equivalent AgentMetrics from serialized data', () => {
      const original = new AgentMetrics({
        cycleCount: 3,
        accumulatedUsage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        accumulatedMetrics: { latencyMs: 500 },
        agentInvocations: [
          {
            usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
            cycles: [
              { cycleId: 'cycle-1', duration: 1000, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              { cycleId: 'cycle-2', duration: 2000, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
              { cycleId: 'cycle-3', duration: 3000, usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
            ],
          },
        ],
        toolMetrics: {
          search: { callCount: 2, successCount: 2, errorCount: 0, totalTime: 1.5 },
          calc: { callCount: 1, successCount: 0, errorCount: 1, totalTime: 0.3 },
        },
      })

      const json = JSON.stringify(original)
      const restored = new AgentMetrics(JSON.parse(json))

      expect(restored.toJSON()).toStrictEqual(original.toJSON())
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

    it('toolUsage returns 0 for averageTime and successRate when callCount is 0', () => {
      const metrics = new AgentMetrics({
        toolMetrics: {
          broken: { callCount: 0, successCount: 0, errorCount: 0, totalTime: 0 },
        },
      })

      expect(metrics.toolUsage).toStrictEqual({
        broken: {
          callCount: 0,
          successCount: 0,
          errorCount: 0,
          totalTime: 0,
          averageTime: 0,
          successRate: 0,
        },
      })
    })

    it('totalDuration returns 0 when no invocations exist', () => {
      const metrics = new AgentMetrics()
      expect(metrics.totalDuration).toBe(0)
    })
  })
})
