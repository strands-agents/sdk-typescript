/**
 * S3-based session manager for Amazon S3 storage.
 *
 * Uses `\@aws-sdk/client-s3` as an optional peer dependency. Throws a descriptive
 * error if the package is not installed. Creates the following key structure:
 *
 * ```
 * <prefix>/session_<sessionId>/session.json
 * <prefix>/session_<sessionId>/agents/agent_<agentId>/agent.json
 * <prefix>/session_<sessionId>/agents/agent_<agentId>/messages/message_0.json
 * ```
 */

import type {
  S3Client,
  GetObjectCommand,
  GetObjectCommandInput,
  GetObjectCommandOutput,
  PutObjectCommand,
  PutObjectCommandInput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
  DeleteObjectsCommand,
  DeleteObjectsCommandInput,
} from '@aws-sdk/client-s3'
import type { SessionAgentData, SessionData, SessionMessageData } from '../types/session.js'
import type { SessionRepository } from './session-repository.js'
import { RepositorySessionManager } from './repository-session-manager.js'
import { SessionException } from '../errors.js'

const SESSION_PREFIX = 'session_'
const AGENT_PREFIX = 'agent_'
const MESSAGE_PREFIX = 'message_'

/**
 * Dynamically imported `\@aws-sdk/client-s3` module shape.
 *
 * Maps command constructors to their real types so that `S3Client.send()` can
 * resolve to the correct response type through its overloaded signatures.
 */
interface S3Module {
  S3Client: new (config: { customUserAgent?: string; region?: string }) => S3Client
  GetObjectCommand: new (input: GetObjectCommandInput) => GetObjectCommand
  PutObjectCommand: new (input: PutObjectCommandInput) => PutObjectCommand
  ListObjectsV2Command: new (input: ListObjectsV2CommandInput) => ListObjectsV2Command
  DeleteObjectsCommand: new (input: DeleteObjectsCommandInput) => DeleteObjectsCommand
}

/**
 * Configuration for S3SessionManager.
 */
export interface S3SessionManagerConfig {
  /**
   * Unique session identifier.
   */
  sessionId: string

  /**
   * S3 bucket name for storage.
   */
  bucket: string

  /**
   * Optional S3 key prefix.
   */
  prefix?: string | undefined

  /**
   * Optional pre-configured S3 client instance.
   * If not provided, one will be created using the specified region.
   */
  s3Client?: S3Client | undefined

  /**
   * AWS region. Used when creating a default S3 client.
   */
  region?: string | undefined
}

/**
 * Session manager that persists data to Amazon S3.
 *
 * Requires `\@aws-sdk/client-s3` to be installed. If not installed, the first
 * operation that requires S3 access throws a descriptive error.
 */
export class S3SessionManager extends RepositorySessionManager implements SessionRepository {
  private readonly _bucket: string
  private readonly _prefix: string
  private _s3Client: S3Client | undefined
  private _s3Module: S3Module | undefined
  private readonly _region: string | undefined
  private readonly _providedClient: S3Client | undefined

  constructor(config: S3SessionManagerConfig) {
    super({ sessionId: config.sessionId })
    this._bucket = config.bucket
    this._prefix = config.prefix ?? ''
    this._providedClient = config.s3Client
    this._region = config.region
  }

  /**
   * Lazily initializes the S3 client and SDK module.
   *
   * @returns Object containing the S3 client and resolved module
   */
  private async _ensureS3(): Promise<{ client: S3Client; mod: S3Module }> {
    if (this._s3Client !== undefined && this._s3Module !== undefined) {
      return { client: this._s3Client, mod: this._s3Module }
    }

    try {
      const mod = (await import('@aws-sdk/client-s3')) as unknown as S3Module
      this._s3Module = mod

      if (this._providedClient !== undefined) {
        this._s3Client = this._providedClient
      } else {
        const clientConfig: { customUserAgent?: string; region?: string } = {
          customUserAgent: 'strands-agents',
        }
        if (this._region !== undefined) {
          clientConfig.region = this._region
        }
        this._s3Client = new mod.S3Client(clientConfig)
      }

      return { client: this._s3Client, mod: this._s3Module }
    } catch {
      throw new SessionException(
        'S3SessionManager requires @aws-sdk/client-s3 to be installed. ' +
          'Install it with: npm install @aws-sdk/client-s3'
      )
    }
  }

  // --- Key helpers ---

  private _getSessionKey(sessionId: string): string {
    const base = this._prefix ? `${this._prefix}/` : ''
    return `${base}${SESSION_PREFIX}${sessionId}`
  }

  private _getAgentKey(sessionId: string, agentId: string): string {
    return `${this._getSessionKey(sessionId)}/agents/${AGENT_PREFIX}${agentId}`
  }

