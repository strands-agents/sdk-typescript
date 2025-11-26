import { describe, it, expect } from 'vitest'
import { httpRequest } from '../vended_tools/http_request/http-request.js'
import { Agent } from '@strands-agents/sdk'
// eslint-disable-next-line no-restricted-imports
import { MockMessageModel } from '../src/__fixtures__/mock-message-model.js'

/**
 * Integration tests for HTTP request tool.
 *
 * These tests validate the tool's integration with the Agent system
 * and its ability to make real HTTP requests. Tests using external
 * APIs (like httpbin.org) are marked as skipIf to handle service availability issues.
 */
describe('httpRequest tool (integration)', () => {
  describe('tool registration', () => {
    it('can be registered with an Agent', () => {
      const agent = new Agent({
        model: new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' }),
        tools: [httpRequest],
      })

      expect(agent).toBeDefined()
    })

    it('exports correct tool metadata', () => {
      expect(httpRequest.description).toContain('HTTP requests')
      expect(httpRequest.toolSpec).toBeDefined()
      expect(httpRequest.toolSpec.name).toBe('http_request')
    })
  })

  describe('direct invocation', () => {
    // Note: These tests depend on httpbin.org being available
    // Set to true if httpbin.org is consistently unavailable
    const shouldSkipExternalTests = false

    it.skipIf(shouldSkipExternalTests)('makes successful GET request', async () => {
      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://httpbin.org/get',
      })

      expect(result.status).toBe(200)
      expect(result.statusText).toBe('OK')
      expect(result.headers).toHaveProperty('content-type')
      expect(result.body).toContain('httpbin.org')
    })

    it.skipIf(shouldSkipExternalTests)('includes custom headers in request', async () => {
      const result = await httpRequest.invoke({
        method: 'GET',
        url: 'https://httpbin.org/headers',
        headers: {
          'X-Custom-Header': 'test-value',
        },
      })

      expect(result.status).toBe(200)
      const body = JSON.parse(result.body)
      expect(body.headers).toHaveProperty('X-Custom-Header', 'test-value')
    })

    it.skipIf(shouldSkipExternalTests)('makes successful POST request with JSON body', async () => {
      const postData = { name: 'test', value: 123 }

      const result = await httpRequest.invoke({
        method: 'POST',
        url: 'https://httpbin.org/post',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postData),
      })

      expect(result.status).toBe(200)
      const body = JSON.parse(result.body)
      expect(body.json).toEqual(postData)
    })

    it.skipIf(shouldSkipExternalTests)('throws error for 404 Not Found', async () => {
      await expect(
        httpRequest.invoke({
          method: 'GET',
          url: 'https://httpbin.org/status/404',
        })
      ).rejects.toThrow('HTTP 404')
    })

    it.skipIf(shouldSkipExternalTests)(
      'throws error for timeout',
      async () => {
        await expect(
          httpRequest.invoke({
            method: 'GET',
            url: 'https://httpbin.org/delay/5',
            timeout: 1, // 1 second timeout
          })
        ).rejects.toThrow('Request timed out')
      },
      10000
    ) // Test timeout of 10 seconds
  })
})
