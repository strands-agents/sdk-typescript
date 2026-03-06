/**
 * Swarm Multi-Agent Pattern Implementation.
 *
 * Collaborative agent orchestration where agents work as a team,
 * with shared context and autonomous coordination via handoff tools.
 *
 * Key Features:
 * - Self-organizing agent teams with shared working memory
 * - Tool-based coordination via auto-injected handoff_to_agent
 * - Continuation checks: max handoffs, iterations, timeout, repetitive detection
 */

import type { Agent } from '../agent/agent.js'
import { takeSnapshot, loadSnapshot } from '../agent/snapshot.js'
import type { Snapshot } from '../agent/snapshot.js'
import { tool } from '../tools/zod-tool.js'
import { z } from 'zod'
import type { ContentBlock } from '../types/messages.js'
import { MultiAgentHandoffEvent, MultiAgentResultEvent, NodeStreamUpdateEvent, NodeResultEvent } from './events.js'
import type { MultiAgentStreamEvent } from './events.js'
import { MultiAgentResult, NodeResult, Status } from './state.js'

/**
 * Error thrown when swarm execution limits are exceeded.
 */
export class SwarmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwarmError'
  }
}

/**
 * Shared working memory between swarm nodes.
 */
export class SharedContext {
  private _data: Map<string, Map<string, unknown>> = new Map()

  get(namespace: string, key: string): unknown | undefined {
    return this._data.get(namespace)?.get(key)
  }

  set(namespace: string, key: string, value: unknown): void {
    let ns = this._data.get(namespace)
    if (!ns) {
      ns = new Map()
      this._data.set(namespace, ns)
    }
    ns.set(key, value)
  }

  getNamespace(namespace: string): Map<string, unknown> {
    return this._data.get(namespace) ?? new Map()
  }

  toJSON(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {}
    for (const [ns, map] of this._data) {
      result[ns] = Object.fromEntries(map)
    }
    return result
  }

  static fromJSON(data: Record<string, Record<string, unknown>>): SharedContext {
    const ctx = new SharedContext()
    for (const [ns, entries] of Object.entries(data)) {
      for (const [key, value] of Object.entries(entries)) {
        ctx.set(ns, key, value)
      }
    }
    return ctx
  }
}

/**
 * Tracks execution state across handoffs.
 */
export interface SwarmState {
  currentNode: string
  task: string
  completed: boolean
  nodeHistory: string[]
  metrics: { totalHandoffs: number; totalIterations: number; startTime: number }
}

export interface SwarmOptions {
  entryPoint: string
  maxHandoffs?: number
  maxIterations?: number
  executionTimeout?: number
  repetitiveHandoffWindow?: number
  repetitiveHandoffMinUnique?: number
  sharedContext?: SharedContext
}

export interface SwarmInvokeOptions {
  signal?: AbortSignal
}

export interface SwarmResult {
  content: ContentBlock[]
  state: SwarmState
  metrics: { totalHandoffs: number; totalIterations: number; durationMs: number }
}

/**
 * Wraps an Agent for use in a Swarm with snapshot/restore.
 */
export class SwarmNode {
  readonly id: string
  readonly agent: Agent
  private _snapshot: Snapshot | undefined

  constructor(id: string, agent: Agent) {
    this.id = id
    this.agent = agent
    this._snapshot = takeSnapshot(agent, { include: ['messages', 'state'] })
  }

  reset(): void {
    if (this._snapshot) {
      loadSnapshot(this.agent, this._snapshot)
    }
  }

  saveSnapshot(): Snapshot {
    this._snapshot = takeSnapshot(this.agent, { include: ['messages', 'state'] })
    return this._snapshot
  }
}

/**
 * Pending handoff request set by the handoff_to_agent tool.
 */
interface PendingHandoff {
  targetNode: string
  reason: string
  context: Record<string, unknown> | undefined
}

/**
 * High-level swarm orchestration over SwarmNodes.
 *
 * Execution loop:
 * 1. Start at entryPoint node
 * 2. Run node's agent via stream()
 * 3. After agent completes, check if handoff was requested
 * 4. If handoff, record it, check limits, switch to target
 * 5. If no handoff, mark completed, stop
 */
