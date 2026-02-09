import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { environment } from '../environment.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('environment tool', () => {
  describe('properties', () => {
    it('has correct name and description', () => {
      expect(environment.name).toBe('environment')
      expect(environment.description).toContain('environment variable')
      const schema = environment.toolSpec.inputSchema as { required?: string[] } | undefined
      expect(schema?.required).toContain('key')
    })
  })

  describe('validation', () => {
    it('returns error when key is missing', async () => {
      const ctx = createMockToolContext('environment', {})
      const block = await runToolStream(environment, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Missing required field: key')
    })
  })

  describe('execution', () => {
    const testKey = 'TEST_ENV_TOOL_VAR_' + Date.now()

    beforeEach(() => {
      process.env[testKey] = 'test-value-123'
    })

    afterEach(() => {
      delete process.env[testKey]
    })

    it('reads an existing environment variable', async () => {
      const ctx = createMockToolContext('environment', { key: testKey })
      const block = await runToolStream(environment, ctx)
      const text = getToolResultText(block)
      expect(text).toBe('test-value-123')
    })

    it('returns error for non-existent variable', async () => {
      const ctx = createMockToolContext('environment', { key: 'NONEXISTENT_VAR_XYZ_99' })
      const block = await runToolStream(environment, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('not found')
    })
  })
})
