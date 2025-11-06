import { describe, it, expect } from 'vitest'
import { deepCopy } from '../json.js'

describe('deepCopy', () => {
  describe('primitive values', () => {
    it('copies strings', () => {
      const result = deepCopy('hello')
      expect(result).toBe('hello')
    })

    it('copies numbers', () => {
      const result = deepCopy(42)
      expect(result).toBe(42)
    })

    it('copies booleans', () => {
      const result = deepCopy(true)
      expect(result).toBe(true)
    })

    it('copies null', () => {
      const result = deepCopy(null)
      expect(result).toBe(null)
    })
  })

  describe('object values', () => {
    it('creates a deep copy of objects', () => {
      const original = { nested: { value: 'test' } }
      const copy = deepCopy(original)

      expect(copy).toEqual(original)
      expect(copy).not.toBe(original) // Different reference

      // Verify deep copy - modifying original shouldn't affect copy
      original.nested.value = 'changed'
      expect((copy as { nested: { value: string } }).nested.value).toBe('test')
    })

    it('copies empty objects', () => {
      const result = deepCopy({})
      expect(result).toEqual({})
    })

    it('copies objects with multiple properties', () => {
      const original = { a: 1, b: 'two', c: true, d: null }
      const copy = deepCopy(original)
      expect(copy).toEqual(original)
    })
  })

  describe('array values', () => {
    it('creates a deep copy of arrays', () => {
      const original = [1, 2, 3, { nested: 'value' }]
      const copy = deepCopy(original)

      expect(copy).toEqual(original)
      expect(copy).not.toBe(original) // Different reference

      // Verify deep copy - modifying original shouldn't affect copy
      original[0] = 999
      expect((copy as number[])[0]).toBe(1)
    })

    it('copies empty arrays', () => {
      const result = deepCopy([])
      expect(result).toEqual([])
    })

    it('copies nested arrays', () => {
      const original = [
        [1, 2],
        [3, 4],
      ]
      const copy = deepCopy(original)
      expect(copy).toEqual(original)
    })
  })

  describe('error handling', () => {
    it('throws error for circular references', () => {
      const circular: { self?: unknown } = {}
      circular.self = circular

      expect(() => deepCopy(circular)).toThrow('Unable to serialize tool result')
    })

    it('silently drops functions from objects', () => {
      const withFunction = {
        normalProp: 'value',
        funcProp: (): string => 'test',
      }

      const result = deepCopy(withFunction)
      expect(result).toEqual({ normalProp: 'value' })
      expect(result).not.toHaveProperty('funcProp')
    })

    it('silently drops symbols from objects', () => {
      const sym = Symbol('test')
      const withSymbol = {
        normalProp: 'value',
        [sym]: 'symbolValue',
      }

      const result = deepCopy(withSymbol)
      expect(result).toEqual({ normalProp: 'value' })
      // Symbols are dropped during JSON serialization
      expect(Object.getOwnPropertySymbols(result as object)).toHaveLength(0)
    })

    it('silently drops undefined values from objects', () => {
      const withUndefined = {
        normalProp: 'value',
        undefinedProp: undefined,
      }

      const result = deepCopy(withUndefined)
      expect(result).toEqual({ normalProp: 'value' })
      expect(result).not.toHaveProperty('undefinedProp')
    })
  })

  describe('complex nested structures', () => {
    it('copies deeply nested structures', () => {
      const original = {
        level1: {
          level2: {
            level3: {
              array: [1, 2, { deep: 'value' }],
              string: 'test',
            },
          },
        },
      }

      const copy = deepCopy(original)
      expect(copy).toEqual(original)
      expect(copy).not.toBe(original)
    })

    it('copies arrays of objects', () => {
      const original = [
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
        { id: 3, name: 'third' },
      ]

      const copy = deepCopy(original)
      expect(copy).toEqual(original)
      expect(copy).not.toBe(original)
    })
  })
})
