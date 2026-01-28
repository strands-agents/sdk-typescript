import { describe, it, expect } from 'vitest'
import { StructuredOutputException, formatValidationErrors } from '../exceptions.js'
import { z } from 'zod'

describe('StructuredOutputException', () => {
  it('creates exception with message', () => {
    const error = new StructuredOutputException('Test error')

    expect(error.message).toBe('Test error')
    expect(error.name).toBe('StructuredOutputException')
  })

  it('is an instance of Error', () => {
    const error = new StructuredOutputException('Test error')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StructuredOutputException)
  })

  it('creates exception with forced tool failure message', () => {
    const error = new StructuredOutputException(
      'The model failed to invoke the structured output tool even after it was forced.'
    )

    expect(error.message).toBe('The model failed to invoke the structured output tool even after it was forced.')
  })
})

describe('formatValidationErrors', () => {
  it('formats single validation error', () => {
    const issues: z.ZodIssue[] = [
      {
        code: 'invalid_type',
        message: 'Expected number, received string',
        path: ['age'],
        expected: 'number',
        received: 'string',
      } as z.ZodIssue,
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'age': Expected number, received string")
  })

  it('formats multiple validation errors', () => {
    const issues: z.ZodIssue[] = [
      {
        code: 'invalid_type',
        message: 'Expected number, received string',
        path: ['age'],
        expected: 'number',
        received: 'string',
      } as z.ZodIssue,
      {
        code: 'invalid_type',
        message: 'Expected string, received number',
        path: ['name'],
        expected: 'string',
        received: 'number',
      } as z.ZodIssue,
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe(
      "- Field 'age': Expected number, received string\n" + "- Field 'name': Expected string, received number"
    )
  })

  it('formats nested field path', () => {
    const issues: z.ZodIssue[] = [
      {
        code: 'invalid_type',
        message: 'Invalid format',
        path: ['address', 'street'],
        expected: 'string',
        received: 'number',
      } as z.ZodIssue,
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'address.street': Invalid format")
  })

  it('formats root-level error', () => {
    const issues: z.ZodIssue[] = [
      { code: 'invalid_type', message: 'Invalid type', path: [], expected: 'object', received: 'string' } as z.ZodIssue,
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'root': Invalid type")
  })

  it('formats array index in path', () => {
    const issues: z.ZodIssue[] = [
      {
        code: 'invalid_type',
        message: 'Invalid item',
        path: ['items', 0, 'name'],
        expected: 'string',
        received: 'number',
      } as z.ZodIssue,
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'items.0.name': Invalid item")
  })
})
