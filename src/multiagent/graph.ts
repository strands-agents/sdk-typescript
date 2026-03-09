/**
 * Directed Graph Multi-Agent Pattern Implementation.
 *
 * Deterministic graph-based agent orchestration where agents are nodes
 * executed according to edge dependencies, with output from one node
 * passed as input to connected nodes.
 *
 * Key Features:
 * - Agents as graph nodes with dependency-based execution
 * - Parallel execution of independent nodes
 * - Conditional edges with optional handler functions
 * - Cycle support with configurable execution limits
 * - Reset-on-revisit for stateless node behavior
 *
 * @example
 * ```typescript
 * const graph = new Graph({
 *   nodes: [researcher, writer],
 *   edges: [{ source: 'researcher', target: 'writer' }],
 *   maxNodeExecutions: 10,
 * })
 *
 * const result = await graph.invoke('Explain quantum computing')
 * ```
 */

import type { InvokeArgs } from '../agent/agent.js'
import { Edge } from './edge.js'
import type { EdgeDefinition } from './edge.js'
import {
  BeforeMultiAgentInvocationEvent,
  AfterMultiAgentInvocationEvent,
  MultiAgentHandoffEvent,
  MultiAgentInitializedEvent,
  MultiAgentResultEvent,
} from './events.js'
import type { MultiAgentStreamEvent } from './events.js'
import { HookableEvent } from '../hooks/events.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import type { HookProvider } from '../hooks/types.js'
import { Node, AgentNode, MultiAgentNode } from './nodes.js'
import type { NodeDefinition, AgentNodeOptions, MultiAgentNodeOptions } from './nodes.js'
import { Queue } from './queue.js'
import type { MultiAgentBase } from './base.js'
import { MultiAgentState, MultiAgentResult, Status } from './state.js'

/**
 * Error thrown when graph validation or execution limits are exceeded.
 */
export class GraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphError'
  }
}

/**
 * Runtime configuration for graph execution.
 */
export interface GraphConfig {
  /** Maximum total node executions before stopping. Defaults to Infinity. */
  maxNodeExecutions?: number
  /** Total execution timeout in milliseconds. Defaults to Infinity. */
  executionTimeout?: number
  /** Individual node execution timeout in milliseconds. Defaults to Infinity. */
  nodeTimeout?: number
  /** Whether to reset node state when revisited in cycles. Defaults to false. */
  resetOnRevisit?: boolean
}

/**
 * Options for creating a Graph instance.
 */
export interface GraphOptions extends GraphConfig {
  /** Unique identifier. Defaults to `'graph'`. */
  id?: string
  /** Node definitions — either Node instances or AgentNodeOptions. */
  nodes: NodeDefinition[]
  /** Edge definitions connecting nodes. */
  edges: EdgeDefinition[]
  /** IDs of entry point nodes. Auto-detected if omitted (nodes with no incoming edges). */
  entryPoints?: string[]
  /** Hook providers for event-driven extensibility. */
  hooks?: HookProvider[]
}

/**
 * Extended result metadata from graph execution.
 */
export interface GraphResult {
  result: MultiAgentResult
  executionOrder: string[]
  totalNodes: number
  completedNodes: number
  failedNodes: number
}

/**
 * Directed graph multi-agent orchestration.
 *
 * Execution:
 * 1. Start at entry point nodes (no incoming edges)
 * 2. Execute ready nodes in parallel
 * 3. After a batch completes, find newly ready nodes (all dependencies satisfied)
 * 4. Repeat until no more nodes are ready or limits are exceeded
 */
export class Graph implements MultiAgentBase {
  readonly id: string
  readonly config: Required<GraphConfig>
  readonly hooks: HookRegistryImplementation
  private readonly _nodes: Map<string, Node>
  private readonly _edges: Edge[]
  private readonly _entryPoints: string[]
  private _initialized: boolean

