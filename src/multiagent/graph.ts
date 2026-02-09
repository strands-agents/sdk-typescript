/**
 * Directed Graph multi-agent pattern implementation.
 *
 * Provides deterministic graph-based agent orchestration where agents or
 * MultiAgentBase instances are nodes in a graph, executed according to
 * edge dependencies with optional conditional edges and cycle support.
 */

import type { Span } from '@opentelemetry/api'
import type { Agent } from '../agent/agent.js'
import { AgentState } from '../agent/state.js'
import { getTracer } from '../telemetry/tracer.js'
import type { Usage, Metrics } from '../models/streaming.js'
import type { Interrupt } from '../interrupt.js'
import { InterruptState } from '../interrupt.js'
import type { HookProvider } from '../hooks/types.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import type { ContentBlock, Message } from '../types/messages.js'
import { TextBlock } from '../types/messages.js'
import type { InterruptResponseContent } from '../types/interrupt.js'
import { AgentResult } from '../types/agent.js'
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

const DEFAULT_GRAPH_ID = 'default_graph'

/**
 * Type for graph node executor — either a single Agent or a nested MultiAgentBase.
 */
export type GraphExecutor = Agent | MultiAgentBase

/**
 * Lightweight async queue for merging parallel node streams.
 * Supports pushing events, errors (for fail-fast), and null sentinel for task completion.
 */
class AsyncQueue<T> {
  private readonly _items: Array<T | Error | null> = []
  private _waiters: Array<(value: T | Error | null) => void> = []

  push(item: T | Error | null): void {
    if (this._waiters.length > 0) {
      const resolve = this._waiters.shift()!
      resolve(item)
    } else {
      this._items.push(item)
    }
  }

  async pull(timeoutMs?: number): Promise<T | Error | null | typeof ASYNC_QUEUE_TIMEOUT> {
    if (this._items.length > 0) {
      return this._items.shift() ?? null
    }
    return new Promise<T | Error | null | typeof ASYNC_QUEUE_TIMEOUT>((resolve, _reject) => {
      const timer =
        timeoutMs !== undefined
          ? globalThis.setTimeout(() => {
              this._waiters = this._waiters.filter((r) => r !== resolve)
              resolve(ASYNC_QUEUE_TIMEOUT)
            }, timeoutMs)
          : undefined
      this._waiters.push((value) => {
        if (timer !== undefined) globalThis.clearTimeout(timer)
        resolve(value)
      })
    })
  }
}

const ASYNC_QUEUE_TIMEOUT = Symbol('asyncQueueTimeout')

/**
 * Represents a node in the graph.
 */
export class GraphNode {
  readonly nodeId: string
  readonly executor: GraphExecutor
  readonly dependencies: Set<GraphNode> = new Set()
  executionStatus: Status = Status.PENDING
  result: NodeResult | null = null
  executionTime: number = 0

  private readonly _initialMessages: readonly unknown[]
  private readonly _initialState: AgentState
  private _graph: Graph | undefined = undefined

  constructor(data: { nodeId: string; executor: GraphExecutor }) {
    this.nodeId = data.nodeId
    this.executor = data.executor
    if (this._isAgent(this.executor)) {
      this._initialMessages = structuredClone(this.executor.messages)
      this._initialState = new AgentState(this.executor.state.getAll())
    } else {
      this._initialMessages = []
      this._initialState = new AgentState()
    }
  }

  private _isAgent(exec: GraphExecutor): exec is Agent {
    return 'messages' in exec && 'state' in exec
  }

  resetExecutorState(): void {
    if (this._graph?._interruptState.activated) {
      const context = this._graph._interruptState.context[this.nodeId] as
        | {
            messages: Message[]
            state: Record<string, unknown>
            interruptState: ReturnType<InterruptState['toDict']>
          }
        | undefined
      if (context && this._isAgent(this.executor)) {
        this.executor._restoreMessages(context.messages)
        this.executor._restoreState(context.state as Record<string, never>)
        this.executor._restoreInterruptState(InterruptState.fromDict(context.interruptState))
        return
      }
    }
    if (this._isAgent(this.executor)) {
      this.executor._restoreMessages(structuredClone(this._initialMessages) as Message[])
      this.executor._restoreState(this._initialState.getAll() as Record<string, never>)
    }
    this.executionStatus = Status.PENDING
    this.result = null
  }

  /**
   * Set the parent graph (called by Graph constructor).
   */
  setGraph(graph: Graph): void {
    this._graph = graph
  }
}

/**
 * Represents an edge in the graph with an optional condition.
 */
export class GraphEdge {
  readonly fromNode: GraphNode
  readonly toNode: GraphNode
  readonly condition: ((state: GraphState) => boolean) | undefined

  constructor(data: { fromNode: GraphNode; toNode: GraphNode; condition?: (state: GraphState) => boolean }) {
    this.fromNode = data.fromNode
    this.toNode = data.toNode
    this.condition = data.condition
  }

