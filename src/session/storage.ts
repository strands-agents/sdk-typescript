import type { Scope, Snapshot, SnapshotManifest } from './types.js'

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
 *     agent/<agent_id>/
 *       snapshots/
 *         snapshot_latest.json
 *         manifest.json
 *         immutable_history/
 *           snapshot_00001.json
 *           snapshot_00002.json
 * ```
 */
export interface SnapshotStorage {
  /**
   * Persists a snapshot to storage.
   */
  saveSnapshot(params: { sessionId: string; scope: Scope; isLatest: boolean; snapshot: Snapshot }): Promise<void>

  /**
   * Loads a snapshot from storage.
   */
  loadSnapshot(params: { sessionId: string; scope: Scope; snapshotId: string | null }): Promise<Snapshot | null>

  /**
   * Lists all available snapshot IDs for a session scope.
   *
   * TODO: Add pagination support for long-running agents with many snapshots.
   * Future signature could be:
   * ```typescript
   * listSnapshots(params: {
   *   sessionId: string
   *   scope: Scope
   *   limit?: number        // Max results to return (e.g., 100)
   *   startAfter?: string   // Snapshot ID to start after (for cursor-based pagination)
   * }): Promise<{ snapshotIds: string[]; nextToken?: string }>
   * ```
   */
  listSnapshots(params: { sessionId: string; scope: Scope }): Promise<string[]>

  /**
   * Loads the snapshot manifest.
   */
  loadManifest(params: { sessionId: string; scope: Scope }): Promise<SnapshotManifest>

  /**
   * Saves the snapshot manifest.
   */
  saveManifest(params: { sessionId: string; scope: Scope; manifest: SnapshotManifest }): Promise<void>
}