export class Swarm {
  private readonly _nodes: Map<string, SwarmNode>
  private readonly _entryPoint: string
  private readonly _maxHandoffs: number
  private readonly _maxIterations: number
  private readonly _executionTimeout: number
  private readonly _repetitiveHandoffWindow: number
  private readonly _repetitiveHandoffMinUnique: number
  private readonly _sharedContext: SharedContext

  /** Set by the handoff_to_agent tool during agent execution. */
  private _pendingHandoff: PendingHandoff | undefined

  constructor(nodes: SwarmNode[], options: SwarmOptions) {
    this._nodes = new Map(nodes.map((n) => [n.id, n]))
    this._entryPoint = options.entryPoint
    this._maxHandoffs = options.maxHandoffs ?? 250
    this._maxIterations = options.maxIterations ?? 250
    this._executionTimeout = options.executionTimeout ?? 604800000
    this._repetitiveHandoffWindow = options.repetitiveHandoffWindow ?? 10
    this._repetitiveHandoffMinUnique = options.repetitiveHandoffMinUnique ?? 3
    this._sharedContext = options.sharedContext ?? new SharedContext()
    this._pendingHandoff = undefined

    if (!this._nodes.has(this._entryPoint)) {
      throw new SwarmError(`Entry point '${this._entryPoint}' not found in nodes`)
    }

    this._injectHandoffTools()
  }

  get nodes(): ReadonlyMap<string, SwarmNode> {
    return this._nodes
  }

  get sharedContext(): SharedContext {
    return this._sharedContext
  }

  async invoke(task: string, options?: SwarmInvokeOptions): Promise<SwarmResult> {
    const gen = this.stream(task, options)
    let last: IteratorResult<MultiAgentStreamEvent, SwarmResult>
    do {
      last = await gen.next()
    } while (!last.done)
    return last.value
  }

  async *stream(
    task: string,
    options?: SwarmInvokeOptions
  ): AsyncGenerator<MultiAgentStreamEvent, SwarmResult, undefined> {
    const startTime = Date.now()
    const nodeHistory: string[] = []
    let totalHandoffs = 0
    let currentNodeId = this._entryPoint
    let completed = false
    let lastContent: ContentBlock[] = []

    while (!completed) {
      if (options?.signal?.aborted) {
        throw new SwarmError('Swarm execution aborted')
      }

      this._checkLimits(totalHandoffs, nodeHistory.length, startTime, nodeHistory)

      const node = this._nodes.get(currentNodeId)
      if (!node) {
        throw new SwarmError(`Node '${currentNodeId}' not found`)
      }

      const input = this._buildNodeInput(task, currentNodeId, nodeHistory)
      node.reset()
      this._pendingHandoff = undefined

      // Execute the node's agent
      const gen = node.agent.stream(input)
      let next = await gen.next()
      while (!next.done) {
        yield new NodeStreamUpdateEvent({
          nodeId: currentNodeId,
          nodeType: 'agentNode',
          event: next.value,
        })
        next = await gen.next()
      }

      lastContent = next.value.lastMessage.content
      nodeHistory.push(currentNodeId)

      // Check if a handoff was requested during execution
      const handoff = this._pendingHandoff as PendingHandoff | undefined
      if (handoff) {
        this._pendingHandoff = undefined

        // Store handoff context in shared context
        if (handoff.context) {
          for (const [key, value] of Object.entries(handoff.context)) {
            this._sharedContext.set(currentNodeId, key, value)
          }
        }

        totalHandoffs++

        yield new MultiAgentHandoffEvent({
          source: currentNodeId,
          targets: [handoff.targetNode],
        })

        currentNodeId = handoff.targetNode
      } else {
        // No handoff — agent completed the task
        const nodeResult = new NodeResult({
          nodeId: currentNodeId,
          status: Status.COMPLETED,
          duration: Date.now() - startTime,
          content: lastContent,
        })
        yield new NodeResultEvent({ nodeId: currentNodeId, nodeType: 'agentNode', result: nodeResult })
        completed = true
      }
    }

    const durationMs = Date.now() - startTime
    const state: SwarmState = {
      currentNode: currentNodeId,
      task,
      completed,
      nodeHistory,
      metrics: { totalHandoffs, totalIterations: nodeHistory.length, startTime },
    }

    const result: SwarmResult = {
      content: lastContent,
      state,
      metrics: { totalHandoffs, totalIterations: nodeHistory.length, durationMs },
    }

    yield new MultiAgentResultEvent({
      result: new MultiAgentResult({ results: [], duration: durationMs }),
    })

    return result
  }

