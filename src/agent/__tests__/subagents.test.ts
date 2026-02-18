import { describe, expect, it, vi } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock, ToolUseBlock } from '../../index.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'

describe('Agent subAgents handoff', () => {
  it('wires parent/child and supports root + lookup helpers', () => {
    const child = new Agent({ name: 'math', model: new MockMessageModel() })
    const root = new Agent({ name: 'root', model: new MockMessageModel(), subAgents: [child] })

    expect(child.parentAgent).toBe(root)
    expect(child.rootAgent).toBe(root)
    expect(root.findSubAgent('math')).toBe(child)
    expect(root.findAgent('math')).toBe(child)
    expect(root.findAgent('root')).toBe(root)
  })

  it('throws when sub-agent names are duplicated', () => {
    const a = new Agent({ name: 'dup', model: new MockMessageModel() })
    const b = new Agent({ name: 'dup', model: new MockMessageModel() })

    expect(() => new Agent({ name: 'root', model: new MockMessageModel(), subAgents: [a, b] })).toThrow(
      "Duplicate sub-agent name 'dup'"
    )
  })

  it('throws when tree participants are unnamed', () => {
    const unnamedChild = new Agent({ model: new MockMessageModel() })

    expect(() => new Agent({ name: 'root', model: new MockMessageModel(), subAgents: [unnamedChild] })).toThrow(
      'Agent name is required when using subAgents or parentAgent'
    )
  })

  it('throws when nested sub-agents are configured', () => {
    const grandchild = new Agent({ name: 'science', model: new MockMessageModel() })
    const childWithNested = new Agent({
      name: 'math',
      model: new MockMessageModel(),
      subAgents: [grandchild],
    })

    expect(() => new Agent({ name: 'root', model: new MockMessageModel(), subAgents: [childWithNested] })).toThrow(
      'Nested sub-agents are not supported'
    )
  })

  it('transfers from root to child via transfer_to_agent and emits transfer events', async () => {
    const rootModel = new MockMessageModel().addTurn(
      new ToolUseBlock({ name: 'transfer_to_agent', toolUseId: 't1', input: { agentName: 'math' } })
    )
    const childModel = new MockMessageModel().addTurn(new TextBlock('Math specialist answer'))

    const child = new Agent({ name: 'math', model: childModel })
    const root = new Agent({ name: 'root', model: rootModel, subAgents: [child] })

    const { items, result } = await collectGenerator(root.stream('solve this'))

    expect(result.toString()).toContain('Math specialist answer')
    expect(items.some((event) => event.type === 'beforeTransferEvent')).toBe(true)
    expect(items.some((event) => event.type === 'afterTransferEvent')).toBe(true)
    expect(root.messages.some((message) => message.author === 'math')).toBe(true)
  })

  it('runs mixed tools and then transfers', async () => {
    const echoSpy = vi.fn(() => 'echo-ok')
    const echoTool = createMockTool('echo', () => {
      echoSpy()
      return {
        type: 'toolResultBlock' as const,
        toolUseId: 't2',
        status: 'success' as const,
        content: [new TextBlock('echo-ok')],
      }
    })

    const rootModel = new MockMessageModel().addTurn([
      new ToolUseBlock({ name: 'echo', toolUseId: 't2', input: {} }),
      new ToolUseBlock({ name: 'transfer_to_agent', toolUseId: 't1', input: { agentName: 'math' } }),
    ])
    const childModel = new MockMessageModel().addTurn(new TextBlock('child after mixed tools'))

    const child = new Agent({ name: 'math', model: childModel })
    const root = new Agent({ name: 'root', model: rootModel, subAgents: [child], tools: [echoTool] })

    const { result } = await collectGenerator(root.stream('run mixed'))

    expect(echoSpy).toHaveBeenCalledTimes(1)
    expect(result.toString()).toContain('child after mixed tools')
  })

  it('keeps current agent active when transfer target is invalid', async () => {
    const rootModel = new MockMessageModel()
      .addTurn(new ToolUseBlock({ name: 'transfer_to_agent', toolUseId: 't1', input: { agentName: 'ghost' } }))
      .addTurn(new TextBlock('root fallback answer'))

    const child = new Agent({ name: 'math', model: new MockMessageModel().addTurn(new TextBlock('child answer')) })
    const root = new Agent({ name: 'root', model: rootModel, subAgents: [child] })

    const { result } = await collectGenerator(root.stream('invalid target'))

    expect(result.toString()).toContain('root fallback answer')
    expect(root.messages.some((message) => message.author === 'math')).toBe(false)
  })

  it('resumes from last active agent on subsequent turns', async () => {
    const rootModel = new MockMessageModel().addTurn(
      new ToolUseBlock({ name: 'transfer_to_agent', toolUseId: 't1', input: { agentName: 'math' } })
    )
    const childModel = new MockMessageModel()
      .addTurn(new TextBlock('child first turn'))
      .addTurn(new TextBlock('child second turn'))

    const child = new Agent({ name: 'math', model: childModel })
    const root = new Agent({ name: 'root', model: rootModel, subAgents: [child] })

    const first = await root.invoke('first')
    const second = await root.invoke('second')

    expect(first.toString()).toContain('child first turn')
    expect(second.toString()).toContain('child second turn')
  })

  it('honors explicit child invocation entry even when root remembers another active agent', async () => {
    const rootModel = new MockMessageModel().addTurn(
      new ToolUseBlock({ name: 'transfer_to_agent', toolUseId: 't1', input: { agentName: 'math' } })
    )
    const mathModel = new MockMessageModel().addTurn(new TextBlock('math turn'))
    const flashcardsModel = new MockMessageModel().addTurn(new TextBlock('flashcards direct turn'))

    const math = new Agent({ name: 'math', model: mathModel })
    const flashcards = new Agent({ name: 'flashcards', model: flashcardsModel })
    const root = new Agent({ name: 'root', model: rootModel, subAgents: [math, flashcards] })

    await root.invoke('route to math first')
    const directChildResult = await flashcards.invoke('go direct to flashcards')

    expect(directChildResult.toString()).toContain('flashcards direct turn')
  })
})
