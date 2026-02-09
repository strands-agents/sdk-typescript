import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SummarizingConversationManager, DEFAULT_SUMMARIZATION_PROMPT } from '../summarizing-conversation-manager.js'
import { ContextWindowOverflowError } from '../../errors.js'
import { Message, TextBlock, ToolUseBlock, ToolResultBlock, JsonBlock } from '../../types/messages.js'
import type { HookRegistry } from '../../hooks/registry.js'
import { AfterModelCallEvent } from '../../hooks/events.js'
import { AgentState } from '../../agent/state.js'
import { NullConversationManager } from '../null-conversation-manager.js'

/**
 * Creates a mock model that returns a predictable summary.
 */
function createMockModel(summaryText: string = 'This is a summary of the conversation.'): {
  streamAggregated: ReturnType<typeof vi.fn>
} {
  return {
    // eslint-disable-next-line require-yield
    streamAggregated: vi.fn().mockImplementation(async function* () {
      return {
        message: new Message({
          role: 'assistant',
          content: [new TextBlock(summaryText)],
        }),
        stopReason: 'endTurn',
      }
    }),
  }
}

/**
 * Creates a mock agent with messages and a model.
 */
function createMockAgent(
  messages: Message[],
  model?: ReturnType<typeof createMockModel>
): {
  messages: Message[]
  state: AgentState
  model: ReturnType<typeof createMockModel>
  agentId: string
  conversationManager: NullConversationManager
} {
  return {
    messages,
    state: new AgentState(),
    model: model ?? createMockModel(),
    agentId: 'default',
    conversationManager: new NullConversationManager(),
  }
}

/**
 * Creates simple text messages for testing.
 */
function createTextMessages(count: number): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant'
    messages.push(
      new Message({
        role: role as 'user' | 'assistant',
        content: [new TextBlock(`Message ${i + 1}`)],
      })
    )
  }
  return messages
}

/**
 * Helper to create a hook registry mock that captures the registered callback.
 */
function createMockRegistry(): {
  registry: HookRegistry
  capturedCallback: ((event: AfterModelCallEvent) => void | Promise<void>) | null
} {
  const state: { capturedCallback: ((event: AfterModelCallEvent) => void | Promise<void>) | null } = {
    capturedCallback: null,
  }

  const registry = {
    addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
      state.capturedCallback = callback as (event: AfterModelCallEvent) => void | Promise<void>
    }),
  } as unknown as HookRegistry

  return { registry, ...state }
}

