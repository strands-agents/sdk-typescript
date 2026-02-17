/**
 * OpenTelemetry configuration and setup utilities for Strands agents.
 *
 * This module provides centralized configuration and initialization functionality
 * for OpenTelemetry components and other telemetry infrastructure shared across Strands applications.
 */

import { Resource, envDetectorSync } from '@opentelemetry/resources'
import { NodeTracerProvider, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { logger } from '../logging/index.js'

const SERVICE_NAME = 'strands-agents'
const DEFAULT_SERVICE_NAMESPACE = 'strands'
const DEFAULT_DEPLOYMENT_ENVIRONMENT = 'development'

/**
 * Configuration options for setting up the tracer.
 */
export interface TracerConfig {
  /**
   * Custom NodeTracerProvider instance. If not provided, one will be
   * created with default configuration.
   */
  provider?: NodeTracerProvider

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

let _provider: NodeTracerProvider | null = null

/**
 * Set up the tracer provider with the given configuration.
 *
 * @param config - Tracer configuration options
 * @returns The configured NodeTracerProvider
 *
 * @example
 * ```typescript
 * import { telemetry } from '@strands-agents/sdk'
 *
 * // Simple setup with defaults
 * const provider = telemetry.setupTracer({
 *   exporters: { otlp: true }
 * })
 *
 * // Custom provider
 * telemetry.setupTracer({
 *   provider: new NodeTracerProvider({ resource: myResource }),
 *   exporters: { otlp: true, console: true }
 * })
 * ```
 */
export function setupTracer(config: TracerConfig = {}): NodeTracerProvider {
  if (_provider) {
    logger.warn('tracer provider already initialized, returning existing provider')
    return _provider
  }

  // Use provided provider or create default
  _provider = config.provider ?? new NodeTracerProvider({ resource: getOtelResource() })

  // Add exporters if requested
  if (config.exporters?.otlp) addOtlpExporter(_provider)
  if (config.exporters?.console) addConsoleExporter(_provider)

  // register() sets up global tracer provider, context manager, and propagators
  _provider.register()

  // Flush pending spans on exit for short-lived scripts using BatchSpanProcessor
  process.once('beforeExit', () => {
    if (_provider) {
      _provider.forceFlush().catch((err: unknown) => {
        logger.warn(`error=<${err}> | failed to flush tracer provider on exit`)
      })
    }
  })

  return _provider
}

function addOtlpExporter(provider: NodeTracerProvider): void {
  try {
    provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()))
  } catch (error) {
    logger.warn(`error=<${error}> | failed to configure otlp exporter`)
  }
}

function addConsoleExporter(provider: NodeTracerProvider): void {
  try {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
  } catch (error) {
    logger.warn(`error=<${error}> | failed to configure console exporter`)
  }
}

function getOtelResource(): Resource {
  const serviceName = process.env.OTEL_SERVICE_NAME || SERVICE_NAME
  const serviceNamespace = process.env.OTEL_SERVICE_NAMESPACE || DEFAULT_SERVICE_NAMESPACE
  const deploymentEnvironment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || DEFAULT_DEPLOYMENT_ENVIRONMENT

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
