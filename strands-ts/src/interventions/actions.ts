import type {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
} from '../hooks/events.js'

export type LifecycleEvent =
  | BeforeInvocationEvent
  | BeforeToolCallEvent
  | AfterToolCallEvent
  | BeforeModelCallEvent
  | AfterModelCallEvent

/**
 * Allow the operation to continue unchanged.
 *
 * @example
 * ```typescript
 * return { type: 'proceed' }
 * ```
 */
export type Proceed = { type: 'proceed'; reason?: string }

/**
 * Block the operation. On Before* events, sets event.cancel. On afterToolCall,
 * sets event.retry = false.
 *
 * @example
 * ```typescript
 * override beforeToolCall(event: BeforeToolCallEvent): InterventionAction {
 *   if (!this.isAuthorized(event.agent.appState.get('user_id'), event.toolUse.name)) {
 *     return { type: 'deny', reason: 'User not authorized for this tool' }
 *   }
 *   return { type: 'proceed' }
 * }
 * ```
 */
export type Deny = { type: 'deny'; reason: string }

/**
 * Provide feedback to steer behavior. On beforeToolCall/beforeInvocation, sets
 * event.cancel so the model sees the feedback and adjusts. On beforeModelCall,
 * injects feedback as a user message so the model sees it on this call.
 * On afterModelCall, the response is discarded and the model retries with the
 * feedback injected as a user message.
 *
 * @example
 * ```typescript
 * override afterModelCall(event: AfterModelCallEvent): InterventionAction {
 *   if (this.isTooVague(event.stopData?.message)) {
 *     return { type: 'guide', feedback: 'Be more specific in your response.' }
 *   }
 *   return { type: 'proceed' }
 * }
 * ```
 */
export type Guide = { type: 'guide'; feedback: string; reason?: string }

/**
 * Pause for human approval. Currently uses event.cancel as a workaround —
 * native pause/resume is planned (https://github.com/strands-agents/sdk-typescript/issues/94).
 *
 * @example
 * ```typescript
 * override beforeToolCall(event: BeforeToolCallEvent): InterventionAction {
 *   if (this.requiresApproval(event.toolUse.name)) {
 *     return { type: 'interrupt', prompt: `Approve ${event.toolUse.name}?` }
 *   }
 *   return { type: 'proceed' }
 * }
 * ```
 */
export type Interrupt = { type: 'interrupt'; prompt: string; reason?: string }

/**
 * Modify event content in-place. The `apply` function mutates the event before
 * execution proceeds. Later handlers in the pipeline see the transformed content.
 *
 * The handler already has the typed event from its lifecycle method, so `apply`
 * can close over it directly — no cast needed:
 *
 * @example
 * ```typescript
 * override beforeToolCall(event: BeforeToolCallEvent): InterventionAction {
 *   const redacted = redactPII(event.toolUse.input)
 *   return {
 *     type: 'transform',
 *     apply: () => { event.toolUse.input = redacted },
 *     reason: 'PII redacted from tool input',
 *   }
 * }
 * ```
 */
export type Transform = { type: 'transform'; apply: (event: LifecycleEvent) => void; reason?: string }

/**
 * Union of all intervention actions a handler can return.
 *
 * | Action    | beforeInvocation | beforeToolCall | beforeModelCall | afterToolCall | afterModelCall |
 * |-----------|------------------|----------------|-----------------|---------------|----------------|
 * | Proceed   | —                | —              | —               | —             | —              |
 * | Deny      | cancel           | cancel         | cancel          | —             | —              |
 * | Guide     | cancel+          | cancel+        | inject          | —             | inject + retry |
 * | Interrupt | cancel           | cancel         | cancel          | —             | —              |
 * | Transform | apply            | apply          | apply           | apply         | apply          |
 *
 * — = no-op (logged in audit trail, warns at runtime)
 * cancel = sets event.cancel, short-circuits (remaining handlers skipped)
 * cancel+ = sets event.cancel with accumulated feedback from all guiding handlers
 * inject = appends accumulated feedback as a user message so the model sees it on this call
 * inject + retry = appends accumulated feedback and retries so the model sees guidance
 * apply = calls action.apply(event) for in-place mutation, later handlers see the change
 */
export type InterventionAction = Proceed | Deny | Guide | Interrupt | Transform
