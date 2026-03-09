import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
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

describe('setupTracer (node-specific)', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('provider auto-detection', () => {
    it('should use NodeTracerProvider by default for async context support', async () => {
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider).toBeInstanceOf(NodeTracerProvider)
    })

    it('should accept a custom NodeTracerProvider', async () => {
      const telemetry = await import('../index.js')
      const customProvider = new NodeTracerProvider()

      const provider = telemetry.setupTracer({ provider: customProvider })

      expect(provider).toBe(customProvider)
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

  describe('resource attributes from environment', () => {
    it('should use OTEL_SERVICE_NAME when set', async () => {
      process.env.OTEL_SERVICE_NAME = 'my-custom-service'
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider.resource.attributes['service.name']).toBe('my-custom-service')
    })

    it('should use OTEL_SERVICE_NAMESPACE when set', async () => {
      process.env.OTEL_SERVICE_NAMESPACE = 'my-namespace'
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider.resource.attributes['service.namespace']).toBe('my-namespace')
    })

    it('should use OTEL_DEPLOYMENT_ENVIRONMENT when set', async () => {
      process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'production'
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider.resource.attributes['deployment.environment']).toBe('production')
    })

    it('should merge OTEL_RESOURCE_ATTRIBUTES with defaults', async () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.version=1.0.0,custom.team=platform'
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider.resource.attributes['service.version']).toBe('1.0.0')
      expect(provider.resource.attributes['custom.team']).toBe('platform')
      expect(provider.resource.attributes['service.name']).toBe('strands-agents')
    })

    it('should allow OTEL_RESOURCE_ATTRIBUTES to override defaults', async () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.name=custom-service,deployment.environment=production'
      const telemetry = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider.resource.attributes['service.name']).toBe('custom-service')
      expect(provider.resource.attributes['deployment.environment']).toBe('production')
    })
  })
})
