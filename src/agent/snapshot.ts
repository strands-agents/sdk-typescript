/**
 * Snapshot API for capturing and restoring agent state.
 *
 * This module provides types and utilities for point-in-time capture and restoration
 * of agent state, enabling use cases like checkpointing, undo/redo, and branching
 * conversation flows.
 *
 * NOTE: The takeSnapshot and loadSnapshot functions are currently internal implementation
 * details. We anticipate opening these up as public Agent methods in a future release
 * after API review, but for now they are top-level functions to unblock snapshot
 * functionality without committing to a public API surface.
 */

import type { JSONValue } from '../types/json.js'
import type { MessageData, SystemPromptData } from '../types/messages.js'
import { Message, systemPromptFromData, systemPromptToData } from '../types/messages.js'
import { isStateSerializable } from '../types/serializable.js'
import type { Agent } from './agent.js'

/**
 * Current version of the snapshot format.
 */
export const SNAPSHOT_VERSION = '1.0'

/**
 * All available fields that can be included in a snapshot.
 */
export const ALL_SNAPSHOT_FIELDS = ['messages', 'state', 'conversationManagerState', 'systemPrompt'] as const

/**
 * Strongly typed preset definitions for snapshot field selection.
 * This object allows easy evolution of presets and type-safe access.
 */
export const SNAPSHOT_PRESETS = {
  session: ['messages', 'state', 'conversationManagerState', 'systemPrompt'] as const,
} as const

/**
 * Preset name for snapshot field selection.
 */
export type SnapshotPreset = keyof typeof SNAPSHOT_PRESETS

/**
 * Valid snapshot field names.
 */
export type SnapshotField = (typeof ALL_SNAPSHOT_FIELDS)[number]

/**
 * Point-in-time capture of agent state.
 */
export interface Snapshot {
  /**
   * String identifying the snapshot type (e.g., "agent"). Strands-owned.
   */
  type: string

  /**
   * Version string for forward compatibility. Strands-owned.
   */
  version: string

  /**
   * ISO 8601 timestamp of when snapshot was taken. Strands-owned.
   */
  timestamp: string

  /**
   * Agent's evolving state (opaque to callers). Strands-owned.
   */
  data: Record<string, JSONValue>

  /**
   * Application-owned data. Strands does not read or modify this.
   */
  appData: Record<string, JSONValue>
}

/**
 * Creates an ISO 8601 timestamp string.
 *
 * @returns Current timestamp in ISO 8601 format
 */
export function createTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Options for taking a snapshot of agent state.
 */
export type TakeSnapshotOptions = {
  /**
   * Preset to use as the starting set of fields.
   * If not specified, starts with an empty set (unless include is specified).
   */
  preset?: SnapshotPreset
  /**
   * Fields to add to the snapshot.
   * These are added to the preset fields (if any).
   */
  include?: SnapshotField[]
  /**
   * Fields to exclude from the snapshot.
   * Applied after preset and include to filter out specific fields.
   */
  exclude?: SnapshotField[]
  /**
   * Application-owned data to store in the snapshot.
   * Strands does not read or modify this data.
   */
  appData?: Record<string, JSONValue>
}

/**
 * Takes a snapshot of the agent's current state.
 *
 * NOTE: This is currently an internal implementation detail. We anticipate
 * exposing this as a public Agent method in a future release after API review.
 *
 * @param agent - The agent to snapshot
 * @param options - Snapshot options
 * @returns A snapshot of the agent's state
 */
export function takeSnapshot(agent: Agent, options: TakeSnapshotOptions): Snapshot {
  const fields = resolveSnapshotFields(options)

  const data: Record<string, JSONValue> = {}

  if (fields.has('messages')) {
    data.messages = agent.messages.map((msg) => msg.toJSON()) as unknown as JSONValue
  }

  if (fields.has('state')) {
    data.state = agent.state.toJSON()
  }

  if (fields.has('conversationManagerState')) {
    data.conversationManagerState = isStateSerializable(agent.conversationManager)
      ? agent.conversationManager.toJSON()
      : {}
  }

  if (fields.has('systemPrompt')) {
    data.systemPrompt = agent.systemPrompt !== undefined ? (systemPromptToData(agent.systemPrompt) as JSONValue) : null
  }

  return {
    type: 'agent',
    version: SNAPSHOT_VERSION,
    timestamp: createTimestamp(),
    data,
    appData: options.appData ?? {},
  }
}

/**
 * Loads a snapshot into the agent, restoring its state.
 *
 * NOTE: This is currently an internal implementation detail. We anticipate
 * exposing this as a public Agent method in a future release after API review.
 *
 * @param agent - The agent to restore state into
 * @param snapshot - The snapshot to load
 */
export function loadSnapshot(agent: Agent, snapshot: Snapshot): void {
  const { messages, state, conversationManagerState, systemPrompt } = snapshot.data

  if (messages !== undefined) {
    agent.messages.length = 0
    for (const msgData of messages as unknown as MessageData[]) {
      agent.messages.push(Message.fromJSON(msgData))
    }
  }

  if (state !== undefined) {
    agent.state.loadStateFromJson(state)
  }

  if (conversationManagerState !== undefined) {
    if (isStateSerializable(agent.conversationManager)) {
      agent.conversationManager.loadStateFromJson(conversationManagerState)
    }
  }

  // Only restore systemPrompt if explicitly present and non-null in the snapshot
  if (systemPrompt !== undefined && systemPrompt !== null) {
    agent.systemPrompt = systemPromptFromData(systemPrompt as SystemPromptData)
  }
}

/**
 * Resolves snapshot fields based on preset/include/exclude parameters.
 *
 * Order of operations:
 * 1. Start with preset fields (if specified)
 * 2. Add include fields
 * 3. Remove exclude fields
 *
 * @param options - Snapshot options containing preset, include, and exclude fields
 * @returns Set of resolved field names
 * @throws Error if no fields would be included
 */
export function resolveSnapshotFields(options: TakeSnapshotOptions): Set<SnapshotField> {
  const { preset, include, exclude } = options
  let fields: Set<SnapshotField>

  // Start with preset fields or empty set
  if (preset !== undefined) {
    if (!(preset in SNAPSHOT_PRESETS)) {
      throw new Error(`Invalid preset: ${preset}. Valid presets are: ${Object.keys(SNAPSHOT_PRESETS).join(', ')}`)
    }
    fields = new Set(SNAPSHOT_PRESETS[preset])
  } else {
    fields = new Set()
  }

  // Add include fields
  if (include !== undefined) {
    validateSnapshotFields(include)
    for (const field of include) {
      fields.add(field)
    }
  }

  // Remove exclude fields (no error if field wasn't included)
  if (exclude !== undefined) {
    validateSnapshotFields(exclude)
    for (const field of exclude) {
      fields.delete(field)
    }
  }

  // Must have at least one field
  if (fields.size === 0) {
    throw new Error('No fields to include in snapshot. Specify a preset or include fields.')
  }

  return fields
}

/**
 * Validates that all field names are valid snapshot fields.
 */
function validateSnapshotFields(fields: string[]): void {
  const validFields = new Set<string>(ALL_SNAPSHOT_FIELDS)
  for (const field of fields) {
    if (!validFields.has(field)) {
      throw new Error(`Invalid snapshot field: ${field}. Valid fields are: ${ALL_SNAPSHOT_FIELDS.join(', ')}`)
    }
  }
}
