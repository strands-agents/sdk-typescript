import { logger } from '../logging/logger.js'
import { Agent } from '../agent/agent.js'
import type { InvokeArgs } from '../agent/agent.js'
import { z } from 'zod'
import { HookableEvent } from '../hooks/events.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import type { HookProvider } from '../hooks/types.js'
import type { ContentBlock } from '../types/messages.js'
import { TextBlock } from '../types/messages.js'
import type { AgentNodeOptions } from './nodes.js'
import { AgentNode } from './nodes.js'
import { MultiAgentState, MultiAgentResult, NodeResult, Status } from './state.js'
import type { MultiAgentBase } from './base.js'
import type { MultiAgentStreamEvent } from './events.js'
import {
  AfterMultiAgentInvocationEvent,
  AfterNodeCallEvent,
  BeforeMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  MultiAgentHandoffEvent,
  MultiAgentInitializedEvent,
  MultiAgentResultEvent,
  NodeCancelEvent,
} from './events.js'

/**
 * Runtime configuration for swarm execution.
 */
export interface SwarmConfig {
  /** Max total agent executions (including start). Defaults to Infinity. */
  maxSteps?: number
  /** Total execution timeout in milliseconds. Defaults to Infinity. */
  timeout?: number
  /** Per-agent execution timeout in milliseconds. Defaults to Infinity. */
  nodeTimeout?: number
}

/**
 * Structured output each agent produces to decide the next step.
 *
 * When `agentId` is provided, the swarm hands off to that agent with
 * `message` as input. When omitted, `message` becomes the final response.
 */
interface HandoffResult {
  /** Agent id to hand off to. Omit to end the swarm and return `message` as the final response. */
  agentId?: string
  /** Instructions for the next agent, or the final response if no handoff. */
  message: string
  /** Structured data to pass to the next agent. Serialized as a JSON text block alongside the handoff message. */
  context?: Record<string, unknown>
}

/**
 * Options for creating a Swarm instance.
 */
/**
 * Input type for swarm nodes. Pass an {@link Agent} directly for the simple case,
 * or {@link AgentNodeOptions} when per-node configuration (e.g. timeout) is needed.
 */
export type SwarmNodeDefinition = Agent | AgentNodeOptions

export interface SwarmOptions extends SwarmConfig {
  /** Unique identifier. Defaults to `'swarm'`. */
  id?: string
  /** Swarm agents. Pass agents directly or use {@link AgentNodeOptions} for per-node config. */
  nodes: SwarmNodeDefinition[]
  /** Agent id that receives the initial input. */
  start: string
  /** Hook providers for event-driven extensibility. */
  hooks?: HookProvider[]
}

/**
 * Swarm multi-agent orchestration pattern.
 *
 * Executes agents sequentially with structured output handoffs.
 * Each agent decides whether to hand off to another agent or produce
 * a final response via structured output containing `agentId` and `message`.
 */
export class Swarm implements MultiAgentBase {
  readonly id: string
  readonly hooks: HookRegistryImplementation
  private readonly _nodes: Map<string, AgentNode>
  private readonly _start: AgentNode
  private readonly _handoffSchema: z.ZodType<HandoffResult>
  private readonly _config: Required<SwarmConfig>
  private _initialized: boolean

  constructor(options: SwarmOptions) {
    const { id, nodes, start, hooks, ...config } = options

    this.id = id ?? 'swarm'

    this._config = {
      maxSteps: Infinity,
      timeout: Infinity,
      nodeTimeout: Infinity,
      ...config,
    }
    this._validateConfig()

    this._nodes = this._resolveNodes(nodes)
    this._start = this._resolveStart(start)

    this._handoffSchema = this._buildHandoffSchema()

    this.hooks = new HookRegistryImplementation()
    this.hooks.addAllHooks(hooks ?? [])
    this._initialized = false
  }

