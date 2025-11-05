import type { JSONSchema, JSONValue } from '../types/json'

/**
 * Result of a tool execution.
 * Contains the outcome and any data returned by the tool.
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

  /**
   * The original error object when status is 'error'.
   * Available for inspection by hooks, error handlers, and event loop.
   * Tools must wrap non-Error thrown values into Error objects.
   */
  error?: Error
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
 */
export type ToolChoice = { auto: Record<string, never> } | { any: Record<string, never> } | { tool: { name: string } }

/**
 * HTTP methods supported by the HTTP request tool.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

/**
 * Configuration for HTTP request authentication.
 * Supports multiple authentication types via discriminated union.
 */
export type HttpAuthConfig =
  | HttpBearerAuthConfig
  | HttpTokenAuthConfig
  | HttpBasicAuthConfig
  | HttpCustomAuthConfig
  | HttpApiKeyAuthConfig

/**
 * Bearer token authentication configuration.
 */
export interface HttpBearerAuthConfig {
  /**
   * Authentication type discriminator.
   */
  type: 'bearer'

  /**
   * Bearer token value (if not using environment variable).
   */
  token?: string

  /**
   * Name of environment variable containing the token.
   */
  envVar?: string
}

/**
 * Token authentication configuration (GitHub-style).
 */
export interface HttpTokenAuthConfig {
  /**
   * Authentication type discriminator.
   */
  type: 'token'

  /**
   * Token value (if not using environment variable).
   */
  token?: string

  /**
   * Name of environment variable containing the token.
   */
  envVar?: string
}

/**
 * Basic authentication configuration.
 */
export interface HttpBasicAuthConfig {
  /**
   * Authentication type discriminator.
   */
  type: 'basic'

  /**
   * Username for basic authentication.
   */
  username: string

  /**
   * Password for basic authentication.
   */
  password: string
}

/**
 * Custom authentication configuration.
 */
export interface HttpCustomAuthConfig {
  /**
   * Authentication type discriminator.
   */
  type: 'custom'

  /**
   * Raw Authorization header value.
   */
  value: string
}

/**
 * API key authentication configuration.
 */
export interface HttpApiKeyAuthConfig {
  /**
   * Authentication type discriminator.
   */
  type: 'apiKey'

  /**
   * API key value (if not using environment variable).
   */
  key?: string

  /**
   * Name of environment variable containing the API key.
   */
  envVar?: string
}

/**
 * Input configuration for HTTP request tool.
 * This structure matches the JSON Schema input that the tool receives.
 */
export interface HttpRequestInput {
  /**
   * HTTP method to use for the request.
   */
  method: HttpMethod

  /**
   * Target URL for the request.
   */
  url: string

  /**
   * Optional request headers as key-value pairs.
   */
  headers?: Record<string, string>

  /**
   * Optional request body (for POST, PUT, PATCH).
   */
  body?: string

  /**
   * Optional authentication configuration.
   */
  auth?: HttpAuthConfig

  /**
   * Whether to verify SSL certificates (default: true).
   */
  verifySSL?: boolean
}

/**
 * Response from HTTP request.
 * Contains status, headers, and body.
 */
export interface HttpResponse {
  /**
   * HTTP status code.
   */
  status: number

  /**
   * Response headers as key-value pairs.
   */
  headers: Record<string, string>

  /**
   * Response body as text.
   */
  body: string
}
