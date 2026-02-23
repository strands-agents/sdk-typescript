/**
 * Session management module for conversation persistence and restoration.
 *
 * Provides snapshot-based session management with pluggable storage backends.
 * Supports conversation history, state persistence, and branching.
 *
 * @example
 * ```typescript
 * import { FileStorage, SnapshotStorage } from '@strands/agents/session'
 *
 * const storage = new FileStorage('./sessions')
 * await storage.saveSnapshot({ sessionId, scope, isLatest: true, snapshot })
 * ```
 */

// TODO: add these to top level index
// Core types
export type { Scope, Snapshot, SnapshotManifest, SnapshotTriggerCallback } from './types.js'

// Storage layer
export type { SessionStorage, SnapshotStorage, SnapshotLocation } from './storage.js'

// Storage implementations
export { FileStorage } from './file-storage.js'
export { S3Storage, type S3StorageConfig } from './s3-storage.js'
