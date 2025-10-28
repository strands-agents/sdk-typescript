import type { Tool } from './tool'

/**
 * Registry for managing Tool instances.
 *
 * Provides CRUDL operations for Tool management with name-based lookup.
 * Multiple independent registry instances can be created.
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry()
 *
 * // Register a single tool
 * registry.register(myTool)
 *
 * // Register multiple tools
 * registry.register([tool1, tool2, tool3])
 *
 * // Retrieve a tool
 * const tool = registry.get('calculator')
 *
 * // Update a tool
 * registry.update('calculator', updatedCalculator)
 *
 * // Remove a tool
 * registry.remove('calculator')
 *
 * // List all tools
 * const allTools = registry.list()
 * ```
 */
export class ToolRegistry {
  private readonly _tools: Map<string, Tool>

  /**
   * Creates a new ToolRegistry instance with an empty registry.
   */
  constructor() {
    this._tools = new Map()
  }

  /**
   * Registers one or more tools with the registry.
   * Accepts single Tool or array of Tools for convenience.
   *
   * @param tool - Single Tool instance or array of Tool instances to register
   * @throws If a tool with duplicate name already exists
   * @throws If tool name is empty or not a string
   *
   * @example
   * ```typescript
   * // Register single tool
   * registry.register(calculatorTool)
   *
   * // Register multiple tools
   * registry.register([tool1, tool2, tool3])
   * ```
   */
  public register(tool: Tool | Tool[]): void {
    const tools = Array.isArray(tool) ? tool : [tool]

    for (const t of tools) {
      // Validate tool name is non-empty string
      if (typeof t.toolName !== 'string' || t.toolName.trim() === '') {
        throw new Error('Tool name must be a non-empty string')
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
   * @returns The Tool instance
   * @throws If tool with given name doesn't exist
   *
   * @example
   * ```typescript
   * const calculator = registry.get('calculator')
   * ```
   */
  public get(name: string): Tool {
    const tool = this._tools.get(name)

    if (!tool) {
      throw new Error(`Tool with name '${name}' not found`)
    }

    return tool
  }

  /**
   * Updates an existing tool registration.
   * The new tool's name must match the parameter name.
   *
   * @param name - The name of the tool to update
   * @param tool - The new Tool instance
   * @throws If tool with given name doesn't exist
   * @throws If the new tool's name doesn't match the parameter name
   * @throws If tool name is empty or not a string
   *
   * @example
   * ```typescript
   * registry.update('calculator', updatedCalculatorTool)
   * ```
   */
  public update(name: string, tool: Tool): void {
    // Validate tool name is non-empty string
    if (typeof tool.toolName !== 'string' || tool.toolName.trim() === '') {
      throw new Error('Tool name must be a non-empty string')
    }

    // Check if tool exists
    if (!this._tools.has(name)) {
      throw new Error(`Tool with name '${name}' not found`)
    }

    // Check if new tool's name matches the parameter
    if (tool.toolName !== name) {
      throw new Error(`Tool name '${tool.toolName}' does not match parameter name '${name}'`)
    }

    this._tools.set(name, tool)
  }

  /**
   * Removes a tool from the registry.
   *
   * @param name - The name of the tool to remove
   * @throws If tool with given name doesn't exist
   *
   * @example
   * ```typescript
   * registry.remove('calculator')
   * ```
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
   *
   * @example
   * ```typescript
   * const allTools = registry.list()
   * console.log(`Registry contains ${allTools.length} tools`)
   * ```
   */
  public list(): Tool[] {
    return Array.from(this._tools.values())
  }
}
