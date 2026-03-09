/**
 * OpenTelemetry configuration and setup utilities for Strands agents.
 *
 * Uses BasicTracerProvider from `@opentelemetry/sdk-trace-base` which works in
 * Node.js, browser, and WASM environments. For Node.js-specific features like
 * automatic async context propagation, pass a NodeTracerProvider via the
 * `provider` config option.
 *
 * @see https://github.com/strands-agents/sdk-typescript/issues/447
 */

import { Resource, envDetectorSync } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { logger } from '../logging/index.js'

const DEFAULT_SERVICE_NAME = 'strands-agents'
const DEFAULT_SERVICE_NAMESPACE = 'strands'
const DEFAULT_DEPLOYMENT_ENVIRONMENT = 'development'

/**
 * Get the service name, respecting the OTEL_SERVICE_NAME environment variable.
 *
 * @returns The service name from OTEL_SERVICE_NAME or the default 'strands-agents'
 */
export function getServiceName(): string {
  return globalThis?.process?.env?.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME
}

/**
 * Configuration options for setting up the tracer.
 */
export interface TracerConfig {
  /**
   * Custom TracerProvider instance. If not provided, a BasicTracerProvider
   * will be created with default configuration.
   *
   * For Node.js-specific async context propagation, pass a NodeTracerProvider:
   * @example
   * ```typescript
   * import { NodeTracerProvider } from '\@opentelemetry/sdk-trace-node'
   * telemetry.setupTracer({ provider: new NodeTracerProvider() })
   * ```
   */
  provider?: BasicTracerProvider

  /**
   * Exporter configuration.
   */
  exporters?: {
    /**
     * Enable OTLP exporter. Uses OTEL_EXPORTER_OTLP_ENDPOINT and
     * OTEL_EXPORTER_OTLP_HEADERS env vars automatically.
     */
    otlp?: boolean
    /**
     * Enable console exporter for debugging.
     */
    console?: boolean
  }
}

let _provider: BasicTracerProvider | null = null

/**
 * Set up the tracer provider with the given configuration.
 *
 * @param config - Tracer configuration options
 * @returns The configured BasicTracerProvider
 *
 * @example
 * ```typescript
 * import { telemetry } from '\@strands-agents/sdk'
 *
 * // Simple setup with defaults (works in Node, browser, and WASM)
 * const provider = telemetry.setupTracer({
 *   exporters: { otlp: true }
 * })
 *
 * // Node.js with async context propagation
 * import { NodeTracerProvider } from '\@opentelemetry/sdk-trace-node'
 * telemetry.setupTracer({
 *   provider: new NodeTracerProvider({ resource: myResource }),
 *   exporters: { otlp: true, console: true }
 * })
 * ```
 */
export function setupTracer(config: TracerConfig = {}): BasicTracerProvider {
  if (_provider) {
    logger.warn('tracer provider already initialized, returning existing provider')
    return _provider
  }

  // Use provided provider or create default
  _provider = config.provider ?? new BasicTracerProvider({ resource: getOtelResource() })

  // Add exporters if requested
  if (config.exporters?.otlp) addOtlpExporter(_provider)
  if (config.exporters?.console) addConsoleExporter(_provider)

  // register() sets up global tracer provider, context manager, and propagators
  _provider.register()

  // Flush pending spans on exit for short-lived scripts (Node.js only)
  if (typeof globalThis?.process?.once === 'function') {
    globalThis.process.once('beforeExit', () => {
      if (_provider) {
        _provider.forceFlush().catch((err: unknown) => {
          logger.warn(`error=<${err}> | failed to flush tracer provider on exit`)
        })
      }
    })
  }

  return _provider
}

function addOtlpExporter(provider: BasicTracerProvider): void {
  try {
    provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()))
  } catch (error) {
    logger.warn(`error=<${error}> | failed to configure otlp exporter`)
  }
}

function addConsoleExporter(provider: BasicTracerProvider): void {
  try {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
  } catch (error) {
    logger.warn(`error=<${error}> | failed to configure console exporter`)
  }
}

function getOtelResource(): Resource {
  const serviceName = getServiceName()
  const serviceNamespace = globalThis?.process?.env?.OTEL_SERVICE_NAMESPACE || DEFAULT_SERVICE_NAMESPACE
  const deploymentEnvironment = globalThis?.process?.env?.OTEL_DEPLOYMENT_ENVIRONMENT || DEFAULT_DEPLOYMENT_ENVIRONMENT

  const defaultResource = new Resource({
    'service.name': serviceName,
    'service.namespace': serviceNamespace,
    'deployment.environment': deploymentEnvironment,
    'telemetry.sdk.name': 'opentelemetry',
    'telemetry.sdk.language': 'typescript',
  })

  // Merge with OTEL_RESOURCE_ATTRIBUTES env var (env attrs take precedence)
  const envResource = envDetectorSync.detect()
  return defaultResource.merge(envResource)
}
