import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { S3ClientConfig } from '@aws-sdk/client-s3'
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3/dist-types/commands/ListObjectsV2Command.js'
import { SnapshotStorage } from './storage.js'
import type { Scope, Snapshot, SnapshotManifest } from './types.js'
import { validateIdentifier } from '../types/validation.js'
import { SessionError } from '../errors.js'

const MANIFEST = 'manifest.json'
const SNAPSHOT_LATEST = 'snapshot_latest.json'
const IMMUTABLE_HISTORY = 'immutable_history/'
const SNAPSHOT_REGEX = /snapshot_(\d+)\.json$/

/**
 * Configuration options for S3SnapshotStorage
 */
export type S3SnapshotStorageConfig = {
  /** S3 bucket name */
  bucket: string
  /** Optional key prefix for all objects */
  prefix?: string
  /** AWS region (overrides s3ClientConfig.region if both provided) */
  region?: string
  /** Pre-configured S3 client (if provided, other config options are ignored) */
  s3Client?: S3Client
  /** S3 client configuration (used only if s3Client not provided) */
  s3ClientConfig?: S3ClientConfig
}

/**
 * S3-based implementation of SnapshotStorage for persisting session snapshots
 */
export class S3SnapshotStorage extends SnapshotStorage {
  /** S3 client instance */
  private s3: S3Client
  /** S3 bucket name */
  private readonly bucket: string
  /** Key prefix for all objects */
  private readonly prefix: string

  /**
   * Creates new S3SnapshotStorage instance
   * @param config - Configuration options
   */
  constructor(config: S3SnapshotStorageConfig) {
    super()
    this.bucket = config.bucket
    this.prefix = config.prefix ?? ''

    if (config.s3Client) {
      this.s3 = config.s3Client
    } else {
      const clientConfig: S3ClientConfig = {
        ...config.s3ClientConfig,
        region: config.region ?? config.s3ClientConfig?.region ?? 'us-east-1',
      }
      this.s3 = new S3Client(clientConfig)
    }
  }

  /**
   * Generates S3 key path for session scope snapshots
   */
  private getKey(sessionId: string, scope: Scope, path: string): string {
    validateIdentifier(sessionId)
    const scopeId = scope.kind === 'agent' ? scope.agentId : scope.multiAgentId
    validateIdentifier(scopeId)

    const base = this.prefix ? `${this.prefix}/` : ''
    return `${base}${sessionId}/scopes/${scope.kind}/${scopeId}/snapshots/${path}`
  }

  /**
   * Saves snapshot to S3, optionally marking as latest
   */
  async saveSnapShot(sessionId: string, scope: Scope, isLatest: boolean, snapshot: Snapshot): Promise<void> {
    await this.writeJSON(this.getHistorySnapshotKey(sessionId, scope, snapshot.snapshotId), snapshot)
    if (isLatest) {
      await this.writeJSON(this.getLatestSnapshotKey(sessionId, scope), snapshot)
    }
  }

  /**
   * Loads snapshot by ID or latest if null
   */
  async loadSnapshot(sessionId: string, scope: Scope, snapshotId: number | null): Promise<Snapshot | null> {
    const key =
      snapshotId === null
        ? this.getLatestSnapshotKey(sessionId, scope)
        : this.getHistorySnapshotKey(sessionId, scope, snapshotId)
    return this.readJSON<Snapshot>(key)
  }

  /**
   * Lists all snapshot IDs for a session scope
   */
  async listSnapShot(sessionId: string, scope: Scope): Promise<number[]> {
    const prefix = this.getKey(sessionId, scope, IMMUTABLE_HISTORY)
    try {
      const response: ListObjectsV2CommandOutput = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix })
      )
      return (response.Contents ?? [])
        .map((obj) => obj.Key?.match(SNAPSHOT_REGEX)?.[1])
        .filter((id): id is string => id !== undefined)
        .map((id) => parseInt(id))
        .sort((a, b) => a - b)
    } catch (error) {
      throw new SessionError(`Failed to list snapshots for session ${sessionId}`, { cause: error })
    }
  }

  /**
   * Loads manifest or returns default if not found
   */
  async loadManifest(params: { sessionId: string; scope: Scope }): Promise<SnapshotManifest> {
    const key = this.getKey(params.sessionId, params.scope, MANIFEST)
    return (
      (await this.readJSON<SnapshotManifest>(key)) ?? {
        schemaVersion: 1,
        nextSnapshotId: 1,
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
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
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
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
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

  private getHistorySnapshotKey(sessionId: string, scope: Scope, snapshotId: number): string {
    return this.getKey(sessionId, scope, `${IMMUTABLE_HISTORY}snapshot_${String(snapshotId).padStart(5, '0')}.json`)
  }
}