  shouldTraverse(state: GraphState): boolean {
    if (this.condition === undefined) return true
    return this.condition(state)
  }
}

/**
 * Graph execution state.
 */
export class GraphState {
  task: MultiAgentInput = ''
  status: Status = Status.PENDING
  completedNodes: Set<GraphNode> = new Set()
  failedNodes: Set<GraphNode> = new Set()
  interruptedNodes: Set<GraphNode> = new Set()
  executionOrder: GraphNode[] = []
  startTime: number = Date.now() / 1000
  results: Record<string, NodeResult> = {}
  accumulatedUsage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  accumulatedMetrics: Metrics = { latencyMs: 0 }
  executionCount: number = 0
  executionTime: number = 0
  totalNodes: number = 0
  edges: Array<[GraphNode, GraphNode]> = []
  entryPoints: GraphNode[] = []

  shouldContinue(maxNodeExecutions: number | undefined, executionTimeout: number | undefined): [boolean, string] {
    if (maxNodeExecutions !== undefined && this.executionOrder.length >= maxNodeExecutions) {
      return [false, `Max node executions reached: ${maxNodeExecutions}`]
    }
    if (executionTimeout !== undefined) {
      const elapsed = this.executionTime / 1000 + Date.now() / 1000 - this.startTime
      if (elapsed > executionTimeout) {
        return [false, `Execution timed out: ${executionTimeout}s`]
      }
    }
    return [true, 'Continuing']
  }
}

/**
 * Result from graph execution.
 */
export class GraphResult extends MultiAgentResult {
  readonly totalNodes: number
  readonly completedNodes: number
  readonly failedNodes: number
  readonly interruptedNodes: number
  readonly executionOrder: GraphNode[]
  readonly edges: Array<[GraphNode, GraphNode]>
  readonly entryPoints: GraphNode[]

  constructor(data: {
    status?: Status
    results?: Record<string, NodeResult>
    accumulatedUsage?: Usage
    accumulatedMetrics?: Metrics
    executionCount?: number
    executionTime?: number
    interrupts?: Interrupt[]
    totalNodes?: number
    completedNodes?: number
    failedNodes?: number
    interruptedNodes?: number
    executionOrder?: GraphNode[]
    edges?: Array<[GraphNode, GraphNode]>
    entryPoints?: GraphNode[]
  }) {
    super(data)
    this.totalNodes = data.totalNodes ?? 0
    this.completedNodes = data.completedNodes ?? 0
    this.failedNodes = data.failedNodes ?? 0
    this.interruptedNodes = data.interruptedNodes ?? 0
    this.executionOrder = data.executionOrder ?? []
    this.edges = data.edges ?? []
    this.entryPoints = data.entryPoints ?? []
  }
}

/**
 * Builder for constructing and validating graphs.
 */
export class GraphBuilder {
  private readonly _nodes: Record<string, GraphNode> = {}
  private readonly _edges: Set<GraphEdge> = new Set()
  private readonly _entryPoints: Set<GraphNode> = new Set()
  private _maxNodeExecutions: number | undefined = undefined
  private _executionTimeout: number | undefined = undefined
  private _nodeTimeout: number | undefined = undefined
  private _resetOnRevisit: boolean = false
  private _id: string = DEFAULT_GRAPH_ID
  private _hooks: HookProvider[] | undefined = undefined

  addNode(executor: GraphExecutor, nodeId?: string): GraphNode {
    this._validateNodeExecutor(executor, this._nodes)
    const id =
      nodeId ??
      (executor as { id?: string }).id ??
      (executor as { name?: string }).name ??
      `node_${Object.keys(this._nodes).length}`
    if (id in this._nodes) {
      throw new Error(`Node '${id}' already exists`)
    }
    const node = new GraphNode({ nodeId: id, executor })
    this._nodes[id] = node
    return node
  }

  addEdge(
    fromNode: string | GraphNode,
    toNode: string | GraphNode,
    condition?: (state: GraphState) => boolean
  ): GraphEdge {
    const from = this._resolveNode(fromNode, 'Source')
    const to = this._resolveNode(toNode, 'Target')
    const edge = new GraphEdge({
      fromNode: from,
      toNode: to,
      ...(condition !== undefined ? { condition } : {}),
    })
    this._edges.add(edge)
    to.dependencies.add(from)
    return edge
  }

  setEntryPoint(nodeId: string): GraphBuilder {
    if (!(nodeId in this._nodes)) {
      throw new Error(`Node '${nodeId}' not found`)
    }
    this._entryPoints.add(this._nodes[nodeId]!)
    return this
  }

  resetOnRevisit(enabled: boolean = true): GraphBuilder {
    this._resetOnRevisit = enabled
    return this
  }

  setMaxNodeExecutions(maxExecutions: number): GraphBuilder {
    this._maxNodeExecutions = maxExecutions
    return this
  }

