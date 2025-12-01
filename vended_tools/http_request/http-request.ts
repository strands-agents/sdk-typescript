/* eslint-env browser, node */
import { tool } from '../../src/tools/zod-tool.js'
import { z } from 'zod'

/**
 * Zod schema for HTTP request input validation.
 */
const httpRequestInputSchema = z.object({
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
    .describe('HTTP method to use for the request'),
  url: z.string().url().describe('URL to send the request to'),
  headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers as key-value pairs'),
  body: z.string().optional().describe('Optional request body as a string'),
  timeout: z.number().positive().optional().describe('Optional timeout in seconds (default: 30)'),
})

/**
 * HTTP request tool for making HTTP requests to external APIs.
 *
 * Supports all standard HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * and provides comprehensive request configuration including headers, body, and timeout.
 *
 * @example
 * ```typescript
 * // With agent
 * const agent = new Agent({ tools: [httpRequest] })
 * await agent.invoke('Make a GET request to https://api.example.com/data')
 *
 * // Direct usage
 * const response = await httpRequest.invoke({
 *   method: 'POST',
 *   url: 'https://api.example.com/users',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: '{"name":"test"}',
 *   timeout: 10
 * })
 * ```
 */
export const httpRequest = tool({
  name: 'http_request',
  description:
    'Makes HTTP requests to external APIs. Supports GET, POST, PUT, DELETE, PATCH, HEAD, and OPTIONS methods. Returns response with status, headers, and body.',
  inputSchema: httpRequestInputSchema,
  callback: async (input) => {
    const { method, url, headers, body, timeout = 30 } = input

    // Create AbortController for timeout
    const controller = new AbortController()
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeout * 1000)

    try {
      // Build fetch options
      const fetchOptions: RequestInit = {
        method,
        signal: controller.signal,
      }

      // Only add headers and body if they are defined
      if (headers !== undefined) {
        fetchOptions.headers = headers
      }
      if (body !== undefined) {
        fetchOptions.body = body
      }

      // Make the fetch request
      const response = await globalThis.fetch(url, fetchOptions)

      // Clear the timeout
      globalThis.clearTimeout(timeoutId)

      // Get response body as text
      const responseBody = await response.text()

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      // Check if response was successful
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${method} ${url}`)
      }

      // Return successful response as JSON-serializable object
      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
      }
    } catch (error) {
      // Clear timeout on error
      globalThis.clearTimeout(timeoutId)

      // Handle abort/timeout error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout} seconds: ${method} ${url}`)
      }

      // Re-throw other errors (network errors, HTTP errors, etc.)
      throw error
    }
  },
})
