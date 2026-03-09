import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: vi.fn(),
}))

vi.mock('@opentelemetry/sdk-trace-base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/sdk-trace-base')>()
  return {
    ...actual,
    ConsoleSpanExporter: vi.fn(),
  }
})

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

  describe('exporter configuration', () => {
    it('should add OTLP exporter when exporters.otlp is true', async () => {
      const telemetry = await import('../index.js')

      telemetry.setupTracer({ exporters: { otlp: true } })

      expect(OTLPTraceExporter).toHaveBeenCalled()
    })

    it('should add console exporter when exporters.console is true', async () => {
      const telemetry = await import('../index.js')

      telemetry.setupTracer({ exporters: { console: true } })

      expect(ConsoleSpanExporter).toHaveBeenCalled()
    })

    it('should add both exporters when both are true', async () => {
      const telemetry = await import('../index.js')

      telemetry.setupTracer({ exporters: { otlp: true, console: true } })

      expect(OTLPTraceExporter).toHaveBeenCalled()
      expect(ConsoleSpanExporter).toHaveBeenCalled()
    })

    it('should add no exporters when both are false', async () => {
      const telemetry = await import('../index.js')

      telemetry.setupTracer({ exporters: { otlp: false, console: false } })

      expect(OTLPTraceExporter).not.toHaveBeenCalled()
      expect(ConsoleSpanExporter).not.toHaveBeenCalled()
    })

    it('should add no exporters when exporters config is empty', async () => {
      const telemetry = await import('../index.js')

      telemetry.setupTracer({})

      expect(OTLPTraceExporter).not.toHaveBeenCalled()
      expect(ConsoleSpanExporter).not.toHaveBeenCalled()
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
