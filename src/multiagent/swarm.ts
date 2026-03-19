import { logger } from '../logging/logger.js'
import type { InvokableAgent } from '../types/agent.js'
import type { MultiAgentInput } from './multiagent.js'
import { z } from 'zod'
import { HookableEvent } from '../hooks/events.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import type { HookCallback, HookableEventConstructor, HookCleanup } from '../hooks/types.js'
import type { MultiAgentPlugin } from './plugins.js'
import { MultiAgentPluginRegistry } from './plugins.js'
import type { ContentBlock } from '../types/messages.js'
import { TextBlock } from '../types/messages.js'
import type { AgentNodeOptions } from './nodes.js'
import { AgentNode } from './nodes.js'
import { MultiAgentState, MultiAgentResult, NodeResult, Status } from './state.js'
import type { MultiAgent } from './multiagent.js'
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
 * Input type for swarm nodes. Pass an {@link InvokableAgent} directly for the simple case,
 * or {@link AgentNodeOptions} for per-node config.
 */
export type SwarmNodeDefinition = InvokableAgent | AgentNodeOptions

export interface SwarmOptions extends SwarmConfig {
  /** Unique identifier. Defaults to `'swarm'`. */
  id?: string
  /** Swarm agents. Pass agents directly or use {@link AgentNodeOptions} for per-node config. */
  nodes: SwarmNodeDefinition[]
  /** Agent id that receives the initial input. Defaults to the first agent in `nodes`. */
  start?: string
  /** Plugins for event-driven extensibility. */
  plugins?: MultiAgentPlugin[]
}

/**
 * Swarm multi-agent orchestration pattern.
 *
 * Agents execute sequentially, each deciding whether to hand off to another agent or
 * produce a final response. Routing is driven by structured output: each agent receives
 * a Zod schema with `agentId`, `message`, and optional `context` fields. When `agentId`
 * is present, the swarm hands off to that agent with `message` as input. When omitted,
 * `message` becomes the final response.
 *
 * Key design choices vs the Python SDK:
 * - Handoffs use structured output rather than an injected `handoff_to_agent` tool.
 *   Routing logic stays in the orchestrator, not inside tool callbacks.
 * - Context is passed as serialized JSON text blocks rather than a mutable SharedContext.
 * - A single `maxSteps` limit replaces Python's separate `max_handoffs`/`max_iterations`.
 * - Agent descriptions are embedded in the structured output schema for routing decisions.
 * - Exceeding `maxSteps` throws an exception. Python returns a FAILED result.
 *
 * @example
 * ```typescript
 * const swarm = new Swarm({
 *   nodes: [researcher, writer],
 *   start: 'researcher',
 *   maxSteps: 10,
 * })
 *
 * const result = await swarm.invoke('Explain quantum computing')
 * ```
 */
export class Swarm implements MultiAgent {
  readonly id: string
  readonly nodes: ReadonlyMap<string, AgentNode>
  readonly config: Required<SwarmConfig>
  private readonly _pluginRegistry: MultiAgentPluginRegistry
  private readonly _hookRegistry: HookRegistryImplementation
  readonly start: AgentNode
  private _initialized: boolean

  constructor(options: SwarmOptions) {
    const { id, nodes, start, plugins, ...config } = options

    this.id = id ?? 'swarm'

    this.config = {
      maxSteps: config.maxSteps ?? Infinity,
    }
    this._validateConfig()

    this.nodes = this._resolveNodes(nodes)
    this.start = this._resolveStart(start)

    this._hookRegistry = new HookRegistryImplementation()
    this._pluginRegistry = new MultiAgentPluginRegistry(plugins)
    this._initialized = false
  }

  /**
   * Initialize the swarm. Invokes the {@link MultiAgentInitializedEvent} callback.
   * Called automatically on first invocation.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return
    await this._pluginRegistry.initialize(this)
    await this._hookRegistry.invokeCallbacks(new MultiAgentInitializedEvent({ orchestrator: this }))
    this._initialized = true
  }

  /**
   * Register a hook callback for a specific swarm event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   * @returns Cleanup function that removes the callback when invoked
   */
  addHook<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup {
    return this._hookRegistry.addCallback(eventType, callback)
  }

  /**
   * Invoke swarm and return final result (consumes stream).
   *
   * @param input - The input to pass to the start agent
   * @returns Promise resolving to the final MultiAgentResult
   */
  async invoke(input: MultiAgentInput): Promise<MultiAgentResult> {
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
  async *stream(input: MultiAgentInput): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    await this.initialize()

    const gen = this._stream(input)
    let next = await gen.next()
    while (!next.done) {
      if (next.value instanceof HookableEvent) {
        await this._hookRegistry.invokeCallbacks(next.value)
      }
      yield next.value
      next = await gen.next()
    }
    return next.value
  }

