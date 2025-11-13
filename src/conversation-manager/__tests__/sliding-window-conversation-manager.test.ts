import { describe, it, expect } from 'vitest'
import { SlidingWindowConversationManager } from '../sliding-window-conversation-manager.js'
import { ContextWindowOverflowError, Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../index.js'
import type { Agent } from '../../agent/agent.js'

describe('SlidingWindowConversationManager', () => {
  describe('constructor', () => {
    it('sets default windowSize to 40', () => {
      const manager = new SlidingWindowConversationManager()
      // Access through type assertion since these are private
      expect((manager as any)._windowSize).toBe(40)
    })

    it('sets default shouldTruncateResults to true', () => {
      const manager = new SlidingWindowConversationManager()
      expect((manager as any)._shouldTruncateResults).toBe(true)
    })

    it('accepts custom windowSize', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 20 })
      expect((manager as any)._windowSize).toBe(20)
    })

    it('accepts custom shouldTruncateResults', () => {
      const manager = new SlidingWindowConversationManager({ shouldTruncateResults: false })
      expect((manager as any)._shouldTruncateResults).toBe(false)
    })
  })

  describe('applyManagement', () => {
    it('skips reduction when message count is less than window size', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 10 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.applyManagement(mockAgent)

      expect(mockAgent.messages).toHaveLength(2)
    })

    it('skips reduction when message count equals window size', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.applyManagement(mockAgent)

      expect(mockAgent.messages).toHaveLength(2)
    })

    it('calls reduceContext when message count exceeds window size', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.applyManagement(mockAgent)

      // Should have trimmed to window size
      expect(mockAgent.messages).toHaveLength(2)
      expect(manager.removedMessageCount).toBe(1)
    })
  })

  describe('reduceContext - tool result truncation', () => {
    it('truncates tool results when shouldTruncateResults is true', () => {
      const manager = new SlidingWindowConversationManager({ shouldTruncateResults: true })
      const messages = [
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-1',
              status: 'success',
              content: [new TextBlock('Large tool result content')],
            }),
          ],
        }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      const toolResult = messages[0]!.content[0]! as ToolResultBlock
      expect(toolResult.status).toBe('error')
      expect(toolResult.content[0]).toEqual({ type: 'textBlock', text: 'The tool result was too large!' })
    })

    it('finds last message with tool results', () => {
      const manager = new SlidingWindowConversationManager({ shouldTruncateResults: true })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-1',
              status: 'success',
              content: [new TextBlock('First result')],
            }),
          ],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-2',
              status: 'success',
              content: [new TextBlock('Second result')],
            }),
          ],
        }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should truncate the last message with tool results (index 3)
      const lastToolResult = messages[3]!.content[0]! as ToolResultBlock
      expect(lastToolResult.status).toBe('error')
      expect(lastToolResult.content[0]).toEqual({ type: 'textBlock', text: 'The tool result was too large!' })

      // Earlier tool result should remain unchanged
      const firstToolResult = messages[1]!.content[0]! as ToolResultBlock
      expect(firstToolResult.status).toBe('success')
      expect(firstToolResult.content[0]).toEqual({ type: 'textBlock', text: 'First result' })
    })

    it('returns after successful truncation without trimming messages', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2, shouldTruncateResults: true })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-1',
              status: 'success',
              content: [new TextBlock('Large result')],
            }),
          ],
        }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should not have removed any messages, only truncated tool result
      expect(mockAgent.messages).toHaveLength(3)
      expect(manager.removedMessageCount).toBe(0)
    })

    it('skips truncation when shouldTruncateResults is false', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2, shouldTruncateResults: false })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-1',
              status: 'success',
              content: [new TextBlock('Large result')],
            }),
          ],
        }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should have trimmed messages instead of truncating tool result
      expect(mockAgent.messages).toHaveLength(2)
      expect(manager.removedMessageCount).toBe(1)

      // Tool result should not be truncated - it's now at index 1 after trimming
      const toolResult = mockAgent.messages[1]!.content[0]! as ToolResultBlock
      expect(toolResult.status).toBe('success')
    })

    it('does not truncate already-truncated results', () => {
      const manager = new SlidingWindowConversationManager({ shouldTruncateResults: true })
      const messages = [
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-1',
              status: 'error',
              content: [new TextBlock('The tool result was too large!')],
            }),
          ],
        }),
      ]

      // First call should return false (already truncated)
      const result = (manager as any).truncateToolResults(messages, 0)
      expect(result).toBe(false)

      // reduceContext should fall through to message trimming
      const messages2 = [
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tool-1',
              status: 'error',
              content: [new TextBlock('The tool result was too large!')],
            }),
          ],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        new Message({ role: 'user', content: [new TextBlock('Message')] }),
      ]
      const mockAgent = { messages: messages2 } as unknown as Agent

      manager.reduceContext(mockAgent)

      // Should have trimmed messages since truncation was skipped
      expect(mockAgent.messages.length).toBeLessThan(3)
    })
  })

  describe('reduceContext - message trimming', () => {
    it('trims oldest messages when tool results cannot be truncated', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 3, shouldTruncateResults: false })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 3')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      expect(mockAgent.messages).toHaveLength(3)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Message 2' })
    })

    it('calculates correct trim index (messages.length - windowSize)', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should remove 2 messages (4 - 2 = 2)
      expect(manager.removedMessageCount).toBe(2)
      expect(mockAgent.messages).toHaveLength(2)
    })

    it('uses default trim index of 2 when messages <= windowSize', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 5 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should remove 2 messages (default when count <= windowSize)
      expect(manager.removedMessageCount).toBe(2)
      expect(mockAgent.messages).toHaveLength(1)
    })

    it('updates removedMessageCount by trim index', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 3')] }),
      ]
      const mockAgent = { messages } as Agent

      expect(manager.removedMessageCount).toBe(0)

      manager.reduceContext(mockAgent)

      // Should have removed 3 messages (5 - 2 = 3)
      expect(manager.removedMessageCount).toBe(3)

      // Call again
      messages.push(new Message({ role: 'assistant', content: [new TextBlock('Response 3')] }))
      messages.push(new Message({ role: 'user', content: [new TextBlock('Message 4')] }))

      manager.reduceContext(mockAgent)

      // Should have removed 2 more messages (cumulative: 3 + 2 = 5)
      expect(manager.removedMessageCount).toBe(5)
    })

    it('removes messages from start of array using splice', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should keep last 2 messages
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Message 2' })
      expect(mockAgent.messages[1]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response 2' })
    })
  })

  describe('reduceContext - tool pair validation', () => {
    it('does not trim at index where oldest message is toolResult', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2, shouldTruncateResults: false })
      const messages = [
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'tool1', toolUseId: 'id-1', input: {} })],
        }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'id-1',
              status: 'success',
              content: [new TextBlock('Result')],
            }),
          ],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        new Message({ role: 'user', content: [new TextBlock('Message')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should not trim at index 1 (toolResult), should trim at index 2 instead
      // This means keeping last 2 messages
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response' })
    })

    it('does not trim at index where oldest message is toolUse without following toolResult', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2, shouldTruncateResults: false })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'tool1', toolUseId: 'id-1', input: {} })],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response')] }), // Not a toolResult
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should skip index 1 (toolUse without following toolResult), trim at index 2
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response' })
    })

    it('allows trim when oldest message is toolUse with following toolResult', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2, shouldTruncateResults: false })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'tool1', toolUseId: 'id-1', input: {} })],
        }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'id-1',
              status: 'success',
              content: [new TextBlock('Result')],
            }),
          ],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should trim at index 3 (5 - 2 = 3)
      // Index 1 would be toolUse (valid start since toolResult follows)
      // Index 2 would be toolResult (invalid - no preceding toolUse)
      // Index 3 would be Response (valid - text block)
      // So we trim at index 3, keeping last 2 messages
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response' })
      expect(mockAgent.messages[1]!.content[0]!).toEqual({ type: 'textBlock', text: 'Message 2' })
    })

    it('allows trim at toolUse when toolResult immediately follows', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 3, shouldTruncateResults: false })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'tool1', toolUseId: 'id-1', input: {} })],
        }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'id-1',
              status: 'success',
              content: [new TextBlock('Result')],
            }),
          ],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should trim at index 2 (5 - 3 = 2)
      // Index 2 is toolUse with toolResult at index 3 - this is valid
      expect(mockAgent.messages).toHaveLength(3)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({
        type: 'toolUseBlock',
        name: 'tool1',
        toolUseId: 'id-1',
        input: {},
      })
      expect(mockAgent.messages[1]!.content[0]!).toEqual({
        type: 'toolResultBlock',
        toolUseId: 'id-1',
        status: 'success',
        content: [{ type: 'textBlock', text: 'Result' }],
      })
    })

    it('allows trim when oldest message is text or other non-tool content', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = { messages } as Agent

      manager.reduceContext(mockAgent)

      // Should trim at index 1 (3 - 2 = 1)
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]).toEqual({ type: 'textBlock', text: 'Response 1' })
    })

    it('throws ContextWindowOverflowError when no valid trim point exists', () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 0, shouldTruncateResults: false })
      const messages = [
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'id-1',
              status: 'success',
              content: [new TextBlock('Result')],
            }),
          ],
        }),
      ]
      const mockAgent = { messages } as Agent

      expect(() => {
        manager.reduceContext(mockAgent)
      }).toThrow(ContextWindowOverflowError)
    })
  })

  describe('helper methods', () => {
    describe('findLastMessageWithToolResults', () => {
      it('returns correct index when tool results exist', () => {
        const manager = new SlidingWindowConversationManager()
        const messages = [
          new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
          new Message({
            role: 'user',
            content: [
              new ToolResultBlock({
                toolUseId: 'id-1',
                status: 'success',
                content: [new TextBlock('Result 1')],
              }),
            ],
          }),
          new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
        ]

        const index = (manager as any).findLastMessageWithToolResults(messages)
        expect(index).toBe(1)
      })

      it('returns undefined when no tool results exist', () => {
        const manager = new SlidingWindowConversationManager()
        const messages = [
          new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
          new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        ]

        const index = (manager as any).findLastMessageWithToolResults(messages)
        expect(index).toBeUndefined()
      })

      it('iterates backwards from end', () => {
        const manager = new SlidingWindowConversationManager()
        const messages = [
          new Message({
            role: 'user',
            content: [
              new ToolResultBlock({
                toolUseId: 'id-1',
                status: 'success',
                content: [new TextBlock('Result 1')],
              }),
            ],
          }),
          new Message({ role: 'assistant', content: [new TextBlock('Response')] }),
          new Message({
            role: 'user',
            content: [
              new ToolResultBlock({
                toolUseId: 'id-2',
                status: 'success',
                content: [new TextBlock('Result 2')],
              }),
            ],
          }),
        ]

        const index = (manager as any).findLastMessageWithToolResults(messages)
        // Should find the last one (index 2), not the first one (index 0)
        expect(index).toBe(2)
      })
    })

    describe('truncateToolResults', () => {
      it('returns true when changes are made', () => {
        const manager = new SlidingWindowConversationManager()
        const messages = [
          new Message({
            role: 'user',
            content: [
              new ToolResultBlock({
                toolUseId: 'id-1',
                status: 'success',
                content: [new TextBlock('Large result')],
              }),
            ],
          }),
        ]

        const result = (manager as any).truncateToolResults(messages, 0)
        expect(result).toBe(true)
      })

      it('returns false when already truncated', () => {
        const manager = new SlidingWindowConversationManager()
        const messages = [
          new Message({
            role: 'user',
            content: [
              new ToolResultBlock({
                toolUseId: 'id-1',
                status: 'error',
                content: [new TextBlock('The tool result was too large!')],
              }),
            ],
          }),
        ]

        const result = (manager as any).truncateToolResults(messages, 0)
        expect(result).toBe(false)
      })

      it('returns false when no tool results found', () => {
        const manager = new SlidingWindowConversationManager()
        const messages = [new Message({ role: 'user', content: [new TextBlock('Message')] })]

        const result = (manager as any).truncateToolResults(messages, 0)
        expect(result).toBe(false)
      })
    })
  })
})