  setExecutionTimeout(timeout: number): GraphBuilder {
    this._executionTimeout = timeout
    return this
  }

  setNodeTimeout(timeout: number): GraphBuilder {
    this._nodeTimeout = timeout
    return this
  }

  setGraphId(graphId: string): GraphBuilder {
    this._id = graphId
    return this
  }

  setHookProviders(hooks: HookProvider[]): GraphBuilder {
    this._hooks = hooks
    return this
  }

  /**
   * Attaches a session manager to the graph for persistence.
   * The session manager is added as a hook provider alongside any existing hooks.
   *
   * @param sessionManager - Session manager to attach (must implement HookProvider)
   * @returns This builder for chaining
   */
  setSessionManager(sessionManager: HookProvider): GraphBuilder {
    if (this._hooks === undefined) {
      this._hooks = [sessionManager]
    } else {
      this._hooks.push(sessionManager)
    }
    return this
  }

  build(): Graph {
    if (Object.keys(this._nodes).length === 0) {
      throw new Error('Graph must contain at least one node')
    }
    let entryPoints = this._entryPoints
    if (entryPoints.size === 0) {
      entryPoints = new Set(Object.values(this._nodes).filter((node) => node.dependencies.size === 0))
      if (entryPoints.size === 0) {
        throw new Error('No entry points found - all nodes have dependencies')
      }
    }
    this._validateGraph(entryPoints)
    const config: {
      nodes: Record<string, GraphNode>
      edges: Set<GraphEdge>
      entryPoints: GraphNode[]
      maxNodeExecutions?: number
      executionTimeout?: number
      nodeTimeout?: number
      resetOnRevisit?: boolean
      id?: string
      hooks?: HookProvider[]
    } = {
      nodes: { ...this._nodes },
      edges: new Set(this._edges),
      entryPoints: [...entryPoints],
      resetOnRevisit: this._resetOnRevisit,
      id: this._id,
    }
    if (this._maxNodeExecutions !== undefined) config.maxNodeExecutions = this._maxNodeExecutions
    if (this._executionTimeout !== undefined) config.executionTimeout = this._executionTimeout
    if (this._nodeTimeout !== undefined) config.nodeTimeout = this._nodeTimeout
    if (this._hooks !== undefined) config.hooks = this._hooks
    return new Graph(config)
  }

  private _resolveNode(node: string | GraphNode, label: string): GraphNode {
    if (typeof node === 'string') {
      if (!(node in this._nodes)) throw new Error(`${label} node '${node}' not found`)
      return this._nodes[node]!
    }
    const found = Object.values(this._nodes).find((n) => n === node)
    if (!found) {
      throw new Error(`${label} node object has not been added to the graph, use graph.addNode`)
    }
    return found
  }

  private _validateNodeExecutor(executor: GraphExecutor, existingNodes: Record<string, GraphNode>): void {
    const seen = new Set(Object.values(existingNodes).map((n) => n.executor))
    if (seen.has(executor)) {
      throw new Error('Duplicate node instance detected. Each node must have a unique object instance.')
    }
  }

  private _validateGraph(entryPoints: Set<GraphNode>): void {
    const entryIds = new Set([...entryPoints].map((n) => n.nodeId))
    const nodeIds = new Set(Object.keys(this._nodes))
    const invalid = [...entryIds].filter((id) => !nodeIds.has(id))
    if (invalid.length > 0) {
      throw new Error(`Entry points not found in nodes: ${invalid.join(', ')}`)
    }
    if (this._maxNodeExecutions === undefined && this._executionTimeout === undefined) {
      // No execution limits configured — graph may run indefinitely if cycles exist
    }
  }
}

/**
 * Directed Graph multi-agent orchestration.
 */
export class Graph extends MultiAgentBase {
  readonly nodes: Record<string, GraphNode>
  readonly edges: Set<GraphEdge>
  readonly entryPoints: GraphNode[]
  readonly maxNodeExecutions: number | undefined
  readonly executionTimeout: number | undefined
  readonly nodeTimeout: number | undefined
  readonly resetOnRevisit: boolean
  override readonly id: string
  readonly hooks: HookRegistryImplementation
  state: GraphState
  _interruptState: InterruptState
  private _initialized: boolean = false
  private _resumeNextNodes: GraphNode[] = []
  private _resumeFromSession: boolean = false
  private _invocationOptions: MultiAgentInvokeOptions | undefined

  constructor(config: {
    nodes: Record<string, GraphNode>
    edges: Set<GraphEdge>
    entryPoints: GraphNode[]
    maxNodeExecutions?: number
    executionTimeout?: number
    nodeTimeout?: number
    resetOnRevisit?: boolean
    id?: string
    hooks?: HookProvider[]
  }) {
    super()
    this._validateGraph(config.nodes)
    this.nodes = config.nodes
    this.edges = config.edges
    this.entryPoints = config.entryPoints
    this.maxNodeExecutions = config.maxNodeExecutions
    this.executionTimeout = config.executionTimeout
    this.nodeTimeout = config.nodeTimeout
    this.resetOnRevisit = config.resetOnRevisit ?? false
    this.id = config.id ?? DEFAULT_GRAPH_ID
    this.state = new GraphState()
    this._interruptState = new InterruptState()
    this.hooks = new HookRegistryImplementation()
    if (config.hooks) {
      this.hooks.addAllHooks(config.hooks)
    }
    for (const node of Object.values(this.nodes)) {
      node.setGraph(this)
    }
  }

