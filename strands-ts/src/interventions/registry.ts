import { BeforeToolCallEvent, AfterModelCallEvent, type HookableEvent } from '../hooks/events.js'
import type { HookRegistry } from '../hooks/registry.js'
import type { HookableEventConstructor } from '../hooks/types.js'
import { Message, TextBlock } from '../types/messages.js'
import type { InterventionAction } from './actions.js'
import { InterventionHandler } from './handler.js'
import { logger } from '../logging/logger.js'

/**
 * A single entry in the intervention audit trail.
 */
export interface AuditRecord {
  handler: string
  eventType: string
  actionType: string
  detail: string
  timestamp: string
}

// Minimum lifecycle methods for Cedar (beforeToolCall) and steering (beforeToolCall +
// afterModelCall). Additional methods (e.g. beforeInvocation, beforeModelCall,
// afterToolCall) will be added once those events support cancellation (#889).
type LifecycleMethod = 'beforeToolCall' | 'afterModelCall'

const EVENT_MAP: ReadonlyArray<[LifecycleMethod, HookableEventConstructor]> = [
  ['beforeToolCall', BeforeToolCallEvent],
  ['afterModelCall', AfterModelCallEvent],
]

/**
 * Bridges {@link InterventionHandler} instances and the Strands hook system.
 *
 * Registers one hook callback per lifecycle event type, then dispatches to
 * all handlers that override that method — in registration order, with
 * short-circuiting on Deny/Interrupt and accumulation for Guide.
 *
 * Every handler decision is recorded in {@link auditLog}.
 *
 * Action support per lifecycle method:
 *
 * | Action    | beforeToolCall                    | afterModelCall                              |
 * |-----------|----------------------------------|---------------------------------------------|
 * | Proceed   | no-op                            | no-op                                       |
 * | Deny      | sets event.cancel                | no-op (model already responded)             |
 * | Guide     | sets event.cancel with feedback  | sets event.retry + injects feedback as user message |
 * | Interrupt | sets event.cancel with approval  | no-op (model already responded)             |
 *
 *
 * Interrupt on beforeToolCall: uses event.cancel as a workaround until native
 * interrupt/resume support lands (https://github.com/strands-agents/sdk-typescript/issues/94).
 *
 * Transform (modify content in-place) is planned but blocked on mutable event
 * content fields (#906).
 */
export class InterventionRegistry {
  private readonly _handlers: InterventionHandler[]
  private readonly _auditLog: AuditRecord[] = []

  constructor(handlers: InterventionHandler[]) {
    const seen = new Set<string>()
    for (const h of handlers) {
      if (seen.has(h.name)) {
        throw new Error(`Duplicate intervention handler name: '${h.name}'`)
      }
      seen.add(h.name)
    }
    this._handlers = handlers
  }

  get handlers(): readonly InterventionHandler[] {
    return this._handlers
  }

  get auditLog(): readonly AuditRecord[] {
    return [...this._auditLog]
  }

  /** Clear the audit log. Use this for long-running agents to prevent unbounded memory growth. */
  clearAuditLog(): void {
    this._auditLog.length = 0
  }

  /**
   * Wire handlers into the hook system. Only registers callbacks for
   * lifecycle methods where at least one handler overrides the default.
   */
  register(hookRegistry: HookRegistry): void {
    for (const [method, eventType] of EVENT_MAP) {
      if (this._handlers.some((h) => h[method] !== InterventionHandler.prototype[method])) {
        hookRegistry.addCallback(eventType, (event) => this._dispatch(event, method))
      }
    }
  }

