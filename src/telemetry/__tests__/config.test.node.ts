import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

describe('setupTracer (node-specific)', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('custom provider', () => {
    it('should use custom NodeTracerProvider instead of creating a new one', async () => {
      const telemetry = await import('../index.js')
      const customProvider = new NodeTracerProvider()

      const provider = telemetry.setupTracer({ provider: customProvider })

      expect(provider).toBe(customProvider)
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
