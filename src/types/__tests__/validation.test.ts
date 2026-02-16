import { describe, it, expect } from 'vitest'
import { ensureDefined, validateIdentifier } from '../validation.js'

describe('ensureDefined', () => {
  describe('when value is defined', () => {
    it('returns the value', () => {
      const value = 'test'
      const result = ensureDefined(value, 'testField')
      expect(result).toBe('test')
    })

    it('returns zero', () => {
      const result = ensureDefined(0, 'numberField')
      expect(result).toBe(0)
    })

    it('returns empty string', () => {
      const result = ensureDefined('', 'stringField')
      expect(result).toBe('')
    })
  })

  describe('when value is null', () => {
    it('throws error with field name', () => {
      expect(() => ensureDefined(null, 'testField')).toThrow('Expected testField to be defined, but got null')
    })
  })

  describe('when value is undefined', () => {
    it('throws error with field name', () => {
      expect(() => ensureDefined(undefined, 'testField')).toThrow('Expected testField to be defined, but got undefined')
    })
  })
})

describe('validateIdentifier', () => {
  describe('when identifier is valid', () => {
    it('returns the identifier', () => {
      expect(validateIdentifier('valid-id')).toBe('valid-id')
    })
  })

  describe('when identifier contains forward slash', () => {
    it('throws error', () => {
      expect(() => validateIdentifier('invalid/id')).toThrow(
        "Identifier 'invalid/id' can only contain lowercase letters, numbers, hyphens, and underscores"
      )
    })
  })

  describe('when identifier contains backslash', () => {
    it('throws error', () => {
      expect(() => validateIdentifier('invalid\\id')).toThrow(
        "Identifier 'invalid\\id' can only contain lowercase letters, numbers, hyphens, and underscores"
      )
    })
  })
})