  /**
   * Iterate handlers in registration order and resolve the winning action.
   *
   * - Deny / Interrupt short-circuit immediately (remaining handlers are skipped).
   * - Guide feedback strings accumulate across handlers and are applied at the end.
   * - If a handler throws, behavior depends on {@link InterventionHandler.onError}:
   *   `'throw'` (default) rethrows, `'deny'` fails closed, `'proceed'` skips.
   *
   * Transform (modify content in-place) is planned but blocked on mutable event
   * content fields (#906).
   */
  private async _dispatch(event: HookableEvent, method: LifecycleMethod): Promise<void> {
    const guides: string[] = []
    const apply = this._getApplier(event, method)

    for (const handler of this._handlers) {
      if (handler[method] === InterventionHandler.prototype[method]) continue

      let action: InterventionAction | undefined
      try {
        // Safe: register() only wires each method to its matching event type,
        // so the event is always the correct type for the method being called.
        action = await handler[method](event as never)
      } catch (error) {
        action = this._handleError(handler, method, error)
        if (!action) continue
      }

      this._log(handler.name, method, action)

      if (action.type === 'guide') {
        guides.push(`[${handler.name}] ${action.feedback}`)
      } else if (apply(action, handler.name)) {
        return
      }
    }

    // Guide feedback accumulates across handlers, applied after all have run.
    if (guides.length > 0) {
      apply({ type: 'guide', feedback: guides.join('\n') }, '')
    }
  }

  /**
   * Returns a function that applies a single action to the event.
   * Returns true if the action short-circuits (deny/interrupt), false otherwise.
   */
  private _getApplier(event: HookableEvent, method: LifecycleMethod): (action: InterventionAction, handlerName: string) => boolean {
    if (event instanceof BeforeToolCallEvent) {
      return (action, handlerName) => {
        switch (action.type) {
          case 'deny':
            event.cancel = `DENIED: ${action.reason}`
            return true
          case 'interrupt':
            // Uses event.cancel as a workaround until native interrupt/resume
            // support lands. See: https://github.com/strands-agents/sdk-typescript/issues/94
            event.cancel = `REQUIRES APPROVAL: ${action.prompt}`
            return true
          case 'guide':
            event.cancel = `GUIDANCE: ${action.feedback}`
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${(action as InterventionAction).type} has no effect on this event type`)
            return false
        }
      }
    }

    if (event instanceof AfterModelCallEvent) {
      return (action, handlerName) => {
        switch (action.type) {
          case 'guide':
            event.retry = true
            // Direct push bypasses MessageAddedEvent and conversation manager, so this
            // message won't trigger context management and could push the context over
            // the limit. LocalAgent doesn't expose a message-append method that goes
            // through the hook pipeline. This matches what plugins can do today.
            event.agent.messages.push(new Message({ role: 'user', content: [new TextBlock(action.feedback)] }))
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${action.type} has no effect on this event type`)
            return false
        }
      }
    }

    // Fallback for future event types not yet handled above
    return (action, handlerName) => {
      if (action.type !== 'proceed') {
        logger.warn(`handler=<${handlerName}>, event=<${method}> | ${action.type} has no effect on this event type`)
      }
      return false
    }
  }

  /**
   * Handle a handler error based on its onError policy.
   * Returns an action to apply, or undefined to skip the handler.
   * For 'proceed', logs immediately since the caller will skip. For 'deny',
   * returns the action without logging — the caller logs it with the normal path.
   */
  private _handleError(handler: InterventionHandler, method: string, error: unknown): InterventionAction | undefined {
    const errorMsg = error instanceof Error ? error.message : String(error)

    if (handler.onError === 'throw') {
      throw error
    } else if (handler.onError === 'deny') {
      return { type: 'deny', reason: `Handler threw: ${errorMsg}` }
    } else {
      this._log(handler.name, method, { type: 'proceed', reason: `Handler threw: ${errorMsg}` })
      return undefined
    }
  }

  private _log(handlerName: string, method: string, action: InterventionAction): void {
    let detail: string
    switch (action.type) {
      case 'proceed':
        detail = action.reason ?? ''
        break
      case 'deny':
        detail = action.reason
        break
      case 'guide':
        detail = action.feedback
        break
      case 'interrupt':
        detail = action.prompt
        break
    }

    this._auditLog.push({
      handler: handlerName,
      eventType: method,
      actionType: action.type.toUpperCase(),
      detail,
      timestamp: new Date().toISOString(),
    })
  }
}