  toJSON(): Record<string, unknown> {
    return {
      sharedContext: this._sharedContext.toJSON(),
      entryPoint: this._entryPoint,
      maxHandoffs: this._maxHandoffs,
      maxIterations: this._maxIterations,
      executionTimeout: this._executionTimeout,
      repetitiveHandoffWindow: this._repetitiveHandoffWindow,
      repetitiveHandoffMinUnique: this._repetitiveHandoffMinUnique,
    }
  }

  private _checkLimits(totalHandoffs: number, totalIterations: number, startTime: number, nodeHistory: string[]): void {
    if (totalHandoffs >= this._maxHandoffs) {
      throw new SwarmError(`Max handoffs reached: ${this._maxHandoffs}`)
    }
    if (totalIterations >= this._maxIterations) {
      throw new SwarmError(`Max iterations reached: ${this._maxIterations}`)
    }
    if (Date.now() - startTime >= this._executionTimeout) {
      throw new SwarmError(`Execution timed out after ${this._executionTimeout}ms`)
    }
    if (this._repetitiveHandoffWindow > 0 && nodeHistory.length >= this._repetitiveHandoffWindow) {
      const recent = nodeHistory.slice(-this._repetitiveHandoffWindow)
      const unique = new Set(recent).size
      if (unique < this._repetitiveHandoffMinUnique) {
        throw new SwarmError(
          `Repetitive handoff detected: ${unique} unique agents in last ${this._repetitiveHandoffWindow} handoffs`
        )
      }
    }
  }

  private _buildNodeInput(task: string, currentNodeId: string, nodeHistory: string[]): string {
    const parts: string[] = [`User Request: ${task}`]

    if (nodeHistory.length > 0) {
      parts.push(`Previous agents: ${nodeHistory.join(' → ')}`)
    }

    const contextJson = this._sharedContext.toJSON()
    if (Object.keys(contextJson).length > 0) {
      parts.push(`Shared context: ${JSON.stringify(contextJson)}`)
    }

    const otherNodes = [...this._nodes.keys()].filter((id) => id !== currentNodeId)
    if (otherNodes.length > 0) {
      parts.push(`Available agents for handoff: ${otherNodes.join(', ')}`)
    }

    parts.push(
      'You have access to handoff_to_agent to transfer control to another agent. ' +
        'If you do not hand off, the swarm considers the task complete.'
    )

    return parts.join('\n\n')
  }

  private _injectHandoffTools(): void {
    const nodes = this._nodes
    const nodeIds = [...nodes.keys()]
    const setPendingHandoff = (handoff: PendingHandoff): void => {
      this._pendingHandoff = handoff
    }

    const handoffTool = tool({
      name: 'handoff_to_agent',
      description: 'Transfer control to another agent in the swarm for specialized help.',
      inputSchema: z.object({
        agent_name: z.string().describe('Name of the agent to hand off to'),
        reason: z.string().describe('Why you are handing off'),
        context: z.record(z.string(), z.unknown()).optional().describe('Additional context to share'),
      }),
      callback({ agent_name, reason, context }) {
        const target = nodes.get(agent_name)
        if (!target) {
          return {
            status: 'error',
            message: `Agent '${agent_name}' not found. Available: ${nodeIds.join(', ')}`,
          }
        }

        setPendingHandoff({
          targetNode: agent_name,
          reason,
          context: context as Record<string, unknown> | undefined,
        })

        return {
          status: 'success',
          message: `Handing off to ${agent_name}: ${reason}`,
        }
      },
    })

    for (const node of this._nodes.values()) {
      node.agent.toolRegistry.add(handoffTool)
    }
  }
}

export type SwarmEvent = MultiAgentStreamEvent
