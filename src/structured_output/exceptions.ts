import type { z } from 'zod'

/**
 * Exception raised when the model fails to produce structured output.
 * This is raised only when the LLM refuses to use the structured output tool
 * even after being forced via toolChoice.
 */
export class StructuredOutputException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructuredOutputException'
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
