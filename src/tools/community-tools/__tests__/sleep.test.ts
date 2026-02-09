import { describe, it, expect, vi } from 'vitest'
import { sleep } from '../sleep.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('sleep tool', () => {
  describe('properties', () => {
    it('has correct name and description', () => {
      expect(sleep.name).toBe('sleep')
      expect(sleep.description).toContain('Pause')
      expect(sleep.toolSpec.inputSchema).toBeDefined()
    })
  })

  describe('validation', () => {
    it('returns error when duration is zero', async () => {
      const ctx = createMockToolContext('sleep', {})
      const block = await runToolStream(sleep, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('greater than 0')
    })

    it('returns error when duration exceeds 5 minutes', async () => {
      const ctx = createMockToolContext('sleep', { seconds: 301 })
      const block = await runToolStream(sleep, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('cannot exceed')
    })
  })

  describe('execution', () => {
    it('sleeps for specified milliseconds', async () => {
      vi.useFakeTimers()
      const ctx = createMockToolContext('sleep', { milliseconds: 100 })
      const promise = runToolStream(sleep, ctx)
      await vi.advanceTimersByTimeAsync(100)
      const block = await promise
      const text = getToolResultText(block)
      expect(text).toContain('Slept for 100ms')
      vi.useRealTimers()
    })

    it('sleeps for specified seconds', async () => {
      vi.useFakeTimers()
      const ctx = createMockToolContext('sleep', { seconds: 2 })
      const promise = runToolStream(sleep, ctx)
      await vi.advanceTimersByTimeAsync(2000)
      const block = await promise
      const text = getToolResultText(block)
      expect(text).toContain('Slept for 2000ms')
      vi.useRealTimers()
    })

    it('combines seconds and milliseconds', async () => {
      vi.useFakeTimers()
      const ctx = createMockToolContext('sleep', { seconds: 1, milliseconds: 500 })
      const promise = runToolStream(sleep, ctx)
      await vi.advanceTimersByTimeAsync(1500)
      const block = await promise
      const text = getToolResultText(block)
      expect(text).toContain('Slept for 1500ms')
      vi.useRealTimers()
    })
  })
})
