import { describe, expect, it } from 'vitest'
import { MultiAgentNodeStreamEvent } from '../events.js'
import { TextBlock } from '../../types/messages.js'

describe('MultiAgentNodeStreamEvent', () => {
  it('constructs with nodeId, nodeType, and event', () => {
    const inner = new TextBlock('hello')
    const event = new MultiAgentNodeStreamEvent({ nodeId: 'node-2', nodeType: 'agentNode', event: inner })
    expect(event.type).toBe('multiAgentNodeStreamEvent')
    expect(event.nodeId).toBe('node-2')
    expect(event.nodeType).toBe('agentNode')
    expect(event.event).toBe(inner)
  })
})
