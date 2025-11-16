import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MetricsCollector } from '../metrics-collector.js'
import type { Usage } from '../../models/streaming.js'

describe('MetricsCollector', () => {
  describe('initialization', () => {
    it('creates instance without OpenTelemetry', () => {
      const collector = new MetricsCollector()

      expect(collector).toBeDefined()
    })

    it('creates instance with OpenTelemetry MeterProvider', () => {
      const mockMeterProvider = {
        getMeter: vi.fn().mockReturnValue({
          createCounter: vi.fn().mockReturnValue({ add: vi.fn() }),
          createHistogram: vi.fn().mockReturnValue({ record: vi.fn() }),
        }),
      }

      const collector = new MetricsCollector(mockMeterProvider as any)

      expect(collector).toBeDefined()
      expect(mockMeterProvider.getMeter).toHaveBeenCalledWith('strands-agents-sdk')
    })

    it('has zero initial state', () => {
      const collector = new MetricsCollector()

      const metrics = collector.getMetrics()

      expect(metrics).toEqual({
        eventLoop: {
          cycleCount: 0,
          totalDurationMs: 0,
          cycleDurationsMs: [],
        },
        model: {
          invocationCount: 0,
          totalLatencyMs: 0,
          aggregatedUsage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
          invocations: [],
        },
        tools: {},
        traces: [],
      })
    })
  })

  describe('cycle tracking', () => {
    it('tracks single cycle with duration', () => {
      const collector = new MetricsCollector()

      const { startTime, trace } = collector.startCycle()
      expect(trace.name).toMatch(/Cycle/)
      expect(trace.startTime).toBe(startTime)

      // Simulate some work
      const workDuration = 10
      const endTime = startTime + workDuration
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      collector.endCycle(startTime, trace)

      const metrics = collector.getMetrics()
      expect(metrics.eventLoop.cycleCount).toBe(1)
      expect(metrics.eventLoop.totalDurationMs).toBeCloseTo(workDuration, 0)
      expect(metrics.eventLoop.cycleDurationsMs).toHaveLength(1)
      expect(metrics.eventLoop.cycleDurationsMs[0]).toBeCloseTo(workDuration, 0)
      expect(trace.endTime).toBe(endTime)
      expect(trace.durationMs).toBeCloseTo(workDuration, 0)

      vi.restoreAllMocks()
    })

    it('tracks multiple cycles', () => {
      const collector = new MetricsCollector()

      // Cycle 1
      const cycle1 = collector.startCycle()
      const cycle1End = cycle1.startTime + 10
      vi.spyOn(performance, 'now').mockReturnValue(cycle1End)
      collector.endCycle(cycle1.startTime, cycle1.trace)

      // Cycle 2
      vi.spyOn(performance, 'now').mockReturnValue(cycle1End + 5)
      const cycle2 = collector.startCycle()
      const cycle2End = cycle2.startTime + 20
      vi.spyOn(performance, 'now').mockReturnValue(cycle2End)
      collector.endCycle(cycle2.startTime, cycle2.trace)

      const metrics = collector.getMetrics()
      expect(metrics.eventLoop.cycleCount).toBe(2)
      expect(metrics.eventLoop.totalDurationMs).toBeCloseTo(30, 0)
      expect(metrics.eventLoop.cycleDurationsMs).toEqual([expect.any(Number), expect.any(Number)])
      expect(metrics.traces).toHaveLength(2)

      vi.restoreAllMocks()
    })

    it('creates trace with unique ID', () => {
      const collector = new MetricsCollector()

      const { trace: trace1 } = collector.startCycle()
      const { trace: trace2 } = collector.startCycle()

      expect(trace1.id).toBeDefined()
      expect(trace2.id).toBeDefined()
      expect(trace1.id).not.toBe(trace2.id)
    })
  })

  describe('model invocation tracking', () => {
    it('records single model invocation', () => {
      const collector = new MetricsCollector()

      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }

      collector.recordModelInvocation(250, usage, 50)

      const metrics = collector.getMetrics()
      expect(metrics.model.invocationCount).toBe(1)
      expect(metrics.model.totalLatencyMs).toBe(250)
      expect(metrics.model.aggregatedUsage).toEqual(usage)
      expect(metrics.model.invocations).toEqual([
        {
          latencyMs: 250,
          usage,
          timeToFirstByteMs: 50,
        },
      ])
    })

    it('aggregates multiple model invocations', () => {
      const collector = new MetricsCollector()

      const usage1: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }
      const usage2: Usage = {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      }

      collector.recordModelInvocation(250, usage1)
      collector.recordModelInvocation(300, usage2, 75)

      const metrics = collector.getMetrics()
      expect(metrics.model.invocationCount).toBe(2)
      expect(metrics.model.totalLatencyMs).toBe(550)
      expect(metrics.model.aggregatedUsage).toEqual({
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
      })
      expect(metrics.model.invocations).toHaveLength(2)
    })

    it('handles cache token metrics', () => {
      const collector = new MetricsCollector()

      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 30,
      }

      collector.recordModelInvocation(250, usage)

      const metrics = collector.getMetrics()
      expect(metrics.model.aggregatedUsage.cacheReadInputTokens).toBe(20)
      expect(metrics.model.aggregatedUsage.cacheWriteInputTokens).toBe(30)
    })

    it('aggregates cache tokens across invocations', () => {
      const collector = new MetricsCollector()

      const usage1: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 20,
      }
      const usage2: Usage = {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        cacheReadInputTokens: 30,
        cacheWriteInputTokens: 40,
      }

      collector.recordModelInvocation(250, usage1)
      collector.recordModelInvocation(300, usage2)

      const metrics = collector.getMetrics()
      expect(metrics.model.aggregatedUsage.cacheReadInputTokens).toBe(50)
      expect(metrics.model.aggregatedUsage.cacheWriteInputTokens).toBe(40)
    })
  })

  describe('tool execution tracking', () => {
    let collector: MetricsCollector
    let parentTrace: any

    beforeEach(() => {
      collector = new MetricsCollector()
      const cycle = collector.startCycle()
      parentTrace = cycle.trace
    })

    it('tracks single successful tool execution', () => {
      const { startTime, trace } = collector.startToolExecution('testTool', parentTrace)

      const endTime = startTime + 100
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      collector.endToolExecution('testTool', startTime, true, trace)

      const metrics = collector.getMetrics()
      expect(metrics.tools.testTool).toEqual({
        callCount: 1,
        successCount: 1,
        errorCount: 0,
        totalDurationMs: expect.any(Number),
        averageDurationMs: expect.any(Number),
      })
      expect(metrics.tools.testTool?.averageDurationMs).toBeCloseTo(100, 0)

      vi.restoreAllMocks()
    })

    it('tracks single failed tool execution', () => {
      const { startTime, trace } = collector.startToolExecution('testTool', parentTrace)

      const endTime = startTime + 100
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      collector.endToolExecution('testTool', startTime, false, trace)

      const metrics = collector.getMetrics()
      expect(metrics.tools.testTool?.callCount).toBe(1)
      expect(metrics.tools.testTool?.successCount).toBe(0)
      expect(metrics.tools.testTool?.errorCount).toBe(1)

      vi.restoreAllMocks()
    })

    it('aggregates multiple executions of same tool', () => {
      const { startTime: start1, trace: trace1 } = collector.startToolExecution('testTool', parentTrace)
      vi.spyOn(performance, 'now').mockReturnValue(start1 + 100)
      collector.endToolExecution('testTool', start1, true, trace1)

      vi.spyOn(performance, 'now').mockReturnValue(start1 + 200)
      const { startTime: start2, trace: trace2 } = collector.startToolExecution('testTool', parentTrace)
      vi.spyOn(performance, 'now').mockReturnValue(start2 + 200)
      collector.endToolExecution('testTool', start2, true, trace2)

      const metrics = collector.getMetrics()
      expect(metrics.tools.testTool?.callCount).toBe(2)
      expect(metrics.tools.testTool?.successCount).toBe(2)
      expect(metrics.tools.testTool?.totalDurationMs).toBeCloseTo(300, 0)
      expect(metrics.tools.testTool?.averageDurationMs).toBeCloseTo(150, 0)

      vi.restoreAllMocks()
    })

    it('tracks multiple different tools separately', () => {
      const { startTime: start1, trace: trace1 } = collector.startToolExecution('tool1', parentTrace)
      vi.spyOn(performance, 'now').mockReturnValue(start1 + 100)
      collector.endToolExecution('tool1', start1, true, trace1)

      vi.spyOn(performance, 'now').mockReturnValue(start1 + 200)
      const { startTime: start2, trace: trace2 } = collector.startToolExecution('tool2', parentTrace)
      vi.spyOn(performance, 'now').mockReturnValue(start2 + 200)
      collector.endToolExecution('tool2', start2, false, trace2)

      const metrics = collector.getMetrics()
      expect(metrics.tools.tool1).toBeDefined()
      expect(metrics.tools.tool2).toBeDefined()
      if (metrics.tools.tool1 && metrics.tools.tool2) {
        expect(metrics.tools.tool1.successCount).toBe(1)
        expect(metrics.tools.tool2.errorCount).toBe(1)
      }

      vi.restoreAllMocks()
    })

    it('creates tool trace as child of parent trace', () => {
      const { trace: toolTrace } = collector.startToolExecution('testTool', parentTrace)

      expect(toolTrace.parentId).toBe(parentTrace.id)
      expect(toolTrace.name).toBe('testTool')
      expect(toolTrace.metadata).toEqual({ toolName: 'testTool' })
      expect(parentTrace.children).toContain(toolTrace)
    })

    it('updates trace metadata with success status', () => {
      const { startTime, trace } = collector.startToolExecution('testTool', parentTrace)

      const endTime = startTime + 100
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      collector.endToolExecution('testTool', startTime, true, trace)

      expect(trace.metadata?.success).toBe(true)
      expect(trace.endTime).toBe(endTime)
      expect(trace.durationMs).toBeCloseTo(100, 0)

      vi.restoreAllMocks()
    })
  })

  describe('trace tree structure', () => {
    it('builds trace tree with single cycle', () => {
      const collector = new MetricsCollector()

      const { trace } = collector.startCycle()
      collector.endCycle(trace.startTime, trace)

      const metrics = collector.getMetrics()
      expect(metrics.traces).toHaveLength(1)
      expect(metrics.traces[0]?.id).toBe(trace.id)
      expect(metrics.traces[0]?.children).toEqual([])
    })

    it('builds trace tree with nested tool executions', () => {
      const collector = new MetricsCollector()

      const { trace: cycleTrace } = collector.startCycle()
      const { trace: tool1Trace } = collector.startToolExecution('tool1', cycleTrace)
      collector.endToolExecution('tool1', tool1Trace.startTime, true, tool1Trace)

      const { trace: tool2Trace } = collector.startToolExecution('tool2', cycleTrace)
      collector.endToolExecution('tool2', tool2Trace.startTime, true, tool2Trace)

      collector.endCycle(cycleTrace.startTime, cycleTrace)

      const metrics = collector.getMetrics()
      expect(metrics.traces).toHaveLength(1)
      expect(metrics.traces[0]?.children).toHaveLength(2)
      expect(metrics.traces[0]?.children[0]?.name).toBe('tool1')
      expect(metrics.traces[0]?.children[1]?.name).toBe('tool2')
    })

    it('verifies parent-child relationships', () => {
      const collector = new MetricsCollector()

      const { trace: cycleTrace } = collector.startCycle()
      const { trace: toolTrace } = collector.startToolExecution('testTool', cycleTrace)

      expect(toolTrace.parentId).toBe(cycleTrace.id)
      expect(cycleTrace.children).toContain(toolTrace)
    })
  })

  describe('metrics retrieval', () => {
    it('returns complete metrics snapshot', () => {
      const collector = new MetricsCollector()

      const { startTime, trace } = collector.startCycle()
      collector.endCycle(startTime, trace)

      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }
      collector.recordModelInvocation(250, usage)

      const metrics = collector.getMetrics()

      expect(metrics.eventLoop).toBeDefined()
      expect(metrics.model).toBeDefined()
      expect(metrics.tools).toBeDefined()
      expect(metrics.traces).toBeDefined()
    })

    it('returns deep copy that does not affect internal state', () => {
      const collector = new MetricsCollector()

      const { startTime, trace } = collector.startCycle()
      collector.endCycle(startTime, trace)

      const metrics1 = collector.getMetrics()
      metrics1.eventLoop.cycleCount = 999
      if (metrics1.traces[0]) {
        metrics1.traces[0].name = 'Modified'
      }

      const metrics2 = collector.getMetrics()
      expect(metrics2.eventLoop.cycleCount).toBe(1)
      expect(metrics2.traces[0]?.name).toMatch(/Cycle/)
    })
  })

  describe('OpenTelemetry integration', () => {
    it('creates OTel instruments when MeterProvider provided', () => {
      const mockCounterAdd = vi.fn()
      const mockHistogramRecord = vi.fn()

      const mockMeter = {
        createCounter: vi.fn().mockReturnValue({ add: mockCounterAdd }),
        createHistogram: vi.fn().mockReturnValue({ record: mockHistogramRecord }),
      }

      const mockMeterProvider = {
        getMeter: vi.fn().mockReturnValue(mockMeter),
      }

      new MetricsCollector(mockMeterProvider as any)

      expect(mockMeterProvider.getMeter).toHaveBeenCalledWith('strands-agents-sdk')
      expect(mockMeter.createCounter).toHaveBeenCalledWith('strands.event_loop.cycle.count')
      expect(mockMeter.createCounter).toHaveBeenCalledWith('strands.model.invocation.count')
      expect(mockMeter.createCounter).toHaveBeenCalledWith('strands.tool.call.count')
      expect(mockMeter.createCounter).toHaveBeenCalledWith('strands.tool.success.count')
      expect(mockMeter.createCounter).toHaveBeenCalledWith('strands.tool.error.count')
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('strands.event_loop.cycle.duration')
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('strands.model.latency')
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('strands.model.input_tokens')
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('strands.model.output_tokens')
    })

    it('emits metrics to OTel counters and histograms', () => {
      const mockCounterAdd = vi.fn()
      const mockHistogramRecord = vi.fn()

      const mockMeter = {
        createCounter: vi.fn().mockReturnValue({ add: mockCounterAdd }),
        createHistogram: vi.fn().mockReturnValue({ record: mockHistogramRecord }),
      }

      const mockMeterProvider = {
        getMeter: vi.fn().mockReturnValue(mockMeter),
      }

      const collector = new MetricsCollector(mockMeterProvider as any)

      // Test cycle emission
      const { startTime, trace } = collector.startCycle()
      expect(mockCounterAdd).toHaveBeenCalledWith(1)

      vi.spyOn(performance, 'now').mockReturnValue(startTime + 100)
      collector.endCycle(startTime, trace)
      expect(mockHistogramRecord).toHaveBeenCalledWith(expect.any(Number))

      // Test model emission
      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }
      collector.recordModelInvocation(250, usage)
      expect(mockCounterAdd).toHaveBeenCalled()
      expect(mockHistogramRecord).toHaveBeenCalled()

      vi.restoreAllMocks()
    })

    it('includes tool_name attribute in tool metrics', () => {
      const mockCounterAdd = vi.fn()
      const mockHistogramRecord = vi.fn()

      const mockMeter = {
        createCounter: vi.fn().mockReturnValue({ add: mockCounterAdd }),
        createHistogram: vi.fn().mockReturnValue({ record: mockHistogramRecord }),
      }

      const mockMeterProvider = {
        getMeter: vi.fn().mockReturnValue(mockMeter),
      }

      const collector = new MetricsCollector(mockMeterProvider as any)
      const { trace: cycleTrace } = collector.startCycle()

      const { startTime, trace } = collector.startToolExecution('testTool', cycleTrace)
      vi.spyOn(performance, 'now').mockReturnValue(startTime + 100)
      collector.endToolExecution('testTool', startTime, true, trace)

      expect(mockCounterAdd).toHaveBeenCalledWith(1, { tool_name: 'testTool' })
      expect(mockHistogramRecord).toHaveBeenCalledWith(expect.any(Number), { tool_name: 'testTool' })

      vi.restoreAllMocks()
    })

    it('does not emit to OTel when MeterProvider not provided', () => {
      const collector = new MetricsCollector()

      // These operations should not throw
      const { startTime, trace } = collector.startCycle()
      collector.endCycle(startTime, trace)

      const usage: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }
      collector.recordModelInvocation(250, usage)

      const metrics = collector.getMetrics()
      expect(metrics.eventLoop.cycleCount).toBe(1)
      expect(metrics.model.invocationCount).toBe(1)
    })
  })
})
