import type { SnapshotStorage, SnapshotLocation } from './storage.js'
import type { SnapshotTriggerCallback } from './types.js'
import type { HookProvider } from '../hooks/index.js'
import type { HookRegistry } from '../hooks/registry.js'
import { AfterInvocationEvent, InitializedEvent, MessageAddedEvent } from '../hooks/events.js'
import { FileStorage } from './file-storage.js'
import { join } from 'path'
import { tmpdir } from 'os'
import { v7 as uuidV7 } from 'uuid'
import type { Agent } from '../agent/agent.js'
import { takeSnapshot, loadSnapshot } from '../agent/snapshot.js'

/**
 * Controls when `snapshot_latest` is saved automatically.
 * - `'message'`: after every message added to the conversation
 * - `'invocation'`: after every agent invocation completes
 * - `'trigger'`: only when a `snapshotTrigger` fires (or manually via `saveSnapshot`)
 */
export type SaveLatestStrategy = 'message' | 'invocation' | 'trigger'

export interface SessionManagerConfig {
  /** Pluggable storage backends for snapshot persistence. Defaults to FileStorage in the OS temp directory. */
  storage?: {
    snapshot?: SnapshotStorage
  }
  /** Unique session identifier. Defaults to `'default-session'`. */
  sessionId?: string
  /** Agent identifier used to scope snapshots within a session. Defaults to `'default'`. */
  agentId?: string
  /** Snapshot ID to restore on initialization. */
  loadSnapshotId?: string
  /** When to save snapshot_latest. Default: `'message'` (after each message added). */
  saveLatestOn?: SaveLatestStrategy
  /** Callback invoked after each invocation to decide whether to create an immutable snapshot. */
  snapshotTrigger?: SnapshotTriggerCallback
}

/**
 * Manages session persistence for agents, enabling conversation state
 * to be saved and restored across invocations using pluggable storage backends.
 *
 * @example
 * ```typescript
 * import { SessionManager, FileStorage } from '@strands-agents/sdk/session'
 *
 * const session = new SessionManager({
 *   sessionId: 'my-session',
 *   storage: { snapshot: new FileStorage() },
 * })
 * const agent = new Agent({ sessionManager: session })
 * ```
 */
export class SessionManager implements HookProvider {
  private readonly _location: SnapshotLocation
  private readonly _storage: { snapshot: SnapshotStorage }
  private readonly _loadSnapshotId?: string | undefined
  private readonly _saveLatestOn: SaveLatestStrategy
  private readonly _snapshotTrigger?: SnapshotTriggerCallback | undefined

  private _turnCount = 0
  private _lastSnapshotAt?: number

  constructor(config?: SessionManagerConfig) {
    this._location = {
      sessionId: config?.sessionId ?? 'default-session',
      scope: 'agent',
      scopeId: config?.agentId ?? 'default',
    }

    this._storage = {
      snapshot: config?.storage?.snapshot ?? new FileStorage(join(tmpdir(), 'strands-sessions')),
    }

    this._saveLatestOn = config?.saveLatestOn ?? 'message'
    this._snapshotTrigger = config?.snapshotTrigger
    this._loadSnapshotId = config?.loadSnapshotId
  }

  /** Registers lifecycle hook callbacks on the provided registry. */
  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(InitializedEvent, async (event) => {
      await this._onAgentInitialized(event)
    })
    if (this._saveLatestOn === 'message') {
      registry.addCallback(MessageAddedEvent, async (event) => {
        await this._onMessageAdded(event)
      })
    }
    registry.addCallback(AfterInvocationEvent, async (event) => {
      await this._onAfterAgentInvocation(event)
    })
  }

  async saveSnapshot(params: { target: Agent; isLatest: boolean }): Promise<void> {
    const snapshot = takeSnapshot(params.target, { preset: 'session' })
    const snapshotId = params.isLatest ? 'latest' : uuidV7()
    await this._storage.snapshot.saveSnapshot({
      location: this._location,
      snapshotId,
      isLatest: params.isLatest,
      snapshot,
    })
  }

  /** Loads a snapshot from storage and restores it into the target agent. Returns false if no snapshot exists. */
  async restoreSnapshot(params: { target: Agent; snapshotId?: string }): Promise<boolean> {
    const snapshot = await this._storage.snapshot.loadSnapshot({
      location: this._location,
      ...(params.snapshotId !== undefined && { snapshotId: params.snapshotId }),
    })

    if (!snapshot) return false
    loadSnapshot(params.target, snapshot)
    return true
  }

  /** Restores session state on agent initialization. */
  private async _onAgentInitialized(event: InitializedEvent): Promise<void> {
    await this.restoreSnapshot({
      target: event.agent as Agent,
      ...(this._loadSnapshotId !== undefined && { snapshotId: this._loadSnapshotId }),
    })
  }

  /** Increments turn count, saves latest on invocation, and fires the snapshot trigger if configured. */
  private async _onAfterAgentInvocation(event: AfterInvocationEvent): Promise<void> {
    const agent = event.agent as Agent
    this._turnCount += 1

    if (this._saveLatestOn === 'invocation') {
      await this.saveSnapshot({ target: agent, isLatest: true })
    }

    if (
      this._snapshotTrigger?.({
        turnCount: this._turnCount,
        ...(this._lastSnapshotAt !== undefined && { lastSnapshotAt: this._lastSnapshotAt }),
        agentData: { state: agent.state, messages: agent.messages },
      })
    ) {
      await this._saveImmutableAndLatest(agent)
      this._lastSnapshotAt = Date.now()
    }
  }

  private async _onMessageAdded(event: MessageAddedEvent): Promise<void> {
    const agent = event.agent as Agent
    await this.saveSnapshot({ target: agent, isLatest: true })
  }

  /** Captures one snapshot and writes it to both immutable history and snapshot_latest. */
  private async _saveImmutableAndLatest(agent: Agent): Promise<void> {
    const snapshot = takeSnapshot(agent, { preset: 'session' })
    const snapshotId = uuidV7()
    await Promise.all([
      this._storage.snapshot.saveSnapshot({ location: this._location, snapshotId, isLatest: false, snapshot }),
      this._storage.snapshot.saveSnapshot({ location: this._location, snapshotId: 'latest', isLatest: true, snapshot }),
    ])
  }
}
