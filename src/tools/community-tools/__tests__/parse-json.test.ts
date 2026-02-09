import { describe, it, expect } from 'vitest'
import { parseJson } from '../parse-json.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('parse_json tool', () => {
  describe('properties', () => {
    it('has correct name and description', () => {
      expect(parseJson.name).toBe('parse_json')
      expect(parseJson.description).toContain('Parse')
      expect(parseJson.toolSpec.inputSchema).toBeDefined()
    })
  })

  describe('validation', () => {
    it('returns error when json is missing', async () => {
      const ctx = createMockToolContext('parse_json', {})
      const block = await runToolStream(parseJson, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Missing required field')
    })

    it('returns error for invalid JSON', async () => {
      const ctx = createMockToolContext('parse_json', { json: 'not valid { json' })
      const block = await runToolStream(parseJson, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Invalid JSON')
    })

    it('returns error when path not found', async () => {
      const ctx = createMockToolContext('parse_json', { json: '{"a":1}', path: 'b.c' })
      const block = await runToolStream(parseJson, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('not found')
    })
  })

  describe('execution', () => {
    it('parses JSON and returns stringified result', async () => {
      const ctx = createMockToolContext('parse_json', { json: '{"a":1,"b":2}' })
      const block = await runToolStream(parseJson, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('"a": 1')
      expect(text).toContain('"b": 2')
    })

    it('extracts by path with dot notation', async () => {
      const ctx = createMockToolContext('parse_json', {
        json: '{"user":{"name":"Alice","id":10}}',
        path: 'user.name',
      })
      const block = await runToolStream(parseJson, ctx)
      const text = getToolResultText(block)
      expect(text).toBe('Alice')
    })

    it('extracts by path with array index', async () => {
      const ctx = createMockToolContext('parse_json', {
        json: '{"items":[{"x":1},{"x":2}]}',
        path: 'items[1].x',
      })
      const block = await runToolStream(parseJson, ctx)
      const text = getToolResultText(block)
      expect(text).toBe('2')
    })

    it('respects pretty: false', async () => {
      const ctx = createMockToolContext('parse_json', {
        json: '{"a":1}',
        pretty: false,
      })
      const block = await runToolStream(parseJson, ctx)
      const text = getToolResultText(block)
      expect(text).toBe('{"a":1}')
    })
  })
})
