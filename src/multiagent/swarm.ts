/**
 * Swarm multi-agent pattern implementation.
 *
 * Provides a collaborative agent orchestration system where agents work together
 * as a team to solve complex tasks, with shared context and autonomous coordination.
 *
 * Key features:
 * - Self-organizing agent teams with shared working memory
 * - Tool-based coordination via handoff_to_agent
 * - Autonomous agent collaboration without central control
 * - Dynamic task distribution based on agent capabilities
 * - Human input via user interrupts raised in BeforeNodeCallEvent hooks and agent nodes
 */

import type { Span } from '@opentelemetry/api'
import type { Agent } from '../agent/agent.js'
import { getTracer } from '../telemetry/tracer.js'
import type { AgentStreamEvent } from '../types/agent.js'
import { AgentResult } from '../types/agent.js'
import { AgentState } from '../agent/state.js'
import type { ContentBlock, Message } from '../types/messages.js'
import { TextBlock } from '../types/messages.js'
import type { Usage, Metrics } from '../models/streaming.js'
import type { Interrupt } from '../interrupt.js'
import { InterruptState } from '../interrupt.js'
import type { HookProvider } from '../hooks/types.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import { FunctionTool } from '../tools/function-tool.js'
import { MultiAgentBase, MultiAgentResult, NodeResult, Status } from './base.js'
import type { MultiAgentInput, MultiAgentStreamEvent, MultiAgentInvokeOptions } from './types.js'
import {
  MultiAgentNodeStartEvent,
  MultiAgentNodeStopEvent,
  MultiAgentNodeInputEvent,
  MultiAgentNodeStreamEvent,
  MultiAgentHandoffEvent,
  MultiAgentNodeCancelEvent,
  MultiAgentNodeInterruptEvent,
  MultiAgentResultEvent,
} from './streaming-events.js'
import {
  MultiAgentInitializedEvent,
  BeforeMultiAgentInvocationEvent,
  AfterMultiAgentInvocationEvent,
  BeforeNodeCallEvent,
  AfterNodeCallEvent,
} from './hook-events.js'

const DEFAULT_SWARM_ID = 'default_swarm'

/**
 * Represents a node (Agent) in the swarm.
 */
export class SwarmNode {
  /**
   * Unique identifier for this node.
   */
  readonly nodeId: string

  /**
   * The Agent executor for this node.
   */
  readonly executor: Agent

  /**
   * Reference to the parent Swarm for interrupt state access.
   */
  readonly swarm: Swarm | undefined

  private readonly _initialMessages: readonly unknown[]
  private readonly _initialState: AgentState

  constructor(data: { nodeId: string; executor: Agent; swarm?: Swarm }) {
    this.nodeId = data.nodeId
    this.executor = data.executor
    this.swarm = data.swarm
    this._initialMessages = structuredClone(data.executor.messages)
    this._initialState = new AgentState(data.executor.state.getAll())
  }

  /**
   * Reset executor state to initial state when swarm was created.
   * If Swarm is resuming from an interrupt, restores from interrupt context.
   */
  resetExecutorState(): void {
    if (this.swarm && this.swarm._interruptState.activated) {
      const context = this.swarm._interruptState.context[this.nodeId] as {
        messages: Message[]
        state: Record<string, unknown>
        interruptState: ReturnType<InterruptState['toDict']>
      }
      if (context) {
        this.executor._restoreMessages(context.messages)
        this.executor._restoreState(context.state as Record<string, never>)
        this.executor._restoreInterruptState(InterruptState.fromDict(context.interruptState))
        return
      }
    }

    this.executor._restoreMessages(structuredClone(this._initialMessages) as Message[])
    this.executor._restoreState(this._initialState.getAll() as Record<string, never>)
  }
}

/**
 * Shared context between swarm nodes.
 */
export class SharedContext {
  /**
   * Context data keyed by node ID, then by context key.
   */
  readonly context: Record<string, Record<string, unknown>>

  constructor(initialContext?: Record<string, Record<string, unknown>>) {
    this.context = initialContext ?? {}
  }

