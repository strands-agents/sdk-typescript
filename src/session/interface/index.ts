/**
 * Session management module for conversation persistence and restoration.
 *
 * Provides snapshot-based session management with pluggable storage backends.
 * Supports conversation history, state persistence, and branching.
 *
 * @example
 * ```typescript
 * import { SessionManager } from '@strands/agents/session'
 *
 * const agent = new Agent({
 *   sessionManager: new SessionManager({
 *     sessionId: 'user-123',
 *     snapshotTrigger: ({ turnCount }) => turnCount % 5 === 0
 *   })
 * })
 * ```
 */

// Core types
export type { Scope, Snapshot, SnapshotManifest, SnapshotTriggerCallback } from './types.js'

// Storage layer
export type { SessionStorage } from './storage.js'
export { SnapshotStorage } from './storage.js'
