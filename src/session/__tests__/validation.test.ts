import { describe, expect, it } from 'vitest'
import { validateIdentifier } from '../validation.js'

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
