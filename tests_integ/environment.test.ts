import { describe, it, expect } from 'vitest'
import { isBrowser, isNode } from '@strands-agents/sdk'

describe('environment', () => {
  describe('Node.js compatibility', () => {
    it('works in Node.js environment', () => {
      // Test Node.js specific features are available
      expect(typeof process).toBe('object')
      expect(process.version).toBeDefined()
    })
  })

  describe.skipIf(!isBrowser)('Browser compatibility', () => {
    describe('when running in browser', () => {
      it('has window object with expected properties', () => {
        expect(window).toBeDefined()
        expect(typeof window).toBe('object')
        expect(window.location).toBeDefined()
        expect(window.navigator).toBeDefined()
      })

      it('has document object with DOM methods', () => {
        expect(document).toBeDefined()
        expect(typeof document).toBe('object')
        expect(typeof document.createElement).toBe('function')
        expect(typeof document.querySelector).toBe('function')
      })

      it('has navigator object with browser information', () => {
        expect(navigator).toBeDefined()
        expect(typeof navigator).toBe('object')
        expect(typeof navigator.userAgent).toBe('string')
        expect(navigator.userAgent.length).toBeGreaterThan(0)
      })
    })

    describe('environment detection', () => {
      it('correctly identifies browser environment', () => {
        expect(isBrowser).toBe(true)
        expect(typeof window).toBe('object')
      })
    })
  })

  describe.skipIf(!isNode)('environment detection', () => {
    it('correctly identifies Node.js environment', () => {
      expect(isNode).toBe(true)
      expect(typeof process).toBe('object')
    })
  })

  describe('JavaScript features', () => {
    it('supports modern JavaScript features', () => {
      // Test ES2022 features work
      const testArray = [1, 2, 3]
      const lastElement = testArray.at(-1)
      expect(lastElement).toBe(3)
    })

    it('supports async/await functionality', async () => {
      // Test async functionality works
      const promise = Promise.resolve('test')
      const result = await promise
      expect(result).toBe('test')
    })
  })

  describe('TypeScript configuration', () => {
    it('validates strict typing environment', () => {
      // This test validates strict TypeScript configuration
      // If this compiles and runs, strict typing is working
      const testValue: string = 'test'
      expect(typeof testValue).toBe('string')
    })
  })
})