  private _getMessageKey(sessionId: string, agentId: string, messageId: number): string {
    return `${this._getAgentKey(sessionId, agentId)}/messages/${MESSAGE_PREFIX}${messageId}.json`
  }

  // --- S3 I/O helpers ---

  private async _readObject(key: string): Promise<Record<string, unknown> | null> {
    const { client, mod } = await this._ensureS3()

    try {
      const command = new mod.GetObjectCommand({ Bucket: this._bucket, Key: key })
      const response: GetObjectCommandOutput = await client.send(command)

      if (response.Body === undefined) {
        return null
      }

      const content = await response.Body.transformToString()
      return JSON.parse(content) as Record<string, unknown>
    } catch (error) {
      if (isNoSuchKeyError(error)) {
        return null
      }
      throw error
    }
  }

  private async _writeObject(key: string, data: Record<string, unknown>): Promise<void> {
    const { client, mod } = await this._ensureS3()

    const command = new mod.PutObjectCommand({
      Bucket: this._bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    })
    await client.send(command)
  }

  // --- SessionRepository implementation ---

  /**
   * Creates a new session in S3.
   *
   * @param session - Session data to create
   * @returns The created session
   */
  async createSession(session: SessionData): Promise<SessionData> {
    const sessionKey = `${this._getSessionKey(session.sessionId)}/session.json`

    const existing = await this._readObject(sessionKey)
    if (existing !== null) {
      throw new SessionException(`Session ${session.sessionId} already exists`)
    }

    await this._writeObject(sessionKey, session as unknown as Record<string, unknown>)
    return session
  }

  /**
   * Reads a session by ID from S3.
   *
   * @param sessionId - Session identifier
   * @returns Session data, or null if not found
   */
  async readSession(sessionId: string): Promise<SessionData | null> {
    const sessionKey = `${this._getSessionKey(sessionId)}/session.json`
    const data = await this._readObject(sessionKey)
    return data as unknown as SessionData | null
  }

  /**
   * Deletes a session and all its data from S3.
   *
   * @param sessionId - Session identifier to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    const { client, mod } = await this._ensureS3()
    const prefix = `${this._getSessionKey(sessionId)}/`

    // List all objects with this prefix
    const objects: Array<{ Key: string }> = []
    let continuationToken: string | undefined

    do {
      const listCommand = new mod.ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: prefix,
        ...(continuationToken !== undefined && { ContinuationToken: continuationToken }),
      })

      const response: ListObjectsV2CommandOutput = await client.send(listCommand)

      if (response.Contents !== undefined) {
        for (const obj of response.Contents) {
          if (obj.Key !== undefined) {
            objects.push({ Key: obj.Key })
          }
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken !== undefined)

    if (objects.length === 0) {
      throw new SessionException(`Session ${sessionId} does not exist`)
    }

    // Delete in batches of 1000 (S3 limit)
    for (let i = 0; i < objects.length; i += 1000) {
      const batch = objects.slice(i, i + 1000)
      const deleteCommand = new mod.DeleteObjectsCommand({
        Bucket: this._bucket,
        Delete: { Objects: batch },
      })
      await client.send(deleteCommand)
    }
  }

  /**
   * Creates a new agent record in S3.
   *
   * @param sessionId - Session identifier
   * @param sessionAgent - Agent data to create
   */
  async createAgent(sessionId: string, sessionAgent: SessionAgentData): Promise<void> {
    const agentKey = `${this._getAgentKey(sessionId, sessionAgent.agentId)}/agent.json`
    await this._writeObject(agentKey, sessionAgent as unknown as Record<string, unknown>)
  }

  /**
   * Reads an agent record from S3.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @returns Agent data, or null if not found
   */
  async readAgent(sessionId: string, agentId: string): Promise<SessionAgentData | null> {
    const agentKey = `${this._getAgentKey(sessionId, agentId)}/agent.json`
    const data = await this._readObject(agentKey)
    return data as unknown as SessionAgentData | null
  }

  /**
   * Updates an existing agent record in S3.
   *
   * @param sessionId - Session identifier
   * @param sessionAgent - Updated agent data
   */
  async updateAgent(sessionId: string, sessionAgent: SessionAgentData): Promise<void> {
    const previousAgent = await this.readAgent(sessionId, sessionAgent.agentId)
    if (previousAgent === null) {
      throw new SessionException(`Agent ${sessionAgent.agentId} in session ${sessionId} does not exist`)
    }

    sessionAgent.createdAt = previousAgent.createdAt
    const agentKey = `${this._getAgentKey(sessionId, sessionAgent.agentId)}/agent.json`
    await this._writeObject(agentKey, sessionAgent as unknown as Record<string, unknown>)
  }

