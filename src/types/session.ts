/**
 * Data models for session management.
 *
 * Provides types for persisting agent conversation history, state, and
 * conversation manager state across sessions.
 */

import type { JSONValue } from './json.js'
import type { Message } from './messages.js'

/**
 * Session type values.
 */
export const SESSION_TYPE_AGENT = 'AGENT' as const

/**
 * Session type enumeration.
 */
export type SessionType = typeof SESSION_TYPE_AGENT

/**
 * Recursively encode any Uint8Array values in an object to base64.
 *
 * @param obj - Object to process
 * @returns Object with Uint8Array values replaced by base64-encoded representations
 */
export function encodeBytesValues(obj: unknown): unknown {
  if (obj instanceof Uint8Array) {
    return {
      __bytes_encoded__: true,
      data: uint8ArrayToBase64(obj),
    }
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => encodeBytesValues(item))
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = encodeBytesValues(value)
    }
    return result
  }
  return obj
}

/**
 * Recursively decode any base64-encoded byte values in an object.
 *
 * @param obj - Object to process
 * @returns Object with base64-encoded representations replaced by Uint8Array values
 */
export function decodeBytesValues(obj: unknown): unknown {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>
    if (record.__bytes_encoded__ === true && typeof record.data === 'string') {
      return base64ToUint8Array(record.data)
    }
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      result[key] = decodeBytesValues(value)
    }
    return result
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => decodeBytesValues(item))
  }
  return obj
}

/**
 * Session metadata stored in persistent storage.
 */
export interface SessionData {
  sessionId: string
  sessionType: SessionType
  createdAt: string
  updatedAt: string
}

/**
 * Creates a new Session data object.
 *
 * @param sessionId - Unique session identifier
 * @param sessionType - Type of session
 * @returns Session data object
 */
export function createSession(sessionId: string, sessionType: SessionType = SESSION_TYPE_AGENT): SessionData {
  const now = new Date().toISOString()
  return {
    sessionId,
    sessionType,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Agent data within a session.
 */
export interface SessionAgentData {
  agentId: string
  state: Record<string, JSONValue>
  conversationManagerState: Record<string, JSONValue>
  _internalState: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * Creates a SessionAgent from an agent-like source.
 *
 * @param agentId - Agent identifier
 * @param state - Agent state dictionary
 * @param conversationManagerState - Conversation manager state dictionary
 * @param internalState - Internal state for interrupt persistence
 * @returns SessionAgent data object
 */
export function createSessionAgent(
  agentId: string,
  state: Record<string, JSONValue>,
  conversationManagerState: Record<string, JSONValue>,
  internalState?: Record<string, unknown>
): SessionAgentData {
  const now = new Date().toISOString()
  return {
    agentId,
    state,
    conversationManagerState,
    _internalState: internalState ?? {},
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Message within a session agent's history.
 */
export interface SessionMessageData {
  message: Record<string, unknown>
  messageId: number
  redactMessage: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

/**
 * Creates a SessionMessage from a Message and index.
 *
 * @param message - The message to store
 * @param index - Sequential message index
 * @returns SessionMessage data object
 */
export function createSessionMessage(message: Message, index: number): SessionMessageData {
  const now = new Date().toISOString()
  return {
    message: encodeBytesValues(messageToRecord(message)) as Record<string, unknown>,
    messageId: index,
    redactMessage: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Converts a SessionMessage back to a Message-compatible record.
 * If the message was redacted, returns the redact content instead.
 *
 * @param sessionMessage - The session message to convert
 * @returns Message-compatible record
 */
export function sessionMessageToRecord(sessionMessage: SessionMessageData): Record<string, unknown> {
  if (sessionMessage.redactMessage !== null) {
    return decodeBytesValues(sessionMessage.redactMessage) as Record<string, unknown>
  }
  return decodeBytesValues(sessionMessage.message) as Record<string, unknown>
}

// --- Internal helpers ---

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return globalThis.btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function messageToRecord(message: Message): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content.map((block) => {
      // Serialize each content block to a plain object
      const result: Record<string, unknown> = { type: block.type }
      for (const [key, value] of Object.entries(block)) {
        if (key !== 'type') {
          result[key] = value
        }
      }
      return result
    }),
  }
}
