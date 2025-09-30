import { describe, it, expect } from 'vitest'
import { hello } from '../src/hello'

describe('hello function', () => {
  it('should return a default greeting when called without parameters', () => {
    const result = hello()
    expect(result).toBe('Hello, World!')
  })

  it('should return a personalized greeting when called with a name', () => {
    const result = hello('TypeScript')
    expect(result).toBe('Hello, TypeScript!')
  })

  it('should handle empty string gracefully', () => {
    const result = hello('')
    expect(result).toBe('Hello, !')
  })

  it('should handle whitespace-only names', () => {
    const result = hello('   ')
    expect(result).toBe('Hello,    !')
  })

  it('should return a string type', () => {
    const result = hello()
    expect(typeof result).toBe('string')
  })

  it('should handle special characters in names', () => {
    const result = hello('Test & Co.')
    expect(result).toBe('Hello, Test & Co.!')
  })
})
