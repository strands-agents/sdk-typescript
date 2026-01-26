import { describe, it, expect } from 'vitest'
import { ModelError, ContextWindowOverflowError, MaxTokensError, normalizeError } from '../errors.js'
import { Message, TextBlock } from '../types/messages.js'

describe('ModelError', () => {
  it('creates an error with the correct message and name', () => {
    const error = new ModelError('Model error occurred')

    expect(error.message).toBe('Model error occurred')
    expect(error.name).toBe('ModelError')
  })

  it('stores the cause error when provided', () => {
    const cause = new Error('original error')
    const error = new ModelError('wrapped error', cause)

    expect(error.message).toBe('wrapped error')
    expect(error.cause).toBe(cause)
  })
})

describe('ContextWindowOverflowError', () => {
  it('creates an error with the correct message and name', () => {
    const error = new ContextWindowOverflowError('Context window overflow occurred')

    expect(error.message).toBe('Context window overflow occurred')
    expect(error.name).toBe('ContextWindowOverflowError')
  })
})

describe('MaxTokensError', () => {
  it('creates an error with the correct message, name, and partial message', () => {
    const partialMessage = new Message({
      role: 'assistant',
      content: [new TextBlock('partial response')],
    })
    const error = new MaxTokensError('Max tokens reached', partialMessage)

    expect(error.message).toBe('Max tokens reached')
    expect(error.name).toBe('MaxTokensError')
    expect(error.partialMessage).toBe(partialMessage)
  })
})

describe('normalizeError', () => {
  it('returns the same Error instance when given an Error', () => {
    const error = new Error('test error')
    expect(normalizeError(error)).toBe(error)
  })

  it('wraps non-Error values in an Error', () => {
    expect(normalizeError('test error').message).toBe('test error')
    expect(normalizeError(42).message).toBe('42')
    expect(normalizeError({ code: 'ERR_TEST' }).message).toBe('[object Object]')
    expect(normalizeError(null).message).toBe('null')
    expect(normalizeError(undefined).message).toBe('undefined')
  })
})
