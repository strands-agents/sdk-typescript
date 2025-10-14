import { describe, it, expect } from 'vitest'
import type { ToolResultContent, ToolChoice } from '@/tools/types'

describe('tool types', () => {
  describe('ToolResultContent type narrowing', () => {
    it('narrows type for text content', () => {
      const content: ToolResultContent = {
        type: 'text',
        text: 'Result: 42',
      }

      if (content.type === 'text') {
        expect(content.text).toBe('Result: 42')
      }
    })

    it('narrows type for json content', () => {
      const content: ToolResultContent = {
        type: 'json',
        json: { result: 42 },
      }

      if (content.type === 'json') {
        expect(content.json).toEqual({ result: 42 })
      }
    })
  })

  describe('ToolChoice type narrowing', () => {
    it('allows checking for auto choice', () => {
      const choice: ToolChoice = { auto: {} }
      expect('auto' in choice).toBe(true)
    })

    it('allows checking for specific tool choice', () => {
      const choice: ToolChoice = { tool: { name: 'calculator' } }
      if ('tool' in choice) {
        expect(choice.tool.name).toBe('calculator')
      }
    })
  })
})
