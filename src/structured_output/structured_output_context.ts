import { z } from 'zod'
import type { ToolRegistry } from '../registry/tool-registry.js'
import { StructuredOutputTool } from './structured_output_tool.js'
import { getToolNameFromSchema } from './schema_converter.js'

/**
 * Context for managing structured output tool lifecycle per-invocation.
 * Handles tool registration, result storage, and cleanup.
 */
export class StructuredOutputContext {
  private _schema?: z.ZodSchema | undefined
  private _tool?: StructuredOutputTool
  private _result: any = undefined

  /**
   * Creates a new StructuredOutputContext.
   *
   * @param schema - Optional Zod schema for structured output
   */
  constructor(schema?: z.ZodSchema) {
    this._schema = schema
  }

  /**
   * Registers the structured output tool with the tool registry.
   * The tool is registered as a dynamic tool (hidden from public tools list).
   *
   * @param registry - The tool registry to register with
   */
  registerTool(registry: ToolRegistry): void {
    if (!this._schema) {
      return
    }

    const toolName = getToolNameFromSchema(this._schema)
    this._tool = new StructuredOutputTool(this._schema, toolName, this)

    // Register as dynamic tool (hidden from public tools)
    registry.addDynamic(this._tool)
  }

  /**
   * Stores the validated result from the structured output tool.
   *
   * @param toolUseId - The tool use ID
   * @param result - The validated result
   */
  storeResult(toolUseId: string, result: any): void {
    this._result = result
  }

  /**
   * Retrieves the stored result, if available.
   *
   * @returns The validated result or undefined if not yet set
   */
  getResult(): any | undefined {
    return this._result
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
