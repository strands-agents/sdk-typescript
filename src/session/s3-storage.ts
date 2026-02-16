import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3/dist-types/commands/ListObjectsV2Command.js'
import type { SnapshotStorage } from './storage.js'
import type { Scope, Snapshot, SnapshotManifest } from './types.js'
import { validateIdentifier } from '../types/validation.js'
import { SessionError } from '../errors.js'

const MANIFEST = 'manifest.json'
const SNAPSHOT_LATEST = 'snapshot_latest.json'
const IMMUTABLE_HISTORY = 'immutable_history/'
const SNAPSHOT_REGEX = /snapshot_(\d+)\.json$/
const SCHEMA_VERSION = '1.0'
const DEFAULT_SNAPSHOT_ID = '1'

/**
 * Configuration options for S3Storage
 */
export type S3StorageConfig = {
  /** S3 bucket name */
  bucket: string
  /** Optional key prefix for all objects */
  prefix?: string
  /** AWS region (default: us-east-1). Cannot be used with s3Client */
  region?: string
  /** Pre-configured S3 client. Cannot be used with region */
  s3Client?: S3Client
}

/**
 * S3-based implementation of SnapshotStorage for persisting session snapshots
 */
export class S3Storage implements SnapshotStorage {
  /** S3 client instance */
  private readonly _s3: S3Client
  /** S3 bucket name */
  private readonly _bucket: string
  /** Key prefix for all objects */
  private readonly _prefix: string

  /**
   * Creates new S3Storage instance
   * @param config - Configuration options
   */
  constructor(config: S3StorageConfig) {
    if (config.s3Client && config.region) {
      throw new SessionError('Cannot specify both s3Client and region. Configure region in the S3Client instead.')
    }

    this._bucket = config.bucket
    this._prefix = config.prefix ?? ''
    this._s3 = config.s3Client ?? new S3Client({ region: config.region ?? 'us-east-1' })
  }

  /**
   * Generates S3 key path for session scope snapshots
   */
  private getKey(sessionId: string, scope: Scope, path: string): string {
    validateIdentifier(sessionId)
    const scopeId = scope.kind === 'agent' ? scope.agentId : scope.multiAgentId
    validateIdentifier(scopeId)

    const base = this._prefix ? `${this._prefix}/` : ''
    return `${base}${sessionId}/scopes/${scope.kind}/${scopeId}/snapshots/${path}`
  }

  /**
   * Saves snapshot to S3, optionally marking as latest
   */
  async saveSnapshot(params: {
    sessionId: string
    scope: Scope
    isLatest: boolean
    snapshot: Snapshot
  }): Promise<void> {
    await this.writeJSON(
      this.getHistorySnapshotKey(params.sessionId, params.scope, params.snapshot.snapshotId),
      params.snapshot
    )
    if (params.isLatest) {
      await this.writeJSON(this.getLatestSnapshotKey(params.sessionId, params.scope), params.snapshot)
    }
  }

  /**
   * Loads snapshot by ID or latest if undefined
   */
  async loadSnapshot(params: {
    sessionId: string
    scope: Scope
    snapshotId: string | undefined
  }): Promise<Snapshot | null> {
    const key =
      params.snapshotId === undefined
        ? this.getLatestSnapshotKey(params.sessionId, params.scope)
        : this.getHistorySnapshotKey(params.sessionId, params.scope, params.snapshotId)
    return this.readJSON<Snapshot>(key)
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
    const prefix = this.getKey(params.sessionId, params.scope, IMMUTABLE_HISTORY)
    try {
      const response: ListObjectsV2CommandOutput = await this._s3.send(
        new ListObjectsV2Command({ Bucket: this._bucket, Prefix: prefix })
      )
      return (response.Contents ?? [])
        .map((obj) => obj.Key?.match(SNAPSHOT_REGEX)?.[1])
        .filter((id): id is string => id !== undefined)
        .map((id) => String(parseInt(id)))
        .sort((a, b) => parseInt(a) - parseInt(b))
    } catch (error) {
      throw new SessionError(`Failed to list snapshots for session ${params.sessionId}`, { cause: error })
    }
  }

  /**
   * Loads manifest or returns default if not found
   */
  async loadManifest(params: { sessionId: string; scope: Scope }): Promise<SnapshotManifest> {
    const key = this.getKey(params.sessionId, params.scope, MANIFEST)
    const manifest = await this.readJSON<SnapshotManifest>(key)

    return (
      manifest ?? {
        schemaVersion: SCHEMA_VERSION,
        nextSnapshotId: DEFAULT_SNAPSHOT_ID,
        updatedAt: new Date().toISOString(),
      }
    )
  }

  /**
   * Saves manifest to S3
   */
  async saveManifest(params: { sessionId: string; scope: Scope; manifest: SnapshotManifest }): Promise<void> {
    const key = this.getKey(params.sessionId, params.scope, MANIFEST)
    await this.writeJSON(key, params.manifest)
  }

  /**
   * Writes JSON data to S3
   */
  private async writeJSON(key: string, data: unknown): Promise<void> {
    try {
      await this._s3.send(
        new PutObjectCommand({
          Bucket: this._bucket,
          Key: key,
          Body: JSON.stringify(data, null, 2),
          ContentType: 'application/json',
        })
      )
    } catch (error) {
      throw new SessionError(`Failed to write S3 object ${key}`, { cause: error })
    }
  }

  /**
   * Reads and parses JSON from S3
   */
  private async readJSON<T>(key: string): Promise<T | null> {
    try {
      const response = await this._s3.send(new GetObjectCommand({ Bucket: this._bucket, Key: key }))
      const body = await response.Body?.transformToString()
      if (!body) return null
      return JSON.parse(body)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
        return null
      }
      if (error instanceof SyntaxError) {
        throw new SessionError(`Invalid JSON in S3 object ${key}`, { cause: error })
      }
      throw new SessionError(`S3 error reading ${key}`, { cause: error })
    }
  }

  private getLatestSnapshotKey(sessionId: string, scope: Scope): string {
    return this.getKey(sessionId, scope, SNAPSHOT_LATEST)
  }

  private getHistorySnapshotKey(sessionId: string, scope: Scope, snapshotId: string): string {
    return this.getKey(sessionId, scope, `${IMMUTABLE_HISTORY}snapshot_${String(snapshotId).padStart(5, '0')}.json`)
  }
}
