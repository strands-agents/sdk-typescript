import { describe, it, expect } from 'vitest'
import { ContextWindowOverflowError, normalizeError } from '../errors.js'

describe('ContextWindowOverflowError', () => {
  describe('when instantiated with a message', () => {
    it('creates an error with the correct message', () => {
      const message = 'Context window overflow occurred'
      const error = new ContextWindowOverflowError(message)

      expect(error.message).toBe(message)
    })

    it('has the correct error name', () => {
      const error = new ContextWindowOverflowError('test')

      expect(error.name).toBe('ContextWindowOverflowError')
    })

    it('is an instance of Error', () => {
      const error = new ContextWindowOverflowError('test')

      expect(error).toBeInstanceOf(Error)
    })
  })
})

describe('normalizeError', () => {
  describe('when given an Error instance', () => {
    it('returns the same Error instance', () => {
      const error = new Error('test error')
      const result = normalizeError(error)

      expect(result).toBe(error)
    })
  })

  describe('when given a string', () => {
    it('wraps it in an Error', () => {
      const result = normalizeError('test error')

      expect(result).toBeInstanceOf(Error)
      expect(result.message).toBe('test error')
    })
  })

  describe('when given a number', () => {
    it('converts it to string and wraps in Error', () => {
      const result = normalizeError(42)

      expect(result).toBeInstanceOf(Error)
      expect(result.message).toBe('42')
    })
  })

  describe('when given an object', () => {
    it('converts it to string and wraps in Error', () => {
      const result = normalizeError({ code: 'ERR_TEST' })

      expect(result).toBeInstanceOf(Error)
      expect(result.message).toBe('[object Object]')
    })
  })

  describe('when given null', () => {
    it('converts it to string and wraps in Error', () => {
      const result = normalizeError(null)

      expect(result).toBeInstanceOf(Error)
      expect(result.message).toBe('null')
    })
  })

  describe('when given undefined', () => {
    it('converts it to string and wraps in Error', () => {
      const result = normalizeError(undefined)

      expect(result).toBeInstanceOf(Error)
      expect(result.message).toBe('undefined')
    })
  })
})
