import type { InvokableAgent, InvokeArgs } from '../types/agent.js'
import type { ContentBlock } from '../types/messages.js'
import { TextBlock } from '../types/messages.js'
import { HookableEvent } from '../hooks/events.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import type { HookCallback, HookableEventConstructor, HookCleanup } from '../hooks/types.js'
import type { MultiAgentPlugin } from './plugins.js'
import { MultiAgentPluginRegistry } from './plugins.js'
import type { NodeDefinition } from './nodes.js'
import { AgentNode, MultiAgentNode, Node } from './nodes.js'
import { MultiAgentState, MultiAgentResult, NodeResult, Status } from './state.js'
import type { MultiAgent } from './multiagent.js'
import { Swarm } from './swarm.js'
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
import type { EdgeDefinition } from './edge.js'
import { Edge } from './edge.js'
import { Queue } from './queue.js'

/**
 * Runtime configuration for graph execution.
 */
export interface GraphConfig {
  /** Max nodes executing in parallel. */
  maxConcurrency?: number
  /** Max total steps (prevents infinite loops in cyclic graphs). */
  maxSteps?: number
}

/**
 * Options for creating a Graph instance.
 */
export interface GraphOptions extends GraphConfig {
  /** Unique identifier for this graph. Defaults to `'graph'`. */
  id?: string
  /** Node definitions to construct the graph from. */
  nodes: NodeDefinition[]
  /** Edge definitions describing connections between nodes. */
  edges: EdgeDefinition[]
  /** Explicit source node IDs. If omitted, auto-detected from nodes with no incoming edges. */
  sources?: string[]
  /** Plugins for event-driven extensibility. */
  plugins?: MultiAgentPlugin[]
}

/**
 * Directed graph orchestration pattern.
 *
 * Agents execute as nodes in a dependency graph, with edges defining execution order
 * and optional conditions controlling routing. Source nodes (those with no incoming edges)
 * run first, and downstream nodes execute once all their dependencies complete. Parallel
 * execution is supported up to a configurable concurrency limit.
 *
 * Key design choices vs the Python SDK:
 * - Construction uses a declarative options object rather than a mutable GraphBuilder.
 *   Nodes and edges are passed directly to the constructor.
 * - Dependency resolution uses AND semantics: a node runs only when all incoming edges
 *   are satisfied. Python uses OR semantics, firing a node when any single incoming
 *   edge from the completed batch is satisfied.
 * - Nodes are launched individually as they become ready (up to maxConcurrency). Python
 *   executes in discrete batches, waiting for the entire batch to complete before
 *   scheduling the next set of nodes.
 * - Agent nodes are stateless by default (snapshot/restore on each execution). Python
 *   accumulates agent state across executions unless `reset_on_revisit` is enabled.
 * - Node failures produce a FAILED result, allowing parallel paths to continue.
 *   MultiAgent-level limits (maxSteps) throw exceptions. Python does the inverse:
 *   node failures throw exceptions (fail-fast), while limit violations return a
 *   FAILED result.
 *
 * @example
 * ```typescript
 * const graph = new Graph({
 *   nodes: [researcher, writer],
 *   edges: [['researcher', 'writer']],
 * })
 *
 * const result = await graph.invoke('Explain quantum computing')
 * ```
 */
export class Graph implements MultiAgent {
  readonly id: string
  readonly nodes: ReadonlyMap<string, Node>
  readonly edges: readonly Edge[]
  readonly config: Required<GraphConfig>
  private readonly _pluginRegistry: MultiAgentPluginRegistry
  private readonly _hookRegistry: HookRegistryImplementation
  private readonly _sources: Node[]
  private _initialized: boolean

  constructor(options: GraphOptions) {
    const { id, nodes, edges, sources, plugins, ...config } = options

    this.id = id ?? 'graph'

    this.config = {
      maxConcurrency: config.maxConcurrency ?? Infinity,
      maxSteps: config.maxSteps ?? Infinity,
    }
    this._validateConfig()

    this.nodes = this._resolveNodes(nodes)
    this.edges = this._resolveEdges(edges)
    this._sources = this._resolveSources(sources)
    this._validateSources()

    this._hookRegistry = new HookRegistryImplementation()
    this._pluginRegistry = new MultiAgentPluginRegistry(plugins)
    this._initialized = false
  }

  /**
   * Initialize the graph. Invokes the {@link MultiAgentInitializedEvent} callback.
   * Called automatically on first invocation.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return
    await this._pluginRegistry.initialize(this)
    await this._hookRegistry.invokeCallbacks(new MultiAgentInitializedEvent({ orchestrator: this }))
    this._initialized = true
  }

  /**
   * Invoke graph and return final result (consumes stream).
   *
   * @param input - The input to pass to entry point nodes
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
   * Register a hook callback for a specific graph event type.
   *
   * @param eventType - The event class constructor to register the callback for
   * @param callback - The callback function to invoke when the event occurs
   * @returns Cleanup function that removes the callback when invoked
   */
  addHook<T extends HookableEvent>(eventType: HookableEventConstructor<T>, callback: HookCallback<T>): HookCleanup {
    return this._hookRegistry.addCallback(eventType, callback)
  }

