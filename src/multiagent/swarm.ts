import { logger } from '../logging/logger.js'
import type { AttributeValue, Span } from '@opentelemetry/api'
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
import { Tracer } from '../telemetry/tracer.js'
import { normalizeError } from '../errors.js'

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
  /** Custom trace attributes to include on all spans. */
  traceAttributes?: Record<string, AttributeValue>
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
  private readonly _tracer: Tracer
  readonly start: AgentNode
  private _initialized: boolean

  constructor(options: SwarmOptions) {
    const { id, nodes, start, plugins, traceAttributes, ...config } = options

    this.id = id ?? 'swarm'

    this.config = {
      maxSteps: config.maxSteps ?? Infinity,
    }
    this._validateConfig()

    this.nodes = this._resolveNodes(nodes)
    this.start = this._resolveStart(start)

    this._hookRegistry = new HookRegistryImplementation()
    this._pluginRegistry = new MultiAgentPluginRegistry(plugins)
    this._tracer = new Tracer(traceAttributes)
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

    const multiAgentSpan = this._tracer.startMultiAgentSpan({
      orchestratorId: this.id,
      orchestratorType: 'swarm',
      input,
    })

    yield new BeforeMultiAgentInvocationEvent({ orchestrator: this, state })

    // Resume: if state was restored from a snapshot, derive the next node from the last handoff
    const resumeNode = this._findResumeNode(state)
    let node = resumeNode?.node ?? this.start
    let handoff: HandoffResult | undefined = resumeNode?.lastHandoff
    let caughtError: Error | undefined
    let result: MultiAgentResult | undefined

    try {
      while (state.steps < this.config.maxSteps) {
        state.steps++

        // Execute current node
        const nodeResult = yield* this._streamNode(node, input, state, handoff, multiAgentSpan)
        handoff = nodeResult.structuredOutput as HandoffResult | undefined
        state.results.push(nodeResult)

        // Check for terminal conditions
        if (nodeResult.status === Status.FAILED || !handoff?.agentId) {
          break
        }

        // Hand off to next agent
        const target = this.nodes.get(handoff.agentId)!
        yield new MultiAgentHandoffEvent({ source: node.id, targets: [target.id], state })
        logger.debug(`source=<${node.id}>, target=<${target.id}> | swarm handoff`)
        node = target
      }

      this._checkSteps(state, handoff)

      result = new MultiAgentResult({
        results: state.results,
        content: this._resolveContent(state),
        duration: Date.now() - state.startTime,
      })
    } catch (error) {
      caughtError = normalizeError(error)
      throw caughtError
    } finally {
      this._tracer.endMultiAgentSpan(multiAgentSpan, {
        duration: Date.now() - state.startTime,
        ...(result && { usage: result.usage }),
        ...(caughtError && { error: caughtError }),
      })

      yield new AfterMultiAgentInvocationEvent({ orchestrator: this, state })
    }

    yield new MultiAgentResultEvent({ result })
    return result
  }

  private async *_streamNode(
    node: AgentNode,
    input: MultiAgentInput,
    state: MultiAgentState,
    handoff: HandoffResult | undefined,
    multiAgentSpan: Span | null
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResult, undefined> {
    const nodeState = state.node(node.id)!
    const handoffSchema = this._buildHandoffSchema(node.id)
    const nodeSpan = this._tracer.withSpanContext(multiAgentSpan, () =>
      this._tracer.startNodeSpan({ nodeId: node.id, nodeType: node.type })
    )

    const beforeEvent = new BeforeNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
    yield beforeEvent

    if (beforeEvent.cancel) {
      const message = typeof beforeEvent.cancel === 'string' ? beforeEvent.cancel : 'node cancelled by hook'
      const result = new NodeResult({ nodeId: node.id, status: Status.CANCELLED, duration: 0 })
      nodeState.status = Status.CANCELLED
      nodeState.results.push(result)
      yield new NodeCancelEvent({ nodeId: node.id, state, message })
      yield new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
      this._tracer.endNodeSpan(nodeSpan, { status: Status.CANCELLED, duration: 0 })
      return result
    }

    const nodeInput = this._resolveNodeInput(input, handoff)

    try {
      const gen = this._tracer.withSpanContext(nodeSpan, () =>
        node.stream(nodeInput, state, { structuredOutputSchema: handoffSchema })
      )
      let next = await this._tracer.withSpanContext(nodeSpan, () => gen.next())
      while (!next.done) {
        yield next.value
        next = await this._tracer.withSpanContext(nodeSpan, () => gen.next())
      }

      const result = next.value
      this._tracer.endNodeSpan(nodeSpan, { status: result.status, duration: result.duration, usage: result.usage })

      yield new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
      return result
    } catch (error) {
      const nodeError = normalizeError(error)
      this._tracer.endNodeSpan(nodeSpan, { error: nodeError })

      yield new AfterNodeCallEvent({
        orchestrator: this,
        state,
        nodeId: node.id,
        error: nodeError,
      })
      throw nodeError
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

    const handoff = last.structuredOutput as HandoffResult | undefined
    if (handoff?.message) {
      return [new TextBlock(handoff.message)]
    }

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

  /**
   * Checks whether the swarm has exceeded its step limit with work still pending.
   *
   * This is only an error when the loop exhausted its step budget while the last agent
   * still requested a handoff (i.e. there was more work to do). If the swarm completed
   * normally on its final allowed step (no pending handoff), no error is thrown.
   *
   * @param state - Current swarm execution state
   * @param handoff - The last handoff result from the most recent agent execution
   * @throws Error when step limit is reached with a pending handoff
   */
  private _checkSteps(state: MultiAgentState, handoff?: HandoffResult): void {
    if (handoff?.agentId && state.steps >= this.config.maxSteps) {
      throw new Error(`max_steps=<${this.config.maxSteps}> | swarm reached step limit`)
    }
  }

  /**
   * Finds the next node to execute from a restored {@link MultiAgentState}.
   *
   * When the session manager restores state from a snapshot, `state.results`
   * contains results from the previous invocation. The last result's structured
   * output contains the handoff decision — if it has an `agentId`, that is the
   * node the previous run intended to hand off to but never executed (e.g. due
   * to a crash). We resume from that handoff target.
   *
   * If the last result has no `agentId`, the previous run completed normally
   * and there is nothing to resume.
   *
   * @returns The handoff target node and its handoff context, or `undefined` for a fresh start
   */
  private _findResumeNode(state: MultiAgentState): { node: AgentNode; lastHandoff: HandoffResult } | undefined {
    if (state.results.length === 0) return undefined

    const lastResult = state.results[state.results.length - 1]!
    const lastNodeHandoff = lastResult.structuredOutput as HandoffResult | undefined
    if (!lastNodeHandoff?.agentId) return undefined

    const nextNode = this.nodes.get(lastNodeHandoff.agentId)
    if (!nextNode) {
      logger.warn(`node_id=<${lastNodeHandoff.agentId}> | resume target not found in swarm, starting fresh`)
      return undefined
    }

    logger.debug(`node_id=<${nextNode.id}>, prior_steps=<${state.steps}> | resuming swarm from restored state`)
    return { node: nextNode, lastHandoff: lastNodeHandoff }
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