  /**
   * Add context from a node.
   *
   * @param node - The node adding context
   * @param key - Context key (must be a non-empty string)
   * @param value - Context value (must be JSON serializable)
   */
  addContext(node: SwarmNode, key: string, value: unknown): void {
    if (key == null || typeof key !== 'string' || key.trim() === '') {
      throw new Error('Key must be a non-empty string')
    }

    // Validate JSON serializable
    try {
      JSON.stringify(value)
    } catch {
      throw new Error(
        `Value is not JSON serializable: ${typeof value}. Only JSON-compatible types (string, number, boolean, array, object, null) are allowed.`
      )
    }

    if (!(node.nodeId in this.context)) {
      this.context[node.nodeId] = {}
    }
    this.context[node.nodeId]![key] = value
  }
}

/**
 * Current state of swarm execution.
 */
export class SwarmState {
  /**
   * The agent currently executing.
   */
  currentNode: SwarmNode | undefined

  /**
   * The original task being executed.
   */
  task: MultiAgentInput

  /**
   * Current swarm execution status.
   */
  completionStatus: Status

  /**
   * Context shared between agents.
   */
  sharedContext: SharedContext

  /**
   * Complete history of agents that have executed.
   */
  nodeHistory: SwarmNode[]

  /**
   * When swarm execution began (epoch seconds).
   */
  startTime: number

  /**
   * Results from each agent execution.
   */
  results: Record<string, NodeResult>

  /**
   * Total token usage across all agents.
   */
  accumulatedUsage: Usage

  /**
   * Total metrics across all agents.
   */
  accumulatedMetrics: Metrics

  /**
   * Total execution time in milliseconds.
   */
  executionTime: number

  /**
   * The agent to execute next (set by handoff).
   */
  handoffNode: SwarmNode | undefined

  /**
   * Message passed during agent handoff.
   */
  handoffMessage: string | undefined

  constructor(data: { currentNode?: SwarmNode; task: MultiAgentInput; completionStatus?: Status }) {
    this.currentNode = data.currentNode
    this.task = data.task
    this.completionStatus = data.completionStatus ?? Status.PENDING
    this.sharedContext = new SharedContext()
    this.nodeHistory = []
    this.startTime = Date.now() / 1000
    this.results = {}
    this.accumulatedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    this.accumulatedMetrics = { latencyMs: 0 }
    this.executionTime = 0
    this.handoffNode = undefined
    this.handoffMessage = undefined
  }

  /**
   * Check if the swarm should continue executing.
   *
   * @returns Tuple of [shouldContinue, reason]
   */
  shouldContinue(limits: {
    maxHandoffs: number
    maxIterations: number
    executionTimeout: number
    repetitiveHandoffDetectionWindow: number
    repetitiveHandoffMinUniqueAgents: number
  }): [boolean, string] {
    if (this.nodeHistory.length >= limits.maxHandoffs) {
      return [false, `Max handoffs reached: ${limits.maxHandoffs}`]
    }

    if (this.nodeHistory.length >= limits.maxIterations) {
      return [false, `Max iterations reached: ${limits.maxIterations}`]
    }

    const elapsed = this.executionTime / 1000 + Date.now() / 1000 - this.startTime
    if (elapsed > limits.executionTimeout) {
      return [false, `Execution timed out: ${limits.executionTimeout}s`]
    }

    if (
      limits.repetitiveHandoffDetectionWindow > 0 &&
      this.nodeHistory.length >= limits.repetitiveHandoffDetectionWindow
    ) {
      const recent = this.nodeHistory.slice(-limits.repetitiveHandoffDetectionWindow)
      const uniqueNodes = new Set(recent.map((n) => n.nodeId)).size
      if (uniqueNodes < limits.repetitiveHandoffMinUniqueAgents) {
        return [
          false,
          `Repetitive handoff: ${uniqueNodes} unique nodes out of ${limits.repetitiveHandoffDetectionWindow} recent iterations`,
        ]
      }
    }

    return [true, 'Continuing']
  }
}

/**
 * Result from swarm execution — extends MultiAgentResult with swarm-specific details.
 */
export class SwarmResult extends MultiAgentResult {
  /**
   * Complete history of nodes that executed.
   */
  readonly nodeHistory: SwarmNode[]

