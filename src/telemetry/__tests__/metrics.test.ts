import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MetricsClient } from '../metrics.js'
import * as constants from '../metrics-constants.js'

describe('MetricsClient', () => {
  beforeEach(() => {
    MetricsClient.resetInstance()
  })

  afterEach(() => {
    MetricsClient.resetInstance()
  })

  it('returns the same singleton instance', () => {
    const a = MetricsClient.getInstance()
    const b = MetricsClient.getInstance()
    expect(a).toBe(b)
  })

  it('creates no-op instruments by default (OTel not available)', async () => {
    const client = MetricsClient.getInstance()
    await client.initialize()

    // No-op instruments should not throw
    expect(() => {
      client.recordCycleMetrics({
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        metrics: { latencyMs: 200 },
      })
    }).not.toThrow()

    expect(() => {
      client.recordCycleMetrics({
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cacheReadInputTokens: 5,
          cacheWriteInputTokens: 2,
        },
        metrics: { latencyMs: 100, timeToFirstByteMs: 50 },
      })
    }).not.toThrow()

    expect(() => {
      client.recordToolMetrics({
        toolName: 'calculator',
        duration: 0.5,
        success: true,
      })
    }).not.toThrow()

    expect(() => {
      client.recordToolMetrics({
        toolName: 'other',
        duration: 0.1,
        success: false,
      })
    }).not.toThrow()
  })

  it('creates real instruments when OTel meter provider is available', async () => {
    const mockCounter = { add: vi.fn() }
    const mockHistogram = { record: vi.fn() }
    const mockMeter = {
      createCounter: vi.fn(() => mockCounter),
      createHistogram: vi.fn(() => mockHistogram),
    }
    const mockMeterProvider = { getMeter: vi.fn(() => mockMeter) }

    vi.doMock('@opentelemetry/api', () => ({
      metrics: {
        getMeterProvider: () => mockMeterProvider,
      },
    }))

    const client = MetricsClient.getInstance()
    await client.initialize()

    expect(mockMeterProvider.getMeter).toHaveBeenCalledWith('strands-agents')
    expect(mockMeter.createCounter).toHaveBeenCalledWith(constants.STRANDS_EVENT_LOOP_CYCLE_COUNT, { unit: 'Count' })
    expect(mockMeter.createHistogram).toHaveBeenCalledWith(constants.STRANDS_EVENT_LOOP_LATENCY, { unit: 'ms' })

    vi.doUnmock('@opentelemetry/api')
  })

  it('records tool call success metrics', async () => {
    const addFn = vi.fn()
    const recordFn = vi.fn()
    const mockMeter = {
      createCounter: () => ({ add: addFn }),
      createHistogram: () => ({ record: recordFn }),
    }

    vi.doMock('@opentelemetry/api', () => ({
      metrics: {
        getMeterProvider: () => ({ getMeter: () => mockMeter }),
      },
    }))

    const client = MetricsClient.getInstance()
    await client.initialize()

    client.recordToolMetrics({
      toolName: 'calculator',
      duration: 0.5,
      success: true,
    })

    // toolCallCount.add(1), toolSuccessCount.add(1)
    expect(addFn).toHaveBeenCalledWith(1, expect.objectContaining({ tool_name: 'calculator' }))
    // toolDuration.record(0.5)
    expect(recordFn).toHaveBeenCalledWith(0.5, expect.objectContaining({ tool_name: 'calculator' }))

    vi.doUnmock('@opentelemetry/api')
  })

  it('records tool call error metrics', async () => {
    const addFn = vi.fn()
    const recordFn = vi.fn()
    const mockMeter = {
      createCounter: () => ({ add: addFn }),
      createHistogram: () => ({ record: recordFn }),
    }

    vi.doMock('@opentelemetry/api', () => ({
      metrics: {
        getMeterProvider: () => ({ getMeter: () => mockMeter }),
      },
    }))

    const client = MetricsClient.getInstance()
    await client.initialize()

    client.recordToolMetrics({
      toolName: 'calculator',
      duration: 0.3,
      success: false,
    })

    // toolCallCount.add(1) and toolErrorCount.add(1)
    expect(addFn).toHaveBeenCalledWith(1, expect.objectContaining({ tool_name: 'calculator' }))
    // toolDuration.record(0.3)
    expect(recordFn).toHaveBeenCalledWith(0.3, expect.objectContaining({ tool_name: 'calculator' }))

    vi.doUnmock('@opentelemetry/api')
  })

  it('records token usage histograms', async () => {
    const recordFn = vi.fn()
    const mockMeter = {
      createCounter: () => ({ add: vi.fn() }),
      createHistogram: () => ({ record: recordFn }),
    }

    vi.doMock('@opentelemetry/api', () => ({
      metrics: {
        getMeterProvider: () => ({ getMeter: () => mockMeter }),
      },
    }))

    const client = MetricsClient.getInstance()
    await client.initialize()

    client.recordCycleMetrics({
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 10,
      },
      metrics: { latencyMs: 200 },
    })

    expect(recordFn).toHaveBeenCalledWith(100, undefined)
    expect(recordFn).toHaveBeenCalledWith(50, undefined)
    expect(recordFn).toHaveBeenCalledWith(20, undefined)
    expect(recordFn).toHaveBeenCalledWith(10, undefined)
    expect(recordFn).toHaveBeenCalledWith(200, undefined)

    vi.doUnmock('@opentelemetry/api')
  })

  it('records latency and time-to-first-token histograms', async () => {
    const recordFn = vi.fn()
    const mockMeter = {
      createCounter: () => ({ add: vi.fn() }),
      createHistogram: () => ({ record: recordFn }),
    }

    vi.doMock('@opentelemetry/api', () => ({
      metrics: {
        getMeterProvider: () => ({ getMeter: () => mockMeter }),
      },
    }))

    const client = MetricsClient.getInstance()
    await client.initialize()

    client.recordCycleMetrics({
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      metrics: { latencyMs: 350, timeToFirstByteMs: 42 },
    })

    expect(recordFn).toHaveBeenCalledWith(350, undefined)
    expect(recordFn).toHaveBeenCalledWith(42, undefined)

    vi.doUnmock('@opentelemetry/api')
  })

  it('only initializes once even if called multiple times', async () => {
    const client = MetricsClient.getInstance()
    await client.initialize()
    await client.initialize()

    // Should not throw or cause issues
    expect(() => {
      client.recordToolMetrics({
        toolName: 'test',
        duration: 0.1,
        success: true,
      })
    }).not.toThrow()
  })

  it('resets instance for testing', () => {
    const a = MetricsClient.getInstance()
    MetricsClient.resetInstance()
    const b = MetricsClient.getInstance()
    expect(a).not.toBe(b)
  })
})
