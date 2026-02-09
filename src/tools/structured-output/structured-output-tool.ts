import { z, type ZodType } from 'zod'
import { Tool, ToolStreamEvent } from '../tool.js'
import type { ToolContext, ToolStreamGenerator } from '../tool.js'
import type { ToolSpec } from '../types.js'
import type { JSONSchema } from '../../types/json.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'

/**
 * Callback invoked when structured output validation succeeds.
 * Used to store the validated result in the invocation context.
 */
export type StructuredOutputStoreResult = (toolUseId: string, value: unknown) => void

/**
 * Configuration for creating a StructuredOutputTool.
 */
export interface StructuredOutputToolConfig {
  /**
   * Zod schema defining the expected output structure.
   * Used to generate the tool input schema and to validate model output.
   */
  schema: ZodType

  /**
   * Tool name exposed to the model.
   * Must match [a-zA-Z0-9_-]+. Defaults to schema description sanitized or "StructuredOutput".
   */
  name?: string

  /**
   * Callback invoked when the model's tool input validates successfully.
   * The context uses this to store the result for extraction.
   */
  storeResult: StructuredOutputStoreResult
}

const DEFAULT_TOOL_NAME = 'StructuredOutput'

const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Sanitizes a string for use as a tool name (1-64 chars, alphanumeric, hyphen, underscore).
 */
function sanitizeToolName(candidate: string): string {
  const sanitized = candidate.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
  if (sanitized.length === 0) {
    return DEFAULT_TOOL_NAME
  }
  return sanitized.slice(0, 64)
}

/**
 * Derives tool name from config and schema.
 */
function resolveToolName(config: StructuredOutputToolConfig): string {
  if (config.name !== undefined && config.name.length > 0) {
    if (!VALID_NAME_PATTERN.test(config.name) || config.name.length > 64) {
      return sanitizeToolName(config.name)
    }
    return config.name
  }
  const desc = (config.schema as { description?: string }).description
  if (typeof desc === 'string' && desc.length > 0) {
    return sanitizeToolName(desc)
  }
  return DEFAULT_TOOL_NAME
}

/**
 * Tool that validates model output against a Zod schema and stores the result for extraction.
 * Used by the agent loop for structured output; the model is encouraged or forced to call
 * this tool with structured data, which is then validated and returned on AgentResult.structuredOutput.
 */
export class StructuredOutputTool extends Tool {
  readonly name: string
  readonly description: string
  readonly toolSpec: ToolSpec

  private readonly _schema: ZodType
  private readonly _storeResult: StructuredOutputStoreResult

  constructor(config: StructuredOutputToolConfig) {
    super()
    this._schema = config.schema
    this._storeResult = config.storeResult
    this.name = resolveToolName(config)

    const rawSchema = z.toJSONSchema(this._schema) as JSONSchema & { $schema?: string }
    const { $schema: _omit, ...inputSchema } = rawSchema
    const baseDescription =
      typeof (this._schema as { description?: string }).description === 'string'
        ? (this._schema as { description: string }).description
        : 'Structured output'

    this.description =
      'IMPORTANT: This StructuredOutputTool should only be invoked as the last and final tool ' +
      `before returning the completed result to the caller. <description>${baseDescription}</description>`

    this.toolSpec = {
      name: this.name,
      description: this.description,
      inputSchema: inputSchema as JSONSchema,
    }
  }

  /**
   * Validates the tool input against the schema, stores the result on success,
   * or returns an error result with validation details for the model to retry.
   */
  async *stream(toolContext: ToolContext): ToolStreamGenerator {
    const { toolUse } = toolContext
    const toolUseId = toolUse.toolUseId
    const input = toolUse.input

    yield new ToolStreamEvent({})

    const parsed = this._schema.safeParse(typeof input === 'object' && input !== null ? input : {})

    if (parsed.success) {
      try {
        this._storeResult(toolUseId, parsed.data)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return new ToolResultBlock({
          toolUseId,
          status: 'error',
          content: [new TextBlock(`Unexpected error validating ${this.name}: ${msg}`)],
        })
      }
      return new ToolResultBlock({
        toolUseId,
        status: 'success',
        content: [new TextBlock(`Successfully validated ${this.name} structured output`)],
      })
    }

    const issues = parsed.error.issues
    const errorDetails = issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(' -> ') : 'root'
      return `Field '${path}': ${issue.message}`
    })
    const errorMessage =
      `Validation failed for ${this.name}. Please fix the following errors:\n` +
      errorDetails.map((d) => `- ${d}`).join('\n')

    return new ToolResultBlock({
      toolUseId,
      status: 'error',
      content: [new TextBlock(errorMessage)],
    })
  }
}
