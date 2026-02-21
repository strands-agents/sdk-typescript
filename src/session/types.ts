import type { AgentData } from '../types/agent.js'

// Re-export Snapshot and Scope from the canonical location
export type { Snapshot, Scope } from '../agent/snapshot.js'

/**
 * Manifest tracks snapshot metadata and ID allocation.
 * Stored alongside snapshots to manage versioning.
 */
export interface SnapshotManifest {
  /** Schema version for forward/backward compatibility */
  schemaVersion: string
  /** Next available snapshot ID for allocation */
  nextSnapshotId: string
  /** ISO 8601 timestamp of last manifest update */
  updatedAt: string
}

/**
 * Parameters passed to SnapshotTriggerCallback to determine when to create snapshots.
 */
export interface SnapshotTriggerParams {
  /** Number of agent invocations (turns) since session started */
  turnCount: number
  /** Timestamp (ms) of last immutable snapshot creation, undefined if no snapshot yet */
  lastSnapshotAt?: number
  /** Current agent data including messages and state */
  agentData: AgentData
}

/**
 * Callback function to determine when to create immutable snapshots.
 * Called after each agent invocation to decide if a snapshot should be saved.
 *
 * @param params - Snapshot trigger parameters
 * @returns true to create a snapshot, false to skip
 *
 * @example
 * ```ts
 * // Snapshot every 5 turns
 * const trigger: SnapshotTriggerCallback = ({ turnCount }) => turnCount % 5 === 0
 *
 * // Snapshot every 60 seconds
 * const trigger: SnapshotTriggerCallback = ({ lastSnapshotAt }) => {
 *   if (!lastSnapshotAt) return false
 *   return Date.now() - lastSnapshotAt > 60000
 * }
 *
 * // Snapshot when conversation exceeds 10 messages
 * const trigger: SnapshotTriggerCallback = ({ agentData }) => agentData.messages.length > 10
 * ```
 */
export type SnapshotTriggerCallback = (params: SnapshotTriggerParams) => boolean