  constructor(options: GraphOptions) {
    const { id, nodes, edges, entryPoints, hooks, ...config } = options

    this.id = id ?? 'graph'

    this.config = {
      maxNodeExecutions: Infinity,
      executionTimeout: Infinity,
      nodeTimeout: Infinity,
      resetOnRevisit: false,
      ...config,
    }

    // Resolve node definitions to Node instances
    this._nodes = new Map()
    for (const def of nodes) {
      const node =
        def instanceof Node
          ? def
          : def.type === 'multiAgent'
            ? new MultiAgentNode(def as MultiAgentNodeOptions)
            : new AgentNode(def as AgentNodeOptions)
      if (this._nodes.has(node.id)) {
        throw new GraphError(`Duplicate node ID: '${node.id}'`)
      }
      this._nodes.set(node.id, node)
    }

    if (this._nodes.size === 0) {
      throw new GraphError('Graph must contain at least one node')
    }

    // Resolve edge definitions
    this._edges = edges.map((def) => {
      const source = this._nodes.get(def.source)
      const target = this._nodes.get(def.target)
      if (!source) throw new GraphError(`Edge source '${def.source}' not found`)
      if (!target) throw new GraphError(`Edge target '${def.target}' not found`)
      return new Edge({ source, target, ...(def.handler && { handler: def.handler }) })
    })

    // Resolve entry points
    if (entryPoints) {
      for (const ep of entryPoints) {
        if (!this._nodes.has(ep)) throw new GraphError(`Entry point '${ep}' not found`)
      }
      this._entryPoints = entryPoints
    } else {
      const targets = new Set(this._edges.map((e) => e.target.id))
      this._entryPoints = [...this._nodes.keys()].filter((nid) => !targets.has(nid))
      if (this._entryPoints.length === 0) {
        throw new GraphError('No entry points found — all nodes have incoming edges')
      }
    }

    this.hooks = new HookRegistryImplementation()
    this.hooks.addAllHooks(hooks ?? [])
    this._initialized = false
  }

  get nodes(): ReadonlyMap<string, Node> {
    return this._nodes
  }

  get edges(): readonly Edge[] {
    return this._edges
  }

  get entryPoints(): readonly string[] {
    return this._entryPoints
  }

  /**
   * Initialize the graph. Invokes the {@link MultiAgentInitializedEvent} callback.
   * Called automatically on first invocation.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return
    await this.hooks.invokeCallbacks(new MultiAgentInitializedEvent({ orchestrator: this }))
    this._initialized = true
  }

  /**
   * Invoke the graph and return the final result.
   */
  async invoke(task: InvokeArgs): Promise<MultiAgentResult> {
    const gen = this.stream(task)
    let next = await gen.next()
    while (!next.done) {
      next = await gen.next()
    }
    return next.value
  }

