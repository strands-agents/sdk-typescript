import { describe, it, expect } from 'vitest'
import type { Role, ReasoningBlock, ContentBlock, Message, Messages } from '@/types/messages'

describe('messages types', () => {
  describe('Role type', () => {
    it('accepts "user" as a valid role', () => {
      const role: Role = 'user'
      expect(role).toBe('user')
    })

    it('accepts "assistant" as a valid role', () => {
      const role: Role = 'assistant'
      expect(role).toBe('assistant')
    })
  })

  describe('ReasoningBlock interface', () => {
    it('accepts valid reasoning content with text', () => {
      const reasoning: ReasoningBlock = {
        type: 'reasoning',
        text: 'Thinking about the problem...',
      }
      expect(reasoning.text).toBe('Thinking about the problem...')
    })

    it('accepts reasoning content with both text and signature', () => {
      const reasoning: ReasoningBlock = {
        type: 'reasoning',
        text: 'Reasoning process',
        signature: 'sig-456',
      }
      expect(reasoning.text).toBe('Reasoning process')
      expect(reasoning.signature).toBe('sig-456')
    })
  })

  describe('ContentBlock type', () => {
    it('accepts content block with text only', () => {
      const block: ContentBlock = {
        type: 'text',
        text: 'Hello, world!',
      }
      if (block.type === 'text') {
        expect(block.text).toBe('Hello, world!')
      }
    })

    it('accepts content block with toolUse', () => {
      const block: ContentBlock = {
        type: 'tool_use',
        name: 'calculator',
        toolUseId: 'tool-123',
        input: { operation: 'add', a: 1, b: 2 },
      }
      if (block.type === 'tool_use') {
        expect(block.name).toBe('calculator')
      }
    })

    it('accepts content block with toolResult', () => {
      const block: ContentBlock = {
        type: 'tool_result',
        toolUseId: 'tool-123',
        status: 'success',
        content: [{ type: 'text', text: 'Result: 3' }],
      }
      if (block.type === 'tool_result') {
        expect(block.status).toBe('success')
      }
    })

    it('accepts content block with reasoning', () => {
      const block: ContentBlock = {
        type: 'reasoning',
        text: 'Analyzing the request',
      }
      if (block.type === 'reasoning') {
        expect(block.text).toBe('Analyzing the request')
      }
    })
  })

  describe('Message interface', () => {
    it('accepts user message with text content', () => {
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      }
      expect(message.role).toBe('user')
      expect(message.content).toHaveLength(1)
      if (message.content[0] && message.content[0].type === 'text') {
        expect(message.content[0].text).toBe('Hello')
      }
    })

    it('accepts assistant message with tool use', () => {
      const message: Message = {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'search',
            toolUseId: 'search-1',
            input: { query: 'TypeScript' },
          },
        ],
      }
      expect(message.role).toBe('assistant')
      if (message.content[0] && message.content[0].type === 'tool_use') {
        expect(message.content[0].name).toBe('search')
      }
    })

    it('accepts message with multiple content blocks', () => {
      const message: Message = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me help you' },
          { type: 'text', text: 'I will use a tool' },
          { type: 'tool_use', name: 'tool', toolUseId: 'id', input: {} },
        ],
      }
      expect(message.content).toHaveLength(3)
    })

    it('accepts message with empty content array', () => {
      const message: Message = {
        role: 'user',
        content: [],
      }
      expect(message.content).toHaveLength(0)
    })
  })

  describe('Messages type', () => {
    it('accepts array of messages', () => {
      const messages: Messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      ]
      expect(messages).toHaveLength(2)
    })

    it('accepts empty messages array', () => {
      const messages: Messages = []
      expect(messages).toHaveLength(0)
    })

    it('accepts messages with mixed content types', () => {
      const messages: Messages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Calculate 5 + 3' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'calculator',
              toolUseId: 'calc-1',
              input: { a: 5, b: 3 },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'calc-1',
              status: 'success',
              content: [{ type: 'text', text: '8' }],
            },
          ],
        },
      ]
      expect(messages).toHaveLength(3)
    })
  })
})
