import type { Tool } from './tool.js'

/**
 * Registry for managing Tool instances.
 */
export class ToolRegistry {
  private readonly _tools: Map<string, Tool>

  /**
   * Creates a new ToolRegistry instance with an empty registry.
   */
  constructor() {
    this._tools = new Map<string, Tool>()
  }

  /**
   * Registers one or more tools with the registry.
   * Accepts single Tool or array of Tools for convenience.
   *
   * @param tool - Single Tool instance or array of Tool instances to register
   * @throws If a tool with duplicate name already exists
   * @throws If tool name is invalid (must be 1-64 chars, alphanumeric with hyphens/underscores)
   * @throws If tool description is empty
   */
  public register(tool: Tool | Tool[]): void {
    const tools = Array.isArray(tool) ? tool : [tool]

    for (const t of tools) {
      // Validate tool name is a string
      if (typeof t.toolName !== 'string') {
        throw new Error('Tool name must be a string')
      }

      // Validate tool name length (1-64 characters)
      if (t.toolName.length < 1 || t.toolName.length > 64) {
        throw new Error('Tool name must be between 1 and 64 characters')
      }

      // Validate tool name pattern (alphanumeric with hyphens and underscores)
      const validNamePattern = /^[a-zA-Z0-9_-]+$/
      if (!validNamePattern.test(t.toolName)) {
        throw new Error('Tool name must contain only alphanumeric characters, hyphens, and underscores')
      }

      // Validate tool description if present
      if (t.description !== undefined && t.description !== null) {
        if (typeof t.description !== 'string' || t.description.length < 1) {
          throw new Error('Tool description must be a non-empty string')
        }
      }

      // Check for duplicate names
      if (this._tools.has(t.toolName)) {
        throw new Error(`Tool with name '${t.toolName}' already registered`)
      }

      this._tools.set(t.toolName, t)
    }
  }

  /**
   * Retrieves a tool by its unique name.
   *
   * @param name - The unique name of the tool to retrieve
   * @returns The Tool instance, or undefined if not found
   */
  public get(name: string): Tool | undefined {
    return this._tools.get(name)
  }

  /**
   * Removes a tool from the registry.
   *
   * @param name - The name of the tool to remove
   * @throws If tool with given name doesn't exist
   */
  public remove(name: string): void {
    // Check if tool exists
    if (!this._tools.has(name)) {
      throw new Error(`Tool with name '${name}' not found`)
    }

    this._tools.delete(name)
  }

  /**
   * Returns all registered tools as an array.
   * Returns a copy of the internal array to prevent external mutation.
   *
   * @returns Array of all registered Tool instances, or empty array if no tools registered
   */
  public list(): Tool[] {
    return Array.from(this._tools.values())
  }
}
