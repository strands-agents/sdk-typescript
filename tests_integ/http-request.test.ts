import { describe, it, expect, beforeEach } from 'vitest'
import { httpRequest, type ToolContext } from '@strands-agents/sdk'

// eslint-disable-next-line no-restricted-imports
import { collectGenerator } from '../src/__fixtures__/model-test-helpers'

describe('httpRequest integration', () => {
  // Set bypass consent for integration tests
  beforeEach(() => {
    process.env.BYPASS_TOOL_CONSENT = 'true'
  })

  describe('real HTTP requests', () => {
    it('executes GET request to httpbin.org', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/get',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-get-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toContain('httpbin.org')
      }
    }, 10000)

    it('executes POST request to httpbin.org', async () => {
      const input = {
        method: 'POST' as const,
        url: 'https://httpbin.org/post',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"test": "data"}',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-post-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toContain('"test": "data"')
      }
    }, 10000)

    it('executes PUT request to httpbin.org', async () => {
      const input = {
        method: 'PUT' as const,
        url: 'https://httpbin.org/put',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"update": "value"}',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-put-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toContain('"update": "value"')
      }
    }, 10000)

    it('executes DELETE request to httpbin.org', async () => {
      const input = {
        method: 'DELETE' as const,
        url: 'https://httpbin.org/delete',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-delete-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number }
        expect(response.status).toBe(200)
      }
    }, 10000)

    it('executes PATCH request to httpbin.org', async () => {
      const input = {
        method: 'PATCH' as const,
        url: 'https://httpbin.org/patch',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"patch": "data"}',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-patch-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toContain('"patch": "data"')
      }
    }, 10000)
  })

  describe('authentication', () => {
    it('uses Bearer token authentication with httpbin', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/bearer',
        auth: {
          type: 'bearer' as const,
          token: 'test-bearer-token',
        },
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-bearer-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toContain('test-bearer-token')
      }
    }, 10000)

    it('uses Basic authentication with httpbin', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/basic-auth/user/passwd',
        auth: {
          type: 'basic' as const,
          username: 'user',
          password: 'passwd',
        },
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-basic-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number }
        expect(response.status).toBe(200)
      }
    }, 10000)

    it('uses environment variable for authentication', async () => {
      // Set a test token in environment
      const originalToken = process.env.TEST_HTTP_TOKEN
      process.env.TEST_HTTP_TOKEN = 'test-env-token'

      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/bearer',
        auth: {
          type: 'bearer' as const,
          envVar: 'TEST_HTTP_TOKEN',
        },
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-env-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toContain('test-env-token')
      }

      // Restore environment
      if (originalToken !== undefined) {
        process.env.TEST_HTTP_TOKEN = originalToken
      } else {
        delete process.env.TEST_HTTP_TOKEN
      }
    }, 10000)
  })

  describe('error cases', () => {
    it('handles 404 Not Found', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/status/404',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-404-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      // 404 is a successful HTTP response, just with error status code
      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number }
        expect(response.status).toBe(404)
      }
    }, 10000)

    it('handles 500 Server Error', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/status/500',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-500-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      // 500 is a successful HTTP response, just with error status code
      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number }
        expect(response.status).toBe(500)
      }
    }, 10000)

    it('handles invalid authentication', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/basic-auth/user/passwd',
        auth: {
          type: 'basic' as const,
          username: 'wrong',
          password: 'wrong',
        },
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-auth-error-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      // 401 is a successful HTTP response, just indicates auth failure
      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number }
        expect(response.status).toBe(401)
      }
    }, 10000)

    it('handles invalid URL', async () => {
      const input = {
        method: 'GET' as const,
        url: 'not-a-valid-url',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-invalid-url-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('error')
      expect(result.content[0]).toHaveProperty('type', 'toolResultTextContent')
    }, 10000)
  })

  describe('custom headers', () => {
    it('sends custom headers in request', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://httpbin.org/headers',
        headers: {
          'X-Custom-Header': 'custom-value',
          'User-Agent': 'test-agent/1.0',
        },
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-headers-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toContain('X-Custom-Header')
        expect(response.body).toContain('custom-value')
      }
    }, 10000)
  })
})
