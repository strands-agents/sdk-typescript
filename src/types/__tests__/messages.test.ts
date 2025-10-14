import { describe, it, expect } from 'vitest'
import type { ContentBlock, Message } from '@/types/messages'

describe('message types', () => {
  describe('ContentBlock type narrowing', () => {
    it('narrows type for text block', () => {
      const block: ContentBlock = {
        type: 'text',
        text: 'Hello, world!',
      }

      if (block.type === 'text') {
        expect(block.text).toBe('Hello, world!')
      }
    })

    it('narrows type for toolUse block', () => {
      const block: ContentBlock = {
        type: 'toolUse',
        name: 'calculator',
        toolUseId: 'calc-1',
        input: { a: 5, b: 3 },
      }

      if (block.type === 'toolUse') {
        expect(block.name).toBe('calculator')
      }
    })

    it('narrows type for toolResult block', () => {
      const block: ContentBlock = {
        type: 'toolResult',
        toolUseId: 'calc-1',
        status: 'success',
        content: [{ type: 'text', text: 'Result: 8' }],
      }

      if (block.type === 'toolResult') {
        expect(block.status).toBe('success')
      }
    })

    it('narrows type for reasoning block', () => {
      const block: ContentBlock = {
        type: 'reasoning',
        text: 'Thinking about the problem',
      }

      if (block.type === 'reasoning') {
        expect(block.text).toBe('Thinking about the problem')
      }
    })
  })

  describe('Message structure', () => {
    it('supports multi-block messages', () => {
      const message: Message = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me help you' },
          { type: 'toolUse', name: 'calculator', toolUseId: 'calc-1', input: { a: 5, b: 3 } },
        ],
      }
      expect(message.content).toHaveLength(2)
      expect(message.content[0]?.type).toBe('text')
      expect(message.content[1]?.type).toBe('toolUse')
    })
  })
})
