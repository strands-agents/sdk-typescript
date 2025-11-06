import { describe, it, expect, beforeEach } from 'vitest'

// Import from vended_tools, not from main SDK
// eslint-disable-next-line no-restricted-imports
import { httpRequest } from '../vended_tools/http-request'
// eslint-disable-next-line no-restricted-imports
import type { ToolContext } from '../src/tools/tool'
// eslint-disable-next-line no-restricted-imports
import { collectGenerator } from '../src/__fixtures__/model-test-helpers'

describe('httpRequest integration', () => {
  // Set bypass consent for integration tests
  beforeEach(() => {
    process.env.BYPASS_TOOL_CONSENT = 'true'
  })

  describe('real HTTP requests', () => {
    it('executes GET request to strandsagents.com', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://strandsagents.com',
      }
      const toolUse = {
        name: 'httpRequest',
        toolUseId: 'integ-get-1',
        input,
      }
      const context: ToolContext = { toolUse, invocationState: {} }

      const { result } = await collectGenerator(httpRequest.stream(context))

      expect(result.status).toBe('success')
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0] && result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number; body: string }
        expect(response.status).toBe(200)
        expect(response.body).toBeTruthy()
      }
    }, 10000)

    it('executes GET request with custom headers to strandsagents.com', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://strandsagents.com',
        headers: {
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
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0] && result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number }
        expect(response.status).toBe(200)
      }
    }, 10000)
  })

  describe('error cases', () => {
    it('handles 404 Not Found on strandsagents.com', async () => {
      const input = {
        method: 'GET' as const,
        url: 'https://strandsagents.com/this-page-does-not-exist-404',
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
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'toolResultJsonContent')
      if (result.content[0] && result.content[0].type === 'toolResultJsonContent') {
        const response = result.content[0].json as { status: number }
        expect(response.status).toBe(404)
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
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.content[0]).toHaveProperty('type', 'toolResultTextContent')
    }, 10000)
  })
})
