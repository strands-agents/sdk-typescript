import { Registry, ValidationError } from './registry.js'
import type { Tool } from '../tools/tool.js'

/**
 * A concrete implementation of the Registry for managing Tool instances.
 * It adds validation for tool properties and ensures unique tool names.
 */
export class ToolRegistry extends Registry<Tool, Tool> {
  /**
   * Generates a unique identifier for a Tool.
   * @override
   * @returns The tool itself as the identifier.
   */
  protected generateId(tool: Tool): Tool {
    return tool
  }

  /**
   * Validates a tool before it is registered.
   * @override
   * @param tool - The tool to be validated.
   * @throws ValidationError If the tool's properties are invalid or its name is already registered.
   */
  protected validate(tool: Tool): void {
    // Validate tool name is a string
    if (typeof tool.name !== 'string') {
      throw new ValidationError('Tool name must be a string')
    }

    // Validate tool name length (1-64 characters)
    if (tool.name.length < 1 || tool.name.length > 64) {
      throw new ValidationError('Tool name must be between 1 and 64 characters')
    }

    // Validate tool name pattern
    const validNamePattern = /^[a-zA-Z0-9_-]+$/
    if (!validNamePattern.test(tool.name)) {
      throw new ValidationError('Tool name must contain only alphanumeric characters, hyphens, and underscores')
    }

    // Validate tool description if present
    if (tool.description !== undefined && tool.description !== null) {
      if (typeof tool.description !== 'string' || tool.description.length < 1) {
        throw new ValidationError('Tool description must be a non-empty string')
      }
    }

    // Check for duplicate names
    const hasDuplicate = this.values().some((t) => t.name === tool.name)
    if (hasDuplicate) {
      throw new ValidationError(`Tool with name '${tool.name}' already registered`)
    }
  }

  /**
   * Retrieves the first tool that matches the given name.
   *
   * @param name - The name of the tool to retrieve.
   * @returns The tool if found, otherwise undefined.
   */
  public getByName(name: string): Tool | undefined {
    return this.values().find((tool) => tool.name === name)
  }

  /**
   * Finds and removes the first tool that matches the given name.
   *
   * @param name - The name of the tool to remove.
   */
  public removeByName(name: string): void {
    this.findRemove((tool) => tool.name === name)
  }
}
