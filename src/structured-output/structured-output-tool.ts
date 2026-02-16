import { z } from 'zod'
import { Tool, type ToolContext, type ToolStreamGenerator } from '../tools/tool.js'
import type { ToolSpec } from '../tools/types.js'
import { TextBlock, ToolResultBlock } from '../types/messages.js'
import { convertSchemaToToolSpec } from './structured-output-utils.js'
import { formatValidationErrors } from './exceptions.js'
import type { StructuredOutputContext } from './structured-output-context.js'

/**
 * Tool implementation that validates LLM output against a Zod schema.
 * Provides validation feedback to the LLM for retry on failures.
 */
export class StructuredOutputTool extends Tool {
  readonly name: string
  readonly description: string
  readonly toolSpec: ToolSpec

  private _schema: z.ZodSchema
  private _context: StructuredOutputContext

  /**
   * Creates a new StructuredOutputTool.
   *
   * @param schema - The Zod schema to validate against
   * @param toolName - The name of the tool
   * @param context - The structured output context for result storage
   */
  constructor(schema: z.ZodSchema, toolName: string, context: StructuredOutputContext) {
    super()
    this._schema = schema
    this._context = context
    this.toolSpec = convertSchemaToToolSpec(schema, toolName)
    this.name = this.toolSpec.name
    this.description = this.toolSpec.description
  }

  /**
   * Executes the tool by validating input against the schema.
   * On success, stores the validated result in context.
   * On failure, returns formatted validation errors for LLM retry.
   *
   * @param toolContext - The tool execution context
   * @returns Generator that returns a ToolResultBlock
   */
  // Validation is synchronous, so no streaming events are yielded - only the final result is returned
  // eslint-disable-next-line require-yield
  async *stream(toolContext: ToolContext): ToolStreamGenerator {
    const { toolUse } = toolContext

    try {
      // Validate input against schema
      const validated = this._schema.parse(toolUse.input)

      // Store validated result in context
      this._context.storeResult(toolUse.toolUseId, validated)

      // Return success result
      return new ToolResultBlock({
        toolUseId: toolUse.toolUseId,
        status: 'success',
        content: [new TextBlock(JSON.stringify(validated))],
      })
    } catch (error) {
      // Handle validation errors
      if (error instanceof z.ZodError) {
        const formattedErrors = formatValidationErrors(error.issues)
        const errorMessage = `Validation failed for ${this.name}. Please fix the following errors:\n${formattedErrors}`

        // Return error result with formatted validation feedback
        return new ToolResultBlock({
          toolUseId: toolUse.toolUseId,
          status: 'error',
          content: [new TextBlock(errorMessage)],
          error: error,
        })
      }

      // Re-throw unexpected errors
      throw error
    }
  }
}
