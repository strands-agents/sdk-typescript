import type { Agent, InvokeArgs } from '../agent/agent.js'
import { takeSnapshot, loadSnapshot } from '../agent/snapshot.js'
import type { MultiAgentStreamEvent } from './events.js'
import { NodeStreamUpdateEvent } from './events.js'
import { MultiAgentState, NodeResult, Status } from './state.js'
import type { NodeResultUpdate } from './state.js'

/**
 * Configuration for a node execution.
 */
export interface NodeConfig {
  /**
   * Maximum execution time for this node in milliseconds.
   */
  timeout?: number
}

/**
 * Abstract base class for all multi-agent orchestration nodes.
 *
 * Uses the template method pattern: {@link stream} handles orchestration
 * boilerplate (duration measurement, status tracking, error capture) and
 * delegates to {@link handle} for node-specific execution logic.
 */
export abstract class Node {
  /** Unique identifier for this node within the orchestration. */
  readonly id: string
  /** Optional per-node configuration. */
  readonly config?: NodeConfig

  /**
   * @param id - Unique identifier for this node within the orchestration
   * @param config - Optional per-node configuration
   */
  constructor(id: string, config?: NodeConfig) {
    this.id = id
    if (config) this.config = config
  }

  /**
   * Execute the node. Handles duration measurement, error capture,
   * and delegates to handle() for node-specific logic.
   *
   * @param args - Input to pass to the node (string, content blocks, or messages)
   * @param state - The current multi-agent state
   * @returns Async generator yielding streaming events and returning a NodeResult
   */
  async *stream(
    args: InvokeArgs,
    state: MultiAgentState
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResult, undefined> {
    const startTime = Date.now()
    try {
      const update = yield* this.handle(args, state)
      return new NodeResult({
        nodeId: this.id,
        status: Status.COMPLETED,
        duration: Date.now() - startTime,
        content: [],
        ...update,
      })
    } catch (error) {
      return new NodeResult({
        nodeId: this.id,
        status: Status.FAILED,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error : new Error(String(error)),
        content: [],
      })
    }
  }

  /**
   * Node-specific execution logic implemented by subclasses.
   *
   * @param args - Input to process (string, content blocks, or messages)
   * @param state - The current multi-agent state
   * @returns Async generator yielding streaming events and returning a partial result
   */
  abstract handle(
    args: InvokeArgs,
    state: MultiAgentState
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>
}

/**
 * Node that wraps an Agent instance for multi-agent orchestration.
 *
 * Each execution is isolated — the wrapped agent's internal state
 * is unchanged after the node completes.
 */
export class AgentNode extends Node {
  readonly type = 'agentNode' as const
  private readonly _agent: Agent

  /**
   * @param id - Unique identifier for this node within the orchestration
   * @param agent - The Agent instance to wrap
   * @param config - Optional per-node configuration
   */
  constructor(id: string, agent: Agent, config?: NodeConfig) {
    super(id, config)
    this._agent = agent
  }

  get agent(): Agent {
    return this._agent
  }

  /**
   * Executes the wrapped agent, yielding each agent streaming event
   * wrapped in a {@link MultiAgentNodeStreamEvent}.
   *
   * @param args - Input to pass to the agent
   * @param state - The current multi-agent state (unused by AgentNode)
   * @returns Async generator yielding streaming events and returning the agent's content blocks
   */
  async *handle(
    args: InvokeArgs,
    _state: MultiAgentState
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    const snapshot = takeSnapshot(this._agent, { include: ['messages', 'state'] })
    try {
      const gen = this._agent.stream(args)
      let next = await gen.next()
      while (!next.done) {
        yield new NodeStreamUpdateEvent({ nodeId: this.id, nodeType: this.type, event: next.value })
        next = await gen.next()
      }
      return { content: next.value.lastMessage.content }
    } finally {
      loadSnapshot(this._agent, snapshot)
    }
  }
}
