import { describe, expect, it } from 'vitest'
import { StructuredOutputException, formatValidationErrors } from '../exceptions.js'
import { z } from 'zod'

describe('StructuredOutputException', () => {
  it('creates exception with message', () => {
    const exception = new StructuredOutputException('Test error')
    expect(exception.message).toBe('Test error')
    expect(exception.name).toBe('StructuredOutputException')
  })

  it('is instance of Error', () => {
    const exception = new StructuredOutputException('Test error')
    expect(exception).toBeInstanceOf(Error)
  })
})

describe('formatValidationErrors', () => {
  it('formats single field error', () => {
    const schema = z.object({ name: z.string() })
    const result = schema.safeParse({ name: 123 })

    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationErrors(result.error.issues)
      expect(formatted).toBe("- Field 'name': Invalid input: expected string, received number")
    }
  })

  it('formats multiple field errors', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })
    const result = schema.safeParse({ name: 123, age: 'invalid' })

    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationErrors(result.error.issues)
      const lines = formatted.split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toBe("- Field 'name': Invalid input: expected string, received number")
      expect(lines[1]).toBe("- Field 'age': Invalid input: expected number, received string")
    }
  })

  it('formats nested field errors', () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
      }),
    })
    const result = schema.safeParse({ user: { name: 123 } })

    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationErrors(result.error.issues)
      expect(formatted).toBe("- Field 'user.name': Invalid input: expected string, received number")
    }
  })

  it('formats array field errors', () => {
    const schema = z.object({
      items: z.array(z.string()),
    })
    const result = schema.safeParse({ items: ['valid', 123, 'valid'] })

    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationErrors(result.error.issues)
      expect(formatted).toBe("- Field 'items.1': Invalid input: expected string, received number")
    }
  })

  it('formats root-level errors', () => {
    const schema = z.string()
    const result = schema.safeParse(123)

    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationErrors(result.error.issues)
      expect(formatted).toBe("- Field 'root': Invalid input: expected string, received number")
    }
  })

  it('formats required field errors', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })
    const result = schema.safeParse({ name: 'John' })

    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationErrors(result.error.issues)
      expect(formatted).toContain("- Field 'age':")
    }
  })

  it('formats multiple errors with newlines', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      email: z.string().email(),
    })
    const result = schema.safeParse({ name: 123, age: 'invalid', email: 'not-an-email' })

    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationErrors(result.error.issues)
      const lines = formatted.split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe("- Field 'name': Invalid input: expected string, received number")
      expect(lines[1]).toBe("- Field 'age': Invalid input: expected number, received string")
      expect(lines[2]).toBe("- Field 'email': Invalid email address")
    }
  })
})