  constructor(
    data: {
      status?: Status
      results?: Record<string, NodeResult>
      accumulatedUsage?: Usage
      accumulatedMetrics?: Metrics
      executionCount?: number
      executionTime?: number
      interrupts?: Interrupt[]
      nodeHistory?: SwarmNode[]
    } = {}
  ) {
    super(data)
    this.nodeHistory = data.nodeHistory ?? []
  }
}

/**
 * Swarm configuration options.
 */
export interface SwarmConfig {
  /**
   * List of Agent instances to include in the swarm.
   */
  nodes: Agent[]

  /**
   * Agent to start execution with. If undefined, uses the first agent.
   */
  entryPoint?: Agent

  /**
   * Maximum handoffs to agents (default: 20).
   */
  maxHandoffs?: number

  /**
   * Maximum node executions within the swarm (default: 20).
   */
  maxIterations?: number

  /**
   * Total execution timeout in seconds (default: 900).
   */
  executionTimeout?: number

  /**
   * Individual node timeout in seconds (default: 300).
   */
  nodeTimeout?: number

  /**
   * Number of recent nodes to check for repetitive handoffs. Disabled by default (0).
   */
  repetitiveHandoffDetectionWindow?: number

  /**
   * Minimum unique agents required in recent sequence. Disabled by default (0).
   */
  repetitiveHandoffMinUniqueAgents?: number

  /**
   * Hook providers for monitoring and extending execution behavior.
   */
  hooks?: HookProvider[]

  /**
   * Unique swarm id (default: "default_swarm").
   */
  id?: string
}

/**
 * Self-organizing collaborative agent teams with shared working memory.
 *
 * Swarm coordinates multiple agents to solve complex tasks through autonomous
 * handoffs. Each agent can pass control to another agent using the injected
 * `handoff_to_agent` tool, along with a message and shared context.
 *
 * @example
 * ```typescript
 * const researcher = new Agent({ model, name: 'researcher', systemPrompt: '...' })
 * const writer = new Agent({ model, name: 'writer', systemPrompt: '...' })
 *
 * const swarm = new Swarm({ nodes: [researcher, writer] })
 * const result = await swarm.invoke('Write a blog post about AI')
 * ```
 */
export class Swarm extends MultiAgentBase {
  readonly id: string

  /**
   * Swarm nodes keyed by node ID.
   */
  readonly nodes: Record<string, SwarmNode>

  /**
   * Shared context between nodes.
   */
  sharedContext: SharedContext

  /**
   * Current swarm execution state.
   */
  state: SwarmState

  /**
   * Hook registry for multiagent lifecycle events.
   */
  readonly hooks: HookRegistryImplementation

  /**
   * Interrupt state for human-in-the-loop workflows.
   * @internal
   */
  _interruptState: InterruptState

  private readonly _entryPoint: Agent | undefined
  private readonly _maxHandoffs: number
  private readonly _maxIterations: number
  private readonly _executionTimeout: number
  private readonly _nodeTimeout: number
  private readonly _repetitiveHandoffDetectionWindow: number
  private readonly _repetitiveHandoffMinUniqueAgents: number
  private _initialized: boolean
  private _resumeFromSession: boolean
  private _invocationOptions: MultiAgentInvokeOptions | undefined

  constructor(config: SwarmConfig) {
    super()
    this.id = config.id ?? DEFAULT_SWARM_ID
    this._entryPoint = config.entryPoint
    this._maxHandoffs = config.maxHandoffs ?? 20
    this._maxIterations = config.maxIterations ?? 20
    this._executionTimeout = config.executionTimeout ?? 900
    this._nodeTimeout = config.nodeTimeout ?? 300
    this._repetitiveHandoffDetectionWindow = config.repetitiveHandoffDetectionWindow ?? 0
    this._repetitiveHandoffMinUniqueAgents = config.repetitiveHandoffMinUniqueAgents ?? 0

    this.sharedContext = new SharedContext()
    this.nodes = {}
    this.state = new SwarmState({ task: '', completionStatus: Status.PENDING })
    this._interruptState = new InterruptState()
    this._initialized = false
    this._resumeFromSession = false

    this.hooks = new HookRegistryImplementation()
    if (config.hooks) {
      this.hooks.addAllHooks(config.hooks)
    }

    this._setupSwarm(config.nodes)
    this._injectSwarmTools()
  }

