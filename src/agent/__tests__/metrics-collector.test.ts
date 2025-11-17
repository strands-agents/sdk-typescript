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

      const startPerf = globalThis.performance.now()
      const cycle = collector.startCycle()
      expect(cycle.trace.name).toMatch(/Cycle/)
      expect(cycle.trace.startTime).toBeGreaterThanOrEqual(startPerf)

      // Simulate some work
      const workDuration = 10
      const endTime = cycle.trace.startTime + workDuration
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      // Manually dispose to end cycle
      cycle[Symbol.dispose]()

      const metrics = collector.getMetrics()
      expect(metrics.eventLoop.cycleCount).toBe(1)
      expect(metrics.eventLoop.totalDurationMs).toBeCloseTo(workDuration, 0)
      expect(metrics.eventLoop.cycleDurationsMs).toHaveLength(1)
      expect(metrics.eventLoop.cycleDurationsMs[0]).toBeCloseTo(workDuration, 0)
      expect(cycle.trace.endTime).toBe(endTime)
      expect(cycle.trace.durationMs).toBeCloseTo(workDuration, 0)

      vi.restoreAllMocks()
    })

    it('tracks multiple cycles', () => {
      const collector = new MetricsCollector()

      // Cycle 1
      const cycle1 = collector.startCycle()
      const cycle1End = cycle1.trace.startTime + 10
      vi.spyOn(performance, 'now').mockReturnValue(cycle1End)
      cycle1[Symbol.dispose]()

      // Cycle 2
      vi.spyOn(performance, 'now').mockReturnValue(cycle1End + 5)
      const cycle2 = collector.startCycle()
      const cycle2End = cycle2.trace.startTime + 20
      vi.spyOn(performance, 'now').mockReturnValue(cycle2End)
      cycle2[Symbol.dispose]()

      const metrics = collector.getMetrics()
      expect(metrics.eventLoop.cycleCount).toBe(2)
      expect(metrics.eventLoop.totalDurationMs).toBeCloseTo(30, 0)
      expect(metrics.eventLoop.cycleDurationsMs).toEqual([expect.any(Number), expect.any(Number)])
      expect(metrics.traces).toHaveLength(2)

      vi.restoreAllMocks()
    })

    it('creates trace with unique ID', () => {
      const collector = new MetricsCollector()

      const cycle1 = collector.startCycle()
      const cycle2 = collector.startCycle()

      expect(cycle1.trace.id).toBeDefined()
      expect(cycle2.trace.id).toBeDefined()
      expect(cycle1.trace.id).not.toBe(cycle2.trace.id)

      cycle1[Symbol.dispose]()
      cycle2[Symbol.dispose]()
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

    beforeEach(() => {
      collector = new MetricsCollector()
      // Start a cycle to have a parent trace available
      collector.startCycle()
    })

    it('tracks single successful tool execution', () => {
      const toolExecution = collector.startToolExecution('testTool')

      const endTime = toolExecution.trace.startTime + 100
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      toolExecution.markSuccess()
      toolExecution[Symbol.dispose]()

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
      const toolExecution = collector.startToolExecution('testTool')

      const endTime = toolExecution.trace.startTime + 100
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      // Don't call markSuccess() - should be tracked as error
      toolExecution[Symbol.dispose]()

      const metrics = collector.getMetrics()
      expect(metrics.tools.testTool?.callCount).toBe(1)
      expect(metrics.tools.testTool?.successCount).toBe(0)
      expect(metrics.tools.testTool?.errorCount).toBe(1)

      vi.restoreAllMocks()
    })

    it('aggregates multiple executions of same tool', () => {
      const tool1 = collector.startToolExecution('testTool')
      vi.spyOn(performance, 'now').mockReturnValue(tool1.trace.startTime + 100)
      tool1.markSuccess()
      tool1[Symbol.dispose]()

      vi.spyOn(performance, 'now').mockReturnValue(tool1.trace.startTime + 200)
      const tool2 = collector.startToolExecution('testTool')
      vi.spyOn(performance, 'now').mockReturnValue(tool2.trace.startTime + 200)
      tool2.markSuccess()
      tool2[Symbol.dispose]()

      const metrics = collector.getMetrics()
      expect(metrics.tools.testTool?.callCount).toBe(2)
      expect(metrics.tools.testTool?.successCount).toBe(2)
      expect(metrics.tools.testTool?.totalDurationMs).toBeCloseTo(300, 0)
      expect(metrics.tools.testTool?.averageDurationMs).toBeCloseTo(150, 0)

      vi.restoreAllMocks()
    })

    it('tracks multiple different tools separately', () => {
      const tool1 = collector.startToolExecution('tool1')
      vi.spyOn(performance, 'now').mockReturnValue(tool1.trace.startTime + 100)
      tool1.markSuccess()
      tool1[Symbol.dispose]()

      vi.spyOn(performance, 'now').mockReturnValue(tool1.trace.startTime + 200)
      const tool2 = collector.startToolExecution('tool2')
      vi.spyOn(performance, 'now').mockReturnValue(tool2.trace.startTime + 200)
      // Don't mark success on tool2
      tool2[Symbol.dispose]()

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
      const cycle = collector.startCycle()
      const toolExecution = collector.startToolExecution('testTool')

      expect(toolExecution.trace.parentId).toBe(cycle.trace.id)
      expect(toolExecution.trace.name).toBe('testTool')
      expect(toolExecution.trace.metadata).toEqual({ toolName: 'testTool' })
      expect(cycle.trace.children).toContain(toolExecution.trace)

      toolExecution[Symbol.dispose]()
      cycle[Symbol.dispose]()
    })

    it('updates trace metadata with success status', () => {
      const toolExecution = collector.startToolExecution('testTool')

      const endTime = toolExecution.trace.startTime + 100
      vi.spyOn(performance, 'now').mockReturnValue(endTime)

      toolExecution.markSuccess()
      toolExecution[Symbol.dispose]()

      expect(toolExecution.trace.metadata?.success).toBe(true)
      expect(toolExecution.trace.endTime).toBe(endTime)
      expect(toolExecution.trace.durationMs).toBeCloseTo(100, 0)

      vi.restoreAllMocks()
    })
  })

  describe('trace tree structure', () => {
    it('builds trace tree with single cycle', () => {
      const collector = new MetricsCollector()

      const cycle = collector.startCycle()
      cycle[Symbol.dispose]()

      const metrics = collector.getMetrics()
      expect(metrics.traces).toHaveLength(1)
      expect(metrics.traces[0]?.id).toBe(cycle.trace.id)
      expect(metrics.traces[0]?.children).toEqual([])
    })

    it('builds trace tree with nested tool executions', () => {
      const collector = new MetricsCollector()

      const cycle = collector.startCycle()
      const tool1 = collector.startToolExecution('tool1')
      tool1.markSuccess()
      tool1[Symbol.dispose]()

      const tool2 = collector.startToolExecution('tool2')
      tool2.markSuccess()
      tool2[Symbol.dispose]()

      cycle[Symbol.dispose]()

      const metrics = collector.getMetrics()
      expect(metrics.traces).toHaveLength(1)
      expect(metrics.traces[0]?.children).toHaveLength(2)
      expect(metrics.traces[0]?.children[0]?.name).toBe('tool1')
      expect(metrics.traces[0]?.children[1]?.name).toBe('tool2')
    })

    it('verifies parent-child relationships', () => {
      const collector = new MetricsCollector()

      const cycle = collector.startCycle()
      const toolExecution = collector.startToolExecution('testTool')

      expect(toolExecution.trace.parentId).toBe(cycle.trace.id)
      expect(cycle.trace.children).toContain(toolExecution.trace)

      toolExecution[Symbol.dispose]()
      cycle[Symbol.dispose]()
    })
  })

  describe('metrics retrieval', () => {
    it('returns complete metrics snapshot', () => {
      const collector = new MetricsCollector()

      const cycle = collector.startCycle()
      cycle[Symbol.dispose]()

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

      const cycle = collector.startCycle()
      cycle[Symbol.dispose]()

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
      const cycle = collector.startCycle()
      expect(mockCounterAdd).toHaveBeenCalledWith(1)

      vi.spyOn(performance, 'now').mockReturnValue(cycle.trace.startTime + 100)
      cycle[Symbol.dispose]()
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
      collector.startCycle()

      const toolExecution = collector.startToolExecution('testTool')
      vi.spyOn(performance, 'now').mockReturnValue(toolExecution.trace.startTime + 100)
      toolExecution.markSuccess()
      toolExecution[Symbol.dispose]()

      expect(mockCounterAdd).toHaveBeenCalledWith(1, { tool_name: 'testTool' })
      expect(mockHistogramRecord).toHaveBeenCalledWith(expect.any(Number), { tool_name: 'testTool' })

      vi.restoreAllMocks()
    })

    it('does not emit to OTel when MeterProvider not provided', () => {
      const collector = new MetricsCollector()

      // These operations should not throw
      const cycle = collector.startCycle()
      cycle[Symbol.dispose]()

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
