import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock, ToolUseBlock, ToolResultBlock } from '../../index.js'
import { Interrupt } from '../../interrupt.js'
import { BeforeToolCallEvent } from '../../hooks/events.js'
import type { HookProvider } from '../../hooks/types.js'
import type { HookRegistry } from '../../hooks/registry.js'

/**
 * Creates a hook provider that raises an interrupt on BeforeToolCallEvent.
 */
function createInterruptHook(interruptName: string, reason: string): HookProvider {
  return {
    registerCallbacks(registry: HookRegistry) {
      registry.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
        event.interrupt(interruptName, reason)
      })
    },
  }
}

describe('Agent interrupt system', () => {
  describe('hook-based interrupt raise and resume', () => {
    it('returns AgentResult with stopReason interrupt when hook raises interrupt', async () => {
      const model = new MockMessageModel().addTurn(
        new ToolUseBlock({ name: 'dangerous_tool', toolUseId: 'tu-1', input: {} })
      )

      const tool = createMockTool(
        'dangerous_tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [new TextBlock('done')] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('approval', 'needs human approval')],
        printer: false,
      })

      const result = await agent.invoke('do something risky')

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toHaveLength(1)
      expect(result.interrupts[0]).toBeInstanceOf(Interrupt)
      expect(result.interrupts[0]!.name).toBe('approval')
      expect(result.interrupts[0]!.reason).toBe('needs human approval')
    })

    it('resumes from interrupt and completes tool execution', async () => {
      const model = new MockMessageModel()
        // First call: model requests tool use
        .addTurn(new ToolUseBlock({ name: 'dangerous_tool', toolUseId: 'tu-1', input: {} }))
        // Second call (after resume + tool execution): model responds
        .addTurn(new TextBlock('Tool executed successfully'))

      const tool = createMockTool(
        'dangerous_tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [new TextBlock('done')] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('approval', 'needs human approval')],
        printer: false,
      })

      // First invocation: raises interrupt
      const interruptResult = await agent.invoke('do something risky')
      expect(interruptResult.stopReason).toBe('interrupt')
      expect(interruptResult.interrupts).toHaveLength(1)

      const interruptId = interruptResult.interrupts[0]!.id

      // Resume with approval
      const resumeResult = await agent.invoke([{ interruptResponse: { interruptId, response: true } }])

      expect(resumeResult.stopReason).toBe('endTurn')
      expect(resumeResult.toString()).toBe('Tool executed successfully')
    })

    it('cancels tool when hook denies on resume', async () => {
      const model = new MockMessageModel()
        .addTurn(new ToolUseBlock({ name: 'dangerous_tool', toolUseId: 'tu-1', input: {} }))
        .addTurn(new TextBlock('Understood, I will not proceed'))

      const tool = createMockTool(
        'dangerous_tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [new TextBlock('done')] })
      )

      // Hook that interrupts, then cancels if denied
      const hook: HookProvider = {
        registerCallbacks(registry: HookRegistry) {
          registry.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
            const response = event.interrupt('approval', 'needs approval')
            if (!response) {
              event.cancelTool = 'User denied the operation'
            }
          })
        },
      }

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [hook],
        printer: false,
      })

      // Interrupt
      const interruptResult = await agent.invoke('do something risky')
      expect(interruptResult.stopReason).toBe('interrupt')

      // Resume with denial
      const resumeResult = await agent.invoke([
        { interruptResponse: { interruptId: interruptResult.interrupts[0]!.id, response: false } },
      ])

      // Agent should continue after tool cancellation and produce end turn
      expect(resumeResult.stopReason).toBe('endTurn')
    })
  })

  describe('tool-level interrupt raise and resume', () => {
    it('returns interrupt when tool calls interrupt()', async () => {
      const model = new MockMessageModel().addTurn(
        new ToolUseBlock({ name: 'delete_files', toolUseId: 'tu-1', input: {} })
      )

      const realTool = {
        name: 'delete_files',
        description: 'Delete files',
        toolSpec: {
          name: 'delete_files',
          description: 'Delete files',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        // eslint-disable-next-line require-yield
        async *stream(context: import('../../tools/tool.js').ToolContext) {
          context.interrupt('confirm_delete', 'About to delete important files')
          return new ToolResultBlock({
            toolUseId: context.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock('deleted')],
          })
        },
      }

      const agent = new Agent({
        model,
        tools: [realTool],
        printer: false,
      })

      const result = await agent.invoke('delete my files')

      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toHaveLength(1)
      expect(result.interrupts[0]!.name).toBe('confirm_delete')
      expect(result.interrupts[0]!.reason).toBe('About to delete important files')
      expect(result.interrupts[0]!.id).toMatch(/^v1:tool_call:tu-1:/)
    })

    it('resumes tool execution when interrupt response is provided', async () => {
      const model = new MockMessageModel()
        .addTurn(new ToolUseBlock({ name: 'delete_files', toolUseId: 'tu-1', input: {} }))
        .addTurn(new TextBlock('Files deleted'))

      let executionCount = 0

      const realTool = {
        name: 'delete_files',
        description: 'Delete files',
        toolSpec: {
          name: 'delete_files',
          description: 'Delete files',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        // eslint-disable-next-line require-yield
        async *stream(context: import('../../tools/tool.js').ToolContext) {
          executionCount++
          const response = context.interrupt('confirm_delete', 'About to delete important files')
          // On resume, response is available and tool continues
          return new ToolResultBlock({
            toolUseId: context.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock(`deleted with approval: ${response}`)],
          })
        },
      }

      const agent = new Agent({
        model,
        tools: [realTool],
        printer: false,
      })

      // First call: interrupt
      const interruptResult = await agent.invoke('delete my files')
      expect(interruptResult.stopReason).toBe('interrupt')
      expect(executionCount).toBe(1)

      // Resume: tool re-executes, interrupt() returns response
      const resumeResult = await agent.invoke([
        { interruptResponse: { interruptId: interruptResult.interrupts[0]!.id, response: 'approved' } },
      ])

      expect(resumeResult.stopReason).toBe('endTurn')
      expect(executionCount).toBe(2) // Tool re-executed on resume
    })
  })

  describe('resume validation', () => {
    it('throws TypeError when resuming with string instead of interrupt responses', async () => {
      const model = new MockMessageModel().addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('check', 'reason')],
        printer: false,
      })

      // First: get an interrupt
      const result = await agent.invoke('test')
      expect(result.stopReason).toBe('interrupt')

      // Attempt to resume with a string (invalid)
      await expect(agent.invoke('just a string')).rejects.toThrow(TypeError)
    })

    it('throws TypeError when resuming with wrong content type', async () => {
      const model = new MockMessageModel().addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('check', 'reason')],
        printer: false,
      })

      const result = await agent.invoke('test')
      expect(result.stopReason).toBe('interrupt')

      // Resume with wrong content shape
      await expect(agent.invoke([{ textBlock: 'wrong' }] as never)).rejects.toThrow(TypeError)
    })

    it('throws Error when resuming with unknown interrupt ID', async () => {
      const model = new MockMessageModel().addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('check', 'reason')],
        printer: false,
      })

      const result = await agent.invoke('test')
      expect(result.stopReason).toBe('interrupt')

      // Resume with wrong interrupt ID
      await expect(
        agent.invoke([{ interruptResponse: { interruptId: 'nonexistent-id', response: 'yes' } }])
      ).rejects.toThrow('no interrupt found')
    })

    it('throws Error when using structured output during interrupt resume', async () => {
      const model = new MockMessageModel().addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('check', 'reason')],
        printer: false,
        structuredOutput: z.object({ result: z.string() }),
      })

      const result = await agent.invoke('test')
      expect(result.stopReason).toBe('interrupt')

      const interruptId = result.interrupts[0]!.id

      // Resume while structured output is configured — should throw
      await expect(agent.invoke([{ interruptResponse: { interruptId, response: 'yes' } }])).rejects.toThrow(
        'Cannot use structured output during interrupt resume'
      )
    })
  })

  describe('event loop cycle behavior', () => {
    it('does not append messages to conversation when interrupted', async () => {
      const model = new MockMessageModel().addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('check', 'reason')],
        printer: false,
      })

      // Get initial message count after user message is added
      const result = await agent.invoke('test')
      expect(result.stopReason).toBe('interrupt')

      // Only the user message should be in conversation — tool use message and results should NOT
      // be appended because the tool execution was interrupted
      expect(agent.messages).toHaveLength(1)
      expect(agent.messages[0]!.role).toBe('user')
    })

    it('skips model invocation and replays stored context on resume', async () => {
      const model = new MockMessageModel()
        .addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
        // This turn should be used AFTER the resumed tool completes
        .addTurn(new TextBlock('Final response'))

      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [new TextBlock('result')] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('check', 'reason')],
        printer: false,
      })

      // Interrupt
      await agent.invoke('test')

      // Model should have been called once
      expect(model.callCount).toBe(1)

      // Resume — model should NOT be called again for the stored tool use message
      const interruptId = agent['_interruptState'].interrupts.values().next().value!.id
      const resumeResult = await agent.invoke([{ interruptResponse: { interruptId, response: true } }])

      // Model called twice total: once for initial, once for post-tool-execution continuation
      expect(model.callCount).toBe(2)
      expect(resumeResult.stopReason).toBe('endTurn')
    })

    it('deactivates interrupt state after successful resume', async () => {
      const model = new MockMessageModel()
        .addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
        .addTurn(new TextBlock('Done'))

      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [new TextBlock('ok')] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('check', 'reason')],
        printer: false,
      })

      // Interrupt
      const result = await agent.invoke('test')
      expect(agent['_interruptState'].activated).toBe(true)

      // Resume
      await agent.invoke([{ interruptResponse: { interruptId: result.interrupts[0]!.id, response: true } }])

      // State should be fully cleared
      expect(agent['_interruptState'].activated).toBe(false)
      expect(agent['_interruptState'].interrupts.size).toBe(0)
      expect(agent['_interruptState'].context).toStrictEqual({})
    })

    it('preserves partial tool results across interrupt and resume', async () => {
      const model = new MockMessageModel()
        .addTurn([
          new ToolUseBlock({ name: 'safe_tool', toolUseId: 'tu-1', input: {} }),
          new ToolUseBlock({ name: 'dangerous_tool', toolUseId: 'tu-2', input: {} }),
        ])
        .addTurn(new TextBlock('All done'))

      const safeTool = createMockTool(
        'safe_tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [new TextBlock('safe result')] })
      )
      const dangerousTool = createMockTool(
        'dangerous_tool',
        () =>
          new ToolResultBlock({ toolUseId: 'tu-2', status: 'success', content: [new TextBlock('dangerous result')] })
      )

      // Hook that only interrupts the dangerous tool
      const hook: HookProvider = {
        registerCallbacks(registry: HookRegistry) {
          registry.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
            if (event.toolUse.name === 'dangerous_tool') {
              event.interrupt('approve_dangerous', 'This tool is dangerous')
            }
          })
        },
      }

      const agent = new Agent({
        model,
        tools: [safeTool, dangerousTool],
        hooks: [hook],
        printer: false,
      })

      // First tool completes, second is interrupted
      const result = await agent.invoke('do both')
      expect(result.stopReason).toBe('interrupt')
      expect(result.interrupts).toHaveLength(1)
      expect(result.interrupts[0]!.name).toBe('approve_dangerous')

      // Resume — safe tool result should be preserved, dangerous tool executes
      const resumeResult = await agent.invoke([
        { interruptResponse: { interruptId: result.interrupts[0]!.id, response: true } },
      ])

      expect(resumeResult.stopReason).toBe('endTurn')
      expect(resumeResult.toString()).toBe('All done')
    })

    it('toString returns interrupt summary when interrupts are present', async () => {
      const model = new MockMessageModel().addTurn(new ToolUseBlock({ name: 'tool', toolUseId: 'tu-1', input: {} }))
      const tool = createMockTool(
        'tool',
        () => new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [] })
      )

      const agent = new Agent({
        model,
        tools: [tool],
        hooks: [createInterruptHook('approval', 'needs approval')],
        printer: false,
      })

      const result = await agent.invoke('test')

      expect(result.toString()).toContain('Interrupt: approval')
      expect(result.toString()).toContain(result.interrupts[0]!.id)
    })
  })
})