  /**
   * Initialize the swarm. Invokes the {@link MultiAgentInitializedEvent} callback.
   * Called automatically on first invocation.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return
    await this.hooks.invokeCallbacks(new MultiAgentInitializedEvent({ orchestrator: this }))
    this._initialized = true
  }

  /**
   * Invoke swarm and return final result (consumes stream).
   *
   * @param input - The input to pass to the start agent
   * @returns Promise resolving to the final MultiAgentResult
   */
  async invoke(input: InvokeArgs): Promise<MultiAgentResult> {
    const gen = this.stream(input)
    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }
    return next.value
  }

  /**
   * Stream swarm execution, yielding events as agents execute.
   * Invokes hook callbacks for each event before yielding.
   *
   * @param input - The input to pass to the start agent
   * @returns Async generator yielding streaming events and returning a MultiAgentResult
   */
  async *stream(input: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    await this.initialize()

    const gen = this._stream(input)
    let next = await gen.next()
    while (!next.done) {
      if (next.value instanceof HookableEvent) {
        await this.hooks.invokeCallbacks(next.value)
      }
      yield next.value
      next = await gen.next()
    }
    return next.value
  }

  private async *_stream(input: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    const state = new MultiAgentState({
      nodeIds: [...this._nodes.keys()],
      structuredOutputSchema: this._handoffSchema,
    })

    yield new BeforeMultiAgentInvocationEvent({ orchestrator: this, state })

    let node = this._start
    let handoff: HandoffResult | undefined

    try {
      while (state.steps < this._config.maxSteps) {
        this._checkTimeout(state)
        state.steps++

        // Execute current node
        const result = yield* this._streamNode(node, input, state, handoff)
        handoff = result.structuredOutput as HandoffResult | undefined
        state.results.push(result)

        // Check for terminal conditions
        if (result.status === Status.FAILED || !handoff?.agentId) {
          break
        }

        // Hand off to next agent
        const target = this._nodes.get(handoff.agentId)!
        yield new MultiAgentHandoffEvent({ source: node.id, targets: [target.id] })
        logger.debug(`source=<${node.id}>, target=<${target.id}> | swarm handoff`)
        node = target
      }
    } finally {
      yield new AfterMultiAgentInvocationEvent({ orchestrator: this, state })
    }

    const result = new MultiAgentResult({
      results: state.results,
      content: this._resolveContent(state),
      duration: Date.now() - state.startTime,
      ...(state.steps >= this._config.maxSteps &&
        handoff?.agentId && {
          status: Status.FAILED,
          error: new Error(`max_steps=<${this._config.maxSteps}> | swarm reached step limit without completing`),
        }),
    })
    yield new MultiAgentResultEvent({ result })
    return result
  }

  private async *_streamNode(
    node: AgentNode,
    input: InvokeArgs,
    state: MultiAgentState,
    handoff?: HandoffResult
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResult, undefined> {
    const nodeState = state.node(node.id)!

    const beforeEvent = new BeforeNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
    yield beforeEvent

    if (beforeEvent.cancel) {
      const message = typeof beforeEvent.cancel === 'string' ? beforeEvent.cancel : 'node cancelled by hook'
      const result = new NodeResult({ nodeId: node.id, status: Status.CANCELLED, duration: 0 })
      nodeState.status = Status.CANCELLED
      nodeState.results.push(result)
      yield new NodeCancelEvent({ nodeId: node.id, message })
      yield new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
      return result
    }

    const nodeInput = this._buildNodeInput(input, handoff)

    try {
      const gen = node.stream(nodeInput, state)
      let next = await gen.next()
      while (!next.done) {
        this._checkNodeTimeout(node, state)
        yield next.value
        next = await gen.next()
      }

      yield new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
      return next.value
    } catch (error) {
      yield new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
      throw error
    }
  }

  private _validateConfig(): void {
    if (this._config.maxSteps < 1) {
      throw new Error(`max_steps=<${this._config.maxSteps}> | must be at least 1`)
    }
    if (this._config.timeout < 1) {
      throw new Error(`timeout=<${this._config.timeout}> | must be at least 1`)
    }
    if (this._config.nodeTimeout < 1) {
      throw new Error(`node_timeout=<${this._config.nodeTimeout}> | must be at least 1`)
    }
  }

  private _resolveNodes(definitions: SwarmNodeDefinition[]): Map<string, AgentNode> {
    const nodes = new Map<string, AgentNode>()
    for (const definition of definitions) {
      const node = definition instanceof Agent ? new AgentNode({ agent: definition }) : new AgentNode(definition)
      if (nodes.has(node.id)) {
        throw new Error(`agent_id=<${node.id}> | duplicate agent id`)
      }
      nodes.set(node.id, node)
    }
    return nodes
  }

  private _resolveStart(start: string): AgentNode {
    const node = this._nodes.get(start)
    if (!node) {
      throw new Error(`start=<${start}> | start references unknown agent`)
    }
    return node
  }

  private _resolveContent(state: MultiAgentState): ContentBlock[] {
    const last = state.results[state.results.length - 1]!
    state.node(last.nodeId)!.terminus = true
    return [...last.content]
  }

  private _checkTimeout(state: MultiAgentState): void {
    if (Date.now() - state.startTime >= this._config.timeout) {
      throw new Error('swarm execution timed out')
    }
  }

  private _checkNodeTimeout(node: AgentNode, state: MultiAgentState): void {
    const timeout = node.config.timeout ?? this._config.nodeTimeout
    const nodeState = state.node(node.id)!
    if (Date.now() - nodeState.startTime >= timeout) {
      throw new Error(`agent_id=<${node.id}> | agent timed out`)
    }
  }

  private _buildNodeInput(input: InvokeArgs, handoff?: HandoffResult): InvokeArgs {
    if (!handoff) return input

    const blocks: ContentBlock[] = [new TextBlock(handoff.message)]
    if (handoff.context) {
      blocks.push(new TextBlock('Context:\n' + JSON.stringify(handoff.context, null, 2)))
    }
    return blocks
  }

  private _buildHandoffSchema(): z.ZodType<HandoffResult> {
    const agentIds = [...this._nodes.keys()]
    const agentDescriptions = agentIds
      .map((id) => {
        const desc = this._nodes.get(id)!.config.description
        return desc ? `- ${id}: ${desc}` : `- ${id}`
      })
      .join('\n')

    return z
      .object({
        agentId: z
          .enum(agentIds as [string, ...string[]])
          .optional()
          .describe(
            `Target agent to hand off to. Omit to end the conversation.\n\nAvailable agents:\n${agentDescriptions}`
          ),
        message: z.string().describe('Instructions for the next agent, or the final response if no handoff.'),
        context: z.record(z.string(), z.unknown()).optional().describe('Structured data to pass to the next agent.'),
      })
      .describe('Decide whether to hand off to another agent or produce a final response.') as z.ZodType<HandoffResult>
  }
}
