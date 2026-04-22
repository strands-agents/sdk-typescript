import { describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { ToolResultBlock } from '../../types/messages.js'
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

      const tool = createMockTool('confirmTool', (context) => {
        context.interrupt({ name: 'confirm', reason: 'Please confirm' })
      })

      const agent = new Agent({ model, tools: [tool], printer: false })
      const result = await agent.invoke('Test')

      expect(result).toMatchObject({
        stopReason: 'interrupt',
        interrupts: [{ name: 'confirm', reason: 'Please confirm' }],
      })
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

      const tool = createMockTool('testTool', () => 'Success')

      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolCallEvent, (event) => {
        if (event.toolUse.name === 'testTool') {
          event.interrupt({ name: 'confirm_tool', reason: 'Confirm tool execution?' })
        }
      })

      const result = await agent.invoke('Test')

      expect(result).toMatchObject({
        stopReason: 'interrupt',
        interrupts: [{ name: 'confirm_tool', reason: 'Confirm tool execution?' }],
      })
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

      const tool = createMockTool('testTool', () => 'Success')

      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolsEvent, (event) => {
        event.interrupt({ name: 'batch_approval', reason: 'Approve all tools?' })
      })

      const result = await agent.invoke('Test')

      expect(result).toMatchObject({
        stopReason: 'interrupt',
        interrupts: [{ name: 'batch_approval', reason: 'Approve all tools?' }],
      })
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

      expect(interruptResult).toMatchObject({
        stopReason: 'interrupt',
        interrupts: [{ name: 'confirm_transfer', reason: 'Confirm transfer of $5000?' }],
      })
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
      ])

      expect(finalResult.stopReason).toBe('endTurn')
      expect(receivedResponse).toEqual({ approved: true })
      expect(callCount).toBe(2)
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

      const toolA = createMockTool('toolA', () => {
        executionLog.push('A')
        return 'A result'
      })

      const toolB = createMockTool('toolB', () => {
        executionLog.push('B')
        return 'B result'
      })

      const toolC = createMockTool('toolC', (context) => {
        const response = context.interrupt({
          name: 'confirm_c',
          reason: 'Confirm tool C?',
        })
        executionLog.push('C')
        return (response as { approved: boolean })?.approved ? 'C approved' : 'C denied'
      })

      const agent = new Agent({ model, tools: [toolA, toolB, toolC], printer: false })

      // First invocation - A & B execute, C interrupts
      const interruptResult = await agent.invoke('Run all tools')

      expect(interruptResult).toMatchObject({
        stopReason: 'interrupt',
        interrupts: [{ name: 'confirm_c', reason: 'Confirm tool C?' }],
      })
      expect(executionLog).toEqual(['A', 'B'])
      expect(model.callCount).toBe(1)

      // Resume with response for C
      const finalResult = await agent.invoke([
        {
          interruptResponse: {
            interruptId: interruptResult.interrupts![0]!.id,
            response: { approved: true },
          },
        },
      ])

      expect(finalResult.stopReason).toBe('endTurn')
      expect(executionLog).toEqual(['A', 'B', 'C'])
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

      const tool = createMockTool('confirmTool', (context) => {
        context.interrupt({ name: 'confirm', reason: 'Confirm?' })
      })

      const agent = new Agent({ model, tools: [tool], printer: false })

      // First invocation - triggers interrupt
      const interruptResult = await agent.invoke('First message')
      expect(interruptResult).toMatchObject({ stopReason: 'interrupt' })

      // Instead of resuming with interrupt response, send a new message
      // This should clear the interrupt state and start fresh
      // Model returns text response (endTurn), not another tool use
      const newResult = await agent.invoke('Different question')

      // Since we sent a new message (not interrupt responses), the interrupt state is cleared
      expect(newResult).toMatchObject({ stopReason: 'endTurn' })
    })
  })

  describe('error handling', () => {
    it('throws error when interrupt() called on event with non-Agent implementation', async () => {
      const mockLocalAgent = { id: 'mock' } as unknown as Agent
      const event = new BeforeToolCallEvent({
        agent: mockLocalAgent,
        toolUse: { name: 'test', toolUseId: 'id', input: {} },
        tool: undefined,
      })

      expect(() => {
        event.interrupt({ name: 'test', reason: 'test' })
      }).toThrow('Interrupt state not available')
    })

    it('throws TypeError when interrupt responses are mixed with other content blocks', async () => {
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'confirmTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('confirmTool', (context) => {
        context.interrupt({ name: 'confirm', reason: 'Confirm?' })
      })

      const agent = new Agent({ model, tools: [tool], printer: false })

      // First invocation - triggers interrupt
      const interruptResult = await agent.invoke('Test')
      expect(interruptResult.stopReason).toBe('interrupt')

      // Resume with mixed content: interrupt response + text block
      await expect(
        agent.invoke([
          {
            interruptResponse: {
              interruptId: interruptResult.interrupts![0]!.id,
              response: 'yes',
            },
          },
          { type: 'textBlock', text: 'extra text' },
        ] as any)
      ).rejects.toThrow(TypeError)

      await expect(
        agent.invoke([
          {
            interruptResponse: {
              interruptId: interruptResult.interrupts![0]!.id,
              response: 'yes',
            },
          },
          { type: 'textBlock', text: 'extra text' },
        ] as any)
      ).rejects.toThrow('Must resume from interrupt with a list of interruptResponse content blocks only')
    })

    it('allows pure interrupt response arrays without error', async () => {
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'confirmTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('confirmTool', (context) => {
        const response = context.interrupt({ name: 'confirm', reason: 'Confirm?' })
        return `Got: ${response}`
      })

      const agent = new Agent({ model, tools: [tool], printer: false })

      const interruptResult = await agent.invoke('Test')
      expect(interruptResult.stopReason).toBe('interrupt')

      // Resume with pure interrupt responses — should succeed
      const finalResult = await agent.invoke([
        {
          interruptResponse: {
            interruptId: interruptResult.interrupts![0]!.id,
            response: 'approved',
          },
        },
      ])

      expect(finalResult.stopReason).toBe('endTurn')
    })
  })

  describe('multiple hook interrupts', () => {
    it('collects interrupts from multiple BeforeToolCallEvent hooks', async () => {
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'testTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Should not reach this' })

      const tool = createMockTool('testTool', () => 'Success')

      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolCallEvent, (event) => {
        event.interrupt({ name: 'security_check', reason: 'Security review required' })
      })
      agent.addHook(BeforeToolCallEvent, (event) => {
        event.interrupt({ name: 'budget_check', reason: 'Budget approval required' })
      })

      const result = await agent.invoke('Test')

      expect(result).toMatchObject({
        stopReason: 'interrupt',
        interrupts: expect.arrayContaining([
          expect.objectContaining({ name: 'security_check', reason: 'Security review required' }),
          expect.objectContaining({ name: 'budget_check', reason: 'Budget approval required' }),
        ]),
      })
    })

    it('collects interrupts from multiple BeforeToolsEvent hooks', async () => {
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'testTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'Should not reach this' })

      const tool = createMockTool('testTool', () => 'Success')

      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolsEvent, (event) => {
        event.interrupt({ name: 'approval_a', reason: 'First approval' })
      })
      agent.addHook(BeforeToolsEvent, (event) => {
        event.interrupt({ name: 'approval_b', reason: 'Second approval' })
      })

      const result = await agent.invoke('Test')

      expect(result).toMatchObject({
        stopReason: 'interrupt',
        interrupts: expect.arrayContaining([
          expect.objectContaining({ name: 'approval_a', reason: 'First approval' }),
          expect.objectContaining({ name: 'approval_b', reason: 'Second approval' }),
        ]),
      })
    })

    it('resumes correctly after multiple interrupts are answered', async () => {
      const model = new MockMessageModel()
        .addTurn({
          type: 'toolUseBlock',
          name: 'testTool',
          toolUseId: 'tool-1',
          input: {},
        })
        .addTurn({ type: 'textBlock', text: 'All approved' })

      let securityResponse: unknown
      let budgetResponse: unknown
      let hookCallCount = 0

      const tool = createMockTool('testTool', () => 'Success')

      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolCallEvent, (event) => {
        hookCallCount++
        securityResponse = event.interrupt({ name: 'security_check', reason: 'Security review' })
      })
      agent.addHook(BeforeToolCallEvent, (event) => {
        hookCallCount++
        budgetResponse = event.interrupt({ name: 'budget_check', reason: 'Budget review' })
      })

      // First invocation — both hooks interrupt
      const interruptResult = await agent.invoke('Test')
      expect(interruptResult).toMatchObject({
        stopReason: 'interrupt',
        interrupts: expect.arrayContaining([
          expect.objectContaining({ name: 'security_check' }),
          expect.objectContaining({ name: 'budget_check' }),
        ]),
      })
      expect(interruptResult.interrupts).toHaveLength(2)
      expect(hookCallCount).toBe(2)
      expect(model.callCount).toBe(1)

      // Resume with responses for both interrupts
      const finalResult = await agent.invoke(
        interruptResult.interrupts!.map((interrupt) => ({
          interruptResponse: {
            interruptId: interrupt.id,
            response: `approved:${interrupt.name}`,
          },
        }))
      )

      expect(finalResult.stopReason).toBe('endTurn')
      expect(model.callCount).toBe(2)
      expect(securityResponse).toBe('approved:security_check')
      expect(budgetResponse).toBe('approved:budget_check')
    })
  })

  describe('multi-cycle interrupts', () => {
    it('interrupts again on cycle 2 after resuming from cycle 1 (BeforeToolsEvent)', async () => {
      // Cycle 1: model returns tool use → hook interrupts → user resumes → tool executes
      // Cycle 2: model returns another tool use → same hook should interrupt again
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-2', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('testTool', () => 'ok')

      let interruptCount = 0
      const agent = new Agent({ model, tools: [tool], printer: false })

      agent.addHook(BeforeToolsEvent, (event) => {
        interruptCount++
        event.interrupt({ name: 'approval', reason: 'Approve?' })
      })

      // Cycle 1: interrupt
      const result1 = await agent.invoke('Go')
      expect(result1).toMatchObject({
        stopReason: 'interrupt',
        interrupts: [{ name: 'approval', reason: 'Approve?' }],
      })
      expect(interruptCount).toBe(1)

      // Resume cycle 1
      const result2 = await agent.invoke(
        result1.interrupts!.map((i) => ({
          interruptResponse: { interruptId: i.id, response: 'yes' },
        }))
      )

      // Cycle 2: should interrupt again, not silently pass through
      expect(result2).toMatchObject({ stopReason: 'interrupt' })
      expect(interruptCount).toBe(3)
    })
  })
})
