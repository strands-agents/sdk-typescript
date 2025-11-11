import { describe, expect, it } from 'vitest'
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
        type: 'toolResultBlock',
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
        type: 'toolResultBlock',
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

    it('prints comprehensive scenario with all output types', async () => {
      const model = new MockMessageModel()
        .addTurn([
          { type: 'textBlock', text: 'Let me help you. ' },
          { type: 'reasoningBlock', text: 'I need to use the calculator' },
          { type: 'toolUseBlock', name: 'calculator', toolUseId: 'tool-1', input: { expr: '2+2' } },
        ])
        .addTurn([
          { type: 'textBlock', text: 'The calculation succeeded. ' },
          { type: 'reasoningBlock', text: 'Now trying validation' },
          { type: 'toolUseBlock', name: 'validator', toolUseId: 'tool-2', input: { value: 'test' } },
        ])
        .addTurn([
          { type: 'textBlock', text: 'All done. ' },
          { type: 'reasoningBlock', text: 'Task completed successfully' },
        ])

      const calcTool = createMockTool('calculator', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-1',
        status: 'success' as const,
        content: [new TextBlock('4')],
      }))

      const validatorTool = createMockTool('validator', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-2',
        status: 'error' as const,
        content: [new TextBlock('Validation failed')],
      }))

      const outputs: string[] = []
      const mockAppender = (text: string) => outputs.push(text)

      const agent = new Agent({ model, tools: [calcTool, validatorTool], printer: false })
      ;(agent as any)._printer = new AgentPrinter(mockAppender)

      await collectGenerator(agent.stream('Test'))

      const allOutput = outputs.join('')
      const expected = `Let me help you. <reason>I need to use the calculator</reason>
🔧 Tool #1: calculator
✓ Tool completed
The calculation succeeded. <reason>Now trying validation</reason>
🔧 Tool #2: validator
✗ Tool failed
All done. <reason>Task completed successfully</reason>`

      expect(allOutput).toBe(expected)
    })
  })
})
