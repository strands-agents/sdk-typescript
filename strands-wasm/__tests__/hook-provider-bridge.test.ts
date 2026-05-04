import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HookProviderBridge } from '../entry'
import { Agent, ToolResultBlock, TextBlock } from '@strands-agents/sdk'
import { MockMessageModel } from '$/fixtures/mock-message-model'
import * as hookProvider from '../__fixtures__/hook-provider'

describe('HookProviderBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('capability negotiation', () => {
    it('registers no hooks when capabilities list is empty', async () => {
      hookProvider.getCapabilities.mockReturnValue([])
      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'hi' })
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('hello')

      expect(hookProvider.beforeInvocation).not.toHaveBeenCalled()
      expect(hookProvider.afterInvocation).not.toHaveBeenCalled()
      expect(hookProvider.beforeModelCall).not.toHaveBeenCalled()
      expect(hookProvider.afterModelCall).not.toHaveBeenCalled()
    })

    it('registers only declared capabilities', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-model-call', 'after-model-call'])
      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'hi' })
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('hello')

      expect(hookProvider.beforeModelCall).toHaveBeenCalled()
      expect(hookProvider.afterModelCall).toHaveBeenCalled()
      expect(hookProvider.beforeInvocation).not.toHaveBeenCalled()
      expect(hookProvider.afterInvocation).not.toHaveBeenCalled()
    })

    it('calls after-tools hook when capability is declared and tools run', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-tools'])
      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })
      const tool = hookProvider.testTool()
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(hookProvider.afterTools).toHaveBeenCalled()
    })
  })

  describe('cancel decisions', () => {
    it('cancels invocation when before-invocation returns cancel=true', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-invocation'])
      hookProvider.beforeInvocation.mockReturnValue({ cancel: true, cancelMessage: 'stopped by host' })
      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'hi' })
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      const result = await agent.invoke('hello')

      expect(hookProvider.beforeInvocation).toHaveBeenCalled()
      expect(result.stopReason).toBe('endTurn')
    })

    it('cancels model call when before-model-call returns cancel=true', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-model-call'])
      hookProvider.beforeModelCall.mockReturnValue({ cancel: true, cancelMessage: undefined })
      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'hi' })
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      const result = await agent.invoke('hello')

      expect(hookProvider.beforeModelCall).toHaveBeenCalled()
      expect(result.stopReason).toBe('endTurn')
    })
  })

  describe('JSON parse safety', () => {
    it('handles invalid JSON in resume field gracefully', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-invocation'])
      hookProvider.afterInvocation.mockReturnValue({ resume: 'not-valid-json{' })
      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'hi' })
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })

      // Should not throw — invalid JSON is logged and ignored
      await expect(agent.invoke('hello')).resolves.toBeDefined()
    })

    it('handles invalid JSON in toolUse field gracefully', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
      hookProvider.beforeToolCall.mockReturnValue({
        cancel: false,
        cancelMessage: undefined,
        toolUse: 'invalid{json',
        selectedToolName: undefined,
      })
      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })
      let receivedInput: unknown
      const tool = hookProvider.testTool({
        callback: (input) => {
          receivedInput = input
          return [{ text: 'ok' }]
        },
      })
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })

      await expect(agent.invoke('use tool')).resolves.toBeDefined()
      expect(receivedInput).toStrictEqual({})
    })

    it('handles invalid JSON in result field gracefully', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-tool-call'])
      hookProvider.afterToolCall.mockReturnValue({ retry: false, result: 'bad-json{{' })
      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })
      const tool = hookProvider.testTool()
      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })

      await expect(agent.invoke('use tool')).resolves.toBeDefined()
      const toolResult = agent.messages
        .flatMap((m) => m.content)
        .find((b) => b.type === 'toolResultBlock' && b.toolUseId === 'tu-1')
      expect(toolResult).toBeDefined()
    })
  })

  describe('toolUse rewrite', () => {
    it('tool receives rewritten input from before-tool-call decision', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
      hookProvider.beforeToolCall.mockReturnValue({
        cancel: false,
        cancelMessage: undefined,
        toolUse: JSON.stringify({ name: 'test_tool', toolUseId: 'tu-1', input: { rewritten: true } }),
        selectedToolName: undefined,
      })

      let receivedInput: unknown
      const tool = hookProvider.testTool({
        callback: (input) => {
          receivedInput = input
          return [{ text: 'ok' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: { original: true } })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(receivedInput).toStrictEqual({ rewritten: true })
    })

    it('partial rewrite preserves fields not present in host JSON', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
      hookProvider.beforeToolCall.mockReturnValue({
        cancel: false,
        cancelMessage: undefined,
        toolUse: JSON.stringify({ input: { injected: 'context' } }),
        selectedToolName: undefined,
      })

      let receivedInput: unknown
      const tool = hookProvider.testTool({
        callback: (input) => {
          receivedInput = input
          return [{ text: 'ok' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-original', input: { original: true } })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(receivedInput).toStrictEqual({ injected: 'context' })
      const toolUseMessage = agent.messages.find((m) => m.content.some((b) => b.type === 'toolUseBlock'))
      const toolUseBlock = toolUseMessage!.content.find((b) => b.type === 'toolUseBlock')!
      expect(toolUseBlock.name).toBe('test_tool')
      expect(toolUseBlock.toolUseId).toBe('tu-original')
    })

    it('empty object rewrite preserves all original fields', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
      hookProvider.beforeToolCall.mockReturnValue({
        cancel: false,
        cancelMessage: undefined,
        toolUse: JSON.stringify({}),
        selectedToolName: undefined,
      })

      let receivedInput: unknown
      const tool = hookProvider.testTool({
        callback: (input) => {
          receivedInput = input
          return [{ text: 'ok' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-keep', input: { keep: 'me' } })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(receivedInput).toStrictEqual({ keep: 'me' })
      const toolUseMessage = agent.messages.find((m) => m.content.some((b) => b.type === 'toolUseBlock'))
      const toolUseBlock = toolUseMessage!.content.find((b) => b.type === 'toolUseBlock')!
      expect(toolUseBlock.name).toBe('test_tool')
      expect(toolUseBlock.toolUseId).toBe('tu-keep')
    })
  })

  describe('selectedToolName', () => {
    it('executes the replacement tool from registry', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
      hookProvider.beforeToolCall.mockReturnValue({
        cancel: false,
        cancelMessage: undefined,
        toolUse: undefined,
        selectedToolName: 'replacement_tool',
      })

      let originalExecuted = false
      let replacementExecuted = false

      const originalTool = hookProvider.testTool({
        name: 'original_tool',
        description: 'original',
        callback: () => {
          originalExecuted = true
          return [{ text: 'original' }]
        },
      })
      const replacementTool = hookProvider.testTool({
        name: 'replacement_tool',
        description: 'replacement',
        callback: () => {
          replacementExecuted = true
          return [{ text: 'replaced' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'original_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [originalTool, replacementTool], printer: false })
      await agent.invoke('use tool')

      expect(originalExecuted).toBe(false)
      expect(replacementExecuted).toBe(true)
    })

    it('selectedToolName combined with toolUse rewrite applies both', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
      hookProvider.beforeToolCall.mockReturnValue({
        cancel: false,
        cancelMessage: undefined,
        toolUse: JSON.stringify({ input: { redirected: true } }),
        selectedToolName: 'replacement_tool',
      })

      let replacementInput: unknown
      const originalTool = hookProvider.testTool({
        name: 'original_tool',
        description: 'original',
        callback: () => [{ text: 'original' }],
      })
      const replacementTool = hookProvider.testTool({
        name: 'replacement_tool',
        description: 'replacement',
        callback: (input) => {
          replacementInput = input
          return [{ text: 'replaced' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'original_tool', toolUseId: 'tu-1', input: { original: true } })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [originalTool, replacementTool], printer: false })
      await agent.invoke('use tool')

      expect(replacementInput).toStrictEqual({ redirected: true })
    })
  })

  describe('result replacement', () => {
    it('replaces tool result in conversation history via after-tool-call', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-tool-call'])
      hookProvider.afterToolCall.mockReturnValue({
        retry: false,
        result: JSON.stringify({
          toolResult: {
            toolUseId: 'tu-1',
            status: 'success',
            content: [{ text: '[REDACTED]' }],
          },
        }),
      })

      const tool = hookProvider.testTool({
        callback: () => [{ text: 'SECRET_VALUE' }],
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      const toolResultMessage = agent.messages.find((m) =>
        m.content.some((b) => b.type === 'toolResultBlock' && b.toolUseId === 'tu-1')
      )
      expect(toolResultMessage).toBeDefined()
      const block = toolResultMessage!.content.find(
        (b): b is ToolResultBlock => b.type === 'toolResultBlock' && b.toolUseId === 'tu-1'
      )
      expect(block!.content[0]).toStrictEqual(new TextBlock('[REDACTED]'))
    })

    it('handles result JSON missing toolResult wrapper gracefully', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-tool-call'])
      // Missing the { toolResult: ... } wrapper — fromJSON will throw, code should catch and keep original
      hookProvider.afterToolCall.mockReturnValue({
        retry: false,
        result: JSON.stringify({ toolUseId: 'tu-1', status: 'success', content: [{ text: 'flat' }] }),
      })

      const tool = hookProvider.testTool({
        callback: () => [{ text: 'original output' }],
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })

      // Should not throw — malformed result is logged and original result preserved
      await expect(agent.invoke('use tool')).resolves.toBeDefined()

      const toolResultMessage = agent.messages.find((m) =>
        m.content.some((b) => b.type === 'toolResultBlock' && b.toolUseId === 'tu-1')
      )
      expect(toolResultMessage).toBeDefined()
      const block = toolResultMessage!.content.find(
        (b): b is ToolResultBlock => b.type === 'toolResultBlock' && b.toolUseId === 'tu-1'
      )
      // Original result preserved since replacement JSON was malformed
      expect(block).toBeDefined()
    })
  })

  describe('retry', () => {
    it('after-tool-call retry re-executes the tool', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-tool-call'])
      let callCount = 0
      hookProvider.afterToolCall.mockImplementation(() => {
        callCount++
        if (callCount === 1) return { retry: true, result: undefined }
        return { retry: false, result: undefined }
      })

      let toolCallCount = 0
      const tool = hookProvider.testTool({
        callback: () => {
          toolCallCount++
          return [{ text: `call-${toolCallCount}` }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(toolCallCount).toBe(2)
    })

    it('after-model-call retry re-invokes the model', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-model-call'])
      let hookCallCount = 0
      hookProvider.afterModelCall.mockImplementation(() => {
        hookCallCount++
        if (hookCallCount === 1) return { retry: true }
        return { retry: false }
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'first' })
      model.addTurn({ type: 'textBlock', text: 'second' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('hello')

      expect(model.callCount).toBe(2)
    })

    it('after-model-call consecutive retries all re-invoke the model', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-model-call'])
      let hookCallCount = 0
      hookProvider.afterModelCall.mockImplementation(() => {
        hookCallCount++
        if (hookCallCount <= 3) return { retry: true }
        return { retry: false }
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'attempt-1' })
      model.addTurn({ type: 'textBlock', text: 'attempt-2' })
      model.addTurn({ type: 'textBlock', text: 'attempt-3' })
      model.addTurn({ type: 'textBlock', text: 'final' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('hello')

      expect(model.callCount).toBe(4)
      expect(hookCallCount).toBe(4)
    })
  })

  describe('resume', () => {
    it('after-invocation resume re-enters the agent loop with new input', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-invocation'])
      let invocationCount = 0
      hookProvider.afterInvocation.mockImplementation(() => {
        invocationCount++
        if (invocationCount === 1) return { resume: JSON.stringify('follow-up question') }
        return { resume: undefined }
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'first response' })
      model.addTurn({ type: 'textBlock', text: 'second response' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('initial')

      expect(model.callCount).toBe(2)
      const userMessages = agent.messages.filter((m) => m.role === 'user')
      expect(userMessages).toHaveLength(2)
    })

    it('after-invocation resume works with content block array JSON', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-invocation'])
      let invocationCount = 0
      const resumePayload = [{ role: 'user', content: [{ type: 'textBlock', text: 'structured follow-up' }] }]
      hookProvider.afterInvocation.mockImplementation(() => {
        invocationCount++
        if (invocationCount === 1) {
          return { resume: JSON.stringify(resumePayload) }
        }
        return { resume: undefined }
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'first response' })
      model.addTurn({ type: 'textBlock', text: 'second response' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('initial')

      expect(model.callCount).toBe(2)
    })

    it('after-invocation resume works with array JSON', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-invocation'])
      let invocationCount = 0
      hookProvider.afterInvocation.mockImplementation(() => {
        invocationCount++
        if (invocationCount === 1) return { resume: JSON.stringify([{ type: 'textBlock', text: 'follow-up' }]) }
        return { resume: undefined }
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'first response' })
      model.addTurn({ type: 'textBlock', text: 'second response' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('initial')

      expect(model.callCount).toBe(2)
      const userMessages = agent.messages.filter((m) => m.role === 'user')
      expect(userMessages).toHaveLength(2)
    })
  })

  describe('before-tools cancel', () => {
    it('cancels all tool calls in the batch', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tools'])
      hookProvider.beforeTools.mockReturnValue({ cancel: true, cancelMessage: 'tools disabled' })

      let toolExecuted = false
      const tool = hookProvider.testTool({
        callback: () => {
          toolExecuted = true
          return [{ text: 'ok' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(toolExecuted).toBe(false)
    })

    it('cancels multiple tool calls in the same turn', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tools'])
      hookProvider.beforeTools.mockReturnValue({ cancel: true, cancelMessage: 'batch blocked' })

      let toolAExecuted = false
      let toolBExecuted = false
      const toolA = hookProvider.testTool({
        name: 'tool_a',
        description: 'tool A',
        callback: () => {
          toolAExecuted = true
          return [{ text: 'a' }]
        },
      })
      const toolB = hookProvider.testTool({
        name: 'tool_b',
        description: 'tool B',
        callback: () => {
          toolBExecuted = true
          return [{ text: 'b' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn([
        { type: 'toolUseBlock', name: 'tool_a', toolUseId: 'tu-a', input: {} },
        { type: 'toolUseBlock', name: 'tool_b', toolUseId: 'tu-b', input: {} },
      ])
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [toolA, toolB], printer: false })
      await agent.invoke('use tools')

      expect(toolAExecuted).toBe(false)
      expect(toolBExecuted).toBe(false)
    })
  })

  describe('cancel message propagation', () => {
    it('before-invocation cancel message appears in response', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-invocation'])
      hookProvider.beforeInvocation.mockReturnValue({ cancel: true, cancelMessage: 'blocked by policy' })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'should not reach' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      const result = await agent.invoke('hello')

      const lastAssistant = agent.messages.findLast((m) => m.role === 'assistant')
      expect(lastAssistant).toBeDefined()
      const textBlock = lastAssistant!.content.find((b) => b.type === 'textBlock')
      expect(textBlock).toBeDefined()
      expect((textBlock as TextBlock).text).toBe('blocked by policy')
      expect(model.callCount).toBe(0)
    })

    it('before-tool-call cancel message becomes tool result error', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
      hookProvider.beforeToolCall.mockReturnValue({
        cancel: true,
        cancelMessage: 'tool blocked',
        toolUse: undefined,
        selectedToolName: undefined,
      })

      let toolExecuted = false
      const tool = hookProvider.testTool({
        callback: () => {
          toolExecuted = true
          return [{ text: 'ok' }]
        },
      })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(toolExecuted).toBe(false)
      const toolResultMessage = agent.messages.find((m) =>
        m.content.some((b) => b.type === 'toolResultBlock' && b.toolUseId === 'tu-1')
      )
      expect(toolResultMessage).toBeDefined()
      const block = toolResultMessage!.content.find(
        (b): b is ToolResultBlock => b.type === 'toolResultBlock' && b.toolUseId === 'tu-1'
      )
      expect(block!.status).toBe('error')
    })
  })
})
