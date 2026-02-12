import type { Scope, Snapshot, SnapshotManifest } from './types.js'

/**
 * SessionStorage configuration for pluggable storage backends.
 * Allows users to configure snapshot and transcript storage independently.
 *
 * @example
 * ```typescript
 * const storage: SessionStorage = {
 *   snapshot: new S3SnapshotStorage({ bucket: 'my-bucket' })
 * }
 * ```
 */
export type SessionStorage = {
  snapshot: SnapshotStorage
  // TODO: Fast-follow - Transcript support
}

/**
 * Abstract base class for snapshot persistence.
 * Implementations provide storage backends (S3, filesystem, etc.).
 *
 * File layout convention:
 * ```
 * sessions/<session_id>/
 *   scopes/
 *     agent/<agent_id>/
 *       snapshots/
 *         snapshot_latest.json
 *         manifest.json
 *         immutable_history/
 *           snapshot_00001.json
 *           snapshot_00002.json
 * ```
 */
export abstract class SnapshotStorage {
  /**
   * Persists a snapshot to storage.
   *
   * @param sessionId - Session identifier
   * @param scope - Scope of the snapshot
   * @param isLatest - If true, save as snapshot_latest.json; otherwise save to immutable_history
   * @param snapshot - Snapshot data to persist
   */
  abstract saveSnapshot(sessionId: string, scope: Scope, isLatest: boolean, snapshot: Snapshot): Promise<void>

  /**
   * Loads a snapshot from storage.
   *
   * @param sessionId - Session identifier
   * @param scope - Scope of the snapshot
   * @param snapshotId - Snapshot ID to load (null = latest)
   * @returns Snapshot data or null if not found
   */
  abstract loadSnapshot(sessionId: string, scope: Scope, snapshotId: number | null): Promise<Snapshot | null>

  /**
   * Lists all available snapshot IDs for a session scope.
   *
   * @param sessionId - Session identifier
   * @param scope - Scope of the snapshots
   * @returns Array of snapshot IDs (sorted ascending)
   */
  abstract listSnapshot(sessionId: string, scope: Scope): Promise<number[]>

  /**
   * Loads the snapshot manifest.
   *
   * @param params - Parameters that contains sessionId and scope
   * @returns Manifest data
   */
  abstract loadManifest(params: { sessionId: string; scope: Scope }): Promise<SnapshotManifest>

  /**
   * Saves the snapshot manifest.
   *
   * @param params - Parameters that contains sessionId, scope and SnapshotManifest
   */
  abstract saveManifest(params: { sessionId: string; scope: Scope; manifest: SnapshotManifest }): Promise<void>
}
