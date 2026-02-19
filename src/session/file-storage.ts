import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import type { SnapshotStorage } from './storage.js'
import type { Scope, Snapshot, SnapshotManifest } from './types.js'

import { SessionError } from '../errors.js'
import { validateIdentifier } from './validation.js'

const MANIFEST = 'manifest.json'
const SNAPSHOT_LATEST = 'snapshot_latest.json'
const IMMUTABLE_HISTORY = 'immutable_history'
const SNAPSHOT_REGEX = /snapshot_(\d+)\.json$/
const SCHEMA_VERSION = '1.0'
const DEFAULT_SNAPSHOT_ID = '1'

/**
 * File-based implementation of SnapshotStorage for persisting session snapshots
 */
export class FileStorage implements SnapshotStorage {
  /** Base directory path */
  private readonly _baseDir: string

  /**
   * Creates new FileStorage instance
   * @param baseDir - Base directory path for storing snapshots
   */
  constructor(baseDir: string) {
    this._baseDir = baseDir
  }

  /**
   * Generates file path for session scope snapshots
   */
  private _getPath(sessionId: string, scope: Scope, filename: string): string {
    validateIdentifier(sessionId)
    const scopeId = scope.kind === 'agent' ? scope.agentId : scope.multiAgentId
    validateIdentifier(scopeId)

    return join(this._baseDir, sessionId, 'scopes', scope.kind, scopeId, 'snapshots', filename)
  }

  /**
   * Saves snapshot to file, optionally marking as latest
   */
  async saveSnapshot(params: {
    sessionId: string
    scope: Scope
    isLatest: boolean
    snapshot: Snapshot
  }): Promise<void> {
    await this._writeJSON(
      this._getHistorySnapshotPath(params.sessionId, params.scope, params.snapshot.snapshotId),
      params.snapshot
    )
    if (params.isLatest) {
      await this._writeJSON(this._getLatestSnapshotPath(params.sessionId, params.scope), params.snapshot)
    }
  }

  /**
   * Loads snapshot by ID or latest if null
   */
  async loadSnapshot(params: { sessionId: string; scope: Scope; snapshotId?: string }): Promise<Snapshot | null> {
    const path =
      params.snapshotId === undefined
        ? this._getLatestSnapshotPath(params.sessionId, params.scope)
        : this._getHistorySnapshotPath(params.sessionId, params.scope, params.snapshotId)
    return this._readJSON<Snapshot>(path)
  }

  /**
   * Checks if an error is a file not found error (ENOENT)
   */
  private _isFileNotFoundError(error: unknown): boolean {
    return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
  }

  /**
   * Lists all snapshot IDs for a session scope.
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
  async listSnapshotIds(params: { sessionId: string; scope: Scope }): Promise<string[]> {
    const dirPath = this._getPath(params.sessionId, params.scope, IMMUTABLE_HISTORY)
    try {
      const files = await fs.readdir(dirPath)
      return files
        .map((file) => file.match(SNAPSHOT_REGEX)?.[1])
        .filter((id): id is string => id !== undefined)
        .sort((a, b) => parseInt(a) - parseInt(b))
    } catch (error: unknown) {
      if (this._isFileNotFoundError(error)) {
        return []
      }
      throw new SessionError(`Failed to list snapshots for session ${params.sessionId}`, { cause: error })
    }
  }

  /**
   * Loads manifest or returns default if not found
   */
  async loadManifest(params: { sessionId: string; scope: Scope }): Promise<SnapshotManifest> {
    const path = this._getPath(params.sessionId, params.scope, MANIFEST)
    const manifest = await this._readJSON<SnapshotManifest>(path)

    return (
      manifest ?? {
        schemaVersion: SCHEMA_VERSION,
        nextSnapshotId: DEFAULT_SNAPSHOT_ID,
        updatedAt: new Date().toISOString(),
      }
    )
  }

  /**
   * Saves manifest to file
   */
  async saveManifest(params: { sessionId: string; scope: Scope; manifest: SnapshotManifest }): Promise<void> {
    const path = this._getPath(params.sessionId, params.scope, MANIFEST)
    await this._writeJSON(path, params.manifest)
  }

  /**
   * Writes JSON data to file atomically
   */
  private async _writeJSON(path: string, data: unknown): Promise<void> {
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
  private async _readJSON<T>(path: string): Promise<T | null> {
    try {
      const content = await fs.readFile(path, 'utf8')
      return JSON.parse(content)
    } catch (error: unknown) {
      if (this._isFileNotFoundError(error)) {
        return null
      }
      if (error instanceof SyntaxError) {
        throw new SessionError(`Invalid JSON in file ${path}`, { cause: error })
      }
      throw new SessionError(`File system error reading ${path}`, { cause: error })
    }
  }

  private _getLatestSnapshotPath(sessionId: string, scope: Scope): string {
    return this._getPath(sessionId, scope, SNAPSHOT_LATEST)
  }

  private _getHistorySnapshotPath(sessionId: string, scope: Scope, snapshotId: string): string {
    return this._getPath(sessionId, scope, `${IMMUTABLE_HISTORY}/snapshot_${String(snapshotId).padStart(5, '0')}.json`)
  }
}