  /**
   * Stream events during graph execution.
   */
  async *stream(task: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    await this.initialize()

    const gen = this._stream(task)
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

  /**
   * Invoke the graph and return extended result metadata.
   */
  async invokeWithDetails(task: InvokeArgs): Promise<GraphResult> {
    const gen = this._streamWithDetails(task)
    let last: IteratorResult<MultiAgentStreamEvent, GraphResult>
    do {
      last = await gen.next()
    } while (!last.done)
    return last.value
  }

  private async *_stream(task: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    const gen = this._streamWithDetails(task)
    let next = await gen.next()
    while (!next.done) {
      yield next.value
      next = await gen.next()
    }
    return next.value.result
  }

  private async *_streamWithDetails(task: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, GraphResult, undefined> {
    const state = new MultiAgentState({ nodeIds: [...this._nodes.keys()] })
    const executionOrder: string[] = []

    yield new BeforeMultiAgentInvocationEvent({ orchestrator: this, state })

    try {
      let readyIds = [...this._entryPoints]

      while (readyIds.length > 0) {
        if (state.steps >= this.config.maxNodeExecutions) {
          throw new GraphError(`Max node executions reached: ${this.config.maxNodeExecutions}`)
        }
        if (Date.now() - state.startTime >= this.config.executionTimeout) {
          throw new GraphError(`Execution timed out after ${this.config.executionTimeout}ms`)
        }

        const currentBatch = readyIds
        readyIds = []

        yield* this._executeBatch(currentBatch, task, state, executionOrder)

        const newlyReady = this._findNewlyReady(currentBatch, state)

        if (newlyReady.length > 0) {
          yield new MultiAgentHandoffEvent({
            source: currentBatch[currentBatch.length - 1]!,
            targets: newlyReady,
          })
        }

        readyIds = newlyReady
      }
    } finally {
      yield new AfterMultiAgentInvocationEvent({ orchestrator: this, state })
    }

    const result = new MultiAgentResult({
      results: state.results,
      duration: Date.now() - state.startTime,
    })

    yield new MultiAgentResultEvent({ result })

    return {
      result,
      executionOrder,
      totalNodes: this._nodes.size,
      completedNodes: state.results.filter((r) => r.status === Status.COMPLETED).length,
      failedNodes: state.results.filter((r) => r.status === Status.FAILED).length,
    }
  }

  /**
   * Execute a batch of nodes in parallel, yielding events as they arrive via a shared queue.
   */
  private async *_executeBatch(
    nodeIds: string[],
    task: InvokeArgs,
    state: MultiAgentState,
    executionOrder: string[]
  ): AsyncGenerator<MultiAgentStreamEvent, void, undefined> {
    const queue = new Queue()
    let activeCount = nodeIds.length

    for (const nodeId of nodeIds) {
      const node = this._nodes.get(nodeId)!
      const nodeState = state.node(nodeId)

      if (this.config.resetOnRevisit && nodeState && nodeState.results.length > 0) {
        nodeState.status = Status.PENDING
      }

      state.steps++

      const input = this._buildNodeInput(nodeId, task, state)

      this._runNodeToQueue(node, input, state, queue).then(() => {
        activeCount--
        queue.notify()
      })
    }

    while (activeCount > 0 || queue.size > 0) {
      await queue.wait()

      let entry = queue.shift()
      while (entry) {
        const item = entry.data
        if (item.type === 'event') {
          yield item.event
        } else if (item.type === 'result') {
          const nodeState = state.node(item.node.id)
          if (nodeState) {
            nodeState.status = item.result.status
            nodeState.results.push(item.result)
            if (item.result.status === Status.COMPLETED) {
              executionOrder.push(item.node.id)
            }
          }
          state.results.push(item.result)
        } else if (item.type === 'error') {
          throw item.error
        }
        entry.ack()
        entry = queue.shift()
      }
    }
  }

  private async _runNodeToQueue(node: Node, input: InvokeArgs, state: MultiAgentState, queue: Queue): Promise<void> {
    try {
      const gen = node.stream(input, state)
      let next = await gen.next()
      while (!next.done) {
        queue.push({ type: 'event', node, event: next.value })
        next = await gen.next()
      }
      queue.push({ type: 'result', node, result: next.value })
    } catch (error) {
      queue.push({ type: 'error', node, error: error instanceof Error ? error : new Error(String(error)) })
    }
  }

  private _buildNodeInput(nodeId: string, task: InvokeArgs, state: MultiAgentState): InvokeArgs {
    const incomingEdges = this._edges.filter((e) => e.target.id === nodeId)
    const depContents = incomingEdges
      .filter((e) => state.node(e.source.id)?.status === Status.COMPLETED)
      .flatMap((e) => state.node(e.source.id)?.content ?? [])

    if (depContents.length === 0) {
      return task
    }

    const taskText = typeof task === 'string' ? task : ''
    const depText = depContents
      .filter((b) => b.type === 'textBlock')
      .map((b) => (b as { text: string }).text)
      .join('\n')

    const parts: string[] = []
    if (taskText) parts.push(`Original Task: ${taskText}`)
    if (depText) parts.push(`Inputs from previous nodes:\n${depText}`)

    return parts.join('\n\n')
  }

  private _findNewlyReady(completedBatch: string[], state: MultiAgentState): string[] {
    const completedSet = new Set(completedBatch)
    const ready: string[] = []

    for (const [nodeId] of this._nodes) {
      const incoming = this._edges.filter((e) => e.target.id === nodeId)
      if (incoming.length === 0) continue

      const hasNewlyCompleted = incoming.some((e) => completedSet.has(e.source.id))
      if (!hasNewlyCompleted) continue

      const traversable = incoming.some((e) => completedSet.has(e.source.id) && e.handler(state))
      if (!traversable) continue

      ready.push(nodeId)
    }

    return ready
  }
}
