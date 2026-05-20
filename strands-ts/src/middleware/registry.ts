import type { Stage, MiddlewareHandler, MiddlewareNext } from './types.js'

/**
 * Registry that stores middleware handlers keyed by stage tokens
 * and composes them into execution chains.
 */
export class MiddlewareRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _handlers: Map<Stage<any, any, any>, MiddlewareHandler<any, any, any>[]>

  constructor() {
    this._handlers = new Map()
  }

  /**
   * Register a middleware handler for a given stage.
   * Handlers are stored in registration order (first registered = outermost).
   *
   * @param stage - The stage token to register the handler for
   * @param handler - The middleware handler function
   */
  add<TContext, TEvent, TResult>(
    stage: Stage<TContext, TEvent, TResult>,
    handler: MiddlewareHandler<TContext, TEvent, TResult>,
  ): void {
    const handlers = this._handlers.get(stage) ?? []
    handlers.push(handler)
    this._handlers.set(stage, handlers)
  }

  /**
   * Compose all registered handlers for a stage into a single middleware chain.
   * The chain executes handlers in registration order (first registered = outermost)
   * with the terminal function as the innermost layer.
   *
   * @param stage - The stage token to compose handlers for
   * @param terminal - The innermost function that performs actual stage execution
   * @returns A single function representing the full middleware chain
   */
  compose<TContext, TEvent, TResult>(
    stage: Stage<TContext, TEvent, TResult>,
    terminal: MiddlewareNext<TContext, TEvent, TResult>,
  ): MiddlewareNext<TContext, TEvent, TResult> {
    const handlers = (this._handlers.get(stage) ?? []) as MiddlewareHandler<TContext, TEvent, TResult>[]

    let current: MiddlewareNext<TContext, TEvent, TResult> = terminal
    for (let i = handlers.length - 1; i >= 0; i--) {
      const handler = handlers[i]!
      const next = current
      current = (context: TContext): AsyncGenerator<TEvent, TResult, undefined> => handler(context, next)
    }

    return current
  }

  /**
   * Compose and invoke the middleware chain for a stage in one call.
   * Equivalent to `compose(stage, terminal)(context)` but reads more clearly at call sites.
   *
   * @param stage - The stage token to invoke
   * @param context - The context to pass into the chain
   * @param terminal - The innermost function that performs actual stage execution
   * @returns An async generator yielding events and returning the stage result
   */
  invoke<TContext, TEvent, TResult>(
    stage: Stage<TContext, TEvent, TResult>,
    context: TContext,
    terminal: MiddlewareNext<TContext, TEvent, TResult>,
  ): AsyncGenerator<TEvent, TResult, undefined> {
    const chain = this.compose(stage, terminal)
    return chain(context)
  }
}
