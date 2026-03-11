import type { Agent, InvokeArgs, InvokeOptions } from '../agent/agent.js'
import { takeSnapshot, loadSnapshot } from '../agent/snapshot.js'
import type { MultiAgentStreamEvent } from './events.js'
import { NodeStreamUpdateEvent, NodeResultEvent } from './events.js'
import { NodeResult, Status } from './state.js'
import type { MultiAgentState, NodeResultUpdate } from './state.js'
import type { MultiAgentBase } from './base.js'
import { logger } from '../logging/logger.js'

/**
 * Known node type identifiers with extensibility for custom nodes.
 */
export type NodeType = 'agentNode' | 'multiAgentNode' | (string & {})

/**
 * Configuration for a node execution.
 */
export interface NodeConfig {
  /**
   * Optional description of what this node does.
   */
  description?: string
}

/**
 * Abstract base class for all multi-agent orchestration nodes.
 *
 * Uses the template method pattern: {@link stream} handles orchestration
 * boilerplate (duration measurement, status tracking, error capture) and
 * delegates to {@link handle} for node-specific execution logic.
 */
export abstract class Node {
  readonly type: string = 'node'
  /** Unique identifier for this node within the orchestration. */
  readonly id: string
  /** Per-node configuration. */
  readonly config: NodeConfig

  /**
   * @param id - Unique identifier for this node within the orchestration
   * @param config - Per-node configuration
   */
  constructor(id: string, config: NodeConfig) {
    this.id = id
    this.config = config
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
    const nodeState = state.node(this.id)!
    nodeState.status = Status.EXECUTING
    nodeState.startTime = Date.now()

    let result: NodeResult
    try {
      const update = yield* this.handle(args, state)
      result = new NodeResult({
        nodeId: this.id,
        status: Status.COMPLETED,
        duration: Date.now() - nodeState.startTime,
        content: [],
        ...update,
      })
    } catch (error) {
      result = new NodeResult({
        nodeId: this.id,
        status: Status.FAILED,
        duration: Date.now() - nodeState.startTime,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      logger.warn(`node_id=<${this.id}>, error=<${result.error?.message}> | node execution failed`)
    } finally {
      nodeState.status = result!.status
      nodeState.results.push(result!)
    }

    yield new NodeResultEvent({ nodeId: this.id, nodeType: this.type, result })
    return result
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
 * Options for creating an {@link AgentNode}.
 */
export interface AgentNodeOptions {
  /** The agent to wrap as a node. */
  agent: Agent
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

  constructor(options: AgentNodeOptions) {
    const { agent, ...config } = options

    super(agent.agentId, {
      ...config,
      ...(agent.description !== undefined && { description: agent.description }),
    })

    this._agent = agent
  }

  get agent(): Agent {
    return this._agent
  }

  /**
   * Executes the wrapped agent, yielding each agent streaming event
   * wrapped in a {@link NodeStreamUpdateEvent}.
   *
   * @param args - Input to pass to the agent
   * @param state - The current multi-agent state
   * @returns Async generator yielding streaming events and returning the agent's content blocks
   */
  async *handle(
    args: InvokeArgs,
    state: MultiAgentState
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    const snapshot = takeSnapshot(this._agent, { include: ['messages', 'state'] })
    try {
      const options: InvokeOptions = {
        ...(state.structuredOutputSchema && { structuredOutputSchema: state.structuredOutputSchema }),
      }

      const gen = this._agent.stream(args, options)
      let next = await gen.next()
      while (!next.done) {
        yield new NodeStreamUpdateEvent({ nodeId: this.id, nodeType: this.type, event: next.value })
        next = await gen.next()
      }

      return {
        content: next.value.lastMessage.content,
        ...('structuredOutput' in next.value && { structuredOutput: next.value.structuredOutput }),
      }
    } finally {
      loadSnapshot(this._agent, snapshot)
    }
  }
}

/**
 * Options for creating a {@link MultiAgentNode}.
 */
export interface MultiAgentNodeOptions extends NodeConfig {
  /** The orchestrator to wrap as a node. */
  orchestrator: MultiAgentBase
}

/**
 * Node that wraps a multi-agent orchestrator (e.g. Graph) for nested composition.
 *
 * Inner {@link NodeStreamUpdateEvent}s pass through to preserve the original
 * node's identity. All other events are wrapped in a new {@link NodeStreamUpdateEvent}
 * tagged with this node's identity.
 */
export class MultiAgentNode extends Node {
  readonly type = 'multiAgentNode' as const
  private readonly _orchestrator: MultiAgentBase

  constructor(options: MultiAgentNodeOptions) {
    const { orchestrator, ...config } = options
    super(orchestrator.id, config)
    this._orchestrator = orchestrator
  }

  get orchestrator(): MultiAgentBase {
    return this._orchestrator
  }

  /**
   * Executes the wrapped orchestrator. Inner {@link NodeStreamUpdateEvent}s
   * pass through as-is; all other events are wrapped in a new
   * {@link NodeStreamUpdateEvent} tagged with this node's identity.
   *
   * @param args - Input to pass to the orchestrator
   * @param _state - The current multi-agent state (unused)
   * @returns Async generator yielding streaming events and returning the orchestrator's content
   */
  async *handle(
    args: InvokeArgs,
    _state: MultiAgentState
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    const gen = this._orchestrator.stream(args)
    let next = await gen.next()
    while (!next.done) {
      const event = next.value
      if (event.type === 'nodeStreamUpdateEvent') {
        yield event
      } else {
        yield new NodeStreamUpdateEvent({ nodeId: this.id, nodeType: this.type, event })
      }
      next = await gen.next()
    }
    return { content: next.value.content }
  }
}

/**
 * A node definition accepted by orchestration constructors.
 *
 * Pass an {@link Agent} or {@link MultiAgentBase} directly for the simple case,
 * use typed options objects for per-node configuration, or provide pre-built
 * {@link Node} instances for full control.
 */
export type NodeDefinition =
  | Agent
  | MultiAgentBase
  | Node
  | (AgentNodeOptions & { type: 'agent' })
  | (MultiAgentNodeOptions & { type: 'multiAgent' })