  /**
   * Stream events during swarm execution.
   *
   * @param task - The task to execute
   * @param options - Optional invocation options (e.g. invocationState passed to hooks and nodes)
   * @returns Async generator yielding streaming events and returning SwarmResult
   */
  async *stream(
    task: MultiAgentInput,
    options?: MultiAgentInvokeOptions
  ): AsyncGenerator<MultiAgentStreamEvent, SwarmResult> {
    if (!this._initialized) {
      this._initialized = true
      await this.hooks.invokeCallbacks(new MultiAgentInitializedEvent({ source: this }))
    }

    this._interruptState.resume(task)
    this._invocationOptions = options

    await this.hooks.invokeCallbacks(
      new BeforeMultiAgentInvocationEvent({
        source: this,
        ...(options?.invocationState !== undefined && { invocationState: options.invocationState }),
      })
    )

    const tracer = getTracer()
    const multiAgentSpan = tracer.startMultiAgentSpan({
      input: typeof task === 'string' ? task : Array.isArray(task) ? task : String(task),
      instanceName: this.id,
    })

    if (this._resumeFromSession || this._interruptState.activated) {
      this.state.completionStatus = Status.EXECUTING
      this.state.startTime = Date.now() / 1000
    } else {
      const initialNode = this._getInitialNode()
      this.state = new SwarmState({
        currentNode: initialNode,
        task,
        completionStatus: Status.EXECUTING,
      })
      this.state.sharedContext = this.sharedContext
    }

    let interrupts: Interrupt[] = []

    try {
      const gen = this._executeSwarm(multiAgentSpan)
      let next = await gen.next()
      while (!next.done) {
        const event = next.value
        if (event.type === 'multiAgentNodeInterruptEvent') {
          interrupts = (event as MultiAgentNodeInterruptEvent).interrupts
        }
        yield event
        next = await gen.next()
      }
    } catch (error) {
      this.state.completionStatus = Status.FAILED
      tracer.endMultiAgentSpan({
        span: multiAgentSpan,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    } finally {
      this.state.executionTime += Math.round((Date.now() / 1000 - this.state.startTime) * 1000)
      await this.hooks.invokeCallbacks(
        new AfterMultiAgentInvocationEvent({
          source: this,
          ...(this._invocationOptions?.invocationState !== undefined && {
            invocationState: this._invocationOptions.invocationState,
          }),
        })
      )
      this._resumeFromSession = false
      this._invocationOptions = undefined
    }

    const result = this._buildResult(interrupts)
    tracer.endMultiAgentSpan({ span: multiAgentSpan, result: result.toString() })
    yield new MultiAgentResultEvent({ result })
    return result
  }

  /**
   * Serialize the current swarm state for session persistence.
   *
   * @returns JSON-serializable state snapshot
   */
  serializeState(): Record<string, unknown> {
    let nextNodes: string[] = []

    if (
      (this.state.completionStatus === Status.EXECUTING || this.state.completionStatus === Status.INTERRUPTED) &&
      this.state.currentNode
    ) {
      nextNodes = [this.state.currentNode.nodeId]
    } else if (this.state.handoffNode) {
      nextNodes = [this.state.handoffNode.nodeId]
    }

    return {
      type: 'swarm',
      id: this.id,
      status: this.state.completionStatus,
      nodeHistory: this.state.nodeHistory.map((n) => n.nodeId),
      nodeResults: Object.fromEntries(Object.entries(this.state.results).map(([k, v]) => [k, v.toDict()])),
      nextNodesToExecute: nextNodes,
      currentTask: this.state.task,
      context: {
        sharedContext: this.state.sharedContext.context,
        handoffNode: this.state.handoffNode?.nodeId ?? null,
        handoffMessage: this.state.handoffMessage ?? null,
      },
      _internalState: {
        interruptState: this._interruptState.toDict(),
      },
    }
  }

  /**
   * Restore swarm state from a session dict and prepare for execution.
   *
   * @param payload - Previously serialized state data
   */
  deserializeState(payload: Record<string, unknown>): void {
    const internal = payload['_internalState'] as { interruptState: ReturnType<InterruptState['toDict']> } | undefined
    if (internal) {
      this._interruptState = InterruptState.fromDict(internal.interruptState)
    }

    this._resumeFromSession = 'nextNodesToExecute' in payload
    if (this._resumeFromSession) {
      this._fromDict(payload)
      return
    }

    for (const node of Object.values(this.nodes)) {
      node.resetExecutorState()
    }
    this.state = new SwarmState({ task: '', completionStatus: Status.PENDING })
  }

  private _setupSwarm(agents: Agent[]): void {
    this._validateSwarm(agents)

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]!
      let nodeId = agent.name
      if (!nodeId) {
        nodeId = `node_${i}`
      }

      if (nodeId in this.nodes) {
        throw new Error(`Node ID '${nodeId}' is not unique. Each agent must have a unique name.`)
      }

      this.nodes[nodeId] = new SwarmNode({ nodeId, executor: agent, swarm: this })
    }

    if (this._entryPoint !== undefined) {
      const entryPointId = this._entryPoint.name
      if (!(entryPointId in this.nodes) || this.nodes[entryPointId]!.executor !== this._entryPoint) {
        const available = Object.keys(this.nodes).join(', ')
        throw new Error(`Entry point agent not found in swarm nodes. Available agents: ${available}`)
      }
    }
  }

