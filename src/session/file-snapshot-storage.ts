import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { SnapshotStorage } from './storage.js'
import type { Scope, Snapshot, SnapshotManifest } from './types.js'
import { validateIdentifier } from '../types/validation.js'
import { SessionError } from '../errors.js'

const MANIFEST = 'manifest.json'
const SNAPSHOT_LATEST = 'snapshot_latest.json'
const IMMUTABLE_HISTORY = 'immutable_history'
const SNAPSHOT_REGEX = /snapshot_(\d+)\.json$/

/**
 * File-based implementation of SnapshotStorage for persisting session snapshots
 */
export class FileSnapshotStorage extends SnapshotStorage {
  /** Base directory path */
  private readonly _baseDir: string

  /**
   * Creates new FileSnapshotStorage instance
   * @param baseDir - Base directory path for storing snapshots
   */
  constructor(baseDir: string) {
    super()
    this._baseDir = baseDir
  }

  /**
   * Generates file path for session scope snapshots
   */
  private getPath(sessionId: string, scope: Scope, filename: string): string {
    validateIdentifier(sessionId)
    const scopeId = scope.kind === 'agent' ? scope.agentId : scope.multiAgentId
    validateIdentifier(scopeId)

    return join(this._baseDir, sessionId, 'scopes', scope.kind, scopeId, 'snapshots', filename)
  }

  /**
   * Saves snapshot to file, optionally marking as latest
   */
  async saveSnapshot(sessionId: string, scope: Scope, isLatest: boolean, snapshot: Snapshot): Promise<void> {
    await this.writeJSON(this.getHistorySnapshotPath(sessionId, scope, snapshot.snapshotId), snapshot)
    if (isLatest) {
      await this.writeJSON(this.getLatestSnapshotPath(sessionId, scope), snapshot)
    }
  }

  /**
   * Loads snapshot by ID or latest if null
   */
  async loadSnapshot(sessionId: string, scope: Scope, snapshotId: number | null): Promise<Snapshot | null> {
    const path =
      snapshotId === null
        ? this.getLatestSnapshotPath(sessionId, scope)
        : this.getHistorySnapshotPath(sessionId, scope, snapshotId)
    return this.readJSON<Snapshot>(path)
  }

  /**
   * Lists all snapshot IDs for a session scope
   */
  async listSnapshot(sessionId: string, scope: Scope): Promise<number[]> {
    const dirPath = this.getPath(sessionId, scope, IMMUTABLE_HISTORY)
    try {
      const files = await fs.readdir(dirPath)
      return files
        .map((file) => file.match(SNAPSHOT_REGEX)?.[1])
        .filter((id): id is string => id !== undefined)
        .map((id) => parseInt(id))
        .sort((a, b) => a - b)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return []
      }
      throw new SessionError(`Failed to list snapshots for session ${sessionId}`, { cause: error })
    }
  }

  /**
   * Loads manifest or returns default if not found
   */
  async loadManifest(params: { sessionId: string; scope: Scope }): Promise<SnapshotManifest> {
    const path = this.getPath(params.sessionId, params.scope, MANIFEST)
    return (
      (await this.readJSON<SnapshotManifest>(path)) ?? {
        schemaVersion: 1,
        nextSnapshotId: 1,
        updatedAt: new Date().toISOString(),
      }
    )
  }

  /**
   * Saves manifest to file
   */
  async saveManifest(params: { sessionId: string; scope: Scope; manifest: SnapshotManifest }): Promise<void> {
    const path = this.getPath(params.sessionId, params.scope, MANIFEST)
    await this.writeJSON(path, params.manifest)
  }

  /**
   * Writes JSON data to file atomically
   */
  private async writeJSON(path: string, data: unknown): Promise<void> {
    try {
      await fs.mkdir(dirname(path), { recursive: true })
      const tmpPath = `${path}.tmp`
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(tmpPath, path)
    } catch (error: unknown) {
      throw new SessionError(`Failed to write file ${path}`, { cause: error })
    }
  }

  /**
   * Reads and parses JSON from file
   */
  private async readJSON<T>(path: string): Promise<T | null> {
    try {
      const content = await fs.readFile(path, 'utf8')
      return JSON.parse(content)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      if (error instanceof SyntaxError) {
        throw new SessionError(`Invalid JSON in file ${path}`, { cause: error })
      }
      throw new SessionError(`File system error reading ${path}`, { cause: error })
    }
  }

  private getLatestSnapshotPath(sessionId: string, scope: Scope): string {
    return this.getPath(sessionId, scope, SNAPSHOT_LATEST)
  }

  private getHistorySnapshotPath(sessionId: string, scope: Scope, snapshotId: number): string {
    return this.getPath(sessionId, scope, `${IMMUTABLE_HISTORY}/snapshot_${String(snapshotId).padStart(5, '0')}.json`)
  }
}
