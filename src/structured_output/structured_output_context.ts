import { z } from 'zod'
import type { ToolRegistry } from '../registry/tool-registry.js'
import { StructuredOutputTool } from './structured_output_tool.js'
import { getToolNameFromSchema } from './structured_output_utils.js'

/**
 * Context for managing structured output tool lifecycle per-invocation.
 * Handles tool registration, result storage, and cleanup.
 *
 * Uses a two-phase storage pattern:
 * 1. Phase 1 (Store): During tool execution, results are stored in temporary storage
 * 2. Phase 2 (Extract): After all tools execute, the result is extracted from temporary storage
 */
export class StructuredOutputContext {
  private _schema?: z.ZodSchema | undefined
  private _tool?: StructuredOutputTool | undefined

  // Two-phase storage
  private _temporaryStorage: Map<string, unknown> = new Map() // Phase 1: Store
  private _extractedResult: unknown = undefined // Phase 2: Extract

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
   * Phase 1: Stores the validated result from the structured output tool.
   * Results are stored in temporary storage until extracted.
   *
   * @param toolUseId - The tool use ID
   * @param result - The validated result
   */
  storeResult(toolUseId: string, result: unknown): void {
    this._temporaryStorage.set(toolUseId, result)
  }

  /**
   * Phase 2: Extracts the result from temporary storage after all tools execute.
   * Looks through the provided tool use IDs to find a stored result.
   *
   * @param toolUseIds - Array of tool use IDs to check
   * @returns The extracted result or undefined if not found
   */
  extractResult(toolUseIds: string[]): unknown | undefined {
    for (const toolUseId of toolUseIds) {
      if (this._temporaryStorage.has(toolUseId)) {
        this._extractedResult = this._temporaryStorage.get(toolUseId)
        this._temporaryStorage.delete(toolUseId)
        return this._extractedResult
      }
    }
    return undefined
  }

  /**
   * Checks if a result has been extracted (used for forcing logic).
   *
   * @returns true if a result has been extracted
   */
  hasResult(): boolean {
    return this._extractedResult !== undefined
  }

  /**
   * Retrieves the extracted result, if available.
   *
   * @returns The validated result or undefined if not yet extracted
   */
  getResult(): unknown | undefined {
    return this._extractedResult
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
    this._temporaryStorage.clear()
  }
}
