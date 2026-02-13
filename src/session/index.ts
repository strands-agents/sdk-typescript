/**
 * Session management module for conversation persistence and restoration.
 *
 * Provides snapshot-based session management with pluggable storage backends.
 * Supports conversation history, state persistence, and branching.
 *
 * @example
 * ```typescript
 * import { FileSnapshotStorage, SnapshotStorage } from '@strands/agents/session'
 *
 * const storage = new FileSnapshotStorage('./sessions')
 * await storage.saveSnapshot(sessionId, scope, true, snapshot)
 * ```
 */

// Core types
export type { Scope, Snapshot, SnapshotManifest, SnapshotTriggerCallback } from './types.js'

// Storage layer
export type { SessionStorage } from './storage.js'
export { SnapshotStorage } from './storage.js'

// Storage implementations
export { FileSnapshotStorage } from './file-snapshot-storage.js'
export { S3SnapshotStorage, type S3SnapshotStorageConfig } from './s3-snapshot-storage.js'
