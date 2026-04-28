/**
 * Steering context providers.
 *
 * Providers track agent activity and supply context data to steering handlers
 * for evaluation. Each provider registers hooks via initAgent to observe events,
 * and exposes a context getter that returns a typed snapshot of accumulated data.
 *
 * Built-in providers:
 * - LedgerSteeringProvider: tracks tool call history with timing and status
 *
 * Custom providers implement the SteeringProvider interface.
 */

export type { SteeringContextData, SteeringProvider } from './provider.js'
export { ToolLedgerSteeringProvider } from './ledgers.js'
