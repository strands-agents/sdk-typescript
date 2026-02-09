import type { Message, SystemPrompt } from '../../types/messages.js'

/**
 * Scope defines the context for session data.
 * Sessions can be scoped to a single agent or a multi-agent system.
 */
export type Scope = { kind: 'agent'; agentId: string } | { kind: 'multi_agent'; multiAgentId: string }

/**
 * Snapshot represents a point-in-time capture of agent runtime state.
 * Contains all data needed to restore an agent to a specific conversation state.
 */
export interface Snapshot {
  /** Schema version for forward/backward compatibility */
  schemaVersion: number
  /** Session identifier */
  sessionId: string
  /** Scope of the snapshot (agent or multi-agent) */
  scope: Scope
  /** Sequential snapshot identifier (0 = latest, 1+ = immutable history) */
  snapshotId: number
  /** Conversation history */
  messages: Message[]
  /** Agent state key-value pairs */
  state: Record<string, unknown>
  /** System prompt for agent behavior */
  systemPrompt?: SystemPrompt
  /** ISO 8601 timestamp of snapshot creation */
  createdAt: string
}

/**
 * Manifest tracks snapshot metadata and ID allocation.
 * Stored alongside snapshots to manage versioning.
 */
export interface SnapshotManifest {
  /** Schema version for forward/backward compatibility */
  schemaVersion: number
  /** Next available snapshot ID for allocation */
  nextSnapshotId: number
  /** ISO 8601 timestamp of last manifest update */
  updatedAt: string
}

/**
 * Callback function to determine when to create immutable snapshots.
 * Called after each agent invocation to decide if a snapshot should be saved.
 *
 * @param params - Object containing turnCount and optional lastSnapshotMs
 * @returns true to create a snapshot, false to skip
 *
 * @example
 * ```ts
 * // Snapshot every 5 turns
 * const trigger: SnapshotTriggerCallback = (\{ turnCount \}) => turnCount % 5 === 0
 *
 * // Snapshot every 60 seconds
 * const trigger: SnapshotTriggerCallback = (\{ lastSnapshotMs \}) => \{
 *   if (!lastSnapshotMs) return false
 *   return Date.now() - lastSnapshotMs \> 60000
 * \}
 * ```
 *
 * @remarks
 * Future versions may extend params to include message count, state size, etc.
 */
export type SnapshotTriggerCallback = (params: { turnCount: number; lastSnapshotMs?: number | undefined }) => boolean
