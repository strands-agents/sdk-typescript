import { Agent } from '../agent/agent.js'
import type { InvokeOptions, InvokableAgent, AgentStreamEvent } from '../types/agent.js'
import type { MultiAgentInput } from './multiagent.js'
import { takeSnapshot, loadSnapshot } from '../agent/snapshot.js'
import type { MultiAgentStreamEvent } from './events.js'
import { NodeStreamUpdateEvent, NodeResultEvent } from './events.js'
import { NodeResult, Status } from './state.js'
import type { MultiAgentState, NodeResultUpdate } from './state.js'
import type { MultiAgent } from './multiagent.js'
import { logger } from '../logging/logger.js'
import type { z } from 'zod'
import { normalizeError } from '../errors.js'

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
 * Per-invocation options passed from the orchestrator to a node.
 */
export interface NodeInputOptions {
  /**
   * Structured output schema for this node invocation.
   */
  structuredOutputSchema?: z.ZodSchema
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
   * @param input - Input to pass to the node (string or content blocks)
   * @param state - The current multi-agent state
   * @param options - Per-invocation options from the orchestrator
   * @returns Async generator yielding streaming events and returning a NodeResult
   */
  async *stream(
    input: MultiAgentInput,
    state: MultiAgentState,
    options?: NodeInputOptions
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResult, undefined> {
    const nodeState = state.node(this.id)!
    nodeState.status = Status.EXECUTING
    nodeState.startTime = Date.now()

    let result: NodeResult
    try {
      const update = yield* this.handle(input, state, options)
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
        error: normalizeError(error),
      })
      logger.warn(`node_id=<${this.id}>, error=<${result.error?.message}> | node execution failed`)
    } finally {
      nodeState.status = result!.status
      nodeState.results.push(result!)
    }

    yield new NodeResultEvent({ nodeId: this.id, nodeType: this.type, state, result })
    return result
  }

  /**
   * Node-specific execution logic implemented by subclasses.
   *
   * @param input - Input to process (string or content blocks)
   * @param state - The current multi-agent state
   * @param options - Per-invocation options from the orchestrator
   * @returns Async generator yielding streaming events and returning a partial result
   */
  abstract handle(
    input: MultiAgentInput,
    state: MultiAgentState,
    options?: NodeInputOptions
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined>
}

/**
 * Options for creating an {@link AgentNode}.
 */
export interface AgentNodeOptions {
  /** The agent to wrap as a node. */
  agent: InvokableAgent
}

/**
 * Node that wraps an {@link InvokableAgent} instance for multi-agent orchestration.
 *
 * Each execution is isolated. When the wrapped agent is an {@link Agent} instance,
 * its internal state is snapshot/restored so it remains unchanged after the node completes.
 */
export class AgentNode extends Node {
  readonly type = 'agentNode' as const
  private readonly _agent: InvokableAgent

  constructor(options: AgentNodeOptions) {
    const { agent, ...config } = options

    super(agent.id, {
      ...config,
      ...(agent.description !== undefined && { description: agent.description }),
    })

    this._agent = agent
  }

  get agent(): InvokableAgent {
    return this._agent
  }

  /**
   * Executes the wrapped agent, yielding each agent streaming event
   * wrapped in a {@link NodeStreamUpdateEvent}.
   *
   * @param input - Input to pass to the agent
   * @param state - The current multi-agent state
   * @param options - Per-invocation options from the orchestrator
   * @returns Async generator yielding streaming events and returning the agent's content blocks
   */
  async *handle(
    input: MultiAgentInput,
    state: MultiAgentState,
    options?: NodeInputOptions
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    // Only Agent instances support snapshot/restore for state isolation
    const snapshot =
      this._agent instanceof Agent ? takeSnapshot(this._agent, { include: ['messages', 'state'] }) : undefined
    try {
      const invokeOptions: InvokeOptions = {
        ...(options?.structuredOutputSchema && { structuredOutputSchema: options.structuredOutputSchema }),
      }

      const gen = this._agent.stream(input, invokeOptions)
      let next = await gen.next()
      while (!next.done) {
        yield new NodeStreamUpdateEvent({
          nodeId: this.id,
          nodeType: this.type,
          state,
          inner:
            this._agent instanceof Agent
              ? { source: 'agent', event: next.value as AgentStreamEvent }
              : { source: 'custom', event: next.value },
        })
        next = await gen.next()
      }

      return {
        content: next.value.lastMessage.content,
        ...('structuredOutput' in next.value && { structuredOutput: next.value.structuredOutput }),
        ...(next.value.metrics?.accumulatedUsage && { usage: next.value.metrics.accumulatedUsage }),
      }
    } finally {
      if (snapshot) {
        loadSnapshot(this._agent as Agent, snapshot)
      }
    }
  }
}

/**
 * Options for creating a {@link MultiAgentNode}.
 */
export interface MultiAgentNodeOptions extends NodeConfig {
  /** The orchestrator to wrap as a node. */
  orchestrator: MultiAgent
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
  private readonly _orchestrator: MultiAgent

  constructor(options: MultiAgentNodeOptions) {
    const { orchestrator, ...config } = options
    super(orchestrator.id, config)
    this._orchestrator = orchestrator
  }

  get orchestrator(): MultiAgent {
    return this._orchestrator
  }

  /**
   * Executes the wrapped orchestrator. Inner {@link NodeStreamUpdateEvent}s
   * pass through as-is; all other events are wrapped in a new
   * {@link NodeStreamUpdateEvent} tagged with this node's identity.
   *
   * @param input - Input to pass to the orchestrator
   * @param state - The current multi-agent state
   * @param _options - Per-invocation options (unused by orchestrator nodes)
   * @returns Async generator yielding streaming events and returning the orchestrator's content
   */
  async *handle(
    input: MultiAgentInput,
    state: MultiAgentState,
    _options?: NodeInputOptions
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    const gen = this._orchestrator.stream(input)
    let next = await gen.next()
    while (!next.done) {
      const event = next.value
      if (event.type === 'nodeStreamUpdateEvent') {
        yield event
      } else {
        yield new NodeStreamUpdateEvent({
          nodeId: this.id,
          nodeType: this.type,
          state,
          inner: { source: 'multiAgent', event },
        })
      }
      next = await gen.next()
    }
    const innerResult = next.value
    return {
      content: innerResult.content,
      usage: innerResult.usage,
      ...(innerResult.status !== Status.COMPLETED && { status: innerResult.status }),
      ...(innerResult.error && { error: innerResult.error }),
    }
  }
}

/**
 * A node definition accepted by orchestration constructors.
 *
 * Pass an {@link InvokableAgent} or {@link MultiAgent} directly for the simple case,
 * use typed options objects for per-node configuration, or provide pre-built
 * {@link Node} instances for full control.
 */
export type NodeDefinition = InvokableAgent | MultiAgent | Node | AgentNodeOptions | MultiAgentNodeOptions
