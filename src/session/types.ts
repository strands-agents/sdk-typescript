import type { Message, SystemPrompt } from '../types/messages.js'
import type { AgentData } from '../types/agent.js'

/**
 * Scope defines the context for session data.
 * Sessions can be scoped to a single agent or a multi-agent system.
 */
export type Scope = { kind: 'agent'; agentId: string } | { kind: 'multiAgent'; multiAgentId: string }

/**
 * Snapshot represents a point-in-time capture of agent runtime state.
 * Contains all data needed to restore an agent to a specific conversation state.
 */
export interface Snapshot {
  /** Schema version for forward/backward compatibility */
  schemaVersion: string
  /** Scope of the snapshot (agent or multi-agent) */
  scope: Scope
  /** Snapshot identifier (e.g., "1", "2", or custom string IDs for future extensibility) */
  snapshotId: string
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
  lastSnapshotMs?: number
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
 * const trigger: SnapshotTriggerCallback = ({ lastSnapshotMs }) => {
 *   if (!lastSnapshotMs) return false
 *   return Date.now() - lastSnapshotMs > 60000
 * }
 *
 * // Snapshot when conversation exceeds 10 messages
 * const trigger: SnapshotTriggerCallback = ({ agentData }) => agentData.messages.length > 10
 * ```
 */
export type SnapshotTriggerCallback = (params: SnapshotTriggerParams) => boolean
