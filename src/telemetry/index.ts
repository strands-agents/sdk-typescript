/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 *
 * @example
 * ```typescript
 * import { telemetry } from '@strands-agents/sdk'
 *
 * // Configure telemetry with easy setup
 * telemetry.setupTracer({
 *   exporters: { otlp: true, console: true }
 * })
 *
 * // Or use your own OTel provider - it will be picked up automatically
 * // via the global OTel API
 * ```
 */

export { setupTracer } from './config.js'
export type { TracerConfig } from './config.js'
