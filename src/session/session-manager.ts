import type { SnapshotStorage, SnapshotLocation } from './storage.js'
import type { SnapshotTriggerCallback } from './types.js'
import type { HookProvider } from '../hooks/index.js'
import type { HookRegistry } from '../hooks/registry.js'
import { AfterInvocationEvent, InitializedEvent, MessageAddedEvent } from '../hooks/events.js'
import { v7 as uuidV7 } from 'uuid'
import type { Agent } from '../agent/agent.js'
import { takeSnapshot, loadSnapshot } from '../agent/snapshot.js'

/**
 * Controls when `snapshot_latest` is saved automatically.
 *
 * There are two kinds of snapshots:
 * - **`snapshot_latest`**: A single mutable snapshot that is overwritten on each save. Used to
 *   resume the most recent conversation state (e.g. after a crash or restart). Always reflects
 *   the last saved point in time.
 * - **Immutable snapshots**: Append-only snapshots with unique IDs (UUID v7), created only when
 *   `snapshotTrigger` fires. Used for checkpointing — you can restore to any prior state, not
 *   just the latest.
 *
 * `SaveLatestStrategy` controls how frequently `snapshot_latest` is updated:
 * - `'invocation'`: after every agent invocation completes (default; balances durability and I/O)
 * - `'message'`: after every message added to the conversation (most durable, highest I/O)
 * - `'trigger'`: only when a `snapshotTrigger` fires (or manually via `saveSnapshot`)
 */
export type SaveLatestStrategy = 'message' | 'invocation' | 'trigger'

export interface SessionManagerConfig {
  /** Pluggable storage backends for snapshot persistence. Defaults to FileStorage in Node.js; required in browser environments. */
  storage: {
    snapshot: SnapshotStorage
  }
  /** Unique session identifier. Defaults to `'default-session'`. */
  sessionId?: string
  /** When to save snapshot_latest. Default: `'invocation'` (after each agent invocation completes). See {@link SaveLatestStrategy} for details. */
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
 * import { SessionManager, FileStorage } from '@strands-agents/sdk'
 *
 * const session = new SessionManager({
 *   sessionId: 'my-session',
 *   storage: { snapshot: new FileStorage() },
 * })
 * const agent = new Agent({ sessionManager: session })
 * ```
 */
export class SessionManager implements HookProvider {
  private readonly _sessionId: string
  private readonly _storage: { snapshot: SnapshotStorage }
  private readonly _saveLatestOn: SaveLatestStrategy
  private readonly _snapshotTrigger?: SnapshotTriggerCallback | undefined

  constructor(config: SessionManagerConfig) {
    this._sessionId = config.sessionId ?? 'default-session'
    this._storage = { snapshot: config.storage.snapshot }
    this._saveLatestOn = config.saveLatestOn ?? 'invocation'
    this._snapshotTrigger = config.snapshotTrigger
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

  private _location(agent: Agent): SnapshotLocation {
    return { sessionId: this._sessionId, scope: 'agent', scopeId: agent.agentId }
  }

  async saveSnapshot(params: { target: Agent; isLatest: boolean }): Promise<void> {
    const snapshot = takeSnapshot(params.target, { preset: 'session' })
    const snapshotId = params.isLatest ? 'latest' : uuidV7()
    await this._storage.snapshot.saveSnapshot({
      location: this._location(params.target),
      snapshotId,
      isLatest: params.isLatest,
      snapshot,
    })
  }

  /** Loads a snapshot from storage and restores it into the target agent. Returns false if no snapshot exists. */
  async restoreSnapshot(params: { target: Agent; snapshotId?: string }): Promise<boolean> {
    const snapshot = await this._storage.snapshot.loadSnapshot({
      location: this._location(params.target),
      ...(params.snapshotId !== undefined && { snapshotId: params.snapshotId }),
    })

    if (!snapshot) return false
    loadSnapshot(params.target, snapshot)
    return true
  }

  /** Restores session state on agent initialization. */
  private async _onAgentInitialized(event: InitializedEvent): Promise<void> {
    await this.restoreSnapshot({ target: event.agent as Agent })
  }

  /** Saves latest on invocation and fires the snapshot trigger if configured. */
  private async _onAfterAgentInvocation(event: AfterInvocationEvent): Promise<void> {
    const agent = event.agent as Agent

    if (this._saveLatestOn === 'invocation') {
      await this.saveSnapshot({ target: agent, isLatest: true })
    }

    if (this._snapshotTrigger?.({ agentData: { state: agent.state, messages: agent.messages } })) {
      await this._saveImmutableAndLatest(agent)
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
      this._storage.snapshot.saveSnapshot({ location: this._location(agent), snapshotId, isLatest: false, snapshot }),
      this._storage.snapshot.saveSnapshot({
        location: this._location(agent),
        snapshotId: 'latest',
        isLatest: true,
        snapshot,
      }),
    ])
  }
}
