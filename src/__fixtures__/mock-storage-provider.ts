import type { Scope, Snapshot, SnapshotManifest } from '../session/types.js'
import { SnapshotStorage } from '../session/index.js'

export function createTestSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1,
    sessionId: 'test-session-123',
    scope: { kind: 'agent', agentId: 'test-agent' },
    snapshotId: 1,
    messages: [],
    state: { testKey: 'testValue' },
    systemPrompt: 'You are a test assistant',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function createTestManifest(overrides: Partial<SnapshotManifest> = {}): SnapshotManifest {
  return {
    schemaVersion: 1,
    nextSnapshotId: 2,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function createTestScope(kind: 'agent' | 'multiAgent' = 'agent', id = 'test-id'): Scope {
  return kind === 'agent' ? { kind: 'agent', agentId: id } : { kind: 'multiAgent', multiAgentId: id }
}

export function createTestSnapshots(count: number, baseSnapshot?: Partial<Snapshot>): Snapshot[] {
  return Array.from({ length: count }, (_, i) =>
    createTestSnapshot({
      ...baseSnapshot,
      snapshotId: i + 1,
      createdAt: new Date(2024, 0, 1, 0, i).toISOString(),
    })
  )
}

/**
 * Mock storage implementation for testing that stores data in memory
 */
export class MockSnapshotStorage extends SnapshotStorage {
  private snapshots = new Map<string, Snapshot>()
  private manifests = new Map<string, SnapshotManifest>()

  constructor(public shouldThrowErrors = false) {
    super()
  }

  async saveSnapShot(sessionId: string, scope: Scope, isLatest: boolean, snapshot: Snapshot): Promise<void> {
    if (this.shouldThrowErrors) throw new Error('Mock save error')

    const key = this.getKey(sessionId, scope, snapshot.snapshotId)
    this.snapshots.set(key, snapshot)

    if (isLatest) {
      const latestKey = this.getKey(sessionId, scope, 'latest')
      this.snapshots.set(latestKey, snapshot)
    }
  }

  async loadSnapshot(sessionId: string, scope: Scope, snapshotId: number | null): Promise<Snapshot | null> {
    if (this.shouldThrowErrors) throw new Error('Mock load error')

    const key =
      snapshotId === null ? this.getKey(sessionId, scope, 'latest') : this.getKey(sessionId, scope, snapshotId)

    return this.snapshots.get(key) ?? null
  }

  async listSnapShot(sessionId: string, scope: Scope): Promise<number[]> {
    if (this.shouldThrowErrors) throw new Error('Mock list error')

    const scopeId: string = scope.kind === 'agent' ? scope.agentId! : scope.multiAgentId!
    if (!scopeId) {
      throw new Error(`Invalid scope: missing ${scope.kind === 'agent' ? 'agentId' : 'multiAgentId'}`)
    }
    const prefix = `${sessionId}::${scope.kind}::${scopeId}::`
    const ids: number[] = []

    for (const [key] of this.snapshots) {
      if (key.startsWith(prefix) && !key.endsWith('latest')) {
        const match = key.match(/::(\d+)$/)
        if (match && match[1]) ids.push(parseInt(match[1]))
      }
    }

    return ids.sort((a, b) => a - b)
  }

  async loadManifest(params: { sessionId: string; scope: Scope }): Promise<SnapshotManifest> {
    if (this.shouldThrowErrors) throw new Error('Mock manifest load error')

    if (!params.sessionId) {
      throw new Error('Invalid sessionId: cannot be empty or undefined')
    }

    const key = this.getManifestKey(params.sessionId, params.scope)
    return (
      this.manifests.get(key) ?? {
        schemaVersion: 1,
        nextSnapshotId: 1,
        updatedAt: new Date().toISOString(),
      }
    )
  }

  async saveManifest(params: { sessionId: string; scope: Scope; manifest: SnapshotManifest }): Promise<void> {
    if (this.shouldThrowErrors) throw new Error('Mock manifest save error')

    if (!params.sessionId) {
      throw new Error('Invalid sessionId: cannot be empty or undefined')
    }

    const key = this.getManifestKey(params.sessionId, params.scope)
    this.manifests.set(key, params.manifest)
  }

  private getKey(sessionId: string, scope: Scope, snapshotId: number | string): string {
    if (!sessionId) {
      throw new Error('Invalid sessionId: cannot be empty or undefined')
    }
    const scopeId: string = scope.kind === 'agent' ? scope.agentId! : scope.multiAgentId!
    if (!scopeId) {
      throw new Error(`Invalid scope: missing ${scope.kind === 'agent' ? 'agentId' : 'multiAgentId'}`)
    }
    return `${sessionId}::${scope.kind}::${scopeId}::${snapshotId}`
  }

  private getManifestKey(sessionId: string, scope: Scope): string {
    if (!sessionId) {
      throw new Error('Invalid sessionId: cannot be empty or undefined')
    }
    const scopeId: string = scope.kind === 'agent' ? scope.agentId! : scope.multiAgentId!
    if (!scopeId) {
      throw new Error(`Invalid scope: missing ${scope.kind === 'agent' ? 'agentId' : 'multiAgentId'}`)
    }
    return `${sessionId}::${scope.kind}::${scopeId}::manifest`
  }
}