describe('SummarizingConversationManager', () => {
  describe('constructor', () => {
    it('uses default values', () => {
      const manager = new SummarizingConversationManager()
      // Verify it constructs without error
      expect(manager).toBeDefined()
    })

    it('clamps summary ratio to minimum 0.1', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.01 })
      // Verify construction succeeds with extreme value (clamped internally)
      expect(manager).toBeDefined()
    })

    it('clamps summary ratio to maximum 0.8', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.99 })
      expect(manager).toBeDefined()
    })

    it('throws when both summarizationAgent and summarizationSystemPrompt are provided', () => {
      expect(
        () =>
          new SummarizingConversationManager({
            summarizationAgent: { invoke: vi.fn() },
            summarizationSystemPrompt: 'Custom prompt',
          })
      ).toThrow('Cannot provide both summarizationAgent and summarizationSystemPrompt')
    })
  })

  describe('registerCallbacks', () => {
    it('registers a callback for AfterModelCallEvent', () => {
      const manager = new SummarizingConversationManager()
      const { registry } = createMockRegistry()

      manager.registerCallbacks(registry)

      expect(registry.addCallback).toHaveBeenCalledWith(AfterModelCallEvent, expect.any(Function))
    })

    it('triggers reduce context on ContextWindowOverflowError', async () => {
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 2,
      })

      let capturedCallback: ((event: AfterModelCallEvent) => Promise<void>) | null = null
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)
      expect(capturedCallback).not.toBeNull()

      const messages = createTextMessages(6)
      const model = createMockModel()
      const agent = createMockAgent(messages, model)

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback!(event)

      expect(event.retry).toBe(true)
      // Messages should be reduced: 1 summary + preserved messages
      expect(messages.length).toBeLessThan(6)
    })

    it('does not trigger on non-overflow errors', async () => {
      const manager = new SummarizingConversationManager()

      let capturedCallback: ((event: AfterModelCallEvent) => Promise<void>) | null = null
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const messages = createTextMessages(6)
      const agent = createMockAgent(messages)

      const event = new AfterModelCallEvent({
        agent,
        error: new Error('some other error'),
      })

      await capturedCallback!(event)

      expect(event.retry).toBeUndefined()
      expect(messages.length).toBe(6)
    })
  })

  describe('reduceContext', () => {
    let manager: SummarizingConversationManager
    let capturedCallback: (event: AfterModelCallEvent) => Promise<void>

    beforeEach(() => {
      manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 2,
      })

      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)
    })

    async function triggerReduceContext(
      messages: Message[],
      model?: ReturnType<typeof createMockModel>
    ): Promise<void> {
      const agent = createMockAgent(messages, model)
      // Replace messages reference in agent to share with our test
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback(event)
    }

    it('replaces summarized messages with summary', async () => {
      const messages = createTextMessages(6)
      const model = createMockModel('Summary of conversation')

      await triggerReduceContext(messages, model)

      // First message should be the summary (as user message)
      expect(messages[0]!.role).toBe('user')
      expect(messages[0]!.content[0]!.type).toBe('textBlock')
      expect((messages[0]!.content[0] as TextBlock).text).toBe('Summary of conversation')
    })

    it('preserves recent messages', async () => {
      const messages = createTextMessages(6)
      const originalLast = messages[5]!
      const originalSecondLast = messages[4]!

      await triggerReduceContext(messages)

      // Last two messages should be preserved
      expect(messages[messages.length - 1]).toBe(originalLast)
      expect(messages[messages.length - 2]).toBe(originalSecondLast)
    })

    it('throws when insufficient messages for summarization', async () => {
      const insufficientManager = new SummarizingConversationManager({
        summaryRatio: 0.1,
        preserveRecentMessages: 5,
      })

      let callback: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, cb: unknown) => {
          callback = cb as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      insufficientManager.registerCallbacks(registry)

      const messages = createTextMessages(3)
      const agent = createMockAgent(messages)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await expect(callback!(event)).rejects.toThrow('insufficient messages for summarization')
    })

    it('throws when no messages exist', async () => {
      const messages: Message[] = []

      await expect(triggerReduceContext(messages)).rejects.toThrow('insufficient messages for summarization')
    })
  })

  describe('adjustSplitPointForToolPairs', () => {
    let manager: SummarizingConversationManager
    let capturedCallback: (event: AfterModelCallEvent) => Promise<void>

    beforeEach(() => {
      manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
      })

      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)
    })

    it('skips tool result at split point', async () => {
      const messages: Message[] = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'test_tool', toolUseId: '123', input: {} })],
        }),
        new Message({
          role: 'user',
          content: [new ToolResultBlock({ toolUseId: '123', status: 'success', content: [new TextBlock('output')] })],
        }),
        new Message({ role: 'assistant', content: [new TextBlock('Response after tool')] }),
        new Message({ role: 'user', content: [new TextBlock('Latest message')] }),
      ]

      const model = createMockModel()
      const agent = createMockAgent(messages, model)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback(event)

      // Tool pair should be kept together (both summarized or both kept)
      // The split should not leave a tool result without its tool use
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!
        const hasToolResult = msg.content.some((b) => b.type === 'toolResultBlock')
        if (hasToolResult && i > 0) {
          const prevMsg = messages[i - 1]!
          const prevHasToolUse = prevMsg.content.some((b) => b.type === 'toolUseBlock')
          expect(prevHasToolUse).toBe(true)
        }
      }
    })

    it('skips orphan tool use at split point when next message has no tool result', async () => {
      const messages: Message[] = [
        new Message({ role: 'user', content: [new TextBlock('Message 1')] }),
        new Message({ role: 'assistant', content: [new TextBlock('Message 2')] }),
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} })],
        }),
        new Message({ role: 'user', content: [new TextBlock('Message 4 - no tool result')] }),
      ]

      const model = createMockModel()
      const agent = createMockAgent(messages, model)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback(event)

      expect(messages.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('generateSummary', () => {
    it('throws when no summarization agent and agent has no model', async () => {
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
      })

      let capturedCallback!: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const messages = createTextMessages(5)
      const agentWithoutModel = createMockAgent(messages)
      Object.defineProperty(agentWithoutModel, 'model', { value: undefined, configurable: true })

      const event = new AfterModelCallEvent({
        agent: agentWithoutModel,
        error: new ContextWindowOverflowError('overflow'),
      })

      expect(capturedCallback).toBeDefined()
      await expect(capturedCallback!(event)).rejects.toThrow(
        'No summarization agent provided and parent agent model is not accessible'
      )
    })

    it('throws when agent model exists but has no streamAggregated', async () => {
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
      })

      let capturedCallback!: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const messages = createTextMessages(5)
      const agentWithBadModel = createMockAgent(messages)
      Object.defineProperty(agentWithBadModel, 'model', { value: {}, configurable: true })

      const event = new AfterModelCallEvent({
        agent: agentWithBadModel,
        error: new ContextWindowOverflowError('overflow'),
      })

      expect(capturedCallback).toBeDefined()
      await expect(capturedCallback!(event)).rejects.toThrow(
        'No summarization agent provided and parent agent model is not accessible'
      )
    })

    it('uses dedicated summarization agent when provided', async () => {
      const mockSummarizationAgent = {
        invoke: vi.fn().mockResolvedValue({
          toString: () => 'Custom agent summary',
        }),
      }

      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
        summarizationAgent: mockSummarizationAgent,
      })

      let capturedCallback: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const messages = createTextMessages(6)
      const model = createMockModel()
      const agent = createMockAgent(messages, model)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback!(event)
    })

    it('uses summarization agent with messages containing tool use and tool result blocks', async () => {
      const mockSummarizationAgent = {
        invoke: vi.fn().mockResolvedValue({
          toString: () => 'Summary with tool context',
        }),
      }

      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
        summarizationAgent: mockSummarizationAgent,
      })

      let capturedCallback: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const messages: Message[] = [
        new Message({ role: 'user', content: [new TextBlock('Hello')] }),
        new Message({
          role: 'assistant',
          content: [
            new TextBlock('Hi'),
            new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: 'string input' }),
            new ToolUseBlock({ name: 'other', toolUseId: 'tu-2', input: { key: 'value' } }),
          ],
        }),
        new Message({
          role: 'user',
          content: [
            new ToolResultBlock({
              toolUseId: 'tu-1',
              status: 'success',
              content: [new TextBlock('output')],
            }),
            new ToolResultBlock({
              toolUseId: 'tu-2',
              status: 'error',
              content: [new TextBlock('output'), new JsonBlock({ json: { key: 'value' } })],
            }),
          ],
        }),
      ]
      const model = createMockModel()
      const agent = createMockAgent(messages, model)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback!(event)

      expect(mockSummarizationAgent.invoke).toHaveBeenCalled()
      expect(messages[0]!.content[0]!.type).toBe('textBlock')
      expect((messages[0]!.content[0] as TextBlock).text).toBe('Summary with tool context')
    })

    it('uses parent agent model when no summarization agent provided', async () => {
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
      })

      let capturedCallback: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const model = createMockModel('Model-generated summary')
      const messages = createTextMessages(6)
      const agent = createMockAgent(messages, model)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback!(event)

      expect(model.streamAggregated).toHaveBeenCalled()
      // Verify system prompt was passed
      const callArgs = model.streamAggregated.mock.calls[0]!
      expect(callArgs[1]).toEqual({
        systemPrompt: [expect.objectContaining({ type: 'textBlock', text: DEFAULT_SUMMARIZATION_PROMPT })],
      })
    })

    it('uses custom system prompt when provided', async () => {
      const customPrompt = 'Custom summarization prompt'
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
        summarizationSystemPrompt: customPrompt,
      })

      let capturedCallback: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const model = createMockModel()
      const messages = createTextMessages(6)
      const agent = createMockAgent(messages, model)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback!(event)

      const callArgs = model.streamAggregated.mock.calls[0]!
      expect(callArgs[1]).toEqual({
        systemPrompt: [expect.objectContaining({ type: 'textBlock', text: customPrompt })],
      })
    })

    it('throws when no model available and no summarization agent', async () => {
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
      })

      let capturedCallback: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const messages = createTextMessages(6)
      const agent = {
        messages,
        state: new AgentState(),
        agentId: 'default',
        conversationManager: new NullConversationManager(),
      }

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await expect(capturedCallback!(event)).rejects.toThrow('No summarization agent provided')
    })

    it('converts summary to user message', async () => {
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 1,
      })

      let capturedCallback: (event: AfterModelCallEvent) => Promise<void>
      const registry = {
        addCallback: vi.fn().mockImplementation((_eventClass: unknown, callback: unknown) => {
          capturedCallback = callback as (event: AfterModelCallEvent) => Promise<void>
        }),
      } as unknown as HookRegistry

      manager.registerCallbacks(registry)

      const model = createMockModel('Summary text')
      const messages = createTextMessages(4)
      const agent = createMockAgent(messages, model)
      Object.defineProperty(agent, 'messages', { value: messages, writable: false })

      const event = new AfterModelCallEvent({
        agent,
        error: new ContextWindowOverflowError('overflow'),
      })

      await capturedCallback!(event)

      // The summary message should have role 'user'
      expect(messages[0]!.role).toBe('user')
    })
  })

  describe('getState', () => {
    it('returns serializable state with class name and config', () => {
      const manager = new SummarizingConversationManager({
        summaryRatio: 0.5,
        preserveRecentMessages: 5,
      })
      const state = manager.getState()
      expect(state).toStrictEqual({
        __name__: 'SummarizingConversationManager',
        summaryRatio: 0.5,
        preserveRecentMessages: 5,
      })
    })

    it('returns clamped summaryRatio in state', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.01 })
      const state = manager.getState()
      expect(state.summaryRatio).toBe(0.1)
    })
  })

  describe('restoreFromSession', () => {
    it('returns null and does not throw', () => {
      const manager = new SummarizingConversationManager()
      const result = manager.restoreFromSession({})
      expect(result).toBeNull()
    })

    it('returns null when given state from getState', () => {
      const manager = new SummarizingConversationManager({ summaryRatio: 0.3 })
      const state = manager.getState()
      const result = manager.restoreFromSession(state)
      expect(result).toBeNull()
    })
  })

  describe('DEFAULT_SUMMARIZATION_PROMPT', () => {
    it('is exported and non-empty', () => {
      expect(DEFAULT_SUMMARIZATION_PROMPT).toBeDefined()
      expect(DEFAULT_SUMMARIZATION_PROMPT.length).toBeGreaterThan(0)
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain('Conversation Summary')
    })
  })
})
