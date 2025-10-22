import type { JSONSchema, JSONValue } from '../types/json'

/**
 * Result of a tool execution.
 * Contains the outcome and any data returned by the tool.
 *
 * @example
 * ```typescript
 * const successResult: ToolResult = {
 *   toolUseId: 'calc-123',
 *   status: 'success',
 *   content: [
 *     { type: 'toolResultTextContent', text: 'The result is 8' },
 *     { type: 'toolResultJsonContent', json: { result: 8 } }
 *   ]
 * }
 *
 * const errorResult: ToolResult = {
 *   toolUseId: 'calc-456',
 *   status: 'error',
 *   content: [{ type: 'toolResultTextContent', text: 'Error: Division by zero' }]
 * }
 * ```
 */
export interface ToolResult {
  /**
   * The ID of the tool use that this result corresponds to.
   */
  toolUseId: string

  /**
   * Status indicating success or error.
   */
  status: ToolResultStatus

  /**
   * Array of content blocks containing the tool's output.
   */
  content: ToolResultContent[]
}

/**
 * Status of a tool execution.
 * Indicates whether the tool executed successfully or encountered an error.
 */
export type ToolResultStatus = 'success' | 'error'

/**
 * Content returned from a tool execution.
 * Can be either text or structured JSON data.
 *
 * This is a discriminated union where the `type` field determines the content format.
 *
 * @example
 * ```typescript
 * // Text result
 * const textResult: ToolResultContent = {
 *   type: 'toolResultTextContent',
 *   text: 'Operation completed successfully'
 * }
 *
 * // JSON result
 * const jsonResult: ToolResultContent = {
 *   type: 'toolResultJsonContent',
 *   json: { result: 42, status: 'success' }
 * }
 *
 * // Type-safe handling
 * function handleResult(content: ToolResultContent) {
 *   switch (content.type) {
 *     case 'text':
 *       console.log(content.text)
 *       break
 *     case 'json':
 *       console.log(JSON.stringify(content.json))
 *       break
 *   }
 * }
 * ```
 */
export type ToolResultContent = ToolResultTextContent | ToolResultJsonContent

/**
 * Text content returned from a tool execution.
 */
export interface ToolResultTextContent {
  /**
   * Discriminator for text content.
   */
  type: 'toolResultTextContent'

  /**
   * Plain text result from the tool.
   */
  text: string
}

/**
 * JSON content returned from a tool execution.
 */
export interface ToolResultJsonContent {
  /**
   * Discriminator for JSON content.
   */
  type: 'toolResultJsonContent'

  /**
   * Structured JSON result from the tool.
   */
  json: JSONValue
}

/**
 * Specification for a tool that can be used by the model.
 * Defines the tool's name, description, and input schema.
 *
 * @example
 * ```typescript
 * const calculatorSpec: ToolSpec = {
 *   name: 'calculator',
 *   description: 'Performs basic arithmetic operations',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
 *       a: { type: 'number' },
 *       b: { type: 'number' }
 *     },
 *     required: ['operation', 'a', 'b']
 *   }
 * }
 * ```
 */
export interface ToolSpec {
  /**
   * The unique name of the tool.
   */
  name: string

  /**
   * A description of what the tool does.
   * This helps the model understand when to use the tool.
   */
  description: string

  /**
   * JSON Schema defining the expected input structure for the tool.
   */
  inputSchema: JSONSchema
}

/**
 * Represents a tool usage request from the model.
 * The model generates this when it wants to use a tool.
 *
 * @example
 * ```typescript
 * const toolUse: ToolUse = {
 *   name: 'calculator',
 *   toolUseId: 'calc-123',
 *   input: {
 *     operation: 'add',
 *     a: 5,
 *     b: 3
 *   }
 * }
 * ```
 */
export interface ToolUse {
  /**
   * The name of the tool to execute.
   */
  name: string

  /**
   * Unique identifier for this tool use instance.
   * Used to match tool results back to their requests.
   */
  toolUseId: string

  /**
   * The input parameters for the tool.
   * Must be JSON-serializable.
   */
  input: JSONValue
}

/**
 * Specifies how the model should choose which tool to use.
 *
 * - `{ auto: {} }` - Let the model decide whether to use a tool
 * - `{ any: {} }` - Force the model to use one of the available tools
 * - `{ tool: { name: 'toolName' } }` - Force the model to use a specific tool
 *
 * @example
 * ```typescript
 * // Let model decide
 * const autoChoice: ToolChoice = { auto: {} }
 *
 * // Force use of any available tool
 * const anyChoice: ToolChoice = { any: {} }
 *
 * // Force use of specific tool
 * const specificChoice: ToolChoice = { tool: { name: 'calculator' } }
 * ```
 */
export type ToolChoice = { auto: Record<string, never> } | { any: Record<string, never> } | { tool: { name: string } }
