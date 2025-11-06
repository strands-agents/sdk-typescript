/**
 * Type definitions for the HTTP request tool.
 */

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
