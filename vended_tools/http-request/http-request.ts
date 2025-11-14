import { FunctionTool } from '../../src/tools/function-tool.js'
import type { ToolContext } from '../../src/tools/tool.js'
import type { JSONValue } from '../../src/types/json.js'
import type { HttpRequestInput, HttpResponse, HttpAuthConfig, HttpMethod } from './types.js'

// Type declarations for browser/Node.js globals
declare const Buffer: typeof import('buffer').Buffer
declare const btoa: (data: string) => string

/**
 * Detects if the current environment is Node.js.
 *
 * @returns True if running in Node.js, false otherwise
 */
function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node
}

/**
 * Gets an environment variable value if available.
 * Only works in Node.js environment.
 *
 * @param name - Name of the environment variable
 * @returns The value of the environment variable, or undefined if not available
 */
function getEnvironmentVariable(name: string): string | undefined {
  if (isNodeEnvironment() && typeof process.env === 'object') {
    return process.env[name]
  }
  return undefined
}

/**
 * Checks if the BYPASS_TOOL_CONSENT environment variable is set.
 *
 * @returns True if consent should be bypassed
 */
function shouldBypassConsent(): boolean {
  const bypass = getEnvironmentVariable('BYPASS_TOOL_CONSENT')
  return bypass === 'true' || bypass === '1'
}

/**
 * Checks if a given HTTP method requires user consent.
 *
 * @param method - The HTTP method to check
 * @returns True if consent is required for this method
 */
function requiresConsent(method: HttpMethod): boolean {
  return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)
}

/**
 * Prompts the user for consent to execute a modifying HTTP request.
 * In Node.js, uses stdin. In browser, uses confirm() dialog.
 *
 * @param method - The HTTP method
 * @param url - The target URL
 * @returns Promise that resolves to true if user consents, false otherwise
 */
async function promptForConsent(method: HttpMethod, url: string): Promise<boolean> {
  const message = `Execute ${method} request to ${url}?`

  if (isNodeEnvironment()) {
    // Node.js environment: use readline
    const readline = await import('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(`${message} (y/n): `, (answer) => {
        rl.close()
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
      })
    })
  } else if (
    typeof globalThis !== 'undefined' &&
    'window' in globalThis &&
    typeof (globalThis as Window & typeof globalThis).confirm === 'function'
  ) {
    // Browser environment: use confirm dialog
    return (globalThis as Window & typeof globalThis).confirm(message)
  }

  // Unknown environment: deny by default
  return false
}

/**
 * Resolves the authentication token from either direct value or environment variable.
 *
 * @param token - Direct token value
 * @param envVar - Environment variable name
 * @returns The resolved token, or undefined if not available
 */
function resolveToken(token?: string, envVar?: string): string | undefined {
  if (token) {
    return token
  }
  if (envVar) {
    const envValue = getEnvironmentVariable(envVar)
    if (!envValue && !isNodeEnvironment()) {
      console.warn(`Environment variables not available in browser environment`)
    }
    return envValue
  }
  return undefined
}

/**
 * Builds the Authorization header value from authentication configuration.
 *
 * @param authConfig - Authentication configuration
 * @returns The Authorization header value, or undefined if no auth
 * @throws Error if authentication configuration is invalid
 */
function buildAuthHeader(authConfig?: HttpAuthConfig): string | undefined {
  if (!authConfig) {
    return undefined
  }

  switch (authConfig.type) {
    case 'bearer': {
      const token = resolveToken(authConfig.token, authConfig.envVar)
      if (!token) {
        throw new Error('Bearer token not provided and environment variable not found')
      }
      return `Bearer ${token}`
    }

    case 'token': {
      const token = resolveToken(authConfig.token, authConfig.envVar)
      if (!token) {
        throw new Error('Token not provided and environment variable not found')
      }
      return `token ${token}`
    }

    case 'basic': {
      const credentials = `${authConfig.username}:${authConfig.password}`
      // Use btoa for browser, Buffer for Node.js
      const encoded = isNodeEnvironment() ? Buffer.from(credentials).toString('base64') : btoa(credentials)
      return `Basic ${encoded}`
    }

    case 'custom': {
      return authConfig.value
    }

    case 'apiKey': {
      // API Key uses a different header, so return undefined for Authorization
      return undefined
    }

    default: {
      // TypeScript ensures this is never reached if all cases are handled
      const exhaustiveCheck: never = authConfig as never
      throw new Error(`Unknown auth type: ${JSON.stringify(exhaustiveCheck)}`)
    }
  }
}

/**
 * Builds the X-API-Key header value from API key configuration.
 *
 * @param authConfig - Authentication configuration
 * @returns The X-API-Key header value, or undefined if not API key auth
 * @throws Error if API key is not provided
 */
function buildApiKeyHeader(authConfig?: HttpAuthConfig): string | undefined {
  if (!authConfig || authConfig.type !== 'apiKey') {
    return undefined
  }

  const key = resolveToken(authConfig.key, authConfig.envVar)
  if (!key) {
    throw new Error('API key not provided and environment variable not found')
  }
  return key
}

