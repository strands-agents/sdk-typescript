import { describe, expect, it, vi } from 'vitest'
import { AgentTool } from '../agent-tool.js'
import type { AgentToolConfig } from '../agent-tool.js'
import { Tool } from '../tool.js'
import { createMockContext } from '../../__fixtures__/tool-helpers.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'

/**
 * Creates a mock agent for testing AgentTool.
 *
 * @param response - The text response the mock agent should return
 * @param options - Optional overrides for the mock agent result
 * @returns A mock agent-like object
 */
function createMockAgent(
  response: string,
  options?: { stopReason?: string; throwError?: Error }
): AgentToolConfig['agent'] {
  return {
    invoke: vi.fn().mockImplementation(async () => {
      if (options?.throwError) {
        throw options.throwError
      }
      return {
        stopReason: options?.stopReason ?? 'endTurn',
        lastMessage: {
          content: [{ type: 'textBlock', text: response }],
        },
        toString: () => response,
      }
    }),
  }
}

describe('AgentTool', () => {
  describe('constructor', () => {
    it('creates tool with provided config', () => {
      const agent = createMockAgent('hello')
      const tool = new AgentTool({
        name: 'test-agent',
        description: 'A test agent tool',
        agent,
      })

      expect(tool.name).toBe('test-agent')
      expect(tool.description).toBe('A test agent tool')
    })

    it('builds toolSpec from config', () => {
      const agent = createMockAgent('hello')
      const tool = new AgentTool({
        name: 'my-agent',
        description: 'My agent description',
        agent,
      })

      expect(tool.toolSpec).toStrictEqual({
        name: 'my-agent',
        description: 'My agent description',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt or instruction to send to the agent',
            },
          },
          required: ['prompt'],
        },
      })
    })

    it('uses custom inputSchema when provided', () => {
      const agent = createMockAgent('hello')
      const customSchema = {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: 'Search query' },
          maxResults: { type: 'number' as const },
        },
        required: ['query'],
      }

      const tool = new AgentTool({
        name: 'search-agent',
        description: 'Searches for information',
        agent,
        inputSchema: customSchema,
      })

      expect(tool.toolSpec.inputSchema).toStrictEqual(customSchema)
    })

    it('is an instance of Tool', () => {
      const agent = createMockAgent('hello')
      const tool = new AgentTool({
        name: 'test-agent',
        description: 'A test agent tool',
        agent,
      })

      expect(tool instanceof Tool).toBe(true)
    })

    it('has matching name and toolSpec.name', () => {
      const agent = createMockAgent('hello')
      const tool = new AgentTool({
        name: 'my-tool',
        description: 'Test',
        agent,
      })

      expect(tool.name).toBe(tool.toolSpec.name)
    })

    it('has matching description and toolSpec.description', () => {
      const agent = createMockAgent('hello')
      const tool = new AgentTool({
        name: 'my-tool',
        description: 'Test description',
        agent,
      })

      expect(tool.description).toBe(tool.toolSpec.description)
    })
  })

  describe('stream', () => {
    describe('input extraction', () => {
      it('extracts prompt from object with prompt field', async () => {
        const agent = createMockAgent('response')
        const tool = new AgentTool({
          name: 'test-agent',
          description: 'Test',
          agent,
        })

        const context = createMockContext({
          name: 'test-agent',
          toolUseId: 'tool-1',
          input: { prompt: 'Hello, agent!' },
        })

        await collectGenerator(tool.stream(context))

        expect(agent.invoke).toHaveBeenCalledWith('Hello, agent!')
      })

      it('serializes non-prompt objects to JSON', async () => {
        const agent = createMockAgent('response')
        const tool = new AgentTool({
          name: 'test-agent',
          description: 'Test',
          agent,
        })

        const input = { query: 'search term', maxResults: 5 }
        const context = createMockContext({
          name: 'test-agent',
          toolUseId: 'tool-2',
          input,
        })

        await collectGenerator(tool.stream(context))

        expect(agent.invoke).toHaveBeenCalledWith(JSON.stringify(input))
      })

      it('handles string input directly', async () => {
        const agent = createMockAgent('response')
        const tool = new AgentTool({
          name: 'test-agent',
          description: 'Test',
          agent,
        })

        const context = createMockContext({
          name: 'test-agent',
          toolUseId: 'tool-3',
          input: 'direct string input',
        })

        await collectGenerator(tool.stream(context))

        expect(agent.invoke).toHaveBeenCalledWith('direct string input')
      })
    })

    describe('successful execution', () => {
      it('returns agent response as ToolResultBlock', async () => {
        const agent = createMockAgent('The answer is 42')
        const tool = new AgentTool({
          name: 'calculator',
          description: 'Calculates things',
          agent,
        })

        const context = createMockContext({
          name: 'calculator',
          toolUseId: 'calc-1',
          input: { prompt: 'What is 6 * 7?' },
        })

        const { items: streamEvents, result } = await collectGenerator(tool.stream(context))

        expect(streamEvents).toHaveLength(0)
        expect(result).toEqual({
          type: 'toolResultBlock',
          toolUseId: 'calc-1',
          status: 'success',
          content: [
            expect.objectContaining({
              type: 'textBlock',
              text: 'The answer is 42',
            }),
          ],
        })
      })

      it('does not yield stream events', async () => {
        const agent = createMockAgent('result')
        const tool = new AgentTool({
          name: 'test-agent',
          description: 'Test',
          agent,
        })

        const context = createMockContext({
          name: 'test-agent',
          toolUseId: 'tool-4',
          input: { prompt: 'test' },
        })

        const { items: streamEvents } = await collectGenerator(tool.stream(context))

        expect(streamEvents).toHaveLength(0)
      })
    })

    describe('error handling', () => {
      it('returns error ToolResultBlock when agent throws', async () => {
        const agent = createMockAgent('', { throwError: new Error('Agent invocation failed') })
        const tool = new AgentTool({
          name: 'failing-agent',
          description: 'An agent that fails',
          agent,
        })

        const context = createMockContext({
          name: 'failing-agent',
          toolUseId: 'fail-1',
          input: { prompt: 'test' },
        })

        const { result } = await collectGenerator(tool.stream(context))

        expect(result).toEqual({
          type: 'toolResultBlock',
          toolUseId: 'fail-1',
          status: 'error',
          content: [
            expect.objectContaining({
              type: 'textBlock',
              text: 'Error: Agent invocation failed',
            }),
          ],
          error: expect.any(Error),
        })
      })

      it('handles non-Error thrown values', async () => {
        const agent = {
          invoke: vi.fn().mockRejectedValue('string error'),
        }
        const tool = new AgentTool({
          name: 'string-throw-agent',
          description: 'Test',
          agent,
        })

        const context = createMockContext({
          name: 'string-throw-agent',
          toolUseId: 'fail-2',
          input: { prompt: 'test' },
        })

        const { result } = await collectGenerator(tool.stream(context))

        expect(result.status).toBe('error')
        expect(result.error).toBeInstanceOf(Error)
      })
    })
  })
})