  private async *_stream(input: MultiAgentInput): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    const state = new MultiAgentState({
      nodeIds: [...this.nodes.keys()],
    })

    yield new BeforeMultiAgentInvocationEvent({ orchestrator: this, state })

    let node = this.start
    let handoff: HandoffResult | undefined

    try {
      while (state.steps < this.config.maxSteps) {
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
        const target = this.nodes.get(handoff.agentId)!
        yield new MultiAgentHandoffEvent({ source: node.id, targets: [target.id], state })
        logger.debug(`source=<${node.id}>, target=<${target.id}> | swarm handoff`)
        node = target
      }

      this._checkSteps(state)
    } finally {
      yield new AfterMultiAgentInvocationEvent({ orchestrator: this, state })
    }

    const result = new MultiAgentResult({
      results: state.results,
      content: this._resolveContent(state),
      duration: Date.now() - state.startTime,
    })
    yield new MultiAgentResultEvent({ result })
    return result
  }

  private async *_streamNode(
    node: AgentNode,
    input: MultiAgentInput,
    state: MultiAgentState,
    handoff?: HandoffResult
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResult, undefined> {
    const nodeState = state.node(node.id)!
    const handoffSchema = this._buildHandoffSchema(node.id)

    const beforeEvent = new BeforeNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
    yield beforeEvent

    if (beforeEvent.cancel) {
      const message = typeof beforeEvent.cancel === 'string' ? beforeEvent.cancel : 'node cancelled by hook'
      const result = new NodeResult({ nodeId: node.id, status: Status.CANCELLED, duration: 0 })
      nodeState.status = Status.CANCELLED
      nodeState.results.push(result)
      yield new NodeCancelEvent({ nodeId: node.id, state, message })
      yield new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
      return result
    }

    const nodeInput = this._resolveNodeInput(input, handoff)

    try {
      const gen = node.stream(nodeInput, state, { structuredOutputSchema: handoffSchema })
      let next = await gen.next()
      while (!next.done) {
        yield next.value
        next = await gen.next()
      }

      yield new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
      return next.value
    } catch (error) {
      yield new AfterNodeCallEvent({
        orchestrator: this,
        state,
        nodeId: node.id,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    }
  }

  private _validateConfig(): void {
    if (this.config.maxSteps < 1) {
      throw new Error(`max_steps=<${this.config.maxSteps}> | must be at least 1`)
    }
  }

  private _resolveNodes(definitions: SwarmNodeDefinition[]): Map<string, AgentNode> {
    if (definitions.length === 0) {
      throw new Error('nodes list is empty')
    }

    const nodes = new Map<string, AgentNode>()
    for (const definition of definitions) {
      const node = 'agent' in definition ? new AgentNode(definition) : new AgentNode({ agent: definition })
      if (nodes.has(node.id)) {
        throw new Error(`agent_id=<${node.id}> | duplicate agent id`)
      }
      nodes.set(node.id, node)
    }
    return nodes
  }

  private _resolveStart(start: string | undefined): AgentNode {
    if (start === undefined) {
      return this.nodes.values().next().value!
    }

    const node = this.nodes.get(start)
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

  private _resolveNodeInput(input: MultiAgentInput, handoff?: HandoffResult): MultiAgentInput {
    if (!handoff) return input

    const blocks: ContentBlock[] = [new TextBlock(handoff.message)]
    if (handoff.context) {
      blocks.push(new TextBlock('Context:\n' + JSON.stringify(handoff.context, null, 2)))
    }
    return blocks
  }

  private _checkSteps(state: MultiAgentState): void {
    if (state.steps >= this.config.maxSteps) {
      throw new Error(`max_steps=<${this.config.maxSteps}> | swarm reached step limit`)
    }
  }

  private _buildHandoffSchema(nodeId: string): z.ZodType<HandoffResult> {
    const handoffIds = [...this.nodes.keys()].filter((id) => id !== nodeId)
    const handoffDescriptions = handoffIds
      .map((id) => {
        const desc = this.nodes.get(id)!.config.description
        return desc ? `- ${id}: ${desc}` : `- ${id}`
      })
      .join('\n')

    return z
      .object({
        agentId:
          handoffIds.length > 0
            ? z
                .enum(handoffIds as [string, ...string[]])
                .optional()
                .describe(
                  `Target agent to hand off to. Omit to end the conversation.\n\nAvailable agents:\n${handoffDescriptions}`
                )
            : z.never().optional().describe('No other agents available. Omit this field to end the conversation.'),
        message: z.string().describe('Instructions for the next agent, or the final response if no handoff.'),
        context: z.record(z.string(), z.unknown()).optional().describe('Structured data to pass to the next agent.'),
      })
      .describe('Decide whether to hand off to another agent or produce a final response.') as z.ZodType<HandoffResult>
  }
}
