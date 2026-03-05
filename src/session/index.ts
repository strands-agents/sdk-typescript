/**
 * Session management module for conversation persistence and restoration.
 *
 * Exported as a separate entry point (`@strands-agents/sdk/session`) rather than
 * from the main index to avoid a circular dependency:
 * session-manager.ts → agent.ts (for takeSnapshot/loadSnapshot) → session-manager.ts.
 * This will be resolved when the stateless AgentSpec proposal lands.
 *
 * @example
 * ```typescript
 * import { FileStorage, SnapshotStorage } from '@strands-agents/sdk/session'
 *
 * const storage = new FileStorage('./sessions')
 * await storage.saveSnapshot({ sessionId, scope, isLatest: true, snapshot })
 * ```
 */

// Core types
export { SessionManager } from './session-manager.js'
export type { SessionManagerConfig, SaveLatestStrategy } from './session-manager.js'
export type { SnapshotManifest, SnapshotTriggerCallback, SnapshotTriggerParams } from './types.js'

// Storage layer
export type { SessionStorage, SnapshotStorage, SnapshotLocation } from './storage.js'

// Storage implementations
export { FileStorage } from './file-storage.js'
export { S3Storage, type S3StorageConfig } from './s3-storage.js'

export type { Scope, Snapshot } from '../agent/snapshot.js'
