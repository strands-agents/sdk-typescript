import { describe, it, expect } from 'vitest'
import { currentTime } from '../current-time.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('currentTime tool', () => {
  describe('properties', () => {
    it('has correct name and description', () => {
      expect(currentTime.name).toBe('current_time')
      expect(currentTime.description).toContain('ISO 8601')
      expect(currentTime.toolSpec.name).toBe('current_time')
    })
  })

  describe('invoke', () => {
    it('returns ISO 8601 format when no timezone given', async () => {
      const ctx = createMockToolContext('current_time', {})
      const block = await runToolStream(currentTime, ctx)
      const text = getToolResultText(block)
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$/)
    })

    it('returns ISO 8601 format for UTC', async () => {
      const ctx = createMockToolContext('current_time', { timezone: 'UTC' })
      const block = await runToolStream(currentTime, ctx)
      const text = getToolResultText(block)
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(\+00:00|Z)$/)
    })

    it('returns ISO 8601 format for US/Pacific', async () => {
      const ctx = createMockToolContext('current_time', { timezone: 'US/Pacific' })
      const block = await runToolStream(currentTime, ctx)
      const text = getToolResultText(block)
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
    })

    it('accepts Europe/London timezone', async () => {
      const ctx = createMockToolContext('current_time', { timezone: 'Europe/London' })
      const block = await runToolStream(currentTime, ctx)
      const text = getToolResultText(block)
      expect(text.length).toBeGreaterThan(0)
      expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })
})
