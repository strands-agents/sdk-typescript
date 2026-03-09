import type { Scope, Snapshot, SnapshotManifest } from './types.js'

/**
 * Identifies the location of a snapshot within the storage hierarchy.
 */
export type SnapshotLocation = {
  /** Session identifier */
  sessionId: string
  /** Scope of the snapshot (agent or multi-agent) */
  scope: Scope
  /** Scope-specific identifier (agentId or multiAgentId) */
  scopeId: string
}

/**
 * SessionStorage configuration for pluggable storage backends.
 * Allows users to configure snapshot and transcript storage independently.
 *
 * @example
 * ```typescript
 * const storage: SessionStorage = {
 *   snapshot: new S3Storage({ bucket: 'my-bucket' })
 * }
 * ```
 */
export type SessionStorage = {
  snapshot: SnapshotStorage
  // TODO: Fast-follow - Transcript support
}

/**
 * Interface for snapshot persistence.
 * Implementations provide storage backends (S3, filesystem, etc.).
 *
 * File layout convention:
 * ```
 * sessions/<session_id>/
 *   scopes/
 *     agent/<scope_id>/
 *       snapshots/
 *         snapshot_latest.json
 *         immutable_history/
 *           snapshot_<uuid>.json
 *           snapshot_<uuid>.json
 * ```
 */
export interface SnapshotStorage {
  /**
   * Persists a snapshot to storage.
   */
  saveSnapshot(params: {
    location: SnapshotLocation
    snapshotId: string
    isLatest: boolean
    snapshot: Snapshot
  }): Promise<void>

  /**
   * Loads a snapshot from storage.
   */
  loadSnapshot(params: { location: SnapshotLocation; snapshotId?: string }): Promise<Snapshot | null>

  /**
   * Lists all available snapshot IDs for a session scope, sorted chronologically.
   * Snapshot IDs are UUID v7, so lexicographic sort is chronological order.
   * `location` identifies the scope. `limit` caps results. `startAfter` is a UUID v7 cursor for pagination.
   */
  listSnapshotIds(params: { location: SnapshotLocation; limit?: number; startAfter?: string }): Promise<string[]>

  /**
   * Deletes all snapshots and directories belong to the session id .
   */
  deleteSession(params: { sessionId: string }): Promise<void>

  /**
   * Loads the snapshot manifest.
   */
  loadManifest(params: { location: SnapshotLocation }): Promise<SnapshotManifest>

  /**
   * Saves the snapshot manifest.
   */
  saveManifest(params: { location: SnapshotLocation; manifest: SnapshotManifest }): Promise<void>
}