  /**
   * Stream graph execution, yielding events as nodes execute.
   * Invokes hook callbacks for each event before yielding.
   *
   * @param input - The input to pass to entry nodes
   * @returns Async generator yielding streaming events and returning a MultiAgentResult
   */
  async *stream(input: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    await this.initialize()

    const gen = this._stream(input)
    try {
      let next = await gen.next()
      while (!next.done) {
        if (next.value instanceof HookableEvent) {
          await this._hookRegistry.invokeCallbacks(next.value)
        }
        yield next.value
        next = await gen.next()
      }
      return next.value
    } finally {
      await gen.return(undefined as never)
    }
  }

  private async *_stream(input: InvokeArgs): AsyncGenerator<MultiAgentStreamEvent, MultiAgentResult, undefined> {
    const state = new MultiAgentState({ nodeIds: [...this.nodes.keys()] })

    const queue = new Queue()
    const targets = [...this._sources]
    const streams = new Map<string, Promise<void>>()

    yield new BeforeMultiAgentInvocationEvent({ orchestrator: this, state })

    try {
      while (targets.length > 0 || streams.size > 0) {
        while (targets.length > 0 && streams.size < this.config.maxConcurrency) {
          const node = targets.shift()!

          this._checkSteps(state)
          state.steps++

          streams.set(node.id, this._streamNode(node, input, state, queue))
        }

        await queue.wait()
        while (queue.size > 0) {
          const { data, ack } = queue.shift()!

          if (data.type === 'event') {
            yield data.event
            ack()
            continue
          }

          if (data.type === 'error') {
            streams.delete(data.node.id)
            ack()
            throw data.error
          }

          const { node, result } = data
          streams.delete(node.id)
          ack()

          state.results.push(result)

          const ready = await this._findReady(node, state, streams, targets)
          if (ready.length > 0) {
            yield new MultiAgentHandoffEvent({
              source: node.id,
              targets: ready.map((n) => n.id),
              state,
            })
            targets.push(...ready)
          }
        }
      }
    } finally {
      queue.dispose()
      await Promise.allSettled(streams.values())
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

  /**
   * Executes a single node, pushing streaming events to the shared queue in real-time.
   */
  private async _streamNode(node: Node, input: InvokeArgs, state: MultiAgentState, queue: Queue): Promise<void> {
    const nodeState = state.node(node.id)!

    const beforeEvent = new BeforeNodeCallEvent({ orchestrator: this, state, nodeId: node.id })
    await queue.send({ type: 'event', node, event: beforeEvent })

    if (beforeEvent.cancel) {
      const message = typeof beforeEvent.cancel === 'string' ? beforeEvent.cancel : 'node cancelled by hook'
      const result = new NodeResult({ nodeId: node.id, status: Status.CANCELLED, duration: 0 })
      nodeState.status = Status.CANCELLED
      nodeState.results.push(result)

      await queue.send({
        type: 'event',
        node,
        event: new NodeCancelEvent({ nodeId: node.id, state, message }),
      })
      await queue.send({
        type: 'event',
        node,
        event: new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id }),
      })
      queue.push({ type: 'result', node, result })
      return
    }

    try {
      const nodeInput = this._resolveNodeInput(node, input, state)

      const gen = node.stream(nodeInput, state)
      let next = await gen.next()
      while (!next.done) {
        await queue.send({ type: 'event', node, event: next.value })
        next = await gen.next()
      }
      queue.push({ type: 'result', node, result: next.value })

      await queue.send({
        type: 'event',
        node,
        event: new AfterNodeCallEvent({ orchestrator: this, state, nodeId: node.id }),
      })
    } catch (error) {
      await queue.send({
        type: 'event',
        node,
        event: new AfterNodeCallEvent({
          orchestrator: this,
          state,
          nodeId: node.id,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      })
      queue.push({
        type: 'error',
        node,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private _validateConfig(): void {
    if (this.config.maxConcurrency < 1) {
      throw new Error(`max_concurrency=<${this.config.maxConcurrency}> | must be at least 1`)
    }
    if (this.config.maxSteps < 1) {
      throw new Error(`max_steps=<${this.config.maxSteps}> | must be at least 1`)
    }
  }

  private _validateSources(): void {
    if (this._sources.length === 0) {
      throw new Error('graph has no source nodes')
    }

    const visited = new Set<string>()
    const adjacency = new Map<string, string[]>()
    for (const edge of this.edges) {
      const targets = adjacency.get(edge.source.id) ?? []
      targets.push(edge.target.id)
      adjacency.set(edge.source.id, targets)
    }

    const queue = this._sources.map((n) => n.id)
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      for (const target of adjacency.get(id) ?? []) {
        queue.push(target)
      }
    }

    for (const id of this.nodes.keys()) {
      if (!visited.has(id)) {
        throw new Error(`node_id=<${id}> | unreachable from any source node`)
      }
    }
  }

  private _resolveNodes(definitions: NodeDefinition[]): Map<string, Node> {
    const nodes = new Map<string, Node>()

    for (const definition of definitions) {
      let node: Node

      if (definition instanceof Node) {
        node = definition
      } else if ('orchestrator' in definition) {
        node = new MultiAgentNode(definition)
      } else if ('agent' in definition) {
        node = new AgentNode(definition)
      } else if (definition instanceof Graph || definition instanceof Swarm) {
        node = new MultiAgentNode({ orchestrator: definition })
      } else {
        node = new AgentNode({ agent: definition as InvokableAgent })
      }

      if (nodes.has(node.id)) {
        throw new Error(`node_id=<${node.id}> | duplicate node id`)
      }
      nodes.set(node.id, node)
    }

    return nodes
  }

  private _resolveEdges(definitions: EdgeDefinition[]): Edge[] {
    const edges: Edge[] = []
    for (const definition of definitions) {
      const [sourceId, targetId, handler] = Array.isArray(definition)
        ? [definition[0], definition[1], undefined]
        : [definition.source, definition.target, definition.handler]

      const source = this.nodes.get(sourceId)
      const target = this.nodes.get(targetId)
      if (!source) {
        throw new Error(`source=<${sourceId}> | edge references unknown source node`)
      }
      if (!target) {
        throw new Error(`target=<${targetId}> | edge references unknown target node`)
      }
      edges.push(new Edge({ source, target, ...(handler && { handler }) }))
    }
    return edges
  }

  private _resolveSources(sourceIds?: string[]): Node[] {
    if (sourceIds) {
      const sources: Node[] = []
      for (const id of sourceIds) {
        const node = this.nodes.get(id)
        if (!node) {
          throw new Error(`source=<${id}> | source references unknown node`)
        }
        sources.push(node)
      }
      return sources
    }

    const targetIds = new Set(this.edges.map((e) => e.target.id))
    return [...this.nodes.values()].filter((node) => !targetIds.has(node.id))
  }

  /**
   * Identifies terminus nodes and returns their combined content.
   * A terminus node is where an execution path ended: completed with no
   * downstream progress, or failed/cancelled.
   */
  private _resolveContent(state: MultiAgentState): ContentBlock[] {
    for (const [id, ns] of state.nodes.entries()) {
      if (ns.status === Status.FAILED || ns.status === Status.CANCELLED) {
        ns.terminus = true
      } else if (ns.status === Status.COMPLETED) {
        ns.terminus = !this.edges
          .filter((e) => e.source.id === id)
          .some((e) => state.node(e.target.id)?.status !== Status.PENDING)
      }
    }
    return [...state.nodes.values()].filter((ns) => ns.terminus).flatMap((ns) => ns.content)
  }

  /**
   * Builds the input for a node by combining the original task with dependency outputs.
   */
  private _resolveNodeInput(node: Node, input: InvokeArgs, state: MultiAgentState): InvokeArgs {
    const deps: ContentBlock[] = []
    for (const edge of this.edges.filter((e) => e.target.id === node.id)) {
      const ns = state.node(edge.source.id)!
      if (ns.content.length > 0) {
        deps.push(new TextBlock(`[node: ${edge.source.id}]`), ...ns.content)
      }
    }

    if (deps.length === 0) return input

    const blocks: ContentBlock[] = typeof input === 'string' ? [new TextBlock(input)] : (input as ContentBlock[])
    return [...blocks, ...deps]
  }

  private _checkSteps(state: MultiAgentState): void {
    if (state.steps >= this.config.maxSteps) {
      throw new Error(`steps=<${state.steps}> | max steps reached`)
    }
  }

  /**
   * Finds downstream nodes that are ready to execute after a node completes.
   * A target is ready when all its incoming edge sources are COMPLETED.
   */
  private async _findReady(
    node: Node,
    state: MultiAgentState,
    streams: ReadonlyMap<string, Promise<void>>,
    targets: readonly Node[]
  ): Promise<Node[]> {
    if (state.node(node.id)?.status !== Status.COMPLETED) return []

    const ready: Node[] = []

    for (const edge of this.edges.filter((e) => e.source.id === node.id)) {
      if (!(await edge.handler(state))) continue

      if (streams.has(edge.target.id) || targets.some((n) => n.id === edge.target.id)) continue

      const deps = this.edges.filter((e) => e.target.id === edge.target.id)
      if (deps.every((e) => state.node(e.source.id)?.status === Status.COMPLETED)) {
        ready.push(edge.target)
      }
    }

    return ready
  }
}
