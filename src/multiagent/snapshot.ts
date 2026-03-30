/**
 * Snapshot implementation for multi-agent orchestrators (Graph and Swarm).
 *
 * Well-known keys in data:
 * - `orchestratorId` — orchestrator identity for validation on load
 * - `nodes`          — per-node snapshots keyed by node ID (full preset only)
 * - `state`          — serialized MultiAgentState (absent for nested orchestrators
 *                      whose execution state is ephemeral)
 */

import type { JSONValue } from '../types/json.js'
import { Agent } from '../agent/agent.js'
import {
  takeSnapshot as takeAgentSnapshot,
  loadSnapshot as loadAgentSnapshot,
  createTimestamp,
} from '../agent/snapshot.js'
import type { TakeSnapshotOptions } from '../agent/snapshot.js'
import { SNAPSHOT_SCHEMA_VERSION } from '../types/snapshot.js'
import type { Snapshot } from '../types/snapshot.js'
import { AgentNode, MultiAgentNode } from './nodes.js'
import type { MultiAgentState } from './state.js'
import { serializeStateSerializable, loadStateSerializable } from '../types/serializable.js'
import type { Swarm } from './swarm.js'
import type { Graph } from './graph.js'
import { logger } from '../logging/logger.js'

/**
 * Multi-agent snapshot presets.
 *
 * - `session` — lightweight: orchestratorId + MultiAgentState only.
 *   Suitable for session manager integration; additional fields
 *   (e.g. currentNodeId, routing state) can be added as needed.
 *
 * - `full` (default) — everything: orchestratorId + MultiAgentState + per-node agent snapshots.
 *   For checkpointing, debugging, or preserving agent base state across runs.
 *   Nested MultiAgentNodes are snapshotted recursively. Their execution state
 *   is ephemeral (created per stream() call), so only agent base states and
 *   orchestratorId are captured. If nested state becomes available in the future,
 *   the format supports it without changes.
 */
export type MultiAgentSnapshotPreset = 'session' | 'full'

/**
 * Options for taking a multi-agent snapshot.
 */
export interface TakeMultiAgentSnapshotOptions {
  /** Preset controlling what to capture. Defaults to 'full'. */
  preset?: MultiAgentSnapshotPreset
  /** Application-owned data. Strands does not read or modify this. */
  appData?: Record<string, JSONValue>
  /** Per-agent snapshot options, used when preset is 'full'. */
  agentSnapshotOptions?: TakeSnapshotOptions
}

/**
 * Takes a snapshot of a multi-agent orchestrator's current state.
 *
 * NOTE: This is currently an internal implementation detail. We anticipate
 * exposing this as a public method in a future release after API review.
 *
 * @param orchestrator - The Graph or Swarm to snapshot
 * @param state - The current execution state, or undefined for nested orchestrators
 *   whose state is ephemeral and not available from outside
 * @param options - Multi-agent snapshot options
 * @returns A snapshot of the orchestrator's state
 */
export function takeSnapshot(
  orchestrator: Graph | Swarm,
  state?: MultiAgentState,
  options: TakeMultiAgentSnapshotOptions = {}
): Snapshot {
  const preset = options.preset ?? 'full'

  const data: Record<string, JSONValue> = {
    orchestratorId: orchestrator.id,
  }

  if (state) {
    data.state = serializeStateSerializable(state)
  }

  if (preset === 'full') {
    const agentOpts = options.agentSnapshotOptions ?? ({ preset: 'session' } satisfies TakeSnapshotOptions)
    const nodeSnapshots: Record<string, JSONValue> = {}

    for (const [id, node] of orchestrator.nodes) {
      if (node instanceof AgentNode && node.agent instanceof Agent) {
        nodeSnapshots[id] = takeAgentSnapshot(node.agent, agentOpts) as unknown as JSONValue
      } else if (node instanceof AgentNode) {
        logger.warn(
          `node_id=<${id}> | AgentNode wraps a non-Agent InvokableAgent; ` +
            `snapshot will not include this node's state`
        )
      } else if (node instanceof MultiAgentNode) {
        const inner = node.orchestrator as Graph | Swarm
        nodeSnapshots[id] = takeSnapshot(inner, undefined, {
          ...options,
          appData: {},
        }) as unknown as JSONValue
      }
    }

    if (Object.keys(nodeSnapshots).length > 0) {
      data.nodes = nodeSnapshots as JSONValue
    }
  }

  return {
    scope: 'multiAgent',
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    createdAt: createTimestamp(),
    data,
    appData: options.appData ?? {},
  }
}

/**
 * Loads a multi-agent snapshot, restoring node base states and optionally execution state.
 *
 * Follows the same mutate-in-place pattern as the agent snapshot: the orchestrator's
 * per-node agents are restored directly, and if a `state` instance is provided, execution
 * state is loaded into it. Execution state is a separate parameter (rather than a field on
 * the orchestrator) because orchestrators create ephemeral state per `stream()` call —
 * there is no persistent state field to mutate.
 *
 * NOTE: This is currently an internal implementation detail. We anticipate
 * exposing this as a public method in a future release after API review.
 *
 * @param orchestrator - The Graph or Swarm to restore into
 * @param snapshot - The snapshot to load
 * @param state - Optional MultiAgentState to restore execution state into
 */
export function loadSnapshot(orchestrator: Graph | Swarm, snapshot: Snapshot, state?: MultiAgentState): void {
  if (snapshot.scope !== 'multiAgent') {
    throw new Error(`Expected snapshot scope 'multiAgent', got '${snapshot.scope}'`)
  }
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported snapshot schema version: ${snapshot.schemaVersion}. Current version: ${SNAPSHOT_SCHEMA_VERSION}`
    )
  }

  const orchestratorId = snapshot.data.orchestratorId as string
  if (orchestratorId !== orchestrator.id) {
    throw new Error(`Snapshot orchestrator ID mismatch: expected '${orchestrator.id}', got '${orchestratorId}'`)
  }

  // Restore per-node state if present (full preset)
  const nodeSnapshots = snapshot.data.nodes as Record<string, JSONValue> | undefined
  if (nodeSnapshots) {
    for (const [id, data] of Object.entries(nodeSnapshots)) {
      const node = orchestrator.nodes.get(id)
      if (!node) {
        logger.warn(`node_id=<${id}> | snapshot references unknown node, skipping`)
        continue
      }
      if (node instanceof AgentNode && node.agent instanceof Agent) {
        loadAgentSnapshot(node.agent, data as unknown as Snapshot)
      } else if (node instanceof AgentNode) {
        logger.warn(
          `node_id=<${id}> | AgentNode wraps a non-Agent InvokableAgent; ` +
            `cannot restore snapshot state for this node`
        )
      } else if (node instanceof MultiAgentNode) {
        const child = node.orchestrator as Graph | Swarm
        const childSnapshot = data as unknown as Snapshot
        const childId = childSnapshot.data.orchestratorId as string
        if (childId !== child.id) {
          logger.warn(
            `node_id=<${id}> | nested orchestrator ID mismatch: ` + `expected '${child.id}', got '${childId}', skipping`
          )
          continue
        }
        loadSnapshot(child, childSnapshot)
      }
    }
  }

  if (state && 'state' in snapshot.data && snapshot.data.state != null) {
    loadStateSerializable(state, snapshot.data.state)
  }
}
