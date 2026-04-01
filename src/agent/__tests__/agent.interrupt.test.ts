import { describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'
import { BeforeToolCallEvent, BeforeToolsEvent } from '../../hooks/events.js'
import { FunctionTool } from '../../tools/function-tool.js'
import type { InvokeArgs } from '../../types/agent.js'

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

  describe('resume flow - interrupt → response → continue', () => {
    it('resumes tool callback execution with user response after interrupt', async () => {
      // Turn 0: Model returns tool use (interrupted)
      // Turn 1: Model returns same tool use again (on resume)
      // Turn 2: Model returns final response
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'confirmTool',
          toolUseId: 'tool-1',
          input: { amount: 5000 },
        })
        .addTurn({
          type: 'toolUseBlock',
          name: 'confirmTool',
          toolUseId: 'tool-2',
          input: { amount: 5000 },
        })
        .addTurn({ type: 'textBlock', text: 'Transfer completed' })

      let receivedResponse: unknown
      const tool = new FunctionTool({
        name: 'confirmTool',
        description: 'Tool that requires confirmation',
        inputSchema: {
          type: 'object',
          properties: { amount: { type: 'number' } },
        },
        callback: (rawInput, context) => {
          const input = rawInput as { amount: number }
          const response = context.interrupt({
            name: 'confirm_transfer',
            reason: `Confirm transfer of $${input.amount}?`,
          })
          receivedResponse = response
          return (response as { approved: boolean })?.approved ? 'Transfer approved' : 'Transfer denied'
        },
      })

      const agent = new Agent({ model, tools: [tool], printer: false })

      // First invocation - triggers interrupt
      const interruptResult = await agent.invoke('Transfer $5000')

      expect(interruptResult.stopReason).toBe('interrupt')
      expect(interruptResult.interrupts).toHaveLength(1)
      expect(interruptResult.interrupts?.[0]?.name).toBe('confirm_transfer')

      // Resume with user response (cast to InvokeArgs since interrupt responses are accepted via duck typing)
      const finalResult = await agent.invoke([
        {
          interruptResponse: {
            interruptId: interruptResult.interrupts![0]!.id,
            response: { approved: true },
          },
        },
      ] as unknown as InvokeArgs)

      expect(finalResult.stopReason).toBe('endTurn')
      expect(receivedResponse).toEqual({ approved: true })

      // Verify tool result was added to messages
      const toolResultMessage = agent.messages.find(
        (m) => m.role === 'user' && m.content.some((b) => b.type === 'toolResultBlock')
      )
      expect(toolResultMessage).toBeDefined()
      const toolResult = toolResultMessage?.content.find((b) => b.type === 'toolResultBlock') as
        | ToolResultBlock
        | undefined
      expect(toolResult?.content[0]).toMatchObject({ type: 'textBlock', text: 'Transfer approved' })
    })

    it('clears interrupt state when resuming with new user message instead of interrupt response', async () => {
      // Turn 0: First call with tool use (interrupted)
      // Turn 1: Second call - new user message means fresh start, model returns text response
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'confirmTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Different response' })

      const tool = new FunctionTool({
        name: 'confirmTool',
        description: 'Tool that requires confirmation',
        callback: (_, context) => {
          context.interrupt({ name: 'confirm', reason: 'Confirm?' })
          return 'not reached'
        },
      })

      const agent = new Agent({ model, tools: [tool], printer: false })

      // First invocation - triggers interrupt
      const interruptResult = await agent.invoke('First message')
      expect(interruptResult.stopReason).toBe('interrupt')

      // Instead of resuming with interrupt response, send a new message
      // This should clear the interrupt state and start fresh
      // Model returns text response (endTurn), not another tool use
      const newResult = await agent.invoke('Different question')

      // Since we sent a new message (not interrupt responses), the interrupt state is cleared
      // Model returns text, so we get endTurn
      expect(newResult.stopReason).toBe('endTurn')
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
