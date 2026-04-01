import { describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'
import { BeforeToolCallEvent, BeforeToolsEvent } from '../../hooks/events.js'
import { FunctionTool } from '../../tools/function-tool.js'

describe('Agent interrupt system', () => {
  describe('interrupt from tool callback', () => {
    it('returns stopReason interrupt when tool calls interrupt()', async () => {
      // Model returns tool use first, then text block (following standard test pattern)
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'confirmTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Should not reach this' })

      const tool = new FunctionTool({
        name: 'confirmTool',
        description: 'Tool that requires confirmation',
        callback: (_, context) => {
          context.interrupt({ name: 'confirm', reason: 'Please confirm' })
          return 'not reached'
        },
      })

      const agent = new Agent({ model, tools: [tool], printer: false })
      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toBeDefined()
      expect(result.interrupts).toHaveLength(1)
      expect(result.interrupts?.[0]?.name).toBe('confirm')
      expect(result.interrupts?.[0]?.reason).toBe('Please confirm')
    })
  })

  describe('interrupt from BeforeToolCallEvent hook', () => {
    it('returns stopReason interrupt when hook calls interrupt()', async () => {
      // Model returns tool use first, then text block (following standard test pattern)
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'testTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Should not reach this' })

      const tool = createMockTool(
        'testTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('Success')],
          })
      )

      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolCallEvent, (event) => {
        if (event.toolUse.name === 'testTool') {
          event.interrupt({ name: 'confirm_tool', reason: 'Confirm tool execution?' })
        }
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toHaveLength(1)
      expect(result.interrupts?.[0]?.name).toBe('confirm_tool')
    })
  })

  describe('interrupt from BeforeToolsEvent hook', () => {
    it('returns stopReason interrupt when hook calls interrupt()', async () => {
      // Model returns tool use first, then text block (following standard test pattern)
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'testTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Should not reach this' })

      const tool = createMockTool(
        'testTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('Success')],
          })
      )

      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolsEvent, (event) => {
        event.interrupt({ name: 'batch_approval', reason: 'Approve all tools?' })
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toHaveLength(1)
      expect(result.interrupts?.[0]?.name).toBe('batch_approval')
    })
  })

  describe('error handling', () => {
    it('throws error when interrupt() called without interrupt state', async () => {
      const event = new BeforeToolCallEvent({
        agent: new Agent({ printer: false }),
        toolUse: { name: 'test', toolUseId: 'id', input: {} },
        tool: undefined,
      })

      expect(() => {
        event.interrupt({ name: 'test', reason: 'test' })
      }).toThrow('Interrupt state not available')
    })
  })
})
