/**
 * File-based session manager for local filesystem storage.
 *
 * Creates the following filesystem structure:
 * ```
 * /<storageDir>/
 * └── session_<sessionId>/
 *     ├── session.json
 *     └── agents/
 *         └── agent_<agentId>/
 *             ├── agent.json
 *             └── messages/
 *             ├── message_0.json
 *             └── message_1.json
 * ```
 *
 * Only available in Node.js; throws from the constructor in browser environments.
 */

import type { SessionAgentData, SessionData, SessionMessageData } from '../types/session.js'
import type { SessionRepository } from './session-repository.js'
import { RepositorySessionManager } from './repository-session-manager.js'
import { SessionException } from '../errors.js'

const SESSION_PREFIX = 'session_'
const AGENT_PREFIX = 'agent_'
const MESSAGE_PREFIX = 'message_'
const MULTI_AGENT_PREFIX = 'multi_agent_'

const NOT_AVAILABLE_MESSAGE =
  'FileSessionManager is not available in the browser; it requires Node.js fs. Use RepositorySessionManager with a browser-compatible repository instead.'

function isNode(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.node === 'string'
}

interface NodeModules {
  fs: typeof import('node:fs/promises')
  path: typeof import('node:path')
  os: typeof import('node:os')
}

async function loadNodeModules(): Promise<NodeModules> {
  const pathMod = await import(/* @vite-ignore */ 'node:' + 'path')
  const osMod = await import(/* @vite-ignore */ 'node:' + 'os')
  const fsMod = await import(/* @vite-ignore */ 'node:' + 'fs/promises')
  return { fs: fsMod, path: pathMod, os: osMod }
}

/**
 * Configuration for FileSessionManager.
 */
export interface FileSessionManagerConfig {
  /**
   * Unique session identifier.
   */
  sessionId: string

  /**
   * Directory for storing session files. Defaults to system temp directory.
   */
  storageDir?: string | undefined
}

/**
 * Session manager that persists data to the local filesystem.
 *
 * Implements both RepositorySessionManager (for lifecycle) and
 * SessionRepository (for storage) using Node.js fs/promises.
 * Throws from the constructor when run in the browser.
 */
export class FileSessionManager extends RepositorySessionManager implements SessionRepository {
  private _storageDirPromise: Promise<string>
  private _nodeModulesPromise: Promise<NodeModules> | null = null

  constructor(config: FileSessionManagerConfig) {
    super({ sessionId: config.sessionId })
    if (!isNode()) {
      throw new SessionException(NOT_AVAILABLE_MESSAGE)
    }
    this._storageDirPromise = config.storageDir
      ? Promise.resolve(config.storageDir)
      : (async (): Promise<string> => {
          const { path: pathMod, os } = await loadNodeModules()
          return pathMod.join(os.tmpdir(), 'strands', 'sessions')
        })()
  }

  private async _getNodeModules(): Promise<NodeModules> {
    if (this._nodeModulesPromise === null) {
      this._nodeModulesPromise = loadNodeModules()
    }
    return this._nodeModulesPromise
  }

  private async _getStorageDir(): Promise<string> {
    return this._storageDirPromise
  }

  // --- Path helpers ---

  private async _getSessionPath(sessionId: string): Promise<string> {
    validateIdentifier(sessionId, 'sessionId')
    const { path } = await this._getNodeModules()
    return path.join(await this._getStorageDir(), `${SESSION_PREFIX}${sessionId}`)
  }

  private async _getAgentPath(sessionId: string, agentId: string): Promise<string> {
    const sessionPath = await this._getSessionPath(sessionId)
    validateIdentifier(agentId, 'agentId')
    const { path } = await this._getNodeModules()
    return path.join(sessionPath, 'agents', `${AGENT_PREFIX}${agentId}`)
  }

  private async _getMessagePath(sessionId: string, agentId: string, messageId: number): Promise<string> {
    if (!Number.isInteger(messageId)) {
      throw new SessionException(`message_id=<${messageId}> | message id must be an integer`)
    }
    const agentPath = await this._getAgentPath(sessionId, agentId)
    const { path } = await this._getNodeModules()
    return path.join(agentPath, 'messages', `${MESSAGE_PREFIX}${messageId}.json`)
  }

