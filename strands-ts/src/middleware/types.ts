/**
 * A stage token that identifies a middleware interception point.
 * Stages are created via `createStage()` and carry their Context/Event/Result types
 * as generics, enabling full type inference at registration sites.
 *
 * Third parties can create custom stages — the SDK does not maintain a closed set.
 */
export interface Stage<TContext, TEvent, TResult> {
  /** Human-readable name for debugging and logging. */
  readonly name: string
  /** @internal Phantom field for type inference. Never accessed at runtime. */
  readonly _types?: { context: TContext; event: TEvent; result: TResult }
}

/**
 * The `next` function passed to middleware.
 * Returns an async generator that yields events of type TEvent and returns the stage result.
 * Middleware can choose not to call `next` to short-circuit execution.
 */
export type MiddlewareNext<TContext, TEvent, TResult> = (
  context: TContext
) => AsyncGenerator<TEvent, TResult, undefined>

/**
 * A middleware handler function.
 * Receives the context and a `next` function to call the next layer.
 * Must be an async generator that yields TEvent and returns TResult.
 * Middleware can yield its own events, forward events from next, or suppress them.
 */
export type MiddlewareHandler<TContext, TEvent, TResult> = (
  context: TContext,
  next: MiddlewareNext<TContext, TEvent, TResult>
) => AsyncGenerator<TEvent, TResult, undefined>

/**
 * Extracts the `MiddlewareHandler` type from a stage token.
 * Use this to type middleware methods or properties without repeating the generic parameters.
 *
 * @example
 * ```typescript
 * class MyPlugin implements Plugin {
 *   private _handler: HandlerOf<typeof InvokeModelStage> = async function* (context, next) { ... }
 * }
 * ```
 */
export type HandlerOf<S> = S extends Stage<infer C, infer E, infer R> ? MiddlewareHandler<C, E, R> : never

/**
 * Extracts the `MiddlewareNext` type from a stage token.
 * Use this to type the `next` parameter in standalone middleware methods.
 *
 * @example
 * ```typescript
 * private async *_handler(context: ..., next: NextOf<typeof AgentStreamStage>) { ... }
 * ```
 */
export type NextOf<S> = S extends Stage<infer C, infer E, infer R> ? MiddlewareNext<C, E, R> : never
