import {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  type HookableEvent,
} from '../hooks/events.js'
import type { HookRegistry } from '../hooks/registry.js'
import { HookOrder } from '../hooks/types.js'
import type { HookableEventConstructor } from '../hooks/types.js'
import { Message, TextBlock } from '../types/messages.js'
import type { Guide, InterventionAction } from './actions.js'
import { InterventionHandler } from './handler.js'
import { logger } from '../logging/logger.js'

type LifecycleMethod = 'beforeInvocation' | 'beforeToolCall' | 'afterToolCall' | 'beforeModelCall' | 'afterModelCall'

// Before* events: interventions run last (closest to execution, highest order).
const BEFORE_EVENTS: ReadonlyArray<[LifecycleMethod, HookableEventConstructor]> = [
  ['beforeInvocation', BeforeInvocationEvent],
  ['beforeToolCall', BeforeToolCallEvent],
  ['beforeModelCall', BeforeModelCallEvent],
]

// After* events: interventions run first (closest to execution, lowest order).
const AFTER_EVENTS: ReadonlyArray<[LifecycleMethod, HookableEventConstructor]> = [
  ['afterToolCall', AfterToolCallEvent],
  ['afterModelCall', AfterModelCallEvent],
]

/**
 * Bridges {@link InterventionHandler} instances and the Strands hook system.
 *
 * Registers one hook callback per lifecycle event type, then dispatches to
 * all handlers that override that method — in registration order, with
 * short-circuiting on Deny/Interrupt and accumulation for Guide.
 *
 * See {@link InterventionAction} for the action-to-event compatibility matrix.
 */
export class InterventionRegistry {
  private readonly _handlers: InterventionHandler[]

  constructor(handlers: InterventionHandler[], hookRegistry: HookRegistry) {
    const seen = new Set<string>()
    for (const h of handlers) {
      if (seen.has(h.name)) {
        throw new Error(`Duplicate intervention handler name: '${h.name}'`)
      }
      seen.add(h.name)
    }
    this._handlers = handlers
    this._registerHooks(hookRegistry)
  }

  private _registerHooks(hookRegistry: HookRegistry): void {
    for (const [method, eventType] of BEFORE_EVENTS) {
      if (this._handlers.some((h) => h[method] !== InterventionHandler.prototype[method])) {
        hookRegistry.addCallback(eventType, (event) => this._dispatch(event, method), {
          order: HookOrder.INTERVENTIONS_BEFORE,
        })
      }
    }
    for (const [method, eventType] of AFTER_EVENTS) {
      if (this._handlers.some((h) => h[method] !== InterventionHandler.prototype[method])) {
        hookRegistry.addCallback(eventType, (event) => this._dispatch(event, method), {
          order: HookOrder.INTERVENTIONS_AFTER,
        })
      }
    }
  }

  /**
   * Iterate handlers in registration order and resolve the winning action.
   *
   * - Deny / Interrupt short-circuit immediately (remaining handlers are skipped).
   * - Guide feedback strings accumulate across handlers and are applied at the end.
   * - Transform is applied in-place so later handlers see the mutation.
   * - If a handler throws, behavior depends on {@link InterventionHandler.onError}:
   *   `'throw'` (default) rethrows, `'deny'` fails closed, `'proceed'` skips.
   */
  private async _dispatch(event: HookableEvent, method: LifecycleMethod): Promise<void> {
    logger.debug(`event=<${method}> | dispatching to ${this._handlers.length} handler(s)`)
    const guides: Array<{ handlerName: string; action: Guide }> = []
    const apply = this._getApplier(event, method)

    for (const handler of this._handlers) {
      if (handler[method] === InterventionHandler.prototype[method]) continue

      logger.debug(`handler=<${handler.name}>, event=<${method}> | evaluating`)

      let action: InterventionAction | undefined
      try {
        // Safe: _registerHooks() only wires each method to its matching event type,
        // so the event is always the correct type for the method being called.
        action = await handler[method](event as never)
      } catch (error) {
        action = this._handleError(handler, method, error)
        if (!action) continue
      }

      logger.debug(`handler=<${handler.name}>, event=<${method}> | returned ${action.type}`)

      if (action.type === 'guide') {
        guides.push({ handlerName: handler.name, action })
      } else {
        try {
          if (apply(action, handler.name)) {
            logger.debug(`handler=<${handler.name}>, event=<${method}> | short-circuited`)
            return
          }
        } catch (error) {
          const errorAction = this._handleError(handler, method, error)
          if (errorAction) {
            if (apply(errorAction, handler.name)) {
              return
            }
          }
        }
      }
    }

    // Guide feedback accumulates across handlers. Only logged and applied if
    // no earlier handler short-circuited (deny/interrupt).
    if (guides.length > 0) {
      logger.debug(`event=<${method}> | applying accumulated guide from ${guides.length} handler(s)`)
      const feedback = guides.map((g) => `[${g.handlerName}] ${g.action.feedback}`).join('\n')
      apply({ type: 'guide', feedback }, '')
    }
  }

