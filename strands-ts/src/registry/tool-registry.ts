import type { Tool } from '../tools/tool.js'
import { ToolValidationError } from '../errors.js'

/**
 * Registry for managing Tool instances with name-based CRUDL operations.
 */
export class ToolRegistry {
  private _tools: Map<string, Tool> = new Map()

  /**
   * Creates a new ToolRegistry, optionally pre-populated with tools.
   *
   * @param tools - Optional initial tools to register
   */
  constructor(tools?: Tool[]) {
    if (tools) {
      this.add(tools)
    }
  }

  /**
   * Registers one or more tools.
   *
   * @param tool - A single tool or array of tools to register
   * @throws ToolValidationError If a tool's properties are invalid or its name is already registered
   */
  add(tool: Tool | Tool[]): void {
    const tools = Array.isArray(tool) ? tool : [tool]
    for (const t of tools) {
      this._validateProperties(t)
      if (this._tools.has(t.name)) {
        throw new ToolValidationError(`Tool with name '${t.name}' already registered`)
      }
      this._tools.set(t.name, t)
    }
  }

  /**
   * Registers one or more tools, replacing any existing tools with the same name.
   *
   * @param tools - Array of tools to register
   * @throws ToolValidationError If a tool's properties are invalid
   */
  addOrReplace(newTools: Tool[]): void {
    for (const tool of newTools) {
      this._validateProperties(tool)
      this._tools.set(tool.name, tool)
    }
  }

  /**
   * Retrieves a tool by name.
   *
   * @param name - The name of the tool to retrieve
   * @returns The tool if found, otherwise undefined
   */
  get(name: string): Tool | undefined {
    return this._tools.get(name)
  }

  /**
   * Removes a tool by name. No-op if the tool does not exist.
   *
   * @param name - The name of the tool to remove
   */
  remove(name: string): void {
    this._tools.delete(name)
  }

  /**
   * Removes all registered tools.
   */
  clear(): void {
    this._tools.clear()
  }

  /**
   * Returns all registered tools.
   *
   * @returns Array of all registered tools
   */
  list(): Tool[] {
    return Array.from(this._tools.values())
  }

  private _validateProperties(tool: Tool): void {
    if (typeof tool.name !== 'string') {
      throw new ToolValidationError('Tool name must be a string')
    }

    if (tool.name.length < 1 || tool.name.length > 64) {
      throw new ToolValidationError('Tool name must be between 1 and 64 characters')
    }

    const validNamePattern = /^[a-zA-Z0-9_-]+$/
    if (!validNamePattern.test(tool.name)) {
      throw new ToolValidationError('Tool name must contain only alphanumeric characters, hyphens, and underscores')
    }

    if (tool.description !== undefined && tool.description !== null) {
      if (typeof tool.description !== 'string' || tool.description.length < 1) {
        throw new ToolValidationError('Tool description must be a non-empty string')
      }
    }
  }
}
