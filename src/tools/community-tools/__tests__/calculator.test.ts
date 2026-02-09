import { describe, it, expect } from 'vitest'
import { calculator } from '../calculator.js'
import { createMockToolContext, runToolStream, getToolResultText } from './test-helpers.js'

describe('calculator tool', () => {
  describe('properties', () => {
    it('has correct name and description', () => {
      expect(calculator.name).toBe('calculator')
      expect(calculator.description).toContain('mathematical')
      expect(calculator.toolSpec.inputSchema).toBeDefined()
    })
  })

  describe('evaluate mode', () => {
    it('evaluates simple expression', async () => {
      const ctx = createMockToolContext('calculator', { expression: '2 + 3', mode: 'evaluate' })
      const block = await runToolStream(calculator, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Result: 5')
    })

    it('evaluates expression with variables', async () => {
      const ctx = createMockToolContext('calculator', {
        expression: 'a * b',
        mode: 'evaluate',
        variables: { a: 4, b: 5 },
      })
      const block = await runToolStream(calculator, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Result: 20')
    })

    it('returns error for invalid expression', async () => {
      const ctx = createMockToolContext('calculator', { expression: '1 + ', mode: 'evaluate' })
      const block = await runToolStream(calculator, ctx)
      const text = getToolResultText(block)
      expect(text.toLowerCase()).toContain('error')
    })
  })

  describe('simplify mode', () => {
    it('simplifies algebraic expression', async () => {
      const ctx = createMockToolContext('calculator', {
        expression: 'x + x + x',
        mode: 'simplify',
      })
      const block = await runToolStream(calculator, ctx)
      const text = getToolResultText(block)
      expect(text.includes('Result:') || text.includes('requires optional dependency "mathjs"')).toBe(true)
    })
  })

  describe('derive mode', () => {
    it('derives with respect to variable', async () => {
      const ctx = createMockToolContext('calculator', {
        expression: 'x^2',
        mode: 'derive',
        wrt: 'x',
      })
      const block = await runToolStream(calculator, ctx)
      const text = getToolResultText(block)
      expect(text.includes('Result:') || text.includes('requires optional dependency "mathjs"')).toBe(true)
    })
  })

  describe('default mode', () => {
    it('defaults to evaluate when mode omitted', async () => {
      const ctx = createMockToolContext('calculator', { expression: '10 / 2' })
      const block = await runToolStream(calculator, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('Result: 5')
    })
  })
})