  private _validateGraph(nodes: Record<string, GraphNode>): void {
    const seen = new Set<GraphExecutor>()
    for (const node of Object.values(nodes)) {
      if (seen.has(node.executor)) {
        throw new Error('Duplicate node instance detected. Each node must have a unique object instance.')
      }
      seen.add(node.executor)
    }
  }

  async *stream(
    task: MultiAgentInput,
    options?: MultiAgentInvokeOptions
  ): AsyncGenerator<MultiAgentStreamEvent, GraphResult> {
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

    const startTime = Date.now() / 1000
    if (!this._resumeFromSession && !this._interruptState.activated) {
      this.state = new GraphState()
      this.state.status = Status.EXECUTING
      this.state.task = task
      this.state.totalNodes = Object.keys(this.nodes).length
      this.state.edges = [...this.edges].map((e) => [e.fromNode, e.toNode] as [GraphNode, GraphNode])
      this.state.entryPoints = [...this.entryPoints]
      this.state.startTime = startTime
    } else {
      this.state.status = Status.EXECUTING
      this.state.startTime = startTime
    }
    let interrupts: Interrupt[] = []
    try {
      const gen = this._executeGraph(multiAgentSpan)
      let next = await gen.next()
      while (!next.done) {
        const event = next.value
        if (event.type === 'multiAgentNodeInterruptEvent') {
          interrupts = (event as MultiAgentNodeInterruptEvent).interrupts
        }
        yield event
        next = await gen.next()
      }
      if (this.state.failedNodes.size > 0) {
        this.state.status = Status.FAILED
      } else if (this.state.status === Status.EXECUTING) {
        this.state.status = Status.COMPLETED
      }
      const result = this._buildResult(interrupts)
      tracer.endMultiAgentSpan({ span: multiAgentSpan, result: result.toString() })
      yield new MultiAgentResultEvent({ result })
      return result
    } catch (error) {
      this.state.status = Status.FAILED
      tracer.endMultiAgentSpan({
        span: multiAgentSpan,
        error: error instanceof Error ? error : new Error(String(error)),
      })
      throw error
    } finally {
      this.state.executionTime += Math.round((Date.now() / 1000 - startTime) * 1000)
      await this.hooks.invokeCallbacks(
        new AfterMultiAgentInvocationEvent({
          source: this,
          ...(this._invocationOptions?.invocationState !== undefined && {
            invocationState: this._invocationOptions.invocationState,
          }),
        })
      )
      this._resumeFromSession = false
      this._resumeNextNodes = []
      this._invocationOptions = undefined
    }
  }

  private async *_executeGraph(multiAgentSpan: Span | undefined): AsyncGenerator<MultiAgentStreamEvent, void> {
    let readyNodes: GraphNode[]
    if (this._interruptState.activated) {
      const completedIds = (this._interruptState.context['completed_nodes'] as string[]) ?? []
      readyNodes = completedIds.map((id) => this.nodes[id]).filter((n): n is GraphNode => n !== undefined)
      readyNodes.push(...this.state.interruptedNodes)
      this.state.interruptedNodes.clear()
    } else if (this._resumeFromSession) {
      readyNodes = [...this._resumeNextNodes]
    } else {
      readyNodes = [...this.entryPoints]
    }

    while (readyNodes.length > 0) {
      const [shouldContinue, _reason] = this.state.shouldContinue(this.maxNodeExecutions, this.executionTimeout)
      if (!shouldContinue) {
        this.state.status = Status.FAILED
        return
      }
      const currentBatch = [...readyNodes]
      readyNodes = []
      yield* this._executeNodesParallel(currentBatch, multiAgentSpan)
      if (this.state.status === Status.INTERRUPTED) {
        const completedIds = currentBatch.filter((n) => n.executionStatus === Status.COMPLETED).map((n) => n.nodeId)
        this._interruptState.context['completed_nodes'] = completedIds
        return
      }
      this._interruptState.deactivate()
      const newlyReady = this._findNewlyReadyNodes(currentBatch)
      if (newlyReady.length > 0) {
        const handoff = new MultiAgentHandoffEvent({
          fromNodeIds: currentBatch.map((n) => n.nodeId),
          toNodeIds: newlyReady.map((n) => n.nodeId),
        })
        yield handoff
      }
      readyNodes = newlyReady
    }
  }

