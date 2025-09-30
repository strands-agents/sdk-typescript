import { describe, it, expect } from 'vitest'
import { hello } from '../src/index'

describe('main entry point', () => {
  it('should export the hello function', () => {
    expect(hello).toBeDefined()
    expect(typeof hello).toBe('function')
  })

  it('should provide working hello function through main export', () => {
    const result = hello('SDK')
    expect(result).toBe('Hello, SDK!')
    expect(typeof result).toBe('string')
  })

  it('should have consistent behavior with direct hello import', () => {
    const directResult = hello('Test')
    const indexResult = hello('Test')
    expect(directResult).toBe(indexResult)
  })
})