/**
 * Converts Headers object to plain object for response.
 *
 * @param headers - Headers object from fetch response
 * @returns Plain object with header key-value pairs
 */
function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

/**
 * Executes an HTTP request with the given configuration.
 *
 * @param input - HTTP request input configuration
 * @param _context - Tool execution context (unused in this implementation)
 * @returns HTTP response with status, headers, and body
 */
async function executeHttpRequest(input: HttpRequestInput, _context: ToolContext): Promise<HttpResponse> {
  // Check for user consent if needed
  if (requiresConsent(input.method)) {
    if (!shouldBypassConsent()) {
      const consented = await promptForConsent(input.method, input.url)
      if (!consented) {
        throw new Error('Request cancelled by user')
      }
    }
  }

  // Build headers
  const headers: Record<string, string> = { ...(input.headers || {}) }

  // Add authentication headers
  const authHeader = buildAuthHeader(input.auth)
  if (authHeader) {
    headers.Authorization = authHeader
  }

  const apiKeyHeader = buildApiKeyHeader(input.auth)
  if (apiKeyHeader) {
    headers['X-API-Key'] = apiKeyHeader
  }

  // Build fetch options
  const options: RequestInit = {
    method: input.method,
    headers,
  }

  // Add body for methods that support it
  if (input.body && ['POST', 'PUT', 'PATCH'].includes(input.method)) {
    options.body = input.body
  }

  // Note: Native fetch doesn't support verifySSL option directly
  // This would require using a custom agent in Node.js with node-fetch or similar
  // For now, we document it but don't implement SSL verification control

  // Execute request
  const response = await globalThis.fetch(input.url, options)

  // Parse response
  const body = await response.text()
  const responseHeaders = headersToObject(response.headers)

  return {
    status: response.status,
    headers: responseHeaders,
    body,
  }
}

/**
 * HTTP request tool callback function.
 * Executes HTTP requests with authentication and user consent.
 *
 * @param input - HTTP request input configuration
 * @param _context - Tool execution context (unused in this implementation)
 * @returns HTTP response object
 */
async function httpRequestCallback(input: unknown, _context: ToolContext): Promise<JSONValue> {
  // Type assertion - FunctionTool's JSON Schema validation ensures correct type
  const requestInput = input as HttpRequestInput

  const response = await executeHttpRequest(requestInput, _context)
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
  }
}

/**
 * HTTP request tool for making HTTP/HTTPS requests.
 *
 * Supports all standard HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS),
 * multiple authentication types (Bearer, Token, Basic, Custom, API Key),
 * environment variable support, and user consent for modifying operations.
 *
 * @example
 * ```typescript
 * // GET request with Bearer token from environment
 * const result = await httpRequest.stream({
 *   toolUse: {
 *     name: 'httpRequest',
 *     toolUseId: 'req-1',
 *     input: {
 *       method: 'GET',
 *       url: 'https://api.github.com/user',
 *       auth: {
 *         type: 'token',
 *         envVar: 'GITHUB_TOKEN'
 *       }
 *     }
 *   },
 *   invocationState: {}
 * })
 *
 * // POST request with custom headers
 * const result = await httpRequest.stream({
 *   toolUse: {
 *     name: 'httpRequest',
 *     toolUseId: 'req-2',
 *     input: {
 *       method: 'POST',
 *       url: 'https://api.example.com/data',
 *       headers: {
 *         'Content-Type': 'application/json'
 *       },
 *       body: '{"key": "value"}',
 *       auth: {
 *         type: 'bearer',
 *         token: 'my-token'
 *       }
 *     }
 *   },
 *   invocationState: {}
 * })
 * ```
 */
export const httpRequest = new FunctionTool({
  name: 'httpRequest',
  description:
    'Make HTTP/HTTPS requests to external APIs and services. Supports all standard HTTP methods, authentication, custom headers, and request bodies.',
  inputSchema: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        description: 'HTTP method to use for the request',
      },
      url: {
        type: 'string',
        description: 'Target URL for the request',
      },
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional request headers as key-value pairs',
      },
      body: {
        type: 'string',
        description: 'Optional request body (for POST, PUT, PATCH)',
      },
      auth: {
        type: 'object',
        description: 'Optional authentication configuration',
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'bearer' },
              token: { type: 'string' },
              envVar: { type: 'string' },
            },
            required: ['type'],
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'token' },
              token: { type: 'string' },
              envVar: { type: 'string' },
            },
            required: ['type'],
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'basic' },
              username: { type: 'string' },
              password: { type: 'string' },
            },
            required: ['type', 'username', 'password'],
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'custom' },
              value: { type: 'string' },
            },
            required: ['type', 'value'],
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'apiKey' },
              key: { type: 'string' },
              envVar: { type: 'string' },
            },
            required: ['type'],
          },
        ],
      },
      verifySSL: {
        type: 'boolean',
        description: 'Whether to verify SSL certificates (default: true)',
        default: true,
      },
    },
    required: ['method', 'url'],
  },
  callback: httpRequestCallback,
})
