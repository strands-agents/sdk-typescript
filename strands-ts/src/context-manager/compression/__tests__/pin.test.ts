import { describe, it, expect } from 'vitest'
import { pinMessage, unpinMessage, isPinned } from '../pin-message.js'
import { Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../../types/messages.js'

function makeMessage(text: string, metadata?: Record<string, unknown>): Message {
  return new Message({
    role: 'user',
    content: [new TextBlock(text)],
    ...(metadata !== undefined ? { metadata: metadata as any } : {}),
  })
}

describe('isPinned', () => {
  it('returns false for message without metadata', () => {
    expect(isPinned(makeMessage('hello'))).toBe(false)
  })

  it('returns false for message with empty custom', () => {
    expect(isPinned(makeMessage('hello', { custom: {} }))).toBe(false)
  })

  it('returns true for message with custom.pinned = true', () => {
    expect(isPinned(makeMessage('hello', { custom: { pinned: true } }))).toBe(true)
  })

  it('returns false for message with custom.pinned = false', () => {
    expect(isPinned(makeMessage('hello', { custom: { pinned: false } }))).toBe(false)
  })
})

describe('pinMessage', () => {
  it('returns a new message with pinned = true in custom metadata', () => {
    const original = makeMessage('important')
    const pinned = pinMessage(original)

    expect(isPinned(pinned)).toBe(true)
    expect(pinned.role).toBe('user')
    expect(pinned.content).toEqual(original.content)
  })

  it('preserves existing metadata', () => {
    const original = makeMessage('important', { usage: { inputTokens: 10, outputTokens: 5 } })
    const pinned = pinMessage(original)

    expect(pinned.metadata?.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(isPinned(pinned)).toBe(true)
  })

  it('preserves existing custom fields', () => {
    const original = makeMessage('important', { custom: { myField: 'value' } })
    const pinned = pinMessage(original)

    expect(pinned.metadata?.custom?.myField).toBe('value')
    expect(isPinned(pinned)).toBe(true)
  })

  it('does not mutate the original message', () => {
    const original = makeMessage('important')
    pinMessage(original)

    expect(isPinned(original)).toBe(false)
  })
})

describe('unpinMessage', () => {
  it('removes pinned from custom metadata', () => {
    const pinned = pinMessage(makeMessage('important'))
    const unpinned = unpinMessage(pinned)

    expect(isPinned(unpinned)).toBe(false)
  })

  it('preserves other custom fields', () => {
    const original = makeMessage('important', { custom: { pinned: true, other: 'keep' } })
    const unpinned = unpinMessage(original)

    expect(isPinned(unpinned)).toBe(false)
    expect(unpinned.metadata?.custom?.other).toBe('keep')
  })

  it('removes metadata entirely when nothing remains', () => {
    const pinned = pinMessage(makeMessage('hello'))
    const unpinned = unpinMessage(pinned)

    expect(unpinned.metadata).toBeUndefined()
  })

  it('preserves non-custom metadata fields', () => {
    const original = makeMessage('important', { usage: { inputTokens: 10, outputTokens: 5 }, custom: { pinned: true } })
    const unpinned = unpinMessage(original)

    expect(unpinned.metadata?.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(isPinned(unpinned)).toBe(false)
  })
})

describe('isPinned', () => {
  it('returns false for unpinned message', () => {
    const messages = [makeMessage('a'), makeMessage('b')]
    expect(isPinned(messages, 0)).toBe(false)
  })

  it('returns true for pinned message', () => {
    const messages = [pinMessage(makeMessage('a')), makeMessage('b')]
    expect(isPinned(messages, 0)).toBe(true)
  })

  it('returns true for toolResult whose toolUse partner is pinned', () => {
    const toolUseMsg = pinMessage(
      new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ toolUseId: 'id-1', name: 'test', input: {} })],
      })
    )
    const toolResultMsg = new Message({
      role: 'user',
      content: [new ToolResultBlock({ toolUseId: 'id-1', content: [new TextBlock('result')], status: 'success' })],
    })
    const messages = [toolUseMsg, toolResultMsg, makeMessage('other')]

    expect(isPinned(messages, 1)).toBe(true)
  })

  it('returns true for toolUse whose toolResult partner is pinned', () => {
    const toolUseMsg = new Message({
      role: 'assistant',
      content: [new ToolUseBlock({ toolUseId: 'id-1', name: 'test', input: {} })],
    })
    const toolResultMsg = pinMessage(
      new Message({
        role: 'user',
        content: [new ToolResultBlock({ toolUseId: 'id-1', content: [new TextBlock('result')], status: 'success' })],
      })
    )
    const messages = [toolUseMsg, toolResultMsg, makeMessage('other')]

    expect(isPinned(messages, 0)).toBe(true)
  })

  it('returns false for unrelated message next to pinned', () => {
    const messages = [pinMessage(makeMessage('a')), makeMessage('b')]
    expect(isPinned(messages, 1)).toBe(false)
  })
})
