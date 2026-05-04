import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HookProviderBridge, LifecycleBridge } from '../entry'
import { Agent } from '@strands-agents/sdk'
import { MockMessageModel } from '$/fixtures/mock-message-model'
import * as hookProvider from '../__fixtures__/hook-provider'
import { testTool } from '../__fixtures__/hook-provider'

describe('HookProviderBridge regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function expectNoHooksCalled(): void {
    expect(hookProvider.beforeInvocation).not.toHaveBeenCalled()
    expect(hookProvider.afterInvocation).not.toHaveBeenCalled()
    expect(hookProvider.beforeModelCall).not.toHaveBeenCalled()
    expect(hookProvider.afterModelCall).not.toHaveBeenCalled()
    expect(hookProvider.beforeTools).not.toHaveBeenCalled()
    expect(hookProvider.afterTools).not.toHaveBeenCalled()
    expect(hookProvider.beforeToolCall).not.toHaveBeenCalled()
    expect(hookProvider.afterToolCall).not.toHaveBeenCalled()
  }

  it('text-only invocation unchanged with HookProviderBridge present', async () => {
    hookProvider.getCapabilities.mockReturnValue([])
    const model = new MockMessageModel()
    model.addTurn({ type: 'textBlock', text: 'hello' })
    model.addTurn({ type: 'textBlock', text: 'unreachable' })
    const agent = new Agent({ model, plugins: [new HookProviderBridge()], printer: false })
    const result = await agent.invoke('hi')

    expect(hookProvider.getCapabilities).toHaveBeenCalledTimes(1)
    expectNoHooksCalled()
    expect(model.callCount).toBe(1)
    const textBlock = result.lastMessage.content.find((b) => b.type === 'textBlock')
    expect(textBlock).toBeDefined()
    expect(textBlock!.text).toBe('hello')
  })

  it('tool invocation unchanged with HookProviderBridge present', async () => {
    hookProvider.getCapabilities.mockReturnValue([])
    const model = new MockMessageModel()
    model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
    model.addTurn({ type: 'textBlock', text: 'done' })

    let toolCalled = false
    const tool = testTool({
      callback: () => {
        toolCalled = true
        return [{ text: 'ok' }]
      },
    })

    const agent = new Agent({ model, plugins: [new HookProviderBridge()], tools: [tool], printer: false })
    await agent.invoke('use tool')

    expect(toolCalled).toBe(true)
    expect(model.callCount).toBe(2)
    expect(hookProvider.getCapabilities).toHaveBeenCalledTimes(1)
    expectNoHooksCalled()
  })

  it('LifecycleBridge events unaffected by HookProviderBridge coexistence', async () => {
    hookProvider.getCapabilities.mockReturnValue([])
    const lifecycle = new LifecycleBridge()
    const hookBridge = new HookProviderBridge()
    const model = new MockMessageModel()
    model.addTurn({ type: 'textBlock', text: 'Hello' })
    const agent = new Agent({ model, plugins: [lifecycle, hookBridge], printer: false })
    await agent.invoke('hi')

    const events = lifecycle.drain()
    const eventTypes = events.map((e) => e.val.eventType)

    expect(eventTypes).toContain('initialized')
    expect(eventTypes).toContain('before-invocation')
    expect(eventTypes).toContain('before-model-call')
    expect(eventTypes).toContain('after-model-call')
    expect(eventTypes).toContain('message-added')
    expect(eventTypes).toContain('after-invocation')
  })

  it('LifecycleBridge before-tools/after-tools events with both plugins during tool turn', async () => {
    hookProvider.getCapabilities.mockReturnValue([])
    const lifecycle = new LifecycleBridge()
    const hookBridge = new HookProviderBridge()
    const model = new MockMessageModel()
    model.addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tu-1', input: {} })
    model.addTurn({ type: 'textBlock', text: 'done' })

    const tool = testTool()

    const agent = new Agent({ model, plugins: [lifecycle, hookBridge], tools: [tool], printer: false })
    await agent.invoke('use tool')

    const events = lifecycle.drain()
    const eventTypes = events.map((e) => e.val.eventType)

    expect(eventTypes).toContain('before-tools')
    expect(eventTypes).toContain('after-tools')
    expect(eventTypes).toContain('before-tool-call')
    expect(eventTypes).toContain('after-tool-call')
  })
})

describe('HookProviderBridge error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selectedToolName referencing non-existent tool uses original tool', async () => {
    hookProvider.getCapabilities.mockReturnValue(['before-tool-call'])
    hookProvider.beforeToolCall.mockReturnValue({
      cancel: false,
      cancelMessage: undefined,
      toolUse: undefined,
      selectedToolName: 'nonexistent_tool',
    })

    let originalExecuted = false
    const originalTool = testTool({
      name: 'original_tool',
      description: 'original',
      callback: () => {
        originalExecuted = true
        return [{ text: 'original result' }]
      },
    })

    const model = new MockMessageModel()
    model.addTurn({ type: 'toolUseBlock', name: 'original_tool', toolUseId: 'tu-1', input: {} })
    model.addTurn({ type: 'textBlock', text: 'done' })

    const agent = new Agent({ model, plugins: [new HookProviderBridge()], tools: [originalTool], printer: false })
    await agent.invoke('use tool')

    expect(originalExecuted).toBe(true)
    expect(hookProvider.beforeToolCall).toHaveBeenCalled()
  })

  it('capabilities are read once at init, not per-invocation', async () => {
    hookProvider.getCapabilities.mockReturnValue(['before-invocation'])
    hookProvider.beforeInvocation.mockReturnValue({ cancel: false, cancelMessage: undefined })

    const model = new MockMessageModel()
    model.addTurn({ type: 'textBlock', text: 'first response' })
    model.addTurn({ type: 'textBlock', text: 'second response' })

    const agent = new Agent({ model, plugins: [new HookProviderBridge()], printer: false })
    await agent.invoke('first')

    hookProvider.getCapabilities.mockClear()
    hookProvider.beforeInvocation.mockClear()
    hookProvider.beforeInvocation.mockReturnValue({ cancel: false, cancelMessage: undefined })

    await agent.invoke('second')

    expect(hookProvider.getCapabilities).toHaveBeenCalledTimes(0)
    expect(hookProvider.beforeInvocation).toHaveBeenCalledTimes(1)
  })
})
