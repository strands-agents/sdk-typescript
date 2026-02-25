import type { SnapshotStorage, SnapshotLocation } from './storage.js'
import type { SnapshotTriggerCallback } from './types.js'
import type { HookProvider } from '../hooks/index.js'
import type { HookRegistry } from '../hooks/registry.js'
import { AfterInvocationEvent, InitializedEvent, MessageAddedEvent } from '../hooks/events.js'
import { FileStorage } from './file-storage.js'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Agent } from '../agent/agent.js'
import { takeSnapshot, loadSnapshot } from '../agent/snapshot.js'

const SCHEMA_VERSION = '1.0'

/**
 * Controls when `snapshot_latest` is saved automatically.
 * - `'message'`: after every message added to the conversation
 * - `'invocation'`: after every agent invocation completes
 * - `'never'`: only when a `snapshotTrigger` fires (or manually via `saveSnapshot`)
 */
export type SaveLatestStrategy = 'message' | 'invocation' | 'never'

/**
 * Allocates monotonically increasing snapshot IDs and persists the manifest.
 * Caches the next ID in memory to avoid redundant manifest reads within a session.
 */
class SnapshotIdAllocator {
  private nextId?: string

  constructor(private readonly snapshotStorage: SnapshotStorage) {}

  /**
   * Allocates the next snapshot ID and advances the manifest counter.
   * @returns The allocated numeric snapshot ID
   */
  async allocate(location: SnapshotLocation): Promise<number> {
    if (this.nextId === undefined) {
      const manifest = await this.snapshotStorage.loadManifest({ location })
      this.nextId = manifest.nextSnapshotId
    }

    const id = parseInt(this.nextId)
    this.nextId = String(id + 1)

    await this.snapshotStorage.saveManifest({
      location,
      manifest: { schemaVersion: SCHEMA_VERSION, nextSnapshotId: this.nextId, updatedAt: new Date().toISOString() },
    })
    return id
  }
}

export interface SessionManagerConfig {
  /** Pluggable storage backends for snapshot persistence. Defaults to FileStorage in the OS temp directory. */
  storage?: {
    snapshot?: SnapshotStorage
  }
  /** Unique session identifier. Defaults to `'default-session'`. */
  sessionId?: string
  /** Agent identifier used to scope snapshots within a session. Defaults to `'default'`. */
  agentId?: string
  /** Snapshot ID to restore on initialization. When set, the manifest is advanced past this ID. */
  loadSnapshotId?: string
  /** When to save snapshot_latest. Default: `'message'` (after each message added). */
  saveLatestOn?: SaveLatestStrategy
  /** Callback invoked after each invocation to decide whether to create an immutable snapshot. */
  snapshotTrigger?: SnapshotTriggerCallback
}

/**
 * Manages session persistence for agents, enabling conversation state
 * to be saved and restored across invocations.
 *
 * @example
 * ```typescript
 * const session = new SessionManager({ sessionId: 'my-session' })
 * const agent = new Agent({ sessionManager: session })
 * ```
 */
export class SessionManager implements HookProvider {
  private readonly _location: SnapshotLocation
  private readonly _storage: { snapshot: SnapshotStorage }
  private readonly _loadSnapshotId?: string | undefined
  private readonly _saveLatestOn: SaveLatestStrategy
  private readonly _snapshotTrigger?: SnapshotTriggerCallback | undefined
  private readonly _idAllocator: SnapshotIdAllocator

  private _turnCount = 0
  private _lastSnapshotAt?: number

  /** Creates a new SessionManager with the given configuration. */
  constructor(config?: SessionManagerConfig) {
    const agentId = config?.agentId ?? 'default'
    this._location = {
      sessionId: config?.sessionId ?? 'default-session',
      scope: 'agent',
      scopeId: agentId,
    }

    this._storage = {
      snapshot: config?.storage?.snapshot ?? new FileStorage(join(tmpdir(), 'strands-sessions')),
    }

    this._saveLatestOn = config?.saveLatestOn ?? 'message'
    this._snapshotTrigger = config?.snapshotTrigger
    this._loadSnapshotId = config?.loadSnapshotId
    this._idAllocator = new SnapshotIdAllocator(this._storage.snapshot)
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

  /** Takes a snapshot of the agent and persists it as latest and/or immutable depending on `isLatest`. */
  async saveSnapshot(params: { target: Agent; isLatest: boolean }): Promise<void> {
    const snapshot = takeSnapshot(params.target, { preset: 'session' })
    const snapshotId = params.isLatest ? undefined : (await this._idAllocator.allocate(this._location)).toString()
    await this._storage.snapshot.saveSnapshot({
      location: this._location,
      snapshotId: snapshotId ?? 'latest',
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

  /** Restores session state on agent initialization and advances the manifest when loading a specific snapshot. */
  private async _onAgentInitialized(event: InitializedEvent): Promise<void> {
    const loaded = await this.restoreSnapshot({
      target: event.agent as Agent,
      ...(this._loadSnapshotId !== undefined && { snapshotId: this._loadSnapshotId }),
    })

    // No snapshot found — start fresh
    if (!loaded) {
      return
    }

    if (this._loadSnapshotId !== undefined && parseInt(this._loadSnapshotId) > 0) {
      await this._advanceManifestPastSnapshot(parseInt(this._loadSnapshotId))
    }
  }

  /** Advances the manifest's next snapshot ID to one past the given ID, preventing overwrites. */
  private async _advanceManifestPastSnapshot(snapshotId: number): Promise<void> {
    await this._storage.snapshot.saveManifest({
      location: this._location,
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        nextSnapshotId: String(snapshotId + 1),
        updatedAt: new Date().toISOString(),
      },
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

  /** Saves snapshot_latest after each message when `saveLatestOn` is `'message'`. */
  private async _onMessageAdded(event: MessageAddedEvent): Promise<void> {
    const agent = event.agent as Agent
    await this.saveSnapshot({ target: agent, isLatest: true })
  }

  /** Captures one snapshot and writes it to both immutable history and snapshot_latest. */
  private async _saveImmutableAndLatest(agent: Agent): Promise<void> {
    const snapshot = takeSnapshot(agent, { preset: 'session' })
    const snapshotId = (await this._idAllocator.allocate(this._location)).toString()
    await Promise.all([
      this._storage.snapshot.saveSnapshot({ location: this._location, snapshotId, isLatest: false, snapshot }),
      this._storage.snapshot.saveSnapshot({ location: this._location, snapshotId: 'latest', isLatest: true, snapshot }),
    ])
  }
}
