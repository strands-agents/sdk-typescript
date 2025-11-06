import { describe, it, expect } from 'vitest'
import { ContextWindowOverflowError } from '../errors.js'

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
