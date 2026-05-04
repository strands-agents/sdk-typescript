import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HookProviderBridge } from '../entry'
import { Agent, FunctionTool } from '@strands-agents/sdk'
import { MockMessageModel } from '$/fixtures/mock-message-model'
import * as hookProvider from '../__fixtures__/hook-provider'

describe('HookProviderBridge argument forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('before-model-call', () => {
    it('forwards projectedInputTokens to host function', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-model-call'])
      hookProvider.beforeModelCall.mockReturnValue({ cancel: false, cancelMessage: undefined })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'hi' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('hello')

      expect(hookProvider.beforeModelCall).toHaveBeenCalled()
      const firstArg = hookProvider.beforeModelCall.mock.calls[0][0]
      expect(firstArg === undefined || typeof firstArg === 'number').toBe(true)
    })
  })

  describe('after-model-call', () => {
    it('forwards stopReason on successful completion', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-model-call'])
      hookProvider.afterModelCall.mockReturnValue({ retry: false })

      const model = new MockMessageModel()
      model.addTurn({ type: 'textBlock', text: 'hi' })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })
      await agent.invoke('hello')

      expect(hookProvider.afterModelCall).toHaveBeenCalled()
      const [stopReason, , error] = hookProvider.afterModelCall.mock.calls[0]
      expect(stopReason).toBe('endTurn')
      expect(error).toBeUndefined()
    })

    it('forwards error message on model failure', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-model-call'])
      hookProvider.afterModelCall.mockReturnValue({ retry: false })

      const model = new MockMessageModel()
      model.addTurn(new Error('model exploded'))

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], printer: false })

      await expect(agent.invoke('hello')).rejects.toThrow()

      expect(hookProvider.afterModelCall).toHaveBeenCalled()
      const [, , error] = hookProvider.afterModelCall.mock.calls[0]
      expect(error).toBe('model exploded')
    })
  })

  describe('before-tools', () => {
    it('forwards serialized message to host function', async () => {
      hookProvider.getCapabilities.mockReturnValue(['before-tools'])
      hookProvider.beforeTools.mockReturnValue({ cancel: false, cancelMessage: undefined })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'my_tool', toolUseId: 'tu-1', input: { x: 1 } })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const tool = new FunctionTool({
        name: 'my_tool',
        description: 'test tool',
        inputSchema: { type: 'object', properties: {} },
        callback: () => [{ text: 'ok' }],
      })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(hookProvider.beforeTools).toHaveBeenCalled()
      const firstArg = hookProvider.beforeTools.mock.calls[0][0]
      expect(typeof firstArg).toBe('string')
      const parsed = JSON.parse(firstArg as string)
      expect(parsed).toBeDefined()
      expect(typeof parsed).toBe('object')
    })
  })

  describe('after-tool-call', () => {
    it('forwards serialized toolUse, result, and error', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-tool-call'])
      hookProvider.afterToolCall.mockReturnValue({ retry: false, result: undefined })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'my_tool', toolUseId: 'tu-123', input: { key: 'value' } })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const tool = new FunctionTool({
        name: 'my_tool',
        description: 'test tool',
        inputSchema: { type: 'object', properties: {} },
        callback: () => [{ text: 'tool output' }],
      })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(hookProvider.afterToolCall).toHaveBeenCalled()
      const [toolUseJson, resultJson, error] = hookProvider.afterToolCall.mock.calls[0]

      const toolUse = JSON.parse(toolUseJson as string)
      expect(toolUse.name).toBe('my_tool')
      expect(toolUse.toolUseId).toBe('tu-123')

      const result = JSON.parse(resultJson as string)
      expect(typeof result).toBe('object')

      expect(error).toBeUndefined()
    })

    it('forwards error string when tool throws', async () => {
      hookProvider.getCapabilities.mockReturnValue(['after-tool-call'])
      hookProvider.afterToolCall.mockReturnValue({ retry: false, result: undefined })

      const model = new MockMessageModel()
      model.addTurn({ type: 'toolUseBlock', name: 'error_tool', toolUseId: 'tu-err', input: {} })
      model.addTurn({ type: 'textBlock', text: 'done' })

      const tool = new FunctionTool({
        name: 'error_tool',
        description: 'tool that throws',
        inputSchema: { type: 'object', properties: {} },
        callback: () => {
          throw new Error('tool crashed')
        },
      })

      const bridge = new HookProviderBridge()
      const agent = new Agent({ model, plugins: [bridge], tools: [tool], printer: false })
      await agent.invoke('use tool')

      expect(hookProvider.afterToolCall).toHaveBeenCalled()
      const [, , error] = hookProvider.afterToolCall.mock.calls[0]
      expect(error).toBe('tool crashed')
    })
  })
})
