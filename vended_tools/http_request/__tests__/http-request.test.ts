import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { httpRequest } from '../http-request.js'

describe('httpRequest tool', () => {
  // Store original fetch
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Reset fetch mock before each test
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Restore original fetch after each test
    globalThis.fetch = originalFetch
  })

  describe('GET request', () => {
    it('returns successful response with correct structure', async () => {
      // Mock fetch response
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', 'application/json'],
          ['x-custom-header', 'test-value'],
        ]),
        text: async () => '{"message":"success"}',
      })

      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://api.example.com/data',
      })

      expect(result).toEqual({
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/json',
          'x-custom-header': 'test-value',
        },
        body: '{"message":"success"}',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith('https://api.example.com/data', expect.any(Object))
    })
  })

  describe('POST request', () => {
    it('sends POST request with body and custom headers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{"id":123}',
      })

      const result = await httpRequest.invoke({
        method: 'POST',
        url: 'https://api.example.com/users',
        body: '{"name":"test"}',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      })

      expect(result).toEqual({
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json' },
        body: '{"id":123}',
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          body: '{"name":"test"}',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        })
      )
    })
  })

  describe('PUT request', () => {
    it('sends PUT request successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([]),
        text: async () => '{"updated":true}',
      })

      const result = await httpRequest.invoke({
        method: 'PUT',
        url: 'https://api.example.com/users/1',
        body: '{"name":"updated"}',
      })

      expect(result.status).toBe(200)
      expect(result.body).toBe('{"updated":true}')
    })
  })

  describe('DELETE request', () => {
    it('sends DELETE request successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: new Map([]),
        text: async () => '',
      })

      const result = await httpRequest.invoke({
        method: 'DELETE',
        url: 'https://api.example.com/users/1',
      })

      expect(result.status).toBe(204)
      expect(result.body).toBe('')
    })
  })

  describe('PATCH request', () => {
    it('sends PATCH request successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([]),
        text: async () => '{"patched":true}',
      })

      const result = await httpRequest.invoke({
        method: 'PATCH',
        url: 'https://api.example.com/users/1',
        body: '{"field":"value"}',
      })

      expect(result.status).toBe(200)
      expect(result.body).toBe('{"patched":true}')
    })
  })

  describe('HEAD request', () => {
    it('sends HEAD request and returns headers only', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', 'text/html'],
          ['content-length', '1234'],
        ]),
        text: async () => '',
      })

      const result = await httpRequest.invoke({
        method: 'HEAD',
        url: 'https://api.example.com/resource',
      })

      expect(result.status).toBe(200)
      expect(result.headers).toEqual({
        'content-type': 'text/html',
        'content-length': '1234',
      })
      expect(result.body).toBe('')
    })
  })

  describe('OPTIONS request', () => {
    it('sends OPTIONS request successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['allow', 'GET, POST, PUT, DELETE']]),
        text: async () => '',
      })

      const result = await httpRequest.invoke({
        method: 'OPTIONS',
        url: 'https://api.example.com/resource',
      })

      expect(result.status).toBe(200)
      expect(result.headers.allow).toBe('GET, POST, PUT, DELETE')
    })
  })

  describe('timeout handling', () => {
    it('throws timeout error when request exceeds timeout', async () => {
      // Mock fetch to delay longer than timeout
      globalThis.fetch = vi.fn().mockImplementation(
        async (_url, _options) =>
          new Promise((_resolve, reject) => {
            // Simulate timeout by calling abort
            // eslint-disable-next-line no-undef
            setTimeout(() => {
              const error = new Error('The operation was aborted')
              error.name = 'AbortError'
              reject(error)
            }, 100)
          })
      )

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://slow-api.example.com',
          timeout: 0.1, // 100ms
        })
      ).rejects.toThrow('Request timed out')
    })

    it('uses default timeout of 30 seconds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([]),
        text: async () => 'success',
      })

      await httpRequest.invoke({
        method: 'GET',
        url: 'https://api.example.com',
      })

      // Verify fetch was called with signal (timeout controller)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({ signal: expect.any(Object) })
      )
    })
  })

  describe('HTTP error responses', () => {
    it('throws error for 404 Not Found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map([]),
        text: async () => 'Resource not found',
      })

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://api.example.com/notfound',
        })
      ).rejects.toThrow('HTTP 404 Not Found')
    })

    it('throws error for 400 Bad Request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Map([]),
        text: async () => 'Invalid request',
      })

      await expect(
        httpRequest.invoke({
          method: 'POST',
          url: 'https://api.example.com/data',
          body: 'invalid',
        })
      ).rejects.toThrow('HTTP 400')
    })

    it('throws error for 401 Unauthorized', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Map([]),
        text: async () => 'Authentication required',
      })

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://api.example.com/protected',
        })
      ).rejects.toThrow('HTTP 401')
    })

    it('throws error for 403 Forbidden', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Map([]),
        text: async () => 'Access denied',
      })

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://api.example.com/forbidden',
        })
      ).rejects.toThrow('HTTP 403')
    })

    it('throws error for 500 Internal Server Error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Map([]),
        text: async () => 'Server error',
      })

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://api.example.com/error',
        })
      ).rejects.toThrow('HTTP 500')
    })

    it('throws error for 502 Bad Gateway', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Map([]),
        text: async () => 'Bad gateway',
      })

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://api.example.com',
        })
      ).rejects.toThrow('HTTP 502')
    })

    it('throws error for 503 Service Unavailable', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Map([]),
        text: async () => 'Service unavailable',
      })

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://api.example.com',
        })
      ).rejects.toThrow('HTTP 503')
    })
  })

  describe('network errors', () => {
    it('throws error when fetch fails with network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error: Failed to fetch'))

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://invalid-domain-that-does-not-exist.com',
        })
      ).rejects.toThrow('Network error: Failed to fetch')
    })

    it('throws error when DNS resolution fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'))

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://nonexistent.invalid',
        })
      ).rejects.toThrow('DNS resolution failed')
    })
  })

  describe('response body handling', () => {
    it('handles empty response body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: new Map([]),
        text: async () => '',
      })

      const result = await httpRequest.invoke({
        method: 'DELETE',
        url: 'https://api.example.com/resource',
      })

      expect(result.body).toBe('')
    })

    it('handles plain text response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => 'Plain text response',
      })

      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://api.example.com/text',
      })

      expect(result.body).toBe('Plain text response')
    })

    it('handles HTML response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<html><body>Hello</body></html>',
      })

      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://example.com',
      })

      expect(result.body).toBe('<html><body>Hello</body></html>')
    })

    it('handles large response body', async () => {
      const largeBody = 'x'.repeat(10000)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([]),
        text: async () => largeBody,
      })

      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://api.example.com/large',
      })

      expect(result.body).toBe(largeBody)
      expect(result.body.length).toBe(10000)
    })
  })

  describe('headers handling', () => {
    it('converts response headers to plain object', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', 'application/json'],
          ['cache-control', 'no-cache'],
          ['x-rate-limit', '100'],
        ]),
        text: async () => '{}',
      })

      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://api.example.com',
      })

      expect(result.headers).toEqual({
        'content-type': 'application/json',
        'cache-control': 'no-cache',
        'x-rate-limit': '100',
      })
    })

    it('handles response with no headers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([]),
        text: async () => 'success',
      })

      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://api.example.com',
      })

      expect(result.headers).toEqual({})
    })
  })

  describe('custom timeout', () => {
    it('respects custom timeout value', async () => {
      let abortCalled = false

      globalThis.fetch = vi.fn().mockImplementation(
        async (_url, options) =>
          new Promise((resolve, reject) => {
            // Check if signal is provided
            const signal = (options as { signal?: AbortSignal }).signal
            if (signal) {
              signal.addEventListener('abort', () => {
                abortCalled = true
                const error = new Error('The operation was aborted')
                error.name = 'AbortError'
                reject(error)
              })
            }

            // Simulate delay
            // eslint-disable-next-line no-undef
            setTimeout(() => {
              if (!abortCalled) {
                resolve({
                  ok: true,
                  status: 200,
                  statusText: 'OK',
                  headers: new Map([]),
                  text: async () => 'success',
                })
              }
            }, 200)
          })
      )

      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://api.example.com',
          timeout: 0.1, // 100ms
        })
      ).rejects.toThrow('Request timed out')

      expect(abortCalled).toBe(true)
    })
  })

  describe('request without optional parameters', () => {
    it('sends request without headers or body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([]),
        text: async () => 'success',
      })

      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://api.example.com',
      })

      expect(result.status).toBe(200)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          method: 'GET',
        })
      )
    })
  })
})
