import { describe, it, expect } from 'vitest'
import { hello } from '@/hello'

describe('hello', () => {
  describe('when called without parameters', () => {
    it('returns a default greeting', () => {
      const result = hello()
      expect(result).toBe('Hello, World!')
    })

    it('returns a string type', () => {
      const result = hello()
      expect(typeof result).toBe('string')
    })
  })

  describe('when called with a name', () => {
    it('returns a personalized greeting', () => {
      const result = hello('TypeScript')
      expect(result).toBe('Hello, TypeScript!')
    })

    it('handles empty string gracefully', () => {
      const result = hello('')
      expect(result).toBe('Hello, !')
    })

    it('handles whitespace-only names', () => {
      const result = hello('   ')
      expect(result).toBe('Hello,    !')
    })

    it('handles special characters in names', () => {
      const result = hello('Test & Co.')
      expect(result).toBe('Hello, Test & Co.!')
    })
  })
})