  private _validateSwarm(agents: Agent[]): void {
    const seenInstances = new Set<Agent>()
    for (const agent of agents) {
      if (seenInstances.has(agent)) {
        throw new Error('Duplicate node instance detected. Each node must have a unique object instance.')
      }
      seenInstances.add(agent)
    }
  }

  private _injectSwarmTools(): void {
    const handoffTool = this._createHandoffTool()

    for (const node of Object.values(this.nodes)) {
      const existingTool = node.executor.toolRegistry.find((t) => t.name === 'handoff_to_agent')
      if (existingTool) {
        throw new Error(
          `Agent '${node.nodeId}' already has a tool named 'handoff_to_agent' that conflicts with swarm coordination tools. Please rename this tool to avoid conflicts.`
        )
      }
      node.executor.toolRegistry.add(handoffTool)
    }
  }

  private _createHandoffTool(): FunctionTool {
    return new FunctionTool({
      name: 'handoff_to_agent',
      description: 'Transfer control to another agent in the swarm for specialized help.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: { type: 'string', description: 'Name of the agent to hand off to' },
          message: {
            type: 'string',
            description: 'Message explaining what needs to be done and why you are handing off',
          },
          context: {
            type: 'object',
            description: 'Additional context to share with the next agent',
          },
        },
        required: ['agent_name', 'message'],
      },
      callback: (input: unknown): { status: string; content: { text: string }[] } => {
        const params = input as { agent_name: string; message: string; context?: Record<string, unknown> }
        const targetNode = this.nodes[params.agent_name]
        if (!targetNode) {
          return { status: 'error', content: [{ text: `Error: Agent '${params.agent_name}' not found in swarm` }] }
        }

        this._handleHandoff(targetNode, params.message, params.context ?? {})
        return {
          status: 'success',
          content: [{ text: `Handing off to ${params.agent_name}: ${params.message}` }],
        }
      },
    })
  }

  private _handleHandoff(targetNode: SwarmNode, message: string, context: Record<string, unknown>): void {
    if (this.state.completionStatus !== Status.EXECUTING) {
      return
    }

    this.state.handoffNode = targetNode
    this.state.handoffMessage = message

    if (context && Object.keys(context).length > 0 && this.state.currentNode) {
      for (const [key, value] of Object.entries(context)) {
        this.sharedContext.addContext(this.state.currentNode, key, value)
      }
    }
  }

  private _buildNodeInput(targetNode: SwarmNode): string {
    let contextText = ''

    if (this.state.handoffMessage) {
      contextText += `Handoff Message: ${this.state.handoffMessage}\n\n`
    }

    const task = this.state.task
    if (typeof task === 'string') {
      contextText += `User Request: ${task}\n\n`
    } else if (Array.isArray(task)) {
      contextText += 'User Request: Multi-modal task\n\n'
    }

    if (this.state.nodeHistory.length > 0) {
      contextText += `Previous agents who worked on this: ${this.state.nodeHistory.map((n) => n.nodeId).join(' → ')}\n\n`
    }

    const shared = this.sharedContext.context
    if (Object.keys(shared).length > 0) {
      contextText += 'Shared knowledge from previous agents:\n'
      for (const [nodeName, ctx] of Object.entries(shared)) {
        if (ctx && Object.keys(ctx).length > 0) {
          contextText += `• ${nodeName}: ${JSON.stringify(ctx)}\n`
        }
      }
      contextText += '\n'
    }

    const otherNodes = Object.keys(this.nodes).filter((id) => id !== targetNode.nodeId)
    if (otherNodes.length > 0) {
      contextText += 'Other agents available for collaboration:\n'
      for (const nodeId of otherNodes) {
        contextText += `Agent name: ${nodeId}.\n`
      }
      contextText += '\n'
    }

    contextText +=
      'You have access to swarm coordination tools if you need help from other agents. ' +
      "If you don't hand off to another agent, the swarm will consider the task complete."

    return contextText
  }

  private _activateInterrupt(node: SwarmNode, interrupts: Interrupt[]): MultiAgentNodeInterruptEvent {
    this.state.completionStatus = Status.INTERRUPTED

    this._interruptState.context[node.nodeId] = {
      activated: (node.executor as unknown as { _interruptState: InterruptState })._interruptState.activated,
      interruptState: (node.executor as unknown as { _interruptState: InterruptState })._interruptState.toDict(),
      state: node.executor.state.getAll(),
      messages: node.executor.messages,
    }

    for (const interrupt of interrupts) {
      this._interruptState.interrupts.set(interrupt.id, interrupt)
    }
    this._interruptState.activate()

    return new MultiAgentNodeInterruptEvent({ nodeId: node.nodeId, interrupts })
  }

  private async *_executeSwarm(multiAgentSpan: Span | undefined): AsyncGenerator<MultiAgentStreamEvent, void> {
    try {
      while (true) {
        if (this.state.completionStatus !== Status.EXECUTING) {
          break
        }

        const [shouldContinue, _reason] = this.state.shouldContinue({
          maxHandoffs: this._maxHandoffs,
          maxIterations: this._maxIterations,
          executionTimeout: this._executionTimeout,
          repetitiveHandoffDetectionWindow: this._repetitiveHandoffDetectionWindow,
          repetitiveHandoffMinUniqueAgents: this._repetitiveHandoffMinUniqueAgents,
        })
        if (!shouldContinue) {
          this.state.completionStatus = Status.FAILED
          break
        }

        const currentNode = this.state.currentNode
        if (!currentNode || !(currentNode.nodeId in this.nodes)) {
          this.state.completionStatus = Status.FAILED
          break
        }

        const { event: beforeEvent, interrupts: hookInterrupts } = await this.hooks.invokeCallbacks(
          new BeforeNodeCallEvent({
            source: this,
            nodeId: currentNode.nodeId,
            ...(this._invocationOptions?.invocationState !== undefined && {
              invocationState: this._invocationOptions.invocationState,
            }),
          })
        )

        try {
          if (hookInterrupts.length > 0) {
            yield this._activateInterrupt(currentNode, hookInterrupts)
            break
          }

          if (beforeEvent.cancelNode) {
            const cancelMessage =
              typeof beforeEvent.cancelNode === 'string' ? beforeEvent.cancelNode : 'node cancelled by user'
            yield new MultiAgentNodeCancelEvent({ nodeId: currentNode.nodeId, message: cancelMessage })
            this.state.completionStatus = Status.FAILED
            break
          }

          const nodeGen = this._executeNode(currentNode, this.state.task, multiAgentSpan)
          let lastEvent: MultiAgentStreamEvent | undefined
          let nodeNext = await nodeGen.next()
          while (!nodeNext.done) {
            lastEvent = nodeNext.value
            yield nodeNext.value
            nodeNext = await nodeGen.next()
          }

          // Last event should be stop event with node result
          if (lastEvent && lastEvent.type === 'multiAgentNodeStopEvent') {
            const stopEvent = lastEvent as MultiAgentNodeStopEvent
            if (stopEvent.nodeResult.status === Status.INTERRUPTED) {
              yield this._activateInterrupt(currentNode, stopEvent.nodeResult.interrupts)
              break
            }
          }

          this._interruptState.deactivate()
          this.state.nodeHistory.push(currentNode)
        } catch {
          this.state.completionStatus = Status.FAILED
          break
        } finally {
          // completionStatus may be INTERRUPTED via _activateInterrupt side-effect
          if ((this.state.completionStatus as Status) !== Status.INTERRUPTED) {
            await this.hooks.invokeCallbacks(
              new AfterNodeCallEvent({
                source: this,
                nodeId: currentNode.nodeId,
                ...(this._invocationOptions?.invocationState !== undefined && {
                  invocationState: this._invocationOptions.invocationState,
                }),
              })
            )
          }
        }

        // Check for handoff
        if (this.state.handoffNode) {
          const previousNode = currentNode
          const nextNode = this.state.handoffNode

          this.state.handoffNode = undefined
          this.state.currentNode = nextNode

          yield new MultiAgentHandoffEvent({
            fromNodeIds: [previousNode.nodeId],
            toNodeIds: [nextNode.nodeId],
            message: this.state.handoffMessage ?? 'Agent handoff occurred',
          })
        } else {
          this.state.completionStatus = Status.COMPLETED
          break
        }
      }
    } catch {
      this.state.completionStatus = Status.FAILED
    }
  }

  private async *_executeNode(
    node: SwarmNode,
    task: MultiAgentInput,
    multiAgentSpan?: Span
  ): AsyncGenerator<MultiAgentStreamEvent, void> {
    const startTime = Date.now()
    const nodeName = node.nodeId

    yield new MultiAgentNodeStartEvent({ nodeId: nodeName, nodeType: 'agent' })

    const tracer = getTracer()
    let nodeSpan: Span | undefined
    let nodeError: Error | undefined
    try {
      let nodeInput: ContentBlock[] | import('../types/interrupt.js').InterruptResponseContent[]

      if (
        this._interruptState.activated &&
        this._interruptState.context[nodeName] &&
        (this._interruptState.context[nodeName] as { activated: boolean }).activated
      ) {
        nodeInput = this._interruptState.context[
          'responses'
        ] as import('../types/interrupt.js').InterruptResponseContent[]
      } else {
        const contextText = this._buildNodeInput(node)
        nodeInput = [new TextBlock(`Context:\n${contextText}\n\n`)]

        this.state.handoffMessage = undefined

        if (typeof task !== 'string' && Array.isArray(task)) {
          nodeInput = [...nodeInput, ...(task as ContentBlock[])]
        }
      }

      nodeSpan = tracer.startNodeSpan({
        nodeId: nodeName,
        nodeType: 'agent',
        parentSpan: multiAgentSpan,
      })
      yield new MultiAgentNodeInputEvent({ nodeId: nodeName, input: nodeInput })

      node.resetExecutorState()

      // Stream agent events and capture final result
      const agentOptions: { invocationState?: Record<string, unknown>; parentSpan?: Span } =
        this._invocationOptions?.invocationState !== undefined
          ? { invocationState: this._invocationOptions.invocationState }
          : {}
      if (nodeSpan !== undefined) {
        agentOptions.parentSpan = nodeSpan
      }
      const gen = node.executor.stream(nodeInput, agentOptions)
      let agentResult: AgentResult | undefined
      let genNext = await gen.next()

      while (!genNext.done) {
        yield new MultiAgentNodeStreamEvent({ nodeId: nodeName, event: genNext.value as AgentStreamEvent })
        genNext = await gen.next()
      }
      agentResult = genNext.value

      if (!agentResult) {
        throw new Error(`Node '${nodeName}' did not produce a result`)
      }

      const executionTime = Date.now() - startTime
      const status = agentResult.stopReason === 'interrupt' ? Status.INTERRUPTED : Status.COMPLETED

      const usage = agentResult.metrics?.accumulatedUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      const metrics = agentResult.metrics?.accumulatedMetrics ?? { latencyMs: executionTime }

      const nodeResult = new NodeResult({
        result: agentResult,
        executionTime,
        status,
        accumulatedUsage: usage,
        accumulatedMetrics: metrics,
        executionCount: 1,
        interrupts: agentResult.interrupts ?? [],
      })

      this.state.results[nodeName] = nodeResult
      this._accumulateMetrics(nodeResult)

      yield new MultiAgentNodeStopEvent({ nodeId: nodeName, nodeResult })
    } catch (error) {
      nodeError = error instanceof Error ? error : new Error(String(error))
      const executionTime = Date.now() - startTime
      const nodeResult = new NodeResult({
        result: nodeError,
        executionTime,
        status: Status.FAILED,
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        accumulatedMetrics: { latencyMs: executionTime },
        executionCount: 1,
      })

      this.state.results[nodeName] = nodeResult

      yield new MultiAgentNodeStopEvent({ nodeId: nodeName, nodeResult })
      throw nodeError
    } finally {
      if (nodeSpan !== undefined) {
        const executionTimeMs = Date.now() - startTime
        tracer.endNodeSpan({
          span: nodeSpan,
          status: this.state.results[nodeName]?.status ?? 'failed',
          executionTime: executionTimeMs,
          error: nodeError,
        })
      }
    }
  }

  private _accumulateMetrics(nodeResult: NodeResult): void {
    this.state.accumulatedUsage.inputTokens += nodeResult.accumulatedUsage.inputTokens ?? 0
    this.state.accumulatedUsage.outputTokens += nodeResult.accumulatedUsage.outputTokens ?? 0
    this.state.accumulatedUsage.totalTokens += nodeResult.accumulatedUsage.totalTokens ?? 0
    this.state.accumulatedMetrics.latencyMs += nodeResult.accumulatedMetrics.latencyMs ?? 0
  }

  private _buildResult(interrupts: Interrupt[]): SwarmResult {
    return new SwarmResult({
      status: this.state.completionStatus,
      results: this.state.results,
      accumulatedUsage: this.state.accumulatedUsage,
      accumulatedMetrics: this.state.accumulatedMetrics,
      executionCount: this.state.nodeHistory.length,
      executionTime: this.state.executionTime,
      nodeHistory: this.state.nodeHistory,
      interrupts,
    })
  }

  private _getInitialNode(): SwarmNode {
    if (this._entryPoint) {
      return this.nodes[this._entryPoint.name]!
    }
    return Object.values(this.nodes)[0]!
  }

  private _fromDict(payload: Record<string, unknown>): void {
    this.state.completionStatus = payload['status'] as Status

    const context = (payload['context'] ?? {}) as Record<string, unknown>
    const restoredSharedContext = structuredClone(
      (context['sharedContext'] as Record<string, Record<string, unknown>>) ?? {}
    )
    this.sharedContext = new SharedContext(restoredSharedContext)
    this.state.handoffMessage = (context['handoffMessage'] as string) ?? undefined
    this.state.handoffNode =
      context['handoffNode'] && typeof context['handoffNode'] === 'string'
        ? this.nodes[context['handoffNode']]
        : undefined

    const historyIds = (payload['nodeHistory'] as string[]) ?? []
    this.state.nodeHistory = historyIds.filter((id) => id in this.nodes).map((id) => this.nodes[id]!)

    const rawResults = (payload['nodeResults'] as Record<string, Record<string, unknown>>) ?? {}
    const results: Record<string, NodeResult> = {}
    for (const [nodeId, entry] of Object.entries(rawResults)) {
      if (!(nodeId in this.nodes)) continue
      results[nodeId] = NodeResult.fromDict(entry as never)
    }
    this.state.results = results

    this.state.task = (payload['currentTask'] as MultiAgentInput) ?? this.state.task

    const nextNodeIds = (payload['nextNodesToExecute'] as string[]) ?? []
    if (nextNodeIds.length > 0 && nextNodeIds[0] && nextNodeIds[0] in this.nodes) {
      this.state.currentNode = this.nodes[nextNodeIds[0]]!
    }
  }
}
