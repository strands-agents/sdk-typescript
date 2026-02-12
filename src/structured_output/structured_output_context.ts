import { z } from 'zod'
import type { Message } from '../types/messages.js'
import { ToolUseBlock } from '../types/messages.js'
import type { ToolRegistry } from '../registry/tool-registry.js'
import { StructuredOutputTool } from './structured_output_tool.js'
import { getToolNameFromSchema } from './structured_output_utils.js'

/**
 * Interface for structured output context operations.
 * Allows for null object pattern implementation.
 */
export interface IStructuredOutputContext {
  registerTool(registry: ToolRegistry): void
  storeResult(toolUseId: string, result: unknown): void
  extractResultFromMessage(message: Message): unknown | undefined
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

  extractResultFromMessage(_message: Message): unknown | undefined {
    return undefined
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
 *
 * Uses a two-phase storage pattern:
 * 1. Phase 1 (Store): During tool execution, results are stored in temporary storage
 * 2. Phase 2 (Extract): After all tools execute, the result is extracted from temporary storage
 */
export class StructuredOutputContext implements IStructuredOutputContext {
  readonly isEnabled = true

  private _schema: z.ZodSchema
  // The `| undefined` is needed for `exactOptionalPropertyTypes` since we assign undefined in cleanup()
  private _tool?: StructuredOutputTool | undefined

  // Two-phase storage
  private _temporaryStorage: Map<string, unknown> = new Map() // Phase 1: Store
  private _extractedResult: unknown = undefined // Phase 2: Extract

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
   * Phase 2: Extracts the result from a message after all tools execute.
   * Finds tool use blocks in the message and extracts stored results.
   *
   * @param message - The assistant message containing tool use blocks
   * @returns The extracted result or undefined if not found
   */
  extractResultFromMessage(message: Message): unknown | undefined {
    const toolUseIds = message.content
      .filter((block): block is ToolUseBlock => block.type === 'toolUseBlock')
      .map((block) => block.toolUseId)

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
