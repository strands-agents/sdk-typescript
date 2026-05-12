/**
 * A2A executor that bridges a Strands Agent into the A2A protocol.
 *
 * Implements the AgentExecutor interface from `@a2a-js/sdk/server` to allow
 * a Strands Agent to handle A2A JSON-RPC requests. Supports the full A2A
 * task lifecycle including `completed`, `failed`, `input-required`, and
 * `canceled` states.
 */

import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server'
import type { AgentExecutor } from '@a2a-js/sdk/server'
import { A2AError } from '@a2a-js/sdk/server'
import type { Part } from '@a2a-js/sdk'
import type { InvokableAgent } from '../types/agent.js'
import { ModelStreamUpdateEvent, ContentBlockEvent } from '../hooks/events.js'
import { contentBlocksToParts, partsToContentBlocks } from './adapters.js'
import { CancelledError, normalizeError } from '../errors.js'
import { logger } from '../logging/logger.js'

/**
 * Bridges a Strands Agent into the A2A protocol as an AgentExecutor.
 *
 * Converts A2A message parts to Strands content blocks, streams the agent
 * execution, and publishes text deltas as artifact updates through the A2A
 * event bus. Text chunks are appended to a single artifact as they arrive,
 * implementing A2A-compliant streaming behavior.
 *
 * ## Task Lifecycle States
 *
 * The executor maps agent execution outcomes to A2A task states:
 * - **completed** — Agent finished successfully with `stopReason: 'endTurn'`
 * - **failed** — Agent threw an error during execution
 * - **input-required** — Agent returned with `stopReason: 'interrupt'`
 * - **canceled** — Task was canceled via `cancelTask()` or agent was cancelled
 *
 * ## Invocation state
 *
 * The executor populates the agent's `invocationState` with the incoming A2A
 * {@link RequestContext} under the reserved key `a2aRequestContext`. Hooks and
 * tools running inside the agent can read `event.invocationState.a2aRequestContext`
 * to correlate with the A2A request (taskId, contextId, user message metadata)
 * for logging, metrics, or audit.
 *
 * Because the A2A framework (not user code) drives `execute()`, there is no
 * per-request path for the user to supply their own `invocationState`. If a
 * user hook writes to the `a2aRequestContext` key, it will be overwritten on
 * the next request.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { A2AExecutor } from '@strands-agents/sdk/a2a'
 *
 * const agent = new Agent({ model: 'my-model' })
 * const executor = new A2AExecutor(agent)
 * ```
 */
export class A2AExecutor implements AgentExecutor {
  private _agent: InvokableAgent
  private _runningTasks: Map<string, AbortController> = new Map()

  /**
   * Creates a new A2AExecutor.
   *
   * @param agent - The agent to execute for incoming A2A requests
   */
  constructor(agent: InvokableAgent) {
    this._agent = agent
  }

