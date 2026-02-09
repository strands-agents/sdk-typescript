import { describe, it, expect } from 'vitest'
import { stop } from '../stop.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('stop tool', () => {
  describe('properties', () => {
    it('has correct name and description', () => {
      expect(stop.name).toBe('stop')
      expect(stop.description).toContain('stop')
      expect(stop.toolSpec.inputSchema).toBeDefined()
    })
  })

  describe('execution', () => {
    it('returns default message when none provided', async () => {
      const ctx = createMockToolContext('stop', {})
      const block = await runToolStream(stop, ctx)
      const text = getToolResultText(block)
      expect(text).toBe('Agent stopped')
    })

    it('returns custom message when provided', async () => {
      const ctx = createMockToolContext('stop', { message: 'Task complete: report generated' })
      const block = await runToolStream(stop, ctx)
      const text = getToolResultText(block)
      expect(text).toBe('Task complete: report generated')
    })
  })
})
