import { z } from 'zod'
import type { ToolRegistry } from '../registry/tool-registry.js'
import { StructuredOutputTool } from './tool.js'
import { getToolNameFromSchema } from './utils.js'

/**
 * Interface for structured output context operations.
 * Allows for null object pattern implementation.
 */
export interface IStructuredOutputContext {
  registerTool(registry: ToolRegistry): void
  storeResult(toolUseId: string, result: unknown): void
  hasResult(): boolean
  getResult(): unknown | undefined
  getToolName(): string
  cleanup(registry: ToolRegistry): void
  readonly isEnabled: boolean
}

/**
 * Null object implementation that does nothing.
 * Used when no structured output schema is provided.
 */
export class NullStructuredOutputContext implements IStructuredOutputContext {
  readonly isEnabled = false

  registerTool(_registry: ToolRegistry): void {
    // No-op
  }

  storeResult(_toolUseId: string, _result: unknown): void {
    // No-op
  }

  hasResult(): boolean {
    return true // Always "has result" to skip forcing logic
  }

  getResult(): unknown | undefined {
    return undefined
  }

  getToolName(): string {
    return 'StructuredOutput'
  }

  cleanup(_registry: ToolRegistry): void {
    // No-op
  }
}

/**
 * Context for managing structured output tool lifecycle per-invocation.
 * Handles tool registration, result storage, and cleanup.
 */
export class StructuredOutputContext implements IStructuredOutputContext {
  readonly isEnabled = true

  private _schema: z.ZodSchema
  // The `| undefined` is needed for `exactOptionalPropertyTypes` since we assign undefined in cleanup()
  private _tool?: StructuredOutputTool | undefined
  private _result: unknown = undefined

  /**
   * Creates a new StructuredOutputContext.
   *
   * @param schema - Zod schema for structured output
   */
  constructor(schema: z.ZodSchema) {
    this._schema = schema
  }

  /**
   * Registers the structured output tool with the tool registry.
   *
   * @param registry - The tool registry to register with
   */
  registerTool(registry: ToolRegistry): void {
    const toolName = getToolNameFromSchema(this._schema)
    this._tool = new StructuredOutputTool(this._schema, toolName, this)

    // Register tool (will be removed in cleanup)
    registry.add(this._tool)
  }

  /**
   * Stores the validated result from the structured output tool.
   * If called multiple times, only the latest result is kept.
   *
   * @param toolUseId - The tool use ID (unused, kept for interface compatibility)
   * @param result - The validated result
   */
  storeResult(toolUseId: string, result: unknown): void {
    this._result = result
  }

  /**
   * Checks if a result has been stored.
   *
   * @returns true if a result has been stored
   */
  hasResult(): boolean {
    return this._result !== undefined
  }

  /**
   * Retrieves the stored result, if available.
   *
   * @returns The validated result or undefined if not yet stored
   */
  getResult(): unknown | undefined {
    return this._result
  }

  /**
   * Gets the tool name for forcing.
   *
   * @returns The tool name or 'StructuredOutput' as fallback
   */
  getToolName(): string {
    return this._tool?.name ?? 'StructuredOutput'
  }

  /**
   * Cleans up the structured output tool by removing it from the registry.
   * Should be called in a finally block to ensure cleanup happens regardless of success/failure.
   *
   * @param registry - The tool registry to clean up from
   */
  cleanup(registry: ToolRegistry): void {
    if (this._tool) {
      registry.removeByName(this._tool.name)
      this._tool = undefined
    }
  }
}

/**
 * Factory function to create the appropriate context based on schema presence.
 *
 * @param schema - Optional Zod schema for structured output
 * @returns StructuredOutputContext if schema provided, NullStructuredOutputContext otherwise
 */
export function createStructuredOutputContext(schema?: z.ZodSchema): IStructuredOutputContext {
  return schema ? new StructuredOutputContext(schema) : new NullStructuredOutputContext()
}
