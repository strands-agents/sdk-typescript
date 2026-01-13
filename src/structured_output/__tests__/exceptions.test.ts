import { describe, it, expect } from 'vitest'
import { StructuredOutputException, formatValidationErrors } from '../exceptions.js'
import { z } from 'zod'

describe('StructuredOutputException', () => {
  it('creates exception with message only', () => {
    const error = new StructuredOutputException('Test error')

    expect(error.message).toBe('Test error')
    expect(error.name).toBe('StructuredOutputException')
    expect(error.validationErrors).toBeUndefined()
    expect(error.toolName).toBeUndefined()
    expect(error.toolUseId).toBeUndefined()
  })

  it('creates exception with validation errors', () => {
    const validationErrors: z.ZodIssue[] = [
      { code: 'invalid_type' as const, message: 'Expected number', path: ['age'], expected: 'number', received: 'string' } as z.ZodIssue
    ]

    const error = new StructuredOutputException('Validation failed', { validationErrors })

    expect(error.message).toBe('Validation failed')
    expect(error.validationErrors).toEqual(validationErrors)
  })

  it('creates exception with tool name and tool use id', () => {
    const error = new StructuredOutputException('Tool error', {
      toolName: 'PersonSchema',
      toolUseId: 'tool-123'
    })

    expect(error.toolName).toBe('PersonSchema')
    expect(error.toolUseId).toBe('tool-123')
  })

  it('creates exception with all options', () => {
    const validationErrors: z.ZodIssue[] = [
      { code: 'invalid_type' as const, message: 'Expected string', path: ['name'], expected: 'string', received: 'number' } as z.ZodIssue
    ]

    const error = new StructuredOutputException('Complete error', {
      validationErrors,
      toolName: 'TestTool',
      toolUseId: 'tool-456'
    })

    expect(error.message).toBe('Complete error')
    expect(error.validationErrors).toEqual(validationErrors)
    expect(error.toolName).toBe('TestTool')
    expect(error.toolUseId).toBe('tool-456')
  })
})

describe('formatValidationErrors', () => {
  it('formats single validation error', () => {
    const issues: z.ZodIssue[] = [
      { code: 'invalid_type', message: 'Expected number, received string', path: ['age'], expected: 'number', received: 'string' } as z.ZodIssue
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'age': Expected number, received string")
  })

  it('formats multiple validation errors', () => {
    const issues: z.ZodIssue[] = [
      { code: 'invalid_type', message: 'Expected number, received string', path: ['age'], expected: 'number', received: 'string' } as z.ZodIssue,
      { code: 'invalid_type', message: 'Expected string, received number', path: ['name'], expected: 'string', received: 'number' } as z.ZodIssue
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe(
      "- Field 'age': Expected number, received string\n" +
      "- Field 'name': Expected string, received number"
    )
  })

  it('formats nested field path', () => {
    const issues: z.ZodIssue[] = [
      { code: 'invalid_type', message: 'Invalid format', path: ['address', 'street'], expected: 'string', received: 'number' } as z.ZodIssue
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'address.street': Invalid format")
  })

  it('formats root-level error', () => {
    const issues: z.ZodIssue[] = [
      { code: 'invalid_type', message: 'Invalid type', path: [], expected: 'object', received: 'string' } as z.ZodIssue
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'root': Invalid type")
  })

  it('formats array index in path', () => {
    const issues: z.ZodIssue[] = [
      { code: 'invalid_type', message: 'Invalid item', path: ['items', 0, 'name'], expected: 'string', received: 'number' } as z.ZodIssue
    ]

    const formatted = formatValidationErrors(issues)

    expect(formatted).toBe("- Field 'items.0.name': Invalid item")
  })
})