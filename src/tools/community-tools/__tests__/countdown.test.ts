import { describe, it, expect, vi } from 'vitest'
import { countdown } from '../countdown.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('countdown tool', () => {
  describe('properties', () => {
    it('has correct name and description', () => {
      expect(countdown.name).toBe('countdown')
      expect(countdown.description).toContain('countdown')
      expect(countdown.toolSpec.inputSchema).toBeDefined()
    })
  })

  describe('execution', () => {
    it('streams then returns final message with default seconds', async () => {
      vi.useFakeTimers()
      const ctx = createMockToolContext('countdown', {})
      const promise = runToolStream(countdown, ctx)
      await vi.advanceTimersByTimeAsync(4000)
      const block = await promise
      const text = getToolResultText(block)
      expect(text).toBe('Done.')
      vi.useRealTimers()
    })

    it('uses custom seconds and message', async () => {
      vi.useFakeTimers()
      const ctx = createMockToolContext('countdown', { seconds: 2, message: 'Liftoff!' })
      const promise = runToolStream(countdown, ctx)
      await vi.advanceTimersByTimeAsync(3000)
      const block = await promise
      const text = getToolResultText(block)
      expect(text).toBe('Liftoff!')
      vi.useRealTimers()
    })

    it('clamps seconds to allowed range', async () => {
      vi.useFakeTimers()
      const ctx = createMockToolContext('countdown', { seconds: 100 })
      const promise = runToolStream(countdown, ctx)
      await vi.advanceTimersByTimeAsync(61_000)
      const block = await promise
      const text = getToolResultText(block)
      expect(text).toBeDefined()
      vi.useRealTimers()
    })
  })
})