  /**
   * Executes the agent in response to an A2A message.
   *
   * Converts A2A message parts to Strands content blocks, then streams the
   * agent execution. Text deltas are streamed incrementally into a single
   * artifact; non-text content blocks (images, videos, documents) are each
   * published as separate complete artifacts. A final artifact with
   * `lastChunk: true` signals the end of the text artifact.
   *
   * The final task state depends on the agent's execution outcome:
   * - Normal completion → `completed`
   * - Agent interrupts (needs human input) → `input-required`
   * - Agent throws an error → `failed`
   * - Agent was cancelled → `canceled`
   *
   * @param context - The A2A request context containing the user message
   * @param eventBus - The event bus for publishing A2A artifact and status events
   */
  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId, userMessage } = context
    const contentBlocks = partsToContentBlocks(userMessage.parts)
    if (contentBlocks.length === 0) {
      throw A2AError.invalidRequest('No content blocks available')
    }

    // Publish initial task event to register the task with the ResultManager.
    // Without this, artifact and status events are ignored as "unknown task".
    eventBus.publish({ kind: 'task', id: taskId, contextId, status: { state: 'working' } })

    const artifactId = globalThis.crypto.randomUUID()
    let isFirstChunk = true

    // Create an AbortController for this task so cancelTask() can signal cancellation
    const abortController = new AbortController()
    this._runningTasks.set(taskId, abortController)

    try {
      // Forward the A2A RequestContext to the agent under a reserved key so
      // hooks and tools can correlate with the A2A request (taskId, contextId,
      // user message metadata).
      const stream = this._agent.stream(contentBlocks, {
        invocationState: { a2aRequestContext: context },
        cancelSignal: abortController.signal,
      })
      let next = await stream.next()

      while (!next.done) {
        const event = next.value

        // Stream text deltas incrementally into the text artifact
        if (
          event instanceof ModelStreamUpdateEvent &&
          event.event.type === 'modelContentBlockDeltaEvent' &&
          event.event.delta.type === 'textDelta'
        ) {
          eventBus.publish({
            kind: 'artifact-update',
            taskId,
            contextId,
            artifact: {
              artifactId,
              parts: [{ kind: 'text', text: event.event.delta.text }],
            },
            append: !isFirstChunk,
          })
          isFirstChunk = false
        }

        // Publish non-text content blocks (images, videos, documents) as separate artifacts
        if (event instanceof ContentBlockEvent && event.contentBlock.type !== 'textBlock') {
          const parts = contentBlocksToParts([event.contentBlock])
          if (parts.length > 0) {
            eventBus.publish({
              kind: 'artifact-update',
              taskId,
              contextId,
              artifact: { artifactId: globalThis.crypto.randomUUID(), parts },
              append: false,
              lastChunk: true,
            })
          }
        }

        next = await stream.next()
      }

      // The stream is done — next.value is the AgentResult
      const result = next.value

      // Publish final artifact chunk to signal end of artifact
      eventBus.publish({
        kind: 'artifact-update',
        taskId,
        contextId,
        artifact: {
          artifactId,
          // If no deltas were streamed, publish the full result; otherwise empty to close the artifact
          parts: [{ kind: 'text', text: isFirstChunk && result ? result.toString() : '' }],
        },
        append: !isFirstChunk, // false for new artifact, true to append to streamed chunks
        lastChunk: true, // Always true — this runs after the stream loop ends
      })

      // Determine final task state based on agent result
      if (result.stopReason === 'interrupt') {
        // Agent needs human input — transition to input-required
        const interruptParts: Part[] = []
        if (result.interrupts && result.interrupts.length > 0) {
          const interruptText = result.interrupts.map((i) => `[${i.name}]: ${i.reason ?? 'Input required'}`).join('\n')
          interruptParts.push({ kind: 'text', text: interruptText })
        } else {
          interruptParts.push({ kind: 'text', text: 'Agent requires additional input' })
        }
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'input-required',
            message: {
              kind: 'message',
              messageId: globalThis.crypto.randomUUID(),
              role: 'agent',
              parts: interruptParts,
            },
          },
          final: true,
        })
      } else if (result.stopReason === 'cancelled') {
        // Agent was cancelled cooperatively
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: { state: 'canceled' },
          final: true,
        })
      } else {
        // Normal completion (endTurn, maxTokens, etc.)
        eventBus.publish({ kind: 'status-update', taskId, contextId, status: { state: 'completed' }, final: true })
      }
    } catch (error) {
      if (error instanceof CancelledError) {
        // Agent cancellation via CancelledError — transition to canceled
        logger.debug(`task_id=<${taskId}> | agent execution cancelled`)
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: { state: 'canceled' },
          final: true,
        })
      } else {
        // Agent execution failed — transition to failed state
        logger.error(`task_id=<${taskId}> | agent execution failed`, normalizeError(error))
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'failed',
            message: {
              kind: 'message',
              messageId: globalThis.crypto.randomUUID(),
              role: 'agent',
              parts: [{ kind: 'text', text: 'Agent execution failed' }],
            },
          },
          final: true,
        })
      }
    } finally {
      this._runningTasks.delete(taskId)
    }
  }

  /**
   * Cancels a running task by signaling the agent to stop.
   *
   * Uses cooperative cancellation via AbortController. The agent will stop
   * at the next cancellation checkpoint and the task transitions to `canceled`.
   * If the task is not currently running, throws A2AError.taskNotCancelable.
   *
   * @param taskId - The ID of the task to cancel
   * @param eventBus - The event bus for publishing status events
   */
  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    const abortController = this._runningTasks.get(taskId)
    if (!abortController) {
      throw A2AError.taskNotCancelable(taskId)
    }

    // Signal cancellation — the agent will stop at the next checkpoint
    abortController.abort()
    logger.debug(`task_id=<${taskId}> | cancel signal sent`)

    // Note: The execute() method handles publishing the 'canceled' status
    // when it detects the CancelledError or cancelled stopReason.
  }
}
