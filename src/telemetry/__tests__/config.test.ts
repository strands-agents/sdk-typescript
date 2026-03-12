import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('setupTracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  describe('singleton behavior', () => {
    it('should return the same provider instance when called twice', async () => {
      const telemetry = await import('../index.js')

      const provider1 = telemetry.setupTracer({ exporters: { console: true } })
      const provider2 = telemetry.setupTracer({ exporters: { otlp: true } })

      expect(provider1).toBe(provider2)
    })

    it('should log a warning when called twice', async () => {
      const { logger } = await import('../../logging/index.js')
      const warnSpy = vi.spyOn(logger, 'warn')
      const telemetry = await import('../index.js')

      telemetry.setupTracer()
      telemetry.setupTracer()

      expect(warnSpy).toHaveBeenCalledWith('tracer provider already initialized, returning existing provider')
    })
  })

  describe('resource attributes', () => {
    it('should use strands-agents as default service name', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider.resource.attributes['service.name']).toBe('strands-agents')
    })

    it('should include default resource attributes', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider.resource.attributes['service.name']).toBe('strands-agents')
      expect(provider.resource.attributes['service.namespace']).toBe('strands')
      expect(provider.resource.attributes['deployment.environment']).toBe('development')
      expect(provider.resource.attributes['telemetry.sdk.name']).toBe('opentelemetry')
      expect(provider.resource.attributes['telemetry.sdk.language']).toBe('typescript')
    })
  })
})

describe('setupMeter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  describe('singleton behavior', () => {
    it('returns the same provider instance when called twice', async () => {
      const telemetry = await import('../index.js')

      const provider1 = telemetry.setupMeter({ exporters: { console: true } })
      const provider2 = telemetry.setupMeter({ exporters: { otlp: true } })

      expect(provider1).toBe(provider2)
    })

    it('logs a warning when called twice', async () => {
      const { logger } = await import('../../logging/index.js')
      const warnSpy = vi.spyOn(logger, 'warn')
      const telemetry = await import('../index.js')

      telemetry.setupMeter()
      telemetry.setupMeter()

      expect(warnSpy).toHaveBeenCalledWith('meter provider already initialized, returning existing provider')
    })
  })

  describe('exporter configuration', () => {
    it('creates a provider with forceFlush and shutdown when given empty config', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupMeter({})

      expect(typeof provider.forceFlush).toBe('function')
      expect(typeof provider.shutdown).toBe('function')
    })

    it('creates a provider when otlp exporter is enabled', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupMeter({ exporters: { otlp: true } })

      expect(typeof provider.forceFlush).toBe('function')
    })

    it('creates a provider when console exporter is enabled', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupMeter({ exporters: { console: true } })

      expect(typeof provider.forceFlush).toBe('function')
    })

    it('creates a provider when both exporters are enabled', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupMeter({ exporters: { otlp: true, console: true } })

      expect(typeof provider.forceFlush).toBe('function')
    })

    it('creates a provider when both exporters are explicitly false', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupMeter({ exporters: { otlp: false, console: false } })

      expect(typeof provider.forceFlush).toBe('function')
    })
  })
})

describe('getMeter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns a meter with counter and histogram factory methods', async () => {
    const telemetry = await import('../index.js')

    const meter = telemetry.getMeter()

    expect(typeof meter.createCounter).toBe('function')
    expect(typeof meter.createHistogram).toBe('function')
    expect(typeof meter.createUpDownCounter).toBe('function')
  })

  it('returns a meter that can create instruments without error', async () => {
    const telemetry = await import('../index.js')

    const meter = telemetry.getMeter()
    const counter = meter.createCounter('test_counter')
    const histogram = meter.createHistogram('test_histogram')

    expect(() => counter.add(1)).not.toThrow()
    expect(() => histogram.record(100)).not.toThrow()
  })
})
