import { describe, it, expect, vi } from 'vitest'
import { SlidingWindowConversationManager } from '../sliding-window-conversation-manager.js'
import { ContextWindowOverflowError, Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../index.js'
import { HookRegistryImplementation } from '../../hooks/registry.js'
import { AfterInvocationEvent, AfterModelCallEvent } from '../../hooks/events.js'
import { createMockAgent } from '../../__fixtures__/agent-helpers.js'
import type { Agent } from '../../agent/agent.js'

// Helper to trigger sliding window management through hooks
async function triggerSlidingWindow(manager: SlidingWindowConversationManager, agent: Agent): Promise<void> {
  const registry = new HookRegistryImplementation()
  registry.addHook(manager)
  await registry.invokeCallbacks(new AfterInvocationEvent({ agent }))
}

// Helper to trigger context overflow handling through hooks
async function triggerContextOverflow(
  manager: SlidingWindowConversationManager,
  agent: Agent,
  error: Error
): Promise<{ retryModelCall?: boolean }> {
  const registry = new HookRegistryImplementation()
  registry.addHook(manager)
  return await registry.invokeCallbacks(new AfterModelCallEvent({ agent, error }))
}

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
    it('skips reduction when message count is less than window size', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 10 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerSlidingWindow(manager, mockAgent)

      expect(mockAgent.messages).toHaveLength(2)
    })

    it('skips reduction when message count equals window size', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerSlidingWindow(manager, mockAgent)

      expect(mockAgent.messages).toHaveLength(2)
    })

    it('calls reduceContext when message count exceeds window size', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerSlidingWindow(manager, mockAgent)

      // Should have trimmed to window size
      expect(mockAgent.messages).toHaveLength(2)
    })
  })

  describe('reduceContext - tool result truncation', () => {
    it('truncates tool results when shouldTruncateResults is true', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      const toolResult = messages[0]!.content[0]! as ToolResultBlock
      expect(toolResult.status).toBe('error')
      expect(toolResult.content[0]).toEqual({ type: 'textBlock', text: 'The tool result was too large!' })
    })

    it('finds last message with tool results', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should truncate the last message with tool results (index 3)
      const lastToolResult = messages[3]!.content[0]! as ToolResultBlock
      expect(lastToolResult.status).toBe('error')
      expect(lastToolResult.content[0]).toEqual({ type: 'textBlock', text: 'The tool result was too large!' })

      // Earlier tool result should remain unchanged
      const firstToolResult = messages[1]!.content[0]! as ToolResultBlock
      expect(firstToolResult.status).toBe('success')
      expect(firstToolResult.content[0]).toEqual({ type: 'textBlock', text: 'First result' })
    })

    it('returns after successful truncation without trimming messages', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should not have removed any messages, only truncated tool result
      expect(mockAgent.messages).toHaveLength(3)
    })

    it('skips truncation when shouldTruncateResults is false', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should have trimmed messages instead of truncating tool result
      expect(mockAgent.messages).toHaveLength(2)

      // Tool result should not be truncated - it's now at index 1 after trimming
      const toolResult = mockAgent.messages[1]!.content[0]! as ToolResultBlock
      expect(toolResult.status).toBe('success')
    })

    it('does not truncate already-truncated results', async () => {
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

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should have trimmed messages since truncation was skipped
      expect(mockAgent.messages.length).toBeLessThan(3)
    })

    it('does not call truncateToolResults unless an error is passed in', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 1, shouldTruncateResults: true })
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
              content: [new TextBlock('Tool result content')],
            }),
          ],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      // Spy on truncateToolResults to verify it's NOT called
      const truncateSpy = vi.spyOn(manager as any, 'truncateToolResults')

      // Trigger window size enforcement (no error parameter)
      await triggerSlidingWindow(manager, mockAgent)

      // Verify truncateToolResults was NOT called during window enforcement
      expect(truncateSpy).not.toHaveBeenCalled()

      // Should have trimmed to window size (1 message) through message trimming instead
      expect(mockAgent.messages).toHaveLength(1)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response 1' })

      truncateSpy.mockRestore()
    })
  })

  describe('reduceContext - message trimming', () => {
    it('trims oldest messages when tool results cannot be truncated', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 3, shouldTruncateResults: false })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 3')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      expect(mockAgent.messages).toHaveLength(3)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Message 2' })
    })

    it('calculates correct trim index (messages.length - windowSize)', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should remove 2 messages (4 - 2 = 2)
      expect(mockAgent.messages).toHaveLength(2)
    })

    it('uses default trim index of 2 when messages <= windowSize', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 5 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should remove 2 messages (default when count <= windowSize)
      expect(mockAgent.messages).toHaveLength(1)
    })

    it('removes messages from start of array using splice', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 2')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should keep last 2 messages
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Message 2' })
      expect(mockAgent.messages[1]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response 2' })
    })
  })

  describe('reduceContext - tool pair validation', () => {
    it('does not trim at index where oldest message is toolResult', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should not trim at index 1 (toolResult), should trim at index 2 instead
      // This means keeping last 2 messages
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response' })
    })

    it('does not trim at index where oldest message is toolUse without following toolResult', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should skip index 1 (toolUse without following toolResult), trim at index 2
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response' })
    })

    it('allows trim when oldest message is toolUse with following toolResult', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should trim at index 3 (5 - 2 = 3)
      // Index 1 would be toolUse (valid start since toolResult follows)
      // Index 2 would be toolResult (invalid - no preceding toolUse)
      // Index 3 would be Response (valid - text block)
      // So we trim at index 3, keeping last 2 messages
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]!).toEqual({ type: 'textBlock', text: 'Response' })
      expect(mockAgent.messages[1]!.content[0]!).toEqual({ type: 'textBlock', text: 'Message 2' })
    })

    it('allows trim at toolUse when toolResult immediately follows', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

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

    it('allows trim when oldest message is text or other non-tool content', async () => {
      const manager = new SlidingWindowConversationManager({ windowSize: 2 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))

      // Should trim at index 1 (3 - 2 = 1)
      expect(mockAgent.messages).toHaveLength(2)
      expect(mockAgent.messages[0]!.content[0]).toEqual({ type: 'textBlock', text: 'Response 1' })
    })

    it('throws ContextWindowOverflowError when no valid trim point exists', async () => {
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
      const mockAgent = createMockAgent({ messages })

      await expect(
        triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Context overflow'))
      ).rejects.toThrow(ContextWindowOverflowError)
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
