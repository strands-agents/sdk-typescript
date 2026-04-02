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
    it('resumes tool callback execution without re-calling model', async () => {
      // Turn 0: Model returns tool use (will be interrupted)
      // Turn 1: Model returns final response (after tool completes on resume)
      // Note: Resume skips model call and uses stored message
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'confirmTool',
          toolUseId: 'tool-1',
          input: { amount: 5000 },
        })
        .addTurn({ type: 'textBlock', text: 'Transfer completed' })

      let callCount = 0
      let receivedResponse: unknown
      const tool = new FunctionTool({
        name: 'confirmTool',
        description: 'Tool that requires confirmation',
        inputSchema: {
          type: 'object',
          properties: { amount: { type: 'number' } },
        },
        callback: (rawInput, context) => {
          callCount++
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
      expect(callCount).toBe(1) // Tool was called once before interrupt
      expect(model.callCount).toBe(1) // Model was called once

      // Resume with user response
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
      expect(callCount).toBe(2) // Tool was called again on resume (same tool use)
      // Model call count: 1 (initial) + 0 (resume skips model) + 1 (post-tool-result) = 2
      expect(model.callCount).toBe(2)

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

    it('skips already-completed tools when resuming from partial execution', async () => {
      // Scenario: Tools A, B, C where A & B succeed but C interrupts
      // On resume: A & B should NOT re-execute, only C should execute
      const model = new MockMessageModel()
        .addTurn([
          { type: 'toolUseBlock', name: 'toolA', toolUseId: 'tool-a', input: {} },
          { type: 'toolUseBlock', name: 'toolB', toolUseId: 'tool-b', input: {} },
          { type: 'toolUseBlock', name: 'toolC', toolUseId: 'tool-c', input: {} },
        ])
        .addTurn({ type: 'textBlock', text: 'All tools completed' })

      const executionLog: string[] = []

      const toolA = new FunctionTool({
        name: 'toolA',
        description: 'Tool A',
        callback: () => {
          executionLog.push('A')
          return 'A result'
        },
      })

      const toolB = new FunctionTool({
        name: 'toolB',
        description: 'Tool B',
        callback: () => {
          executionLog.push('B')
          return 'B result'
        },
      })

      const toolC = new FunctionTool({
        name: 'toolC',
        description: 'Tool C that requires confirmation',
        callback: (_, context) => {
          const response = context.interrupt({
            name: 'confirm_c',
            reason: 'Confirm tool C?',
          })
          executionLog.push('C')
          return (response as { approved: boolean })?.approved ? 'C approved' : 'C denied'
        },
      })

      const agent = new Agent({ model, tools: [toolA, toolB, toolC], printer: false })

      // First invocation - A & B execute, C interrupts
      const interruptResult = await agent.invoke('Run all tools')

      expect(interruptResult.stopReason).toBe('interrupt')
      expect(interruptResult.interrupts?.[0]?.name).toBe('confirm_c')
      expect(executionLog).toEqual(['A', 'B']) // A and B executed, C interrupted before completing
      expect(model.callCount).toBe(1) // Model called once for initial invocation

      // Resume with response for C
      const finalResult = await agent.invoke([
        {
          interruptResponse: {
            interruptId: interruptResult.interrupts![0]!.id,
            response: { approved: true },
          },
        },
      ] as unknown as InvokeArgs)

      expect(finalResult.stopReason).toBe('endTurn')
      // A and B should NOT have re-executed, only C should have completed
      expect(executionLog).toEqual(['A', 'B', 'C'])
      // Model call count: 1 (initial) + 0 (resume skips model) + 1 (post-tool-result) = 2
      expect(model.callCount).toBe(2)

      // Verify all tool results are present in messages
      const toolResultMessage = agent.messages.find(
        (m) => m.role === 'user' && m.content.filter((b) => b.type === 'toolResultBlock').length === 3
      )
      expect(toolResultMessage).toBeDefined()
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