  private async *_executeNodesParallel(
    nodes: GraphNode[],
    multiAgentSpan?: Span
  ): AsyncGenerator<MultiAgentStreamEvent, void> {
    const toRun = this._interruptState.activated ? nodes.filter((n) => n.executionStatus === Status.INTERRUPTED) : nodes
    if (toRun.length === 0) return
    const queue = new AsyncQueue<MultiAgentStreamEvent | Error | null>()
    const tasks = toRun.map((node) => this._streamNodeToQueue(node, queue, multiAgentSpan))
    const race = Promise.all(
      tasks.map(async (taskGen) => {
        for await (const _ of taskGen) {
          // consumed by queue
        }
      })
    )
    let activeCount = toRun.length
    const pullTimeout = 100
    while (activeCount > 0) {
      const event = await queue.pull(pullTimeout)
      if (event === ASYNC_QUEUE_TIMEOUT) continue
      if (event === null) {
        activeCount--
        continue
      }
      if (event instanceof Error) {
        throw event
      }
      yield event
    }
    while (true) {
      const event = await queue.pull(pullTimeout)
      if (event === ASYNC_QUEUE_TIMEOUT || event === null) break
      if (event instanceof Error) throw event
      yield event
    }
    await race
  }

  // eslint-disable-next-line require-yield -- pushes to queue instead of yielding; consumer drains queue
  private async *_streamNodeToQueue(
    node: GraphNode,
    queue: AsyncQueue<MultiAgentStreamEvent | Error | null>,
    multiAgentSpan?: Span
  ): AsyncGenerator<void, void> {
    let completed = false
    const pushNull = (): void => {
      if (!completed) {
        completed = true
        queue.push(null)
      }
    }
    if (this.nodeTimeout !== undefined) {
      const timeoutMs = this.nodeTimeout * 1000
      const timeoutError = new Error(`Node '${node.nodeId}' execution timed out after ${this.nodeTimeout}s`)
      const runTask = async (): Promise<void> => {
        try {
          for await (const event of this._executeNode(node, multiAgentSpan)) {
            queue.push(event)
          }
        } catch (e) {
          if (!completed) queue.push(e instanceof Error ? e : new Error(String(e)))
        } finally {
          pushNull()
        }
      }
      const timer = globalThis.setTimeout(() => {
        if (completed) return
        completed = true
        const nodeResult = new NodeResult({
          result: timeoutError,
          executionTime: Math.round(this.nodeTimeout! * 1000),
          status: Status.FAILED,
          accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          accumulatedMetrics: { latencyMs: Math.round(this.nodeTimeout! * 1000) },
          executionCount: 1,
        })
        node.executionStatus = Status.FAILED
        node.result = nodeResult
        node.executionTime = nodeResult.executionTime
        this.state.failedNodes.add(node)
        this.state.results[node.nodeId] = nodeResult
        queue.push(new MultiAgentNodeStopEvent({ nodeId: node.nodeId, nodeResult }))
        queue.push(timeoutError)
        queue.push(null)
      }, timeoutMs)
      await runTask()
      globalThis.clearTimeout(timer)
    } else {
      try {
        for await (const event of this._executeNode(node, multiAgentSpan)) {
          queue.push(event)
        }
      } catch (e) {
        queue.push(e instanceof Error ? e : new Error(String(e)))
      } finally {
        pushNull()
      }
    }
  }