  /**
   * Creates a new message in S3.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param sessionMessage - Message data to create
   */
  async createMessage(sessionId: string, agentId: string, sessionMessage: SessionMessageData): Promise<void> {
    const messageKey = this._getMessageKey(sessionId, agentId, sessionMessage.messageId)
    await this._writeObject(messageKey, sessionMessage as unknown as Record<string, unknown>)
  }

  /**
   * Reads a message by ID from S3.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param messageId - Message index
   * @returns Message data, or null if not found
   */
  async readMessage(sessionId: string, agentId: string, messageId: number): Promise<SessionMessageData | null> {
    const messageKey = this._getMessageKey(sessionId, agentId, messageId)
    const data = await this._readObject(messageKey)
    return data as unknown as SessionMessageData | null
  }

  /**
   * Updates an existing message in S3.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param sessionMessage - Updated message data
   */
  async updateMessage(sessionId: string, agentId: string, sessionMessage: SessionMessageData): Promise<void> {
    const previousMessage = await this.readMessage(sessionId, agentId, sessionMessage.messageId)
    if (previousMessage === null) {
      throw new SessionException(`Message ${sessionMessage.messageId} does not exist`)
    }

    sessionMessage.createdAt = previousMessage.createdAt
    const messageKey = this._getMessageKey(sessionId, agentId, sessionMessage.messageId)
    await this._writeObject(messageKey, sessionMessage as unknown as Record<string, unknown>)
  }

  /**
   * Lists messages for an agent with pagination from S3.
   *
   * @param sessionId - Session identifier
   * @param agentId - Agent identifier
   * @param limit - Maximum number of messages to return
   * @param offset - Number of messages to skip
   * @returns Array of session messages sorted by index
   */
  async listMessages(
    sessionId: string,
    agentId: string,
    limit?: number | undefined,
    offset?: number | undefined
  ): Promise<SessionMessageData[]> {
    const { client, mod } = await this._ensureS3()
    const messagesPrefix = `${this._getAgentKey(sessionId, agentId)}/messages/${MESSAGE_PREFIX}`

    // List all message objects
    const messageKeys: Array<{ index: number; key: string }> = []
    let continuationToken: string | undefined

    do {
      const listCommand = new mod.ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: messagesPrefix,
        ...(continuationToken !== undefined && { ContinuationToken: continuationToken }),
      })

      const response: ListObjectsV2CommandOutput = await client.send(listCommand)

      if (response.Contents !== undefined) {
        for (const obj of response.Contents) {
          if (obj.Key !== undefined && obj.Key.endsWith('.json')) {
            // Extract index from key
            const filename = obj.Key.slice(obj.Key.lastIndexOf('/') + 1)
            const indexStr = filename.slice(MESSAGE_PREFIX.length, -5)
            const index = parseInt(indexStr, 10)
            if (!isNaN(index)) {
              messageKeys.push({ index, key: obj.Key })
            }
          }
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken !== undefined)

    // Sort by index and apply pagination
    messageKeys.sort((a, b) => a.index - b.index)
    const startOffset = offset ?? 0
    let keys: string[]
    if (limit !== undefined) {
      keys = messageKeys.slice(startOffset, startOffset + limit).map((mk) => mk.key)
    } else {
      keys = messageKeys.slice(startOffset).map((mk) => mk.key)
    }

    // Read messages in parallel
    const messages = await Promise.all(
      keys.map(async (key) => {
        const data = await this._readObject(key)
        if (data === null) {
          throw new SessionException(`Failed to read message at key: ${key}`)
        }
        return data as unknown as SessionMessageData
      })
    )

    return messages
  }

  // --- Multi-agent storage ---

  private _getMultiAgentKey(sessionId: string, multiAgentId: string): string {
    return `${this._getSessionKey(sessionId)}/multi_agents/multi_agent_${multiAgentId}/multi_agent.json`
  }

  async createMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void> {
    const key = this._getMultiAgentKey(sessionId, multiAgentId)
    await this._writeObject(key, state)
  }

  async readMultiAgent(sessionId: string, multiAgentId: string): Promise<Record<string, unknown> | null> {
    const key = this._getMultiAgentKey(sessionId, multiAgentId)
    return this._readObject(key)
  }

  async updateMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void> {
    const key = this._getMultiAgentKey(sessionId, multiAgentId)
    const existing = await this._readObject(key)
    if (existing === null) {
      throw new SessionException(`Multi-agent ${multiAgentId} does not exist in session ${sessionId}`)
    }
    await this._writeObject(key, state)
  }
}

/**
 * Checks if an error is an S3 NoSuchKey error.
 *
 * @param error - Error to check
 * @returns True if the error represents a NoSuchKey condition
 */
function isNoSuchKeyError(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const err = error as { name?: string; Code?: string }
    return err.name === 'NoSuchKey' || err.Code === 'NoSuchKey'
  }
  return false
}