  /**
   * Returns a function that applies a single action to the event.
   * Returns true if the action short-circuits (deny/interrupt), false otherwise.
   */
  private _getApplier(
    event: HookableEvent,
    method: LifecycleMethod
  ): (action: InterventionAction, handlerName: string) => boolean {
    // beforeToolCall: supports all actions including native interrupt
    if (event instanceof BeforeToolCallEvent) {
      return (action, handlerName) => {
        const actionType = action.type
        switch (actionType) {
          case 'deny':
            event.cancel = `DENIED: ${action.reason}`
            return true
          case 'interrupt':
            event.interrupt({ name: handlerName, reason: action.prompt })
            return true
          case 'guide':
            event.cancel = `GUIDANCE: ${action.feedback}`
            return false
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${actionType} has no effect on this event type`)
            return false
        }
      }
    }

    // beforeInvocation: cancel-based (does not implement Interruptible)
    if (event instanceof BeforeInvocationEvent) {
      return (action, handlerName) => {
        const actionType = action.type
        switch (actionType) {
          case 'deny':
            event.cancel = `DENIED: ${action.reason}`
            return true
          case 'guide':
            event.cancel = `GUIDANCE: ${action.feedback}`
            return false
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${actionType} has no effect on this event type`)
            return false
        }
      }
    }

    // beforeModelCall: Guide injects feedback as a user message so the model sees
    // it on this call, rather than cancelling (which would end the invocation).
    if (event instanceof BeforeModelCallEvent) {
      return (action, handlerName) => {
        switch (action.type) {
          case 'deny':
            event.cancel = `DENIED: ${action.reason}`
            return true
          case 'guide':
            // Direct push bypasses MessageAddedEvent and conversation manager.
            // This matches what plugins can do today via event.agent.messages.
            event.agent.messages.push(new Message({ role: 'user', content: [new TextBlock(action.feedback)] }))
            return false
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(
              `handler=<${handlerName}>, event=<${method}> | ${(action as InterventionAction).type} has no effect on this event type`
            )
            return false
        }
      }
    }

    // afterToolCall: tool already ran, only Transform (e.g. redact result) is meaningful
    if (event instanceof AfterToolCallEvent) {
      return (action, handlerName) => {
        switch (action.type) {
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${action.type} has no effect on this event type`)
            return false
        }
      }
    }

    // afterModelCall: has retry
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
          case 'transform':
            action.apply(event)
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

  private _handleError(handler: InterventionHandler, method: string, error: unknown): InterventionAction | undefined {
    const errorMsg = error instanceof Error ? error.message : String(error)

    if (handler.onError === 'throw') {
      throw error
    } else if (handler.onError === 'deny') {
      return { type: 'deny', reason: `Handler threw: ${errorMsg}` }
    } else {
      return undefined
    }
  }
}