  private async *_executeNode(node: GraphNode, multiAgentSpan?: Span): AsyncGenerator<MultiAgentStreamEvent, void> {
    if (this.resetOnRevisit && this.state.completedNodes.has(node)) {
      node.resetExecutorState()
      this.state.completedNodes.delete(node)
    }
    node.executionStatus = Status.EXECUTING
    const nodeType = node.executor instanceof MultiAgentBase ? 'multiagent' : 'agent'
    yield new MultiAgentNodeStartEvent({ nodeId: node.nodeId, nodeType })

    const { event: beforeEvent, interrupts: hookInterrupts } = await this.hooks.invokeCallbacks(
      new BeforeNodeCallEvent({
        source: this,
        nodeId: node.nodeId,
        ...(this._invocationOptions?.invocationState !== undefined && {
          invocationState: this._invocationOptions.invocationState,
        }),
      })
    )

    const startTime = Date.now() / 1000
    let nodeResult: NodeResult
    const tracer = getTracer()
    let nodeSpan: Span | undefined
    let nodeError: Error | undefined
    try {
      if (hookInterrupts.length > 0) {
        yield this._activateInterrupt(node, hookInterrupts, true)
        return
      }
      if (beforeEvent.cancelNode) {
        const msg = typeof beforeEvent.cancelNode === 'string' ? beforeEvent.cancelNode : 'node cancelled by user'
        yield new MultiAgentNodeCancelEvent({ nodeId: node.nodeId, message: msg })
        throw new Error(msg)
      }
      nodeSpan = tracer.startNodeSpan({
        nodeId: node.nodeId,
        nodeType,
        parentSpan: multiAgentSpan,
      })
      const nodeInput = this._buildNodeInput(node)
      yield new MultiAgentNodeInputEvent({ nodeId: node.nodeId, input: nodeInput })

      if (node.executor instanceof MultiAgentBase) {
        const multiOptions =
          this._invocationOptions?.invocationState !== undefined
            ? { invocationState: this._invocationOptions.invocationState }
            : undefined
        const gen = node.executor.stream(nodeInput, multiOptions)
        let next = await gen.next()
        while (!next.done) {
          yield new MultiAgentNodeStreamEvent({ nodeId: node.nodeId, event: next.value })
          next = await gen.next()
        }
        const multiResult = next.value as MultiAgentResult
        if (multiResult === undefined) {
          throw new Error(`Node '${node.nodeId}' did not produce a result event`)
        }
        nodeResult = new NodeResult({
          result: multiResult,
          executionTime: multiResult.executionTime,
          status: multiResult.status,
          accumulatedUsage: multiResult.accumulatedUsage,
          accumulatedMetrics: multiResult.accumulatedMetrics,
          executionCount: multiResult.executionCount,
          interrupts: multiResult.interrupts,
        })
      } else if (this._isAgent(node.executor)) {
        const agent = node.executor as Agent
        const agentOptions: { invocationState?: Record<string, unknown>; parentSpan?: Span } =
          this._invocationOptions?.invocationState !== undefined
            ? { invocationState: this._invocationOptions.invocationState }
            : {}
        if (nodeSpan !== undefined) {
          agentOptions.parentSpan = nodeSpan
        }
        const gen = agent.stream(nodeInput, agentOptions)
        let next = await gen.next()
        while (!next.done) {
          yield new MultiAgentNodeStreamEvent({ nodeId: node.nodeId, event: next.value })
          next = await gen.next()
        }
        const agentResponse = next.value as AgentResult | undefined
        if (agentResponse === undefined) {
          throw new Error(`Node '${node.nodeId}' did not produce a result event`)
        }
        const usage = agentResponse.metrics?.accumulatedUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        const metrics = agentResponse.metrics?.accumulatedMetrics ?? { latencyMs: 0 }
        const stopReason = agentResponse.stopReason ?? 'end_turn'
        const interrupts = agentResponse.interrupts ?? []
        nodeResult = new NodeResult({
          result: agentResponse,
          executionTime: Math.round((Date.now() / 1000 - startTime) * 1000),
          status: stopReason === 'interrupt' ? Status.INTERRUPTED : Status.COMPLETED,
          accumulatedUsage: usage,
          accumulatedMetrics: metrics,
          executionCount: 1,
          interrupts,
        })
      } else {
        throw new Error(`Unsupported executor type for node '${node.nodeId}'`)
      }
      node.result = nodeResult
      node.executionTime = nodeResult.executionTime
      if (nodeResult.status === Status.INTERRUPTED) {
        yield this._activateInterrupt(node, nodeResult.interrupts, false)
        return
      }
      node.executionStatus = Status.COMPLETED
      this.state.completedNodes.add(node)
      this.state.results[node.nodeId] = nodeResult
      this.state.executionOrder.push(node)
      this._accumulateMetrics(nodeResult)
      yield new MultiAgentNodeStopEvent({ nodeId: node.nodeId, nodeResult })
    } catch (e) {
      nodeError = e instanceof Error ? e : new Error(String(e))
      const executionTime = Math.round((Date.now() / 1000 - startTime) * 1000)
      nodeResult = new NodeResult({
        result: nodeError,
        executionTime,
        status: Status.FAILED,
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        accumulatedMetrics: { latencyMs: executionTime },
        executionCount: 1,
      })
      node.executionStatus = Status.FAILED
      node.result = nodeResult
      node.executionTime = executionTime
      this.state.failedNodes.add(node)
      this.state.results[node.nodeId] = nodeResult
      yield new MultiAgentNodeStopEvent({ nodeId: node.nodeId, nodeResult })
      throw nodeError
    } finally {
      if (nodeSpan !== undefined) {
        const executionTimeMs = Math.round((Date.now() / 1000 - startTime) * 1000)
        tracer.endNodeSpan({
          span: nodeSpan,
          status: node.executionStatus as string,
          executionTime: executionTimeMs,
          error: nodeError,
        })
      }
      if ((node.executionStatus as Status) !== Status.INTERRUPTED) {
        await this.hooks.invokeCallbacks(
          new AfterNodeCallEvent({
            source: this,
            nodeId: node.nodeId,
            ...(this._invocationOptions?.invocationState !== undefined && {
              invocationState: this._invocationOptions.invocationState,
            }),
          })
        )
      }
    }
  }

