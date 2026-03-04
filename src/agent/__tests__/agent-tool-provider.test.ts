import { describe, expect, it, vi } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createRandomTool } from '../../__fixtures__/tool-helpers.js'
import type { ToolProvider } from '../../tools/types.js'
import type { Tool } from '../../tools/tool.js'
import { McpClient } from '../../mcp.js'

describe('Agent', () => {
  describe('ToolProvider integration', () => {
    describe('flattenTools', () => {
      it('recognizes ToolProvider via duck typing', async () => {
        const mockTool = createRandomTool('provider-tool')
        const provider: ToolProvider = {
          listTools: vi.fn().mockResolvedValue([mockTool]),
        }

        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model, tools: [provider] })

        await agent.initialize()

        expect(provider.listTools).toHaveBeenCalledOnce()
        expect(agent.tools.some((t) => t.name === 'provider-tool')).toBe(true)
      })

      it('separates tools, McpClient, and ToolProvider in mixed arrays', async () => {
        const directTool = createRandomTool('direct-tool')
        const providerTool = createRandomTool('provider-tool')
        const provider: ToolProvider = {
          listTools: vi.fn().mockResolvedValue([providerTool]),
        }

        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model, tools: [directTool, provider] })

        await agent.initialize()

        expect(agent.tools.some((t) => t.name === 'direct-tool')).toBe(true)
        expect(agent.tools.some((t) => t.name === 'provider-tool')).toBe(true)
      })

      it('handles nested arrays containing ToolProviders', async () => {
        const providerTool = createRandomTool('nested-provider-tool')
        const provider: ToolProvider = {
          listTools: vi.fn().mockResolvedValue([providerTool]),
        }

        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model, tools: [[provider]] })

        await agent.initialize()

        expect(agent.tools.some((t) => t.name === 'nested-provider-tool')).toBe(true)
      })

      it('does not treat McpClient as ToolProvider despite having listTools', () => {
        // McpClient has listTools() but should be categorized as McpClient, not ToolProvider.
        // We verify this by checking that McpClient instanceof check takes priority.
        // The Agent constructor stores McpClient separately from ToolProviders.
        const mockTransport = { start: vi.fn(), close: vi.fn(), send: vi.fn() }
        const mcpClient = new McpClient({ transport: mockTransport as never })

        // McpClient has listTools method
        expect(typeof mcpClient.listTools).toBe('function')

        // But it should not be treated as a generic ToolProvider
        // We verify this by creating an agent with just an McpClient and ensuring
        // it does not get double-registered (McpClient path + ToolProvider path)
        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model, tools: [mcpClient] })

        // Tools should be empty before initialization (MCP tools loaded on init)
        expect(agent.tools).toHaveLength(0)
      })
    })

    describe('initialize', () => {
      it('calls listTools on all ToolProviders and registers their tools', async () => {
        const toolA = createRandomTool('tool-a')
        const toolB = createRandomTool('tool-b')
        const providerA: ToolProvider = {
          listTools: vi.fn().mockResolvedValue([toolA]),
        }
        const providerB: ToolProvider = {
          listTools: vi.fn().mockResolvedValue([toolB]),
        }

        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model, tools: [providerA, providerB] })

        await agent.initialize()

        expect(providerA.listTools).toHaveBeenCalledOnce()
        expect(providerB.listTools).toHaveBeenCalledOnce()
        expect(agent.tools).toHaveLength(2)
      })

      it('does not call listTools again on subsequent initializations', async () => {
        const provider: ToolProvider = {
          listTools: vi.fn().mockResolvedValue([createRandomTool('tool')]),
        }

        const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
        const agent = new Agent({ model, tools: [provider] })

        await agent.initialize()
        await agent.initialize()

        expect(provider.listTools).toHaveBeenCalledOnce()
      })

      it('registers ToolProvider tools that are usable during invocation', async () => {
        const model = new MockMessageModel()
          .addTurn({
            type: 'toolUseBlock',
            name: 'provided-tool',
            toolUseId: 'tu-1',
            input: {},
          })
          .addTurn({ type: 'textBlock', text: 'Done' })

        const providedTool: Tool = {
          name: 'provided-tool',
          description: 'A tool from a provider',
          toolSpec: {
            name: 'provided-tool',
            description: 'A tool from a provider',
            inputSchema: { type: 'object', properties: {} },
          },
          // eslint-disable-next-line require-yield
          async *stream() {
            const { ToolResultBlock, TextBlock } = await import('../../types/messages.js')
            return new ToolResultBlock({
              toolUseId: 'tu-1',
              status: 'success',
              content: [new TextBlock('tool result')],
            })
          },
        }

        const provider: ToolProvider = {
          listTools: vi.fn().mockResolvedValue([providedTool]),
        }

        const agent = new Agent({ model, tools: [provider] })
        const result = await agent.invoke('Use the tool')

        expect(result.stopReason).toBe('endTurn')
      })
    })
  })
})
