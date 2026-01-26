import { describe, it, expect } from 'vitest'
import {
  ModelException,
  ContextWindowOverflowError,
  ModelThrottledError,
  MaxTokensError,
  normalizeError,
} from '../errors.js'
import { Message, TextBlock } from '../types/messages.js'

describe('ModelException', () => {
  describe('when instantiated with a message', () => {
    it('creates an error with the correct message', () => {
      const message = 'Model error occurred'
      const error = new ModelException(message)

      expect(error.message).toBe(message)
    })

    it('has the correct error name', () => {
      const error = new ModelException('test')

      expect(error.name).toBe('ModelException')
    })

    it('is an instance of Error', () => {
      const error = new ModelException('test')

      expect(error).toBeInstanceOf(Error)
    })
  })

  describe('when instantiated with a cause', () => {
    it('stores the cause error', () => {
      const cause = new Error('original error')
      const error = new ModelException('wrapped error', cause)

      expect(error.cause).toBe(cause)
    })

    it('has the correct message', () => {
      const cause = new Error('original error')
      const error = new ModelException('wrapped error', cause)

      expect(error.message).toBe('wrapped error')
    })
  })
})

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

    it('is an instance of ModelException', () => {
      const error = new ContextWindowOverflowError('test')

      expect(error).toBeInstanceOf(ModelException)
    })
  })
})

describe('ModelThrottledError', () => {
  describe('when instantiated with a message', () => {
    it('creates an error with the correct message', () => {
      const message = 'Request was throttled'
      const error = new ModelThrottledError(message)

      expect(error.message).toBe(message)
    })

    it('has the correct error name', () => {
      const error = new ModelThrottledError('test')

      expect(error.name).toBe('ModelThrottledError')
    })

    it('is an instance of Error', () => {
      const error = new ModelThrottledError('test')

      expect(error).toBeInstanceOf(Error)
    })

    it('is an instance of ModelException', () => {
      const error = new ModelThrottledError('test')

      expect(error).toBeInstanceOf(ModelException)
    })
  })
})

describe('MaxTokensError', () => {
  describe('when instantiated with a message and partial message', () => {
    it('creates an error with the correct message', () => {
      const partialMessage = new Message({
        role: 'assistant',
        content: [new TextBlock('partial response')],
      })
      const error = new MaxTokensError('Max tokens reached', partialMessage)

      expect(error.message).toBe('Max tokens reached')
    })

    it('has the correct error name', () => {
      const partialMessage = new Message({
        role: 'assistant',
        content: [new TextBlock('partial response')],
      })
      const error = new MaxTokensError('test', partialMessage)

      expect(error.name).toBe('MaxTokensError')
    })

    it('stores the partial message', () => {
      const partialMessage = new Message({
        role: 'assistant',
        content: [new TextBlock('partial response')],
      })
      const error = new MaxTokensError('test', partialMessage)

      expect(error.partialMessage).toBe(partialMessage)
    })

    it('is an instance of Error', () => {
      const partialMessage = new Message({
        role: 'assistant',
        content: [new TextBlock('partial response')],
      })
      const error = new MaxTokensError('test', partialMessage)

      expect(error).toBeInstanceOf(Error)
    })

    it('is an instance of ModelException', () => {
      const partialMessage = new Message({
        role: 'assistant',
        content: [new TextBlock('partial response')],
      })
      const error = new MaxTokensError('test', partialMessage)

      expect(error).toBeInstanceOf(ModelException)
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
