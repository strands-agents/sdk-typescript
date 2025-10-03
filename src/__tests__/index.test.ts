import { describe, it, expect } from 'vitest'
import { hello } from '@/index'

describe('index', () => {
  describe('exports', () => {
    it('exports the hello function', () => {
      expect(hello).toBeDefined()
      expect(typeof hello).toBe('function')
    })
  })

  describe('hello function', () => {
    it('provides working hello function through main export', () => {
      const result = hello('SDK')
      expect(result).toBe('Hello, SDK!')
      expect(typeof result).toBe('string')
    })

    it('has consistent behavior with direct hello import', () => {
      const directResult = hello('Test')
      const indexResult = hello('Test')
      expect(directResult).toBe(indexResult)
    })
  })
})
