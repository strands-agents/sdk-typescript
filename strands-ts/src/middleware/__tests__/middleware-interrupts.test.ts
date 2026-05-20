import { describe, expect, it } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { ExecuteToolStage, AgentStreamStage } from '../stages.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'
import { InterruptResponseContent } from '../../types/interrupt.js'
import type { ToolContext } from '../../tools/tool.js'

describe('Middleware interrupts', () => {
  describe('ExecuteToolStage', () => {
    it('middleware can raise an interrupt (agent stops with stopReason interrupt)', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'dangerousTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Should not reach' })

      const tool = createMockTool('dangerousTool', () => 'executed')
      const agent = new Agent({ model, tools: [tool], printer: false })

      // eslint-disable-next-line require-yield
      agent.addMiddleware(ExecuteToolStage, async function* (context, next) {
        context.interrupt({ name: 'approve_tool', reason: 'Confirm execution?' })
        return yield* next(context)
      })

      const result = await agent.invoke('Do the dangerous thing')

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toEqual([
        expect.objectContaining({ name: 'approve_tool', reason: 'Confirm execution?' }),
      ])
    })

    it('middleware gets response on resume and continues execution', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'dangerousTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      let toolExecuted = false
      const tool = createMockTool('dangerousTool', () => {
        toolExecuted = true
        return 'executed'
      })

      const agent = new Agent({ model, tools: [tool], printer: false })

      // eslint-disable-next-line require-yield
      agent.addMiddleware(ExecuteToolStage, async function* (context, next) {
        const approval = context.interrupt<string>({ name: 'approve_tool', reason: 'Confirm?' })
        if (approval !== 'yes') {
          return {
            result: new ToolResultBlock({
              toolUseId: context.toolUse.toolUseId,
              status: 'error',
              content: [new TextBlock('Denied by user')],
            }),
          }
        }
        return yield* next(context)
      })

      // First invocation: interrupt fires
      const interruptResult = await agent.invoke('Do it')
      expect(interruptResult.stopReason).toBe('interrupt')
      expect(toolExecuted).toBe(false)

      // Resume with approval
      const finalResult = await agent.invoke([
        new InterruptResponseContent({
          interruptId: interruptResult.interrupts![0]!.id,
          response: 'yes',
        }),
      ])

      expect(finalResult.stopReason).toBe('endTurn')
      expect(toolExecuted).toBe(true)
    })

    it('interrupt ID includes toolUseId for disambiguation', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'myTool', toolUseId: 'unique-tool-id', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('myTool', () => 'ok')
      const agent = new Agent({ model, tools: [tool], printer: false })

      // eslint-disable-next-line require-yield
      agent.addMiddleware(ExecuteToolStage, async function* (context, next) {
        context.interrupt({ name: 'check' })
        return yield* next(context)
      })

      const result = await agent.invoke('Test')

      expect(result.interrupts![0]!.id).toContain('unique-tool-id')
      expect(result.interrupts![0]!.id).toContain('check')
    })

    it('preemptive response skips the interrupt (no halt)', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'myTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      let toolExecuted = false
      const tool = createMockTool('myTool', () => {
        toolExecuted = true
        return 'ok'
      })

      const agent = new Agent({ model, tools: [tool], printer: false })

      // eslint-disable-next-line require-yield
      agent.addMiddleware(ExecuteToolStage, async function* (context, next) {
        // Preemptive response: returns immediately without halting
        const approval = context.interrupt<string>({ name: 'check', response: 'pre-approved' })
        expect(approval).toBe('pre-approved')
        return yield* next(context)
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('endTurn')
      expect(toolExecuted).toBe(true)
    })

    it('context spread preserves interrupt function', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'myTool', toolUseId: 'tool-1', input: { x: 1 } })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('myTool', () => 'ok')
      const agent = new Agent({ model, tools: [tool], printer: false })

      // eslint-disable-next-line require-yield
      agent.addMiddleware(ExecuteToolStage, async function* (context, next) {
        // Spread context to modify toolUse, interrupt should still work
        const modified = { ...context, toolUse: { ...context.toolUse, input: { x: 2 } } }
        modified.interrupt({ name: 'after_spread' })
        return yield* next(modified)
      })

      const result = await agent.invoke('Test')

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts![0]!.name).toBe('after_spread')
    })
  })

  describe('AgentStreamStage', () => {
    it('middleware can raise an interrupt (agent stops with stopReason interrupt)', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, printer: false })

      // eslint-disable-next-line require-yield
      agent.addMiddleware(AgentStreamStage, async function* (context) {
        context.interrupt({ name: 'confirm_stream', reason: 'Are you sure?' })
        // unreachable — interrupt() throws
        return undefined as never
      })

      const { result } = await collectGenerator(agent.stream('Test'))

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toEqual([
        expect.objectContaining({ name: 'confirm_stream', reason: 'Are you sure?' }),
      ])
    })

    it('middleware gets response on resume and continues', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, printer: false })

      agent.addMiddleware(AgentStreamStage, async function* (context, next) {
        const approval = context.interrupt<string>({ name: 'gate', reason: 'Proceed?' })
        if (approval !== 'go') {
          // eslint-disable-next-line require-yield
          return { result: { stopReason: 'endTurn' } } as never
        }
        return yield* next(context)
      })

      // First: interrupt
      const { result: interruptResult } = await collectGenerator(agent.stream('Test'))
      expect(interruptResult.stopReason).toBe('interrupt')

      // Resume
      const { result: finalResult } = await collectGenerator(
        agent.stream([
          new InterruptResponseContent({
            interruptId: interruptResult.interrupts![0]!.id,
            response: 'go',
          }),
        ]),
      )

      expect(finalResult.stopReason).toBe('endTurn')
    })

    it('interrupt ID uses agentStream namespace', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, printer: false })

      // eslint-disable-next-line require-yield
      agent.addMiddleware(AgentStreamStage, async function* (context) {
        context.interrupt({ name: 'my_gate' })
        return undefined as never
      })

      const { result } = await collectGenerator(agent.stream('Test'))

      expect(result.interrupts![0]!.id).toContain('agentStream')
      expect(result.interrupts![0]!.id).toContain('my_gate')
    })
  })
})
