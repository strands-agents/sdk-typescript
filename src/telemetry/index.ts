/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 *
 * This module provides `setupTracer()` to configure a NodeTracerProvider
 * with OTLP or console exporters. The Agent class handles tracing internally
 * once telemetry is configured.
 *
 * @example Basic setup with OTLP exporter
 * ```typescript
 * import { telemetry, Agent } from '@strands-agents/sdk'
 *
 * // Configure telemetry with OTLP exporter
 * telemetry.setupTracer({ exporters: { otlp: true } })
 *
 * // Agent automatically traces invocations
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

export { setupTracer } from './config.js'
export type { TracerConfig } from './config.js'
