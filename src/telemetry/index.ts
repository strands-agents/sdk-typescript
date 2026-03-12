/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 *
 * This module provides `setupTracer()` to configure a NodeTracerProvider
 * with OTLP or console exporters, and `setupMeter()` to configure a
 * MeterProvider for OTEL metrics export. The Agent class handles tracing
 * and metrics internally once telemetry is configured.
 *
 * @example Basic setup with OTLP exporter
 * ```typescript
 * import { telemetry, Agent } from '@strands-agents/sdk'
 *
 * // Configure telemetry with OTLP exporter
 * telemetry.setupTracer({ exporters: { otlp: true } })
 * telemetry.setupMeter({ exporters: { otlp: true } })
 *
 * // Agent automatically traces invocations and emits metrics
 * const agent = new Agent()
 * ```
 *
 * @example Using your own OpenTelemetry provider
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
 *
 * // Set up your own provider
 * const provider = new NodeTracerProvider()
 * provider.register()
 *
 * // Agent automatically uses your provider via the global OTel API
 * const agent = new Agent()
 * ```
 */

export { setupTracer, getTracer, setupMeter, getMeter } from './config.js'
export type { TracerConfig, MeterConfig } from './config.js'
