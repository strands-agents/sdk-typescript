import type { ZodType } from 'zod'
import type { ToolRegistry } from '../../registry/tool-registry.js'
import type { ToolUse } from '../types.js'
import { StructuredOutputTool } from './structured-output-tool.js'

/**
 * Default prompt used when forcing the model to use the structured output tool
 * after it ended its turn without calling it.
 */
export const DEFAULT_STRUCTURED_OUTPUT_PROMPT = 'You must format the previous response as structured output.'

/**
 * Per-invocation state for structured output.
 * Tracks whether structured output is enabled, stores validated results,
 * and manages registration/cleanup of the structured output tool with the agent's registry.
 */
export class StructuredOutputContext {
  private _structuredOutputModel: ZodType | null
  private _structuredOutputTool: StructuredOutputTool | null
  private _structuredOutputPrompt: string
  private _forcedMode: boolean
  private _forceAttempted: boolean
  private _toolChoice: { any: Record<string, never> } | { tool: { name: string } } | null
  private _stopLoop: boolean
  private _expectedToolName: string | null
  private readonly _results: Map<string, unknown> = new Map()

  constructor(
    options: {
      structuredOutputModel?: ZodType | null
      structuredOutputPrompt?: string | null
    } = {}
  ) {
    this._structuredOutputModel = options.structuredOutputModel ?? null
    this._structuredOutputPrompt = options.structuredOutputPrompt ?? DEFAULT_STRUCTURED_OUTPUT_PROMPT
    this._forcedMode = false
    this._forceAttempted = false
    this._toolChoice = null
    this._stopLoop = false
    this._expectedToolName = null

    if (this._structuredOutputModel) {
      this._structuredOutputTool = new StructuredOutputTool({
        schema: this._structuredOutputModel,
        storeResult: (toolUseId: string, value: unknown): void => this.storeResult(toolUseId, value),
      })
      this._expectedToolName = this._structuredOutputTool.name
    } else {
      this._structuredOutputTool = null
    }
  }

  /**
   * True when a structured output schema was provided for this invocation.
   */
  get isEnabled(): boolean {
    return this._structuredOutputModel !== null
  }

  get forcedMode(): boolean {
    return this._forcedMode
  }

  get forceAttempted(): boolean {
    return this._forceAttempted
  }

  get toolChoice(): { any: Record<string, never> } | { tool: { name: string } } | null {
    return this._toolChoice
  }

  get stopLoop(): boolean {
    return this._stopLoop
  }

  get expectedToolName(): string | null {
    return this._expectedToolName
  }

  get structuredOutputPrompt(): string {
    return this._structuredOutputPrompt
  }

  storeResult(toolUseId: string, result: unknown): void {
    this._results.set(toolUseId, result)
  }

  getResult(toolUseId: string): unknown {
    return this._results.get(toolUseId)
  }

  /**
   * Marks this context as in forced mode (model ended turn without using the tool).
   */
  setForcedMode(toolChoice?: { any: Record<string, never> } | { tool: { name: string } }): void {
    if (!this.isEnabled) {
      return
    }
    this._forcedMode = true
    this._forceAttempted = true
    this._toolChoice = toolChoice ?? { any: {} }
  }

  /**
   * True if any of the given tool uses match the structured output tool name.
   */
  hasStructuredOutputTool(toolUses: ToolUse[]): boolean {
    if (this._expectedToolName === null) {
      return false
    }
    return toolUses.some((tu) => tu.name === this._expectedToolName)
  }

  /**
   * Returns the tool spec for the structured output tool, or null if disabled.
   */
  getToolSpec(): { name: string; description: string; inputSchema?: object } | null {
    return this._structuredOutputTool?.toolSpec ?? null
  }

  /**
   * Extracts and removes the structured output result for the first matching tool use.
   */
  extractResult(toolUses: ToolUse[]): unknown {
    if (!this.hasStructuredOutputTool(toolUses)) {
      return null
    }
    for (const tu of toolUses) {
      if (tu.name === this._expectedToolName) {
        const toolUseId = tu.toolUseId
        const result = this._results.get(toolUseId)
        if (result !== undefined) {
          this._results.delete(toolUseId)
          this._stopLoop = true
          return result
        }
      }
    }
    return null
  }

  /**
   * Registers the structured output tool with the registry for this invocation.
   */
  registerTool(registry: ToolRegistry): void {
    if (this._structuredOutputTool && registry.getByName(this._structuredOutputTool.name) === undefined) {
      registry.add(this._structuredOutputTool)
    }
  }

  /**
   * Removes the structured output tool from the registry after the invocation.
   */
  cleanup(registry: ToolRegistry): void {
    if (this._structuredOutputTool && registry.getByName(this._structuredOutputTool.name) !== undefined) {
      registry.removeByName(this._structuredOutputTool.name)
    }
  }
}
