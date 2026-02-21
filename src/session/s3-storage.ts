import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3/dist-types/commands/ListObjectsV2Command.js'
import type { SnapshotStorage, SnapshotLocation } from './storage.js'
import type { Snapshot, SnapshotManifest } from './types.js'
import { SessionError } from '../errors.js'
import { validateIdentifier } from './validation.js'

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
  private _getKey(location: SnapshotLocation, path: string): string {
    validateIdentifier(location.sessionId)
    validateIdentifier(location.scopeId)
    const base = this._prefix ? `${this._prefix}/` : ''
    return `${base}${location.sessionId}/scopes/${location.scope}/${location.scopeId}/snapshots/${path}`
  }

  /**
   * Saves snapshot to S3, optionally marking as latest
   */
  async saveSnapshot(params: {
    location: SnapshotLocation
    snapshotId: string
    isLatest: boolean
    snapshot: Snapshot
  }): Promise<void> {
    await this._writeJSON(this._getHistorySnapshotKey(params.location, params.snapshotId), params.snapshot)
    if (params.isLatest) {
      await this._writeJSON(this._getLatestSnapshotKey(params.location), params.snapshot)
    }
  }

  /**
   * Loads snapshot by ID or latest if undefined
   */
  async loadSnapshot(params: { location: SnapshotLocation; snapshotId?: string }): Promise<Snapshot | null> {
    const key =
      params.snapshotId === undefined
        ? this._getLatestSnapshotKey(params.location)
        : this._getHistorySnapshotKey(params.location, params.snapshotId)
    return this._readJSON<Snapshot>(key)
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
  async listSnapshotIds(params: { location: SnapshotLocation }): Promise<string[]> {
    const prefix = this._getKey(params.location, IMMUTABLE_HISTORY)
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
      throw new SessionError(`Failed to list snapshots for session ${params.location.sessionId}`, { cause: error })
    }
  }

  /**
   * Loads manifest or returns default if not found
   */
  async loadManifest(params: { location: SnapshotLocation }): Promise<SnapshotManifest> {
    const key = this._getKey(params.location, MANIFEST)
    const manifest = await this._readJSON<SnapshotManifest>(key)

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
  async saveManifest(params: { location: SnapshotLocation; manifest: SnapshotManifest }): Promise<void> {
    const key = this._getKey(params.location, MANIFEST)
    await this._writeJSON(key, params.manifest)
  }

  /**
   * Writes JSON data to S3
   */
  private async _writeJSON(key: string, data: unknown): Promise<void> {
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
  private async _readJSON<T>(key: string): Promise<T | null> {
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

  private _getLatestSnapshotKey(location: SnapshotLocation): string {
    return this._getKey(location, SNAPSHOT_LATEST)
  }

  private _getHistorySnapshotKey(location: SnapshotLocation, snapshotId: string): string {
    return this._getKey(location, `${IMMUTABLE_HISTORY}snapshot_${String(snapshotId).padStart(5, '0')}.json`)
  }
}
