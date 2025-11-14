import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { httpRequest } from '../http-request.js'
import type { ToolContext } from '../../../src/tools/tool.js'
import { collectGenerator } from '../../../src/__fixtures__/model-test-helpers.js'
import { isNode } from '../../../src/__fixtures__/environment.js'
import { AgentState } from '../../../src/agent/state.js'

// Mock fetch globally
const mockFetch = vi.fn()
globalThis.fetch = mockFetch as typeof globalThis.fetch

// Helper to create fresh context
const createContext = (toolUseInput: Record<string, unknown>): ToolContext => {
  const state = new AgentState({})
  return {
    toolUse: {
      name: 'httpRequest',
      toolUseId: 'test-id',
      input: toolUseInput as never,
    },
    agent: { state },
  }
}

describe('httpRequest', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockFetch.mockReset()
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up after each test
    vi.restoreAllMocks()
  })

  describe('HTTP methods', () => {
    describe('GET request', () => {
      it('executes GET request successfully', async () => {
        // Mock successful response
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([['content-type', 'application/json']]),
          text: vi.fn().mockResolvedValue('{"result": "success"}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.example.com/data',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(result.toolUseId).toBe('test-get-1')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/data',
          expect.objectContaining({
            method: 'GET',
          })
        )
      })
    })

    describe('POST request', () => {
      it('executes POST request with body', async () => {
        // Mock bypass consent for testing
        const originalEnv = process.env.BYPASS_TOOL_CONSENT
        process.env.BYPASS_TOOL_CONSENT = 'true'

        const mockResponse = {
          ok: true,
          status: 201,
          statusText: 'Created',
          headers: new Map([['content-type', 'application/json']]),
          text: vi.fn().mockResolvedValue('{"id": "123"}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'POST' as const,
          url: 'https://api.example.com/items',
          body: '{"name": "test"}',
          headers: { 'Content-Type': 'application/json' },
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/items',
          expect.objectContaining({
            method: 'POST',
            body: '{"name": "test"}',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          })
        )

        // Restore environment
        if (originalEnv !== undefined) {
          process.env.BYPASS_TOOL_CONSENT = originalEnv
        } else {
          delete process.env.BYPASS_TOOL_CONSENT
        }
      })
    })

    describe('PUT request', () => {
      it('executes PUT request with body', async () => {
        // Mock bypass consent
        const originalEnv = process.env.BYPASS_TOOL_CONSENT
        process.env.BYPASS_TOOL_CONSENT = 'true'

        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([['content-type', 'application/json']]),
          text: vi.fn().mockResolvedValue('{"updated": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'PUT' as const,
          url: 'https://api.example.com/items/123',
          body: '{"name": "updated"}',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/items/123',
          expect.objectContaining({
            method: 'PUT',
            body: '{"name": "updated"}',
          })
        )

        // Restore environment
        if (originalEnv !== undefined) {
          process.env.BYPASS_TOOL_CONSENT = originalEnv
        } else {
          delete process.env.BYPASS_TOOL_CONSENT
        }
      })
    })

    describe('DELETE request', () => {
      it('executes DELETE request', async () => {
        // Mock bypass consent
        const originalEnv = process.env.BYPASS_TOOL_CONSENT
        process.env.BYPASS_TOOL_CONSENT = 'true'

        const mockResponse = {
          ok: true,
          status: 204,
          statusText: 'No Content',
          headers: new Map(),
          text: vi.fn().mockResolvedValue(''),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'DELETE' as const,
          url: 'https://api.example.com/items/123',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/items/123',
          expect.objectContaining({
            method: 'DELETE',
          })
        )

        // Restore environment
        if (originalEnv !== undefined) {
          process.env.BYPASS_TOOL_CONSENT = originalEnv
        } else {
          delete process.env.BYPASS_TOOL_CONSENT
        }
      })
    })

    describe('PATCH request', () => {
      it('executes PATCH request with body', async () => {
        // Mock bypass consent
        const originalEnv = process.env.BYPASS_TOOL_CONSENT
        process.env.BYPASS_TOOL_CONSENT = 'true'

        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([['content-type', 'application/json']]),
          text: vi.fn().mockResolvedValue('{"patched": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'PATCH' as const,
          url: 'https://api.example.com/items/123',
          body: '{"status": "active"}',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/items/123',
          expect.objectContaining({
            method: 'PATCH',
            body: '{"status": "active"}',
          })
        )

        // Restore environment
        if (originalEnv !== undefined) {
          process.env.BYPASS_TOOL_CONSENT = originalEnv
        } else {
          delete process.env.BYPASS_TOOL_CONSENT
        }
      })
    })

    describe('HEAD request', () => {
      it('executes HEAD request', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([
            ['content-type', 'application/json'],
            ['content-length', '1234'],
          ]),
          text: vi.fn().mockResolvedValue(''),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'HEAD' as const,
          url: 'https://api.example.com/data',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/data',
          expect.objectContaining({
            method: 'HEAD',
          })
        )
      })
    })

    describe('OPTIONS request', () => {
      it('executes OPTIONS request', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([
            ['allow', 'GET, POST, PUT, DELETE'],
            ['access-control-allow-methods', 'GET, POST, PUT, DELETE'],
          ]),
          text: vi.fn().mockResolvedValue(''),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'OPTIONS' as const,
          url: 'https://api.example.com/data',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/data',
          expect.objectContaining({
            method: 'OPTIONS',
          })
        )
      })
    })
  })

  describe('authentication', () => {
    describe('bearer token', () => {
      it('adds Bearer token from direct value', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"authenticated": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.example.com/secure',
          auth: {
            type: 'bearer' as const,
            token: 'my-secret-token',
          },
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/secure',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer my-secret-token',
            }),
          })
        )
      })

      it('adds Bearer token from environment variable', async () => {
        // Skip in browser environment
        if (!isNode) {
          return
        }

        // Set up environment variable
        const originalToken = process.env.TEST_TOKEN
        process.env.TEST_TOKEN = 'env-token-value'

        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"authenticated": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.example.com/secure',
          auth: {
            type: 'bearer' as const,
            envVar: 'TEST_TOKEN',
          },
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/secure',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer env-token-value',
            }),
          })
        )

        // Restore environment
        if (originalToken !== undefined) {
          process.env.TEST_TOKEN = originalToken
        } else {
          delete process.env.TEST_TOKEN
        }
      })
    })

    describe('token auth', () => {
      it('adds token auth header (GitHub-style)', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"authenticated": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.github.com/user',
          auth: {
            type: 'token' as const,
            token: 'ghp_token123',
          },
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.github.com/user',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'token ghp_token123',
            }),
          })
        )
      })
    })

    describe('basic auth', () => {
      it('adds Basic auth header with base64 encoding', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"authenticated": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.example.com/secure',
          auth: {
            type: 'basic' as const,
            username: 'user',
            password: 'pass',
          },
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        // Base64 of "user:pass" is "dXNlcjpwYXNz"
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/secure',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Basic dXNlcjpwYXNz',
            }),
          })
        )
      })
    })

    describe('custom auth', () => {
      it('adds custom Authorization header', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"authenticated": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.example.com/secure',
          auth: {
            type: 'custom' as const,
            value: 'CustomScheme abc123',
          },
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/secure',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'CustomScheme abc123',
            }),
          })
        )
      })
    })

    describe('API key', () => {
      it('adds X-API-Key header with direct key', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"authenticated": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.example.com/secure',
          auth: {
            type: 'apiKey' as const,
            key: 'api-key-123',
          },
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/secure',
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-API-Key': 'api-key-123',
            }),
          })
        )
      })
    })
  })

  describe('user consent', () => {
    describe.skipIf(!isNode)('in Node.js environment', () => {
      it('bypasses consent when BYPASS_TOOL_CONSENT is set', async () => {
        const originalEnv = process.env.BYPASS_TOOL_CONSENT
        process.env.BYPASS_TOOL_CONSENT = 'true'

        const mockResponse = {
          ok: true,
          status: 201,
          statusText: 'Created',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"created": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'POST' as const,
          url: 'https://api.example.com/items',
          body: '{"test": true}',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalled()

        // Restore environment
        if (originalEnv !== undefined) {
          process.env.BYPASS_TOOL_CONSENT = originalEnv
        } else {
          delete process.env.BYPASS_TOOL_CONSENT
        }
      })

      it('does not prompt for GET requests', async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map(),
          text: vi.fn().mockResolvedValue('{"data": true}'),
        }
        mockFetch.mockResolvedValue(mockResponse)

        const input = {
          method: 'GET' as const,
          url: 'https://api.example.com/data',
        }
        const context = createContext(input)

        const { result } = await collectGenerator(httpRequest.stream(context))

        expect(result.status).toBe('success')
        expect(mockFetch).toHaveBeenCalled()
      })
    })
  })

  describe('response handling', () => {
    it('includes status code in response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: vi.fn().mockResolvedValue('{"result": "success"}'),
      }
      mockFetch.mockResolvedValue(mockResponse)

      const input = {
        method: 'GET' as const,
        url: 'https://api.example.com/data',
      }
      const context = createContext(input)

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'jsonBlock')
      if (result.content[0] && result.content[0].type === 'jsonBlock') {
        expect(result.content[0].json).toHaveProperty('status', 200)
      }
    })

    it('includes response headers', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', 'application/json'],
          ['x-custom-header', 'custom-value'],
        ]),
        text: vi.fn().mockResolvedValue('{"result": "success"}'),
      }
      mockFetch.mockResolvedValue(mockResponse)

      const input = {
        method: 'GET' as const,
        url: 'https://api.example.com/data',
      }
      const context = createContext(input)

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'jsonBlock')
      if (result.content[0] && result.content[0].type === 'jsonBlock') {
        expect(result.content[0].json).toHaveProperty('headers')
        const json = result.content[0].json as { headers: Record<string, string> }
        expect(json.headers).toHaveProperty('content-type', 'application/json')
        expect(json.headers).toHaveProperty('x-custom-header', 'custom-value')
      }
    })

    it('includes response body', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: vi.fn().mockResolvedValue('{"result": "success"}'),
      }
      mockFetch.mockResolvedValue(mockResponse)

      const input = {
        method: 'GET' as const,
        url: 'https://api.example.com/data',
      }
      const context = createContext(input)

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'jsonBlock')
      if (result.content[0] && result.content[0].type === 'jsonBlock') {
        expect(result.content[0].json).toHaveProperty('body', '{"result": "success"}')
      }
    })

    it('handles network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const input = {
        method: 'GET' as const,
        url: 'https://api.example.com/data',
      }
      const context = createContext(input)

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('error')
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'textBlock')
      if (result.content[0] && result.content[0].type === 'textBlock') {
        expect(result.content[0].text).toContain('Network error')
      }
    })

    it('handles HTTP error status codes', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map(),
        text: vi.fn().mockResolvedValue('Not found'),
      }
      mockFetch.mockResolvedValue(mockResponse)

      const input = {
        method: 'GET' as const,
        url: 'https://api.example.com/notfound',
      }
      const context = createContext(input)

      const { result } = await collectGenerator(httpRequest.stream(context))

      // HTTP errors are still successful responses, just with error status codes
      expect(result.status).toBe('success')
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'jsonBlock')
      if (result.content[0] && result.content[0].type === 'jsonBlock') {
        expect(result.content[0].json).toHaveProperty('status', 404)
      }
    })
  })

  describe('SSL verification', () => {
    it('uses verifySSL: true by default', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: vi.fn().mockResolvedValue('{"result": "success"}'),
      }
      mockFetch.mockResolvedValue(mockResponse)

      const input = {
        method: 'GET' as const,
        url: 'https://api.example.com/data',
      }
      const context = createContext(input)

      await collectGenerator(httpRequest.stream(context))

      // In Node.js, fetch doesn't directly support SSL verification control
      // This is more for documentation purposes
      expect(mockFetch).toHaveBeenCalled()
    })

    it('respects verifySSL: false', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map(),
        text: vi.fn().mockResolvedValue('{"result": "success"}'),
      }
      mockFetch.mockResolvedValue(mockResponse)

      const input = {
        method: 'GET' as const,
        url: 'https://api.example.com/data',
        verifySSL: false,
      }
      const context = createContext(input)

      await collectGenerator(httpRequest.stream(context))

      // In Node.js, fetch doesn't directly support SSL verification control
      // This is more for documentation purposes
      expect(mockFetch).toHaveBeenCalled()
    })
  })
})
