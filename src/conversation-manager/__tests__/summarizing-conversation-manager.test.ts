import { describe, it, expect } from 'vitest'
import { SummarizingConversationManager } from '../summarizing-conversation-manager.js'
import { ContextWindowOverflowError, Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../index.js'
import { HookRegistryImplementation } from '../../hooks/registry.js'
import { AfterModelCallEvent } from '../../hooks/events.js'
import { createMockAgent } from '../../__fixtures__/agent-helpers.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import type { Agent } from '../../agent/agent.js'

async function triggerContextOverflow(
  manager: SummarizingConversationManager,
  agent: Agent,
  error: Error
): Promise<{ retry?: boolean }> {
  const registry = new HookRegistryImplementation()
  registry.addHook(manager)
  return await registry.invokeCallbacks(new AfterModelCallEvent({ agent, error }))
}

describe('SummarizingConversationManager', () => {
  describe('constructor', () => {
    it('sets default summaryRatio to 0.3', () => {
      const manager = new SummarizingConversationManager()
      expect((manager as any)._summaryRatio).toBe(0.3)
    })

    it('sets default preserveRecentMessages to 10', () => {
      const manager = new SummarizingConversationManager()
      expect((manager as any)._preserveRecentMessages).toBe(10)
    })

    it('accepts custom summaryRatio', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.5 })
      expect((manager as any)._summaryRatio).toBe(0.5)
    })

    it('clamps summaryRatio to 0.1 minimum', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.05 })
      expect((manager as any)._summaryRatio).toBe(0.1)
    })

    it('clamps summaryRatio to 0.8 maximum', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.9 })
      expect((manager as any)._summaryRatio).toBe(0.8)
    })

    it('accepts custom preserveRecentMessages', () => {
      const manager = new SummarizingConversationManager({ preserveRecentMessages: 5 })
      expect((manager as any)._preserveRecentMessages).toBe(5)
    })

    it('throws error when both summarizationAgent and summarizationSystemPrompt are provided', () => {
      const mockAgent = createMockAgent()
      expect(
        () =>
          new SummarizingConversationManager({
            summarizationAgent: mockAgent,
            summarizationSystemPrompt: 'Custom prompt',
          })
      ).toThrow('Cannot provide both summarizationAgent and summarizationSystemPrompt')
    })
  })

  describe('calculateSummarizeCount', () => {
    it('calculates correct count based on summary ratio', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.3 })
      const count = (manager as any).calculateSummarizeCount(20)
      expect(count).toBe(6) // 20 * 0.3 = 6
    })

    it('respects preserveRecentMessages limit', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.5, preserveRecentMessages: 5 })
      const count = (manager as any).calculateSummarizeCount(20)
      expect(count).toBe(10) // min(20 * 0.5, 20 - 5) = min(10, 15) = 10
    })

    it('returns 0 when not enough messages to preserve recent', () => {
      const manager = new SummarizingConversationManager({ preserveRecentMessages: 15 })
      const count = (manager as any).calculateSummarizeCount(10)
      expect(count).toBe(0) // 10 - 15 = -5, clamped to 0
    })

    it('returns 0 when preserveRecentMessages exceeds available messages', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.1, preserveRecentMessages: 10 })
      const count = (manager as any).calculateSummarizeCount(5)
      expect(count).toBe(0) // 5 - 10 = -5, clamped to 0
    })
  })

  describe('adjustSplitPointForToolPairs', () => {
    it('returns split point when no tool blocks present', () => {
      const manager = new SummarizingConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const adjusted = (manager as any).adjustSplitPointForToolPairs(messages, 1)
      expect(adjusted).toBe(1)
    })

    it('skips toolResult at split point', () => {
      const manager = new SummarizingConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Result')] }),
          ],
        }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const adjusted = (manager as any).adjustSplitPointForToolPairs(messages, 1)
      expect(adjusted).toBe(2) // Skip the toolResult
    })

    it('skips toolUse without following toolResult', () => {
      const manager = new SummarizingConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'tool', toolUseId: 'tool-1', input: {} })],
        }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const adjusted = (manager as any).adjustSplitPointForToolPairs(messages, 1)
      expect(adjusted).toBe(2) // Skip the toolUse without result
    })

    it('allows toolUse with following toolResult', () => {
      const manager = new SummarizingConversationManager()
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'tool', toolUseId: 'tool-1', input: {} })],
        }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Result')] }),
          ],
        }),
        new Message({ role: 'user', content: [new TextBlock('Message 2')] }),
      ]
      const adjusted = (manager as any).adjustSplitPointForToolPairs(messages, 1)
      expect(adjusted).toBe(1) // Valid split point
    })

    it('throws when no valid split point found', () => {
      const manager = new SummarizingConversationManager()
      const messages = [
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Result')] }),
          ],
        }),
      ]
      expect(() => (manager as any).adjustSplitPointForToolPairs(messages, 0)).toThrow(
        'Unable to trim conversation context!'
      )
    })

    it('throws when split point exceeds message length', () => {
      const manager = new SummarizingConversationManager()
      const messages = [new Message({ role: 'user', content: [new TextBlock('Message 1')] })]
      expect(() => (manager as any).adjustSplitPointForToolPairs(messages, 5)).toThrow(
        'Split point exceeds message array length'
      )
    })
  })

  describe('reduceContext', () => {
    it('throws when insufficient messages for summarization', async () => {
      const manager = new SummarizingConversationManager({ preserveRecentMessages: 10 })
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = createMockAgent({ messages })

      await expect(triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Test'))).rejects.toThrow(
        'Cannot summarize: insufficient messages for summarization'
      )
    })

    it('summarizes messages and replaces with summary', async () => {
      const model = new MockMessageModel().addTurn(new TextBlock('Summary of conversation'))
      const messages = Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0
          ? new Message({ role: 'user', content: [new TextBlock(`Message ${i}`)] })
          : new Message({ role: 'assistant', content: [new TextBlock(`Response ${i}`)] })
      )
      const mockAgent = createMockAgent({ messages })
      ;(mockAgent as any).model = model

      const manager = new SummarizingConversationManager({ summaryRatio: 0.3, preserveRecentMessages: 5 })

      const result = await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Test'))

      expect(result.retry).toBe(true)
      expect(mockAgent.messages.length).toBeLessThan(20)
      expect(mockAgent.messages[0]?.role).toBe('user')
      expect(mockAgent.messages[0]?.content[0]?.type).toBe('textBlock')
    })

    it('preserves recent messages', async () => {
      const model = new MockMessageModel().addTurn(new TextBlock('Summary'))
      const messages = Array.from(
        { length: 20 },
        (_, i) => new Message({ role: 'user', content: [new TextBlock(`Message ${i}`)] })
      )
      const mockAgent = createMockAgent({ messages })
      ;(mockAgent as any).model = model

      const manager = new SummarizingConversationManager({ summaryRatio: 0.5, preserveRecentMessages: 10 })

      await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Test'))

      // Should have summary + 10 recent messages
      expect(mockAgent.messages.length).toBe(11)
      expect(mockAgent.messages[mockAgent.messages.length - 1]?.content[0]).toMatchObject({ text: 'Message 19' })
    })
  })

  describe('generateSummaryWithModel', () => {
    it('calls model with summarization prompt', async () => {
      const model = new MockMessageModel().addTurn(new TextBlock('Generated summary'))
      const messages = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Response 1')] }),
      ]
      const mockAgent = createMockAgent({ messages: [] })
      ;(mockAgent as any).model = model

      const manager = new SummarizingConversationManager()
      const summary = await (manager as any).generateSummaryWithModel(messages, mockAgent)

      expect(summary.role).toBe('user')
      expect(summary.content[0]).toMatchObject({ type: 'textBlock', text: 'Generated summary' })
    })

    it('uses custom summarization prompt when provided', async () => {
      const model = new MockMessageModel().addTurn(new TextBlock('Custom summary'))
      const messages = [new Message({ role: 'user', content: [new TextBlock('Message')] })]
      const mockAgent = createMockAgent({ messages: [] })
      ;(mockAgent as any).model = model

      const manager = new SummarizingConversationManager({
        summarizationSystemPrompt: 'Custom summarization instructions',
      })
      const summary = await (manager as any).generateSummaryWithModel(messages, mockAgent)

      expect(summary.content[0]).toMatchObject({ type: 'textBlock', text: 'Custom summary' })
    })
  })

  describe('generateSummaryWithAgent', () => {
    it('uses dedicated summarization agent', async () => {
      const summaryModel = new MockMessageModel().addTurn(new TextBlock('Agent summary'))
      const summaryAgent = createMockAgent({ messages: [] })
      ;(summaryAgent as any).model = summaryModel
      ;(summaryAgent as any).invoke = async () => ({
        lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Agent summary')] }),
      })

      const messages = [new Message({ role: 'user', content: [new TextBlock('Message')] })]

      const manager = new SummarizingConversationManager({ summarizationAgent: summaryAgent })
      const summary = await (manager as any).generateSummaryWithAgent(messages)

      expect(summary.role).toBe('user')
      expect(summary.content[0]).toMatchObject({ type: 'textBlock', text: 'Agent summary' })
    })

    it('restores original messages after summarization', async () => {
      const summaryModel = new MockMessageModel().addTurn(new TextBlock('Summary'))
      const originalMessages = [new Message({ role: 'user', content: [new TextBlock('Original')] })]
      const summaryAgent = createMockAgent({ messages: [...originalMessages] })
      ;(summaryAgent as any).model = summaryModel
      ;(summaryAgent as any).invoke = async () => ({
        lastMessage: new Message({ role: 'assistant', content: [new TextBlock('Summary')] }),
      })

      const messages = [new Message({ role: 'user', content: [new TextBlock('To summarize')] })]

      const manager = new SummarizingConversationManager({ summarizationAgent: summaryAgent })
      await (manager as any).generateSummaryWithAgent(messages)

      expect(summaryAgent.messages).toHaveLength(1)
      expect(summaryAgent.messages[0]?.content[0]).toMatchObject({ text: 'Original' })
    })
  })

  describe('hook integration', () => {
    it('registers AfterModelCallEvent callback', () => {
      const manager = new SummarizingConversationManager()
      const registry = new HookRegistryImplementation()

      manager.registerCallbacks(registry)

      expect((registry as any)._callbacks.has(AfterModelCallEvent)).toBe(true)
    })

    it('sets retry flag on context overflow', async () => {
      const model = new MockMessageModel().addTurn(new TextBlock('Summary'))
      const messages = Array.from(
        { length: 20 },
        (_, i) => new Message({ role: 'user', content: [new TextBlock(`Message ${i}`)] })
      )
      const mockAgent = createMockAgent({ messages })
      ;(mockAgent as any).model = model

      const manager = new SummarizingConversationManager()
      const result = await triggerContextOverflow(manager, mockAgent, new ContextWindowOverflowError('Test'))

      expect(result.retry).toBe(true)
    })

    it('does not set retry flag for non-overflow errors', async () => {
      const messages = [new Message({ role: 'user', content: [new TextBlock('Message')] })]
      const mockAgent = createMockAgent({ messages })

      const manager = new SummarizingConversationManager()
      const result = await triggerContextOverflow(manager, mockAgent, new Error('Other error'))

      expect(result.retry).toBeUndefined()
    })
  })
})
