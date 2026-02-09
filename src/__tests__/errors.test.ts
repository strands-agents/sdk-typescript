import { describe, it, expect } from 'vitest'
import {
  ModelError,
  ContextWindowOverflowError,
  MaxTokensError,
  JsonValidationError,
  ConcurrentInvocationError,
  StructuredOutputError,
  SessionException,
  normalizeError,
} from '../errors.js'
import { Message, TextBlock } from '../types/messages.js'

describe('ModelError', () => {
  describe('when instantiated with a message', () => {
    it('creates an error with the correct message', () => {
      const message = 'Model error occurred'
      const error = new ModelError(message)

      expect(error.message).toBe(message)
    })

    it('has the correct error name', () => {
      const error = new ModelError('test')

      expect(error.name).toBe('ModelError')
    })

    it('is an instance of Error', () => {
      const error = new ModelError('test')

      expect(error).toBeInstanceOf(Error)
    })
  })

  describe('when instantiated with a cause', () => {
    it('stores the cause error', () => {
      const cause = new Error('original error')
      const error = new ModelError('wrapped error', { cause })

      expect(error.message).toBe('wrapped error')
      expect(error.cause).toBe(cause)
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

    it('is an instance of ModelError', () => {
      const error = new ContextWindowOverflowError('test')

      expect(error).toBeInstanceOf(ModelError)
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
      const error = new MaxTokensError('Max tokens reached', partialMessage)

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

    it('is an instance of ModelError', () => {
      const partialMessage = new Message({
        role: 'assistant',
        content: [new TextBlock('partial response')],
      })
      const error = new MaxTokensError('test', partialMessage)

      expect(error).toBeInstanceOf(ModelError)
    })
  })
})

describe('JsonValidationError', () => {
  it('creates an error with the correct message', () => {
    const error = new JsonValidationError('Invalid JSON: unexpected token')

    expect(error.message).toBe('Invalid JSON: unexpected token')
  })

  it('has the correct error name', () => {
    const error = new JsonValidationError('test')

    expect(error.name).toBe('JsonValidationError')
  })

  it('is an instance of Error', () => {
    const error = new JsonValidationError('test')

    expect(error).toBeInstanceOf(Error)
  })

  it('can be caught as a generic Error', () => {
    expect(() => {
      throw new JsonValidationError('validation failed')
    }).toThrow(Error)
  })
})

describe('ConcurrentInvocationError', () => {
  it('creates an error with the correct message', () => {
    const error = new ConcurrentInvocationError('Agent is already processing an invocation')

    expect(error.message).toBe('Agent is already processing an invocation')
  })

  it('has the correct error name', () => {
    const error = new ConcurrentInvocationError('test')

    expect(error.name).toBe('ConcurrentInvocationError')
  })

  it('is an instance of Error', () => {
    const error = new ConcurrentInvocationError('test')

    expect(error).toBeInstanceOf(Error)
  })

  it('can be caught as a generic Error', () => {
    expect(() => {
      throw new ConcurrentInvocationError('concurrent call')
    }).toThrow(Error)
  })
})

describe('StructuredOutputError', () => {
  it('creates an error with the correct message', () => {
    const message = 'Model did not produce structured output.'
    const error = new StructuredOutputError(message)

    expect(error.message).toBe(message)
  })

  it('has the correct error name', () => {
    const error = new StructuredOutputError('test')

    expect(error.name).toBe('StructuredOutputError')
  })

  it('is an instance of Error', () => {
    const error = new StructuredOutputError('test')

    expect(error).toBeInstanceOf(Error)
  })
})

describe('SessionException', () => {
  it('creates an error with the correct message', () => {
    const error = new SessionException('Session expired')

    expect(error.message).toBe('Session expired')
  })

  it('has the correct error name', () => {
    const error = new SessionException('test')

    expect(error.name).toBe('SessionException')
  })

  it('is an instance of Error', () => {
    const error = new SessionException('test')

    expect(error).toBeInstanceOf(Error)
  })

  it('can be caught as a generic Error', () => {
    expect(() => {
      throw new SessionException('Failed to restore session')
    }).toThrow(Error)
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