  private _activateInterrupt(
    node: GraphNode,
    interrupts: Interrupt[],
    fromHook: boolean
  ): MultiAgentNodeInterruptEvent {
    node.executionStatus = Status.INTERRUPTED
    this.state.status = Status.INTERRUPTED
    this.state.interruptedNodes.add(node)
    for (const i of interrupts) {
      this._interruptState.interrupts.set(i.id, i)
    }
    this._interruptState.activate()
    const ctx: Record<string, unknown> = { from_hook: fromHook, interrupt_ids: interrupts.map((i) => i.id) }
    if (this._isAgent(node.executor)) {
      const agent = node.executor as Agent
      ctx.messages = agent.messages
      ctx.state = agent.state.getAll()
      ctx.interruptState = (agent as unknown as { _interruptState: InterruptState })._interruptState.toDict()
    }
    this._interruptState.context[node.nodeId] = ctx
    return new MultiAgentNodeInterruptEvent({ nodeId: node.nodeId, interrupts })
  }

  private _isAgent(exec: GraphExecutor): exec is Agent {
    return 'messages' in exec && 'state' in exec
  }

  private _findNewlyReadyNodes(completedBatch: GraphNode[]): GraphNode[] {
    const ready: GraphNode[] = []
    for (const node of Object.values(this.nodes)) {
      if (this._isNodeReadyWithConditions(node, completedBatch)) {
        ready.push(node)
      }
    }
    return ready
  }

  private _isNodeReadyWithConditions(node: GraphNode, completedBatch: GraphNode[]): boolean {
    const incoming = [...this.edges].filter((e) => e.toNode === node)
    if (incoming.length === 0) {
      return false
    }

    const alreadyCompleted = this.state.completedNodes.has(node)
    if (alreadyCompleted && !this.resetOnRevisit) {
      return false
    }

    const traversableIncoming = incoming.filter((edge) => edge.shouldTraverse(this.state))
    if (traversableIncoming.length === 0) {
      return false
    }

    const allDependenciesCompleted = traversableIncoming.every((edge) => this.state.completedNodes.has(edge.fromNode))
    if (!allDependenciesCompleted) {
      return false
    }

    const triggeredByCompletedBatch = traversableIncoming.some((edge) => completedBatch.includes(edge.fromNode))
    return triggeredByCompletedBatch
  }

  private _buildNodeInput(node: GraphNode): MultiAgentInput {
    if (this._interruptState.activated) {
      const context = this._interruptState.context
      const nodeContext = context[node.nodeId] as { from_hook?: boolean; interrupt_ids?: string[] } | undefined
      if (nodeContext) {
        if (!nodeContext.from_hook) {
          const responses = (context['responses'] as InterruptResponseContent[] | undefined) ?? []
          const nodeResponses = responses.filter((r) =>
            nodeContext.interrupt_ids?.includes(r.interruptResponse.interruptId)
          )
          if (this._isAgent(node.executor)) {
            const ctx = context[node.nodeId] as {
              messages: unknown[]
              state: Record<string, unknown>
              interruptState: ReturnType<InterruptState['toDict']>
            }
            if (ctx) {
              const agent = node.executor as Agent
              agent._restoreMessages(ctx.messages as Message[])
              agent._restoreState(ctx.state as Record<string, never>)
              agent._restoreInterruptState(InterruptState.fromDict(ctx.interruptState))
            }
          }
          return nodeResponses
        }
      }
    }
    const dependencyResults: Record<string, NodeResult> = {}
    for (const edge of this.edges) {
      if (
        edge.toNode === node &&
        this.state.completedNodes.has(edge.fromNode) &&
        edge.fromNode.nodeId in this.state.results
      ) {
        if (edge.shouldTraverse(this.state)) {
          dependencyResults[edge.fromNode.nodeId] = this.state.results[edge.fromNode.nodeId]!
        }
      }
    }
    if (Object.keys(dependencyResults).length === 0) {
      if (typeof this.state.task === 'string') {
        return [new TextBlock(this.state.task)]
      }
      return this.state.task as ContentBlock[]
    }
    const blocks: ContentBlock[] = []
    if (typeof this.state.task === 'string') {
      blocks.push(new TextBlock(`Original Task: ${this.state.task}`))
    } else {
      blocks.push(new TextBlock('Original Task:'))
      blocks.push(...(this.state.task as ContentBlock[]))
    }
    blocks.push(new TextBlock('\nInputs from previous nodes:'))
    for (const [depId, nodeResult] of Object.entries(dependencyResults)) {
      blocks.push(new TextBlock(`\nFrom ${depId}:`))
      const agentResults = nodeResult.getAgentResults()
      for (const ar of agentResults) {
        const name = (ar as { agent_name?: string }).agent_name ?? 'Agent'
        blocks.push(new TextBlock(`  - ${name}: ${String(ar)}`))
      }
    }
    return blocks
  }

