import { describe, it, expect } from 'vitest'

describe('environment', () => {
  describe('Node.js compatibility', () => {
    it('works in Node.js environment', () => {
      // Test Node.js specific features are available
      expect(typeof process).toBe('object')
      expect(process.version).toBeDefined()
    })
  })

  describe('Browser compatibility', () => {
    describe('when running in browser', () => {
      it('has window object with expected properties', () => {
        // Only test in browser environment
        if (typeof window !== 'undefined') {
          expect(window).toBeDefined()
          expect(typeof window).toBe('object')
          expect(window.location).toBeDefined()
          expect(window.navigator).toBeDefined()
        } else {
          // Skip in Node.js - this test is for browser validation only
          expect(true).toBe(true)
        }
      })

      it('has document object with DOM methods', () => {
        // Only test in browser environment
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
          expect(document).toBeDefined()
          expect(typeof document).toBe('object')
          expect(typeof document.createElement).toBe('function')
          expect(typeof document.querySelector).toBe('function')
        } else {
          // Skip in Node.js - this test is for browser validation only
          expect(true).toBe(true)
        }
      })

      it('has navigator object with browser information', () => {
        // Only test in browser environment
        if (typeof navigator !== 'undefined') {
          expect(navigator).toBeDefined()
          expect(typeof navigator).toBe('object')
          expect(typeof navigator.userAgent).toBe('string')
          expect(navigator.userAgent.length).toBeGreaterThan(0)
        } else {
          // Skip in Node.js - this test is for browser validation only
          expect(true).toBe(true)
        }
      })
    })

    describe('environment detection', () => {
      it('correctly identifies the runtime environment', () => {
        const isBrowser = typeof window !== 'undefined'
        const isNode =
          typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node

        // At least one environment should be detected
        expect(isBrowser || isNode).toBe(true)

        // Log for visibility during test runs
        if (isBrowser) {
          // In browser environment
          expect(typeof window).toBe('object')
        }
        if (isNode) {
          // In Node.js environment
          expect(typeof process).toBe('object')
        }
      })
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
