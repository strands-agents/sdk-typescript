import { describe, it, expect } from 'vitest'
import { AgentPrinter } from '../printer.js'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock } from '../../types/messages.js'

describe('AgentPrinter', () => {
  describe('end-to-end scenarios', () => {
    it('prints simple text output', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello world' })

      const outputs: string[] = []
      const mockAppender = (text: string) => outputs.push(text)

      const agent = new Agent({ model, printer: false })
      ;(agent as any)._printer = new AgentPrinter(mockAppender)

      await collectGenerator(agent.stream('Test'))

      const allOutput = outputs.join('')
      expect(allOutput).toBe('Hello world')
    })

    it('prints reasoning content wrapped in tags', async () => {
      const model = new MockMessageModel().addTurn({ type: 'reasoningBlock', text: 'Let me think' })

      const outputs: string[] = []
      const mockAppender = (text: string) => outputs.push(text)

      const agent = new Agent({ model, printer: false })
      ;(agent as any)._printer = new AgentPrinter(mockAppender)

      await collectGenerator(agent.stream('Test'))

      const allOutput = outputs.join('')
      expect(allOutput).toBe('<reason>Let me think</reason>')
    })

    it('prints text and reasoning together', async () => {
      const model = new MockMessageModel().addTurn([
        { type: 'textBlock', text: 'Answer: ' },
        { type: 'reasoningBlock', text: 'thinking' },
      ])

      const outputs: string[] = []
      const mockAppender = (text: string) => outputs.push(text)

      const agent = new Agent({ model, printer: false })
      ;(agent as any)._printer = new AgentPrinter(mockAppender)

      await collectGenerator(agent.stream('Test'))

      const allOutput = outputs.join('')
      expect(allOutput).toBe('Answer: <reason>thinking</reason>')
    })

    it('prints tool execution', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'calc', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Result: 4' })

      const tool = createMockTool('calc', () => ({
        toolUseId: 'tool-1',
        status: 'success' as const,
        content: [new TextBlock('4')],
      }))

      const outputs: string[] = []
      const mockAppender = (text: string) => outputs.push(text)

      const agent = new Agent({ model, tools: [tool], printer: false })
      ;(agent as any)._printer = new AgentPrinter(mockAppender)

      await collectGenerator(agent.stream('Test'))

      const allOutput = outputs.join('')
      expect(allOutput).toBe('\n🔧 Tool #1: calc\n✓ Tool completed\nResult: 4')
    })

    it('prints tool error', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'bad_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Error handled' })

      const tool = createMockTool('bad_tool', () => ({
        toolUseId: 'tool-1',
        status: 'error' as const,
        content: [new TextBlock('Failed')],
      }))

      const outputs: string[] = []
      const mockAppender = (text: string) => outputs.push(text)

      const agent = new Agent({ model, tools: [tool], printer: false })
      ;(agent as any)._printer = new AgentPrinter(mockAppender)

      await collectGenerator(agent.stream('Test'))

      const allOutput = outputs.join('')
      expect(allOutput).toBe('\n🔧 Tool #1: bad_tool\n✗ Tool failed\nError handled')
    })
  })
})