  private _accumulateMetrics(nodeResult: NodeResult): void {
    this.state.accumulatedUsage.inputTokens += nodeResult.accumulatedUsage.inputTokens ?? 0
    this.state.accumulatedUsage.outputTokens += nodeResult.accumulatedUsage.outputTokens ?? 0
    this.state.accumulatedUsage.totalTokens += nodeResult.accumulatedUsage.totalTokens ?? 0
    this.state.accumulatedMetrics.latencyMs += nodeResult.accumulatedMetrics.latencyMs ?? 0
    this.state.executionCount += nodeResult.executionCount
  }

  private _buildResult(interrupts: Interrupt[]): GraphResult {
    return new GraphResult({
      status: this.state.status,
      results: this.state.results,
      accumulatedUsage: this.state.accumulatedUsage,
      accumulatedMetrics: this.state.accumulatedMetrics,
      executionCount: this.state.executionCount,
      executionTime: this.state.executionTime,
      interrupts,
      totalNodes: this.state.totalNodes,
      completedNodes: this.state.completedNodes.size,
      failedNodes: this.state.failedNodes.size,
      interruptedNodes: this.state.interruptedNodes.size,
      executionOrder: [...this.state.executionOrder],
      edges: this.state.edges,
      entryPoints: this.state.entryPoints,
    })
  }

  serializeState(): Record<string, unknown> {
    const nextNodes = this._computeReadyNodesForResume().map((n) => n.nodeId)
    return {
      type: 'graph',
      id: this.id,
      status: this.state.status,
      completed_nodes: [...this.state.completedNodes].map((n) => n.nodeId),
      failed_nodes: [...this.state.failedNodes].map((n) => n.nodeId),
      interrupted_nodes: [...this.state.interruptedNodes].map((n) => n.nodeId),
      node_results: Object.fromEntries(Object.entries(this.state.results).map(([k, v]) => [k, v.toDict()])),
      next_nodes_to_execute: nextNodes,
      current_task: this.state.task,
      execution_order: this.state.executionOrder.map((n) => n.nodeId),
      _internal_state: { interrupt_state: this._interruptState.toDict() },
    }
  }

  deserializeState(payload: Record<string, unknown>): void {
    const internal = payload['_internal_state'] as { interrupt_state: ReturnType<InterruptState['toDict']> } | undefined
    if (internal) {
      this._interruptState = InterruptState.fromDict(internal.interrupt_state)
    }
    if (!payload['next_nodes_to_execute']) {
      for (const node of Object.values(this.nodes)) {
        node.resetExecutorState()
      }
      this.state = new GraphState()
      this._resumeFromSession = false
      return
    }
    this._fromDict(payload)
    this._resumeFromSession = true
  }

  private _computeReadyNodesForResume(): GraphNode[] {
    if (this.state.status === Status.PENDING) return []
    const completed = this.state.completedNodes
    const ready: GraphNode[] = []
    for (const node of Object.values(this.nodes)) {
      if (completed.has(node)) continue
      const incoming = [...this.edges].filter((e) => e.toNode === node)
      if (incoming.length === 0) {
        ready.push(node)
      } else if (incoming.every((e) => completed.has(e.fromNode) && e.shouldTraverse(this.state))) {
        ready.push(node)
      }
    }
    return ready
  }

  private _fromDict(payload: Record<string, unknown>): void {
    this.state.status = (payload['status'] as Status) ?? Status.PENDING
    const rawResults = (payload['node_results'] as Record<string, unknown>) ?? {}
    const results: Record<string, NodeResult> = {}
    for (const [nodeId, entry] of Object.entries(rawResults)) {
      if (!(nodeId in this.nodes)) continue
      results[nodeId] = NodeResult.fromDict(entry as ReturnType<NodeResult['toDict']>)
    }
    this.state.results = results
    const failedIds = (payload['failed_nodes'] as string[]) ?? []
    this.state.failedNodes = new Set(failedIds.filter((id) => id in this.nodes).map((id) => this.nodes[id]!))
    for (const node of this.state.failedNodes) {
      node.executionStatus = Status.FAILED
    }
    const interruptedIds = (payload['interrupted_nodes'] as string[]) ?? []
    this.state.interruptedNodes = new Set(interruptedIds.filter((id) => id in this.nodes).map((id) => this.nodes[id]!))
    for (const node of this.state.interruptedNodes) {
      node.executionStatus = Status.INTERRUPTED
    }
    const completedIds = (payload['completed_nodes'] as string[]) ?? []
    this.state.completedNodes = new Set(completedIds.filter((id) => id in this.nodes).map((id) => this.nodes[id]!))
    for (const node of this.state.completedNodes) {
      node.executionStatus = Status.COMPLETED
    }
    const orderIds = (payload['execution_order'] as string[]) ?? []
    this.state.executionOrder = orderIds.filter((id) => id in this.nodes).map((id) => this.nodes[id]!)
    this.state.task = (payload['current_task'] as MultiAgentInput) ?? this.state.task
    const nextIds = (payload['next_nodes_to_execute'] as string[]) ?? []
    this._resumeNextNodes = nextIds.filter((id) => id in this.nodes).map((id) => this.nodes[id]!)
  }
}
