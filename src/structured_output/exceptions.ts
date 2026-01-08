import type { z } from 'zod'

/**
 * Exception thrown when structured output operations fail.
 * This includes schema validation errors, unsupported schema features,
 * and other structured output-related errors.
 */
export class StructuredOutputException extends Error {
  /**
   * Validation errors from Zod schema validation, if applicable.
   */
  readonly validationErrors?: z.ZodIssue[] | undefined

  /**
   * The name of the tool that generated this exception, if applicable.
   */
  readonly toolName?: string | undefined

  /**
   * The tool use ID associated with this exception, if applicable.
   */
  readonly toolUseId?: string | undefined

  constructor(
    message: string,
    options?: {
      validationErrors?: z.ZodIssue[]
      toolName?: string
      toolUseId?: string
    }
  ) {
    super(message)
    this.name = 'StructuredOutputException'
    this.validationErrors = options?.validationErrors
    this.toolName = options?.toolName
    this.toolUseId = options?.toolUseId
  }
}

/**
 * Formats Zod validation errors into a human-readable bullet list.
 * Used to provide LLM-friendly error feedback for retry attempts.
 *
 * @param issues - Array of Zod validation issues
 * @returns Formatted error message with bullet points
 */
export function formatValidationErrors(issues: z.ZodIssue[]): string {
  const formatted = issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
      return `- Field '${path}': ${issue.message}`
    })
    .join('\n')

  return formatted
}
