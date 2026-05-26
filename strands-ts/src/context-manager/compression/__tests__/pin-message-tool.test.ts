import { describe, it, expect } from 'vitest'
import { pinMessageTool, isPinned, pinMessage } from '../pin-message.js'
import { Message, TextBlock } from '../../../types/messages.js'
import type { Agent } from '../../../agent/agent.js'

function makeAgent(messages: Message[]): Agent {
  return { messages } as unknown as Agent
}

function makeMessage(text: string): Message {
  return new Message({ role: 'user', content: [new TextBlock(text)] })
}

describe('pinMessageTool', () => {
  it('has the correct name and description', () => {
    expect(pinMessageTool.name).toBe('pin_message')
    expect(pinMessageTool.description).toContain('Pin or unpin')
  })

  it('pins a message at a valid index', async () => {
    const messages = [makeMessage('first'), makeMessage('second'), makeMessage('third')]
    const agent = makeAgent(messages)

    const result = await pinMessageTool.invoke({ index: 1, action: 'pin' }, { agent } as any)

    expect(result).toBe('Pinned message at index 1.')
    expect(isPinned(agent.messages[1]!)).toBe(true)
    expect(isPinned(agent.messages[0]!)).toBe(false)
  })

  it('defaults action to pin', async () => {
    const messages = [makeMessage('first')]
    const agent = makeAgent(messages)

    const result = await pinMessageTool.invoke({ index: 0 } as any, { agent } as any)

    expect(result).toBe('Pinned message at index 0.')
    expect(isPinned(agent.messages[0]!)).toBe(true)
  })

  it('unpins a pinned message', async () => {
    const messages = [pinMessage(makeMessage('pinned'))]
    const agent = makeAgent(messages)

    expect(isPinned(agent.messages[0]!)).toBe(true)

    const result = await pinMessageTool.invoke({ index: 0, action: 'unpin' }, { agent } as any)

    expect(result).toBe('Unpinned message at index 0.')
    expect(isPinned(agent.messages[0]!)).toBe(false)
  })

  it('rejects negative index via schema validation', async () => {
    const agent = makeAgent([makeMessage('only')])

    await expect(pinMessageTool.invoke({ index: -1, action: 'pin' }, { agent } as any)).rejects.toThrow()
  })

  it('returns error for out-of-bounds index', async () => {
    const agent = makeAgent([makeMessage('only')])

    const result = await pinMessageTool.invoke({ index: 5, action: 'pin' }, { agent } as any)

    expect(result).toContain('Invalid index 5')
  })
})