  // --- File I/O helpers ---

  private async _readFile(filePath: string): Promise<Record<string, unknown>> {
    const { fs } = await this._getNodeModules()
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content) as Record<string, unknown>
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new SessionException(`Invalid JSON in file ${filePath}: ${error.message}`)
      }
      throw error
    }
  }

  private async _writeFile(filePath: string, data: Record<string, unknown>): Promise<void> {
    const { fs } = await this._getNodeModules()
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    await fs.mkdir(dir, { recursive: true })

    const tmpPath = `${filePath}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmpPath, filePath)
  }

  private async _exists(filePath: string): Promise<boolean> {
    const { fs } = await this._getNodeModules()
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  // --- SessionRepository implementation ---

  async createSession(session: SessionData): Promise<SessionData> {
    const sessionDir = await this._getSessionPath(session.sessionId)

    if (await this._exists(sessionDir)) {
      throw new SessionException(`Session ${session.sessionId} already exists`)
    }

    const { fs, path } = await this._getNodeModules()
    await fs.mkdir(path.join(sessionDir, 'agents'), { recursive: true })
    await this._writeFile(path.join(sessionDir, 'session.json'), session as unknown as Record<string, unknown>)

    return session
  }

  async readSession(sessionId: string): Promise<SessionData | null> {
    const sessionPath = await this._getSessionPath(sessionId)
    const { path } = await this._getNodeModules()
    const sessionFile = path.join(sessionPath, 'session.json')

    if (!(await this._exists(sessionFile))) {
      return null
    }

    return (await this._readFile(sessionFile)) as unknown as SessionData
  }

  /**
   * Deletes a session and all its data from the filesystem.
   *
   * @param sessionId - Session identifier to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionDir = await this._getSessionPath(sessionId)

    if (!(await this._exists(sessionDir))) {
      throw new SessionException(`Session ${sessionId} does not exist`)
    }

    const { fs } = await this._getNodeModules()
    await fs.rm(sessionDir, { recursive: true })
  }

  async createAgent(sessionId: string, sessionAgent: SessionAgentData): Promise<void> {
    const agentDir = await this._getAgentPath(sessionId, sessionAgent.agentId)
    const { fs, path } = await this._getNodeModules()

    await fs.mkdir(path.join(agentDir, 'messages'), { recursive: true })
    await this._writeFile(path.join(agentDir, 'agent.json'), sessionAgent as unknown as Record<string, unknown>)
  }

  async readAgent(sessionId: string, agentId: string): Promise<SessionAgentData | null> {
    const agentPath = await this._getAgentPath(sessionId, agentId)
    const { path } = await this._getNodeModules()
    const agentFile = path.join(agentPath, 'agent.json')

    if (!(await this._exists(agentFile))) {
      return null
    }

    return (await this._readFile(agentFile)) as unknown as SessionAgentData
  }

  async updateAgent(sessionId: string, sessionAgent: SessionAgentData): Promise<void> {
    const previousAgent = await this.readAgent(sessionId, sessionAgent.agentId)
    if (previousAgent === null) {
      throw new SessionException(`Agent ${sessionAgent.agentId} in session ${sessionId} does not exist`)
    }

    sessionAgent.createdAt = previousAgent.createdAt
    const agentPath = await this._getAgentPath(sessionId, sessionAgent.agentId)
    const { path } = await this._getNodeModules()
    await this._writeFile(path.join(agentPath, 'agent.json'), sessionAgent as unknown as Record<string, unknown>)
  }

  async createMessage(sessionId: string, agentId: string, sessionMessage: SessionMessageData): Promise<void> {
    const messagePath = await this._getMessagePath(sessionId, agentId, sessionMessage.messageId)
    await this._writeFile(messagePath, sessionMessage as unknown as Record<string, unknown>)
  }

  async readMessage(sessionId: string, agentId: string, messageId: number): Promise<SessionMessageData | null> {
    const messagePath = await this._getMessagePath(sessionId, agentId, messageId)

    if (!(await this._exists(messagePath))) {
      return null
    }

    return (await this._readFile(messagePath)) as unknown as SessionMessageData
  }

  async updateMessage(sessionId: string, agentId: string, sessionMessage: SessionMessageData): Promise<void> {
    const previousMessage = await this.readMessage(sessionId, agentId, sessionMessage.messageId)
    if (previousMessage === null) {
      throw new SessionException(`Message ${sessionMessage.messageId} does not exist`)
    }

    sessionMessage.createdAt = previousMessage.createdAt
    const messagePath = await this._getMessagePath(sessionId, agentId, sessionMessage.messageId)
    await this._writeFile(messagePath, sessionMessage as unknown as Record<string, unknown>)
  }

  async listMessages(
    sessionId: string,
    agentId: string,
    limit?: number | undefined,
    offset?: number | undefined
  ): Promise<SessionMessageData[]> {
    const messagesDir = await this._getAgentPath(sessionId, agentId)
    const { fs, path } = await this._getNodeModules()
    const messagesPath = path.join(messagesDir, 'messages')

    if (!(await this._exists(messagesPath))) {
      throw new SessionException(`Messages directory missing from agent: ${agentId} in session ${sessionId}`)
    }

    const files = await fs.readdir(messagesPath)
    const messageIndexFiles: Array<{ index: number; filename: string }> = []

    for (const filename of files) {
      if (filename.startsWith(MESSAGE_PREFIX) && filename.endsWith('.json')) {
        const indexStr = filename.slice(MESSAGE_PREFIX.length, -5)
        const index = parseInt(indexStr, 10)
        if (!isNaN(index)) {
          messageIndexFiles.push({ index, filename })
        }
      }
    }

    messageIndexFiles.sort((a, b) => a.index - b.index)
    let filenames = messageIndexFiles.map((mf) => mf.filename)

    const startOffset = offset ?? 0
    if (limit !== undefined) {
      filenames = filenames.slice(startOffset, startOffset + limit)
    } else {
      filenames = filenames.slice(startOffset)
    }

    const messages: SessionMessageData[] = []
    for (const filename of filenames) {
      const filePath = path.join(messagesPath, filename)
      const data = await this._readFile(filePath)
      messages.push(data as unknown as SessionMessageData)
    }

    return messages
  }

  // --- Multi-agent storage ---

  private async _getMultiAgentPath(sessionId: string, multiAgentId: string): Promise<string> {
    const sessionPath = await this._getSessionPath(sessionId)
    validateIdentifier(multiAgentId, 'multiAgentId')
    const { path } = await this._getNodeModules()
    return path.join(sessionPath, 'multi_agents', `${MULTI_AGENT_PREFIX}${multiAgentId}`)
  }

  async createMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void> {
    const dir = await this._getMultiAgentPath(sessionId, multiAgentId)
    const { fs, path } = await this._getNodeModules()
    await fs.mkdir(dir, { recursive: true })
    await this._writeFile(path.join(dir, 'multi_agent.json'), state)
  }

  async readMultiAgent(sessionId: string, multiAgentId: string): Promise<Record<string, unknown> | null> {
    const dir = await this._getMultiAgentPath(sessionId, multiAgentId)
    const { path } = await this._getNodeModules()
    const filePath = path.join(dir, 'multi_agent.json')
    if (!(await this._exists(filePath))) {
      return null
    }
    return this._readFile(filePath)
  }

  async updateMultiAgent(sessionId: string, multiAgentId: string, state: Record<string, unknown>): Promise<void> {
    const filePath = await this._getMultiAgentPath(sessionId, multiAgentId)
    const { path } = await this._getNodeModules()
    const fullPath = path.join(filePath, 'multi_agent.json')
    if (!(await this._exists(fullPath))) {
      throw new SessionException(`Multi-agent ${multiAgentId} does not exist in session ${sessionId}`)
    }
    await this._writeFile(fullPath, state)
  }
}

/**
 * Validates that an identifier does not contain path separators.
 */
function validateIdentifier(id: string, label: string): void {
  if (id.includes('/') || id.includes('\\')) {
    throw new SessionException(`${label} must not contain path separators: ${id}`)
  }
}
