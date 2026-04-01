/**
 * Internal control-flow mechanism for unwinding nested `yield*` generator chains
 * when cancellation is detected during model streaming.
 * Caught at the `_stream()` level and converted to an `AgentResult` with `stopReason: 'cancelled'`.
 * Not exported from the package — never thrown to users.
 */
export class AgentCancelInterrupt extends Error {
  constructor() {
    super('Agent invocation cancelled')
    this.name = 'AgentCancelInterrupt'
  }
}
