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
 */

import type { InvokeArgs } from '../agent/agent.js'
import { Edge } from './edge.js'
import type { EdgeDefinition } from './edge.js'
import { MultiAgentHandoffEvent, MultiAgentResultEvent } from './events.js'
import type { MultiAgentStreamEvent } from './events.js'
import { Node, AgentNode } from './nodes.js'
import type { NodeDefinition } from './nodes.js'
import { Queue } from './queue.js'
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
 * Configuration for creating a Graph.
 */
export interface GraphOptions {
  /** Node definitions — either Node instances or AgentNodeOptions. */
  nodes: NodeDefinition[]
  /** Edge definitions connecting nodes. */
  edges: EdgeDefinition[]
  /** IDs of entry point nodes. Auto-detected if omitted (nodes with no incoming edges). */
  entryPoints?: string[]
  /** Maximum total node executions before stopping. */
  maxNodeExecutions?: number
  /** Total execution timeout in milliseconds. */
  executionTimeout?: number
  /** Individual node execution timeout in milliseconds. */
  nodeTimeout?: number
  /** Whether to reset node state when revisited in cycles. */
  resetOnRevisit?: boolean
}

/**
 * Extended result from graph execution.
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
export class Graph {
  private readonly _nodes: Map<string, Node>
  private readonly _edges: Edge[]
  private readonly _entryPoints: string[]
  private readonly _maxNodeExecutions: number
  private readonly _executionTimeout: number
  private readonly _nodeTimeout: number
  private readonly _resetOnRevisit: boolean

  constructor(options: GraphOptions) {
    // Resolve node definitions to Node instances
    this._nodes = new Map()
    for (const def of options.nodes) {
      const node = def instanceof Node ? def : new AgentNode(def)
      if (this._nodes.has(node.id)) {
        throw new GraphError(`Duplicate node ID: '${node.id}'`)
      }
      this._nodes.set(node.id, node)
    }

    if (this._nodes.size === 0) {
      throw new GraphError('Graph must contain at least one node')
    }

    // Resolve edge definitions
    this._edges = options.edges.map((def) => {
      const source = this._nodes.get(def.source)
      const target = this._nodes.get(def.target)
      if (!source) throw new GraphError(`Edge source '${def.source}' not found`)
      if (!target) throw new GraphError(`Edge target '${def.target}' not found`)
      return new Edge({ source, target, ...(def.handler && { handler: def.handler }) })
    })

    // Resolve entry points
    if (options.entryPoints) {
      for (const id of options.entryPoints) {
        if (!this._nodes.has(id)) throw new GraphError(`Entry point '${id}' not found`)
      }
      this._entryPoints = options.entryPoints
    } else {
      // Auto-detect: nodes with no incoming edges
      const targets = new Set(this._edges.map((e) => e.target.id))
      this._entryPoints = [...this._nodes.keys()].filter((id) => !targets.has(id))
      if (this._entryPoints.length === 0) {
        throw new GraphError('No entry points found — all nodes have incoming edges')
      }
    }

    this._maxNodeExecutions = options.maxNodeExecutions ?? Infinity
    this._executionTimeout = options.executionTimeout ?? Infinity
    this._nodeTimeout = options.nodeTimeout ?? Infinity
    this._resetOnRevisit = options.resetOnRevisit ?? false
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
   * Invoke the graph and return the final result.
   */
  async invoke(task: InvokeArgs): Promise<GraphResult> {
    const gen = this.stream(task)
    let last: IteratorResult<MultiAgentStreamEvent, GraphResult>
    do {
      last = await gen.next()
    } while (!last.done)
    return last.value
  }

  /**
   * Stream events during graph execution.
   */
  async *stream(task: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, GraphResult, undefined> {
    const startTime = Date.now()
    const state = new MultiAgentState({ nodeIds: [...this._nodes.keys()] })
    const executionOrder: string[] = []

    let readyIds = [...this._entryPoints]

    while (readyIds.length > 0) {
      // Check execution limits
      if (state.steps >= this._maxNodeExecutions) {
        throw new GraphError(`Max node executions reached: ${this._maxNodeExecutions}`)
      }
      if (Date.now() - startTime >= this._executionTimeout) {
        throw new GraphError(`Execution timed out after ${this._executionTimeout}ms`)
      }

      const currentBatch = readyIds
      readyIds = []

      // Execute batch — parallel if multiple nodes, yielding events as they arrive
      yield* this._executeBatch(currentBatch, task, state, executionOrder)

      // Find newly ready nodes
      const newlyReady = this._findNewlyReady(currentBatch, state)

      if (newlyReady.length > 0) {
        yield new MultiAgentHandoffEvent({
          source: currentBatch[currentBatch.length - 1]!,
          targets: newlyReady,
        })
      }

      readyIds = newlyReady
    }

    const duration = Date.now() - startTime
    const allResults = state.results
    const multiAgentResult = new MultiAgentResult({ results: allResults, duration })

    yield new MultiAgentResultEvent({ result: multiAgentResult })

    return {
      result: multiAgentResult,
      executionOrder,
      totalNodes: this._nodes.size,
      completedNodes: allResults.filter((r) => r.status === Status.COMPLETED).length,
      failedNodes: allResults.filter((r) => r.status === Status.FAILED).length,
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

    // Start all nodes concurrently
    for (const nodeId of nodeIds) {
      const node = this._nodes.get(nodeId)!
      const nodeState = state.node(nodeId)

      // Reset if revisiting
      if (this._resetOnRevisit && nodeState && nodeState.results.length > 0) {
        nodeState.status = Status.PENDING
      }

      state.steps++

      // Build input for this node
      const input = this._buildNodeInput(nodeId, task, state)

      // Run node in background, pushing events to queue
      this._runNodeToQueue(node, input, state, queue).then(() => {
        activeCount--
      })
    }

    // Consume events from queue until all nodes complete
    while (activeCount > 0 || queue.size > 0) {
      await queue.wait()

      let item = queue.shift()
      while (item) {
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
        item = queue.shift()
      }
    }
  }

  /**
   * Run a single node and push all events/results to the shared queue.
   */
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

  /**
   * Build input for a node based on its dependencies' outputs.
   */
  private _buildNodeInput(nodeId: string, task: InvokeArgs, state: MultiAgentState): InvokeArgs {
    // Get completed dependency outputs via incoming edges
    const incomingEdges = this._edges.filter((e) => e.target.id === nodeId)
    const depContents = incomingEdges
      .filter((e) => state.node(e.source.id)?.status === Status.COMPLETED)
      .flatMap((e) => state.node(e.source.id)?.content ?? [])

    if (depContents.length === 0) {
      // Entry point or no completed deps — use original task
      return task
    }

    // Combine task text with dependency outputs
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

  /**
   * Find nodes that became ready after a batch completed.
   * A node is ready when all its incoming edge sources are completed
   * and at least one incoming edge's condition is satisfied from the current batch.
   */
  private _findNewlyReady(completedBatch: string[], state: MultiAgentState): string[] {
    const completedSet = new Set(completedBatch)
    const ready: string[] = []

    for (const [nodeId] of this._nodes) {
      const incoming = this._edges.filter((e) => e.target.id === nodeId)
      if (incoming.length === 0) continue // entry points, already executed

      // At least one incoming edge must come from the just-completed batch
      const hasNewlyCompleted = incoming.some((e) => completedSet.has(e.source.id))
      if (!hasNewlyCompleted) continue

      // Check that at least one edge from the completed batch is traversable
      const traversable = incoming.some((e) => completedSet.has(e.source.id) && e.handler(state))
      if (!traversable) continue

      ready.push(nodeId)
    }

    return ready
  }
}
