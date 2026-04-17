import { describe, it, expect } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { ToolResultBlock } from '../../types/messages.js'
import { BeforeToolCallEvent, InterruptEvent } from '../../hooks/events.js'

describe('Agent Interrupt Integration', () => {
  it('stops the agent loop when a hook raises an interrupt', async () => {
    const model = new MockMessageModel().addTurn({
      type: 'toolUseBlock',
      name: 'deleteTool',
      toolUseId: 'tool-1',
      input: { key: 'X' },
    })

    const tool = createMockTool(
      'deleteTool',
      () => new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
    )

    const agent = new Agent({ model, tools: [tool], printer: false })
    agent.addHook(BeforeToolCallEvent, async (event) => {
      if (event.toolUse.name === 'deleteTool') {
        await event.interrupt('approval', 'Confirm deletion')
      }
    })

    const result = await agent.invoke('Delete key X')

    expect(result.stopReason).toBe('interrupt')
    expect(result.interrupts).toBeDefined()
    expect(result.interrupts!.length).toBe(1)
    expect(result.interrupts![0]!.name).toBe('approval')
    expect(result.interrupts![0]!.reason).toBe('Confirm deletion')
  })

  it('yields InterruptEvent in the stream', async () => {
    const model = new MockMessageModel().addTurn({
      type: 'toolUseBlock',
      name: 'deleteTool',
      toolUseId: 'tool-1',
      input: {},
    })

    const tool = createMockTool(
      'deleteTool',
      () => new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
    )

    const agent = new Agent({ model, tools: [tool], printer: false })
    agent.addHook(BeforeToolCallEvent, async (event) => {
      if (event.toolUse.name === 'deleteTool') {
        await event.interrupt('approval', 'Confirm')
      }
    })

    const { items } = await collectGenerator(agent.stream('Delete'))
    const interruptEvents = items.filter((e): e is InterruptEvent => e instanceof InterruptEvent)
    expect(interruptEvents.length).toBe(1)
    expect(interruptEvents[0]!.interrupts[0]!.name).toBe('approval')
  })

  it('resumes from interrupt with response', async () => {
    const model = new MockMessageModel()
      .addTurn({ type: 'toolUseBlock', name: 'deleteTool', toolUseId: 'tool-1', input: { key: 'X' } })
      .addTurn({ type: 'textBlock', text: 'Deleted successfully' })

    const tool = createMockTool(
      'deleteTool',
      () => new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
    )

    const agent = new Agent({ model, tools: [tool], printer: false })
    agent.addHook(BeforeToolCallEvent, async (event) => {
      if (event.toolUse.name === 'deleteTool') {
        const response = await event.interrupt('approval', 'Confirm deletion')
        if (response !== 'approved') {
          event.cancel = 'Denied'
        }
      }
    })

    const result1 = await agent.invoke('Delete key X')
    expect(result1.stopReason).toBe('interrupt')
    expect(result1.interrupts!.length).toBe(1)

    const interruptId = result1.interrupts![0]!.id

    const result2 = await agent.resumeFromInterrupt([{ interruptResponse: { interruptId, response: 'approved' } }])

    expect(result2.stopReason).toBe('endTurn')
    expect(result2.lastMessage.content[0]!.type).toBe('textBlock')
  })

  it('cancels tool when cancel is set', async () => {
    const model = new MockMessageModel()
      .addTurn({ type: 'toolUseBlock', name: 'dangerousTool', toolUseId: 'tool-1', input: {} })
      .addTurn({ type: 'textBlock', text: 'Tool was cancelled' })

    const tool = createMockTool(
      'dangerousTool',
      () => new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
    )

    const agent = new Agent({ model, tools: [tool], printer: false })
    agent.addHook(BeforeToolCallEvent, (event) => {
      if (event.toolUse.name === 'dangerousTool') {
        event.cancel = 'Not allowed'
      }
    })

    const result = await agent.invoke('Do something dangerous')
    expect(result.stopReason).toBe('endTurn')
  })

  it('does not interrupt tools that are not targeted', async () => {
    const model = new MockMessageModel()
      .addTurn({ type: 'toolUseBlock', name: 'safeTool', toolUseId: 'tool-1', input: {} })
      .addTurn({ type: 'textBlock', text: 'Done' })

    const tool = createMockTool(
      'safeTool',
      () => new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
    )

    const agent = new Agent({ model, tools: [tool], printer: false })
    agent.addHook(BeforeToolCallEvent, async (event) => {
      if (event.toolUse.name === 'deleteTool') {
        await event.interrupt('approval', 'Confirm')
      }
    })

    const result = await agent.invoke('Do safe thing')
    expect(result.stopReason).toBe('endTurn')
    expect(result.interrupts).toBeUndefined()
  })
})
