import { describe, expect, it, vi, beforeEach, type MockInstance } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock, ToolUseBlock, ToolResultBlock, MaxTokensError } from '../../index.js'
import { Tracer } from '../../telemetry/tracer.js'

interface MockTracerInstance {
  startAgentSpan: MockInstance
  endAgentSpan: MockInstance
  startAgentLoopSpan: MockInstance
  endAgentLoopSpan: MockInstance
  startModelInvokeSpan: MockInstance
  endModelInvokeSpan: MockInstance
  startToolCallSpan: MockInstance
  endToolCallSpan: MockInstance
}

vi.mock('../../telemetry/tracer.js', () => ({
  Tracer: vi.fn(function () {
    return {
      startAgentSpan: vi.fn().mockReturnValue({ mock: 'agentSpan' }),
      endAgentSpan: vi.fn(),
      startAgentLoopSpan: vi.fn().mockReturnValue({ mock: 'loopSpan' }),
      endAgentLoopSpan: vi.fn(),
      startModelInvokeSpan: vi.fn().mockReturnValue({ mock: 'modelSpan' }),
      endModelInvokeSpan: vi.fn(),
      startToolCallSpan: vi.fn().mockReturnValue({ mock: 'toolSpan' }),
      endToolCallSpan: vi.fn(),
    }
  }),
}))

function getLatestTracer(): MockTracerInstance {
  return vi.mocked(Tracer).mock.results.at(-1)!.value
}

describe('Agent tracer integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('initializes Tracer with traceAttributes from config', () => {
      const traceAttributes = { 'custom.attr': 'value' }
      new Agent({ traceAttributes })

      expect(Tracer).toHaveBeenCalledWith(traceAttributes)
    })

    it('initializes Tracer without traceAttributes when not provided', () => {
      new Agent()

      expect(Tracer).toHaveBeenCalledWith(undefined)
    })
  })

  describe('name and agentId', () => {
    it('defaults name to "Strands Agent"', () => {
      const agent = new Agent()

      expect(agent.name).toBe('Strands Agent')
    })

    it('uses provided name', () => {
      const agent = new Agent({ name: 'My Agent' })

      expect(agent.name).toBe('My Agent')
    })

    it('generates agentId when not provided', () => {
      const agent = new Agent()

      expect(agent.agentId).toMatch(/^agent-\d+-[a-z0-9]+$/)
    })

    it('uses provided agentId', () => {
      const agent = new Agent({ agentId: 'custom-id-123' })

      expect(agent.agentId).toBe('custom-id-123')
    })
  })

  describe('agent span lifecycle', () => {
    it('starts and ends agent span on successful invocation', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, name: 'TestAgent', agentId: 'test-id' })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startAgentSpan).toHaveBeenCalledTimes(1)
      expect(tracer.startAgentSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'TestAgent',
          agentId: 'test-id',
          modelId: 'test-model',
        })
      )
      expect(tracer.endAgentSpan).toHaveBeenCalledTimes(1)
      expect(tracer.endAgentSpan).toHaveBeenCalledWith(
        { mock: 'agentSpan' },
        expect.objectContaining({
          response: expect.objectContaining({ role: 'assistant' }),
          stopReason: 'endTurn',
        })
      )
    })

    it('ends agent span with error when invocation fails', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await expect(agent.invoke('Hi')).rejects.toThrow(MaxTokensError)

      expect(tracer.startAgentSpan).toHaveBeenCalledTimes(1)
      expect(tracer.endAgentSpan).toHaveBeenCalledTimes(1)
      expect(tracer.endAgentSpan).toHaveBeenCalledWith(
        { mock: 'agentSpan' },
        expect.objectContaining({
          error: expect.any(MaxTokensError),
        })
      )
    })

    it('includes systemPrompt in agent span when configured', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, systemPrompt: 'Be helpful' })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startAgentSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'Be helpful',
        })
      )
    })

    it('includes tools in agent span', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const tool = createMockTool(
        'myTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'id',
            status: 'success',
            content: [],
          })
      )
      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startAgentSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([expect.objectContaining({ name: 'myTool' })]),
        })
      )
    })
  })

  describe('agent loop span lifecycle', () => {
    it('starts and ends loop span for each cycle', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Done' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startAgentLoopSpan).toHaveBeenCalledTimes(1)
      expect(tracer.startAgentLoopSpan).toHaveBeenCalledWith(expect.objectContaining({ cycleId: 'cycle-1' }))
      expect(tracer.endAgentLoopSpan).toHaveBeenCalledTimes(1)
      expect(tracer.endAgentLoopSpan).toHaveBeenCalledWith({ mock: 'loopSpan' })
    })

    it('creates multiple loop spans for multi-cycle invocations', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool(
        'testTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('Result')],
          })
      )

      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()

      await agent.invoke('Use tool')

      expect(tracer.startAgentLoopSpan).toHaveBeenCalledTimes(2)
      expect(tracer.startAgentLoopSpan).toHaveBeenNthCalledWith(1, expect.objectContaining({ cycleId: 'cycle-1' }))
      expect(tracer.startAgentLoopSpan).toHaveBeenNthCalledWith(2, expect.objectContaining({ cycleId: 'cycle-2' }))
      expect(tracer.endAgentLoopSpan).toHaveBeenCalledTimes(2)
    })

    it('ends loop span with error when cycle fails', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await expect(agent.invoke('Hi')).rejects.toThrow(MaxTokensError)

      expect(tracer.endAgentLoopSpan).toHaveBeenCalledWith(
        { mock: 'loopSpan' },
        expect.objectContaining({ error: expect.any(MaxTokensError) })
      )
    })
  })

  describe('model invoke span lifecycle', () => {
    it('starts and ends model span on successful model call', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startModelInvokeSpan).toHaveBeenCalledTimes(1)
      expect(tracer.startModelInvokeSpan).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'test-model' }))
      expect(tracer.endModelInvokeSpan).toHaveBeenCalledTimes(1)
      expect(tracer.endModelInvokeSpan).toHaveBeenCalledWith(
        { mock: 'modelSpan' },
        expect.objectContaining({
          output: expect.objectContaining({ role: 'assistant' }),
          stopReason: 'endTurn',
        })
      )
    })

    it('ends model span with error when model call fails', async () => {
      const model = new MockMessageModel().addTurn(new Error('Model failed'))
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await expect(agent.invoke('Hi')).rejects.toThrow()

      expect(tracer.endModelInvokeSpan).toHaveBeenCalledWith(
        { mock: 'modelSpan' },
        expect.objectContaining({ error: expect.any(Error) })
      )
    })

    it('creates model span for each model call in multi-cycle invocation', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool(
        'testTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('Result')],
          })
      )

      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()

      await agent.invoke('Use tool')

      expect(tracer.startModelInvokeSpan).toHaveBeenCalledTimes(2)
      expect(tracer.endModelInvokeSpan).toHaveBeenCalledTimes(2)
    })
  })

  describe('tool call span lifecycle', () => {
    it('starts and ends tool span for each tool execution', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: { key: 'val' } })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool(
        'testTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('Result')],
          })
      )

      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()

      await agent.invoke('Use tool')

      expect(tracer.startToolCallSpan).toHaveBeenCalledTimes(1)
      expect(tracer.startToolCallSpan).toHaveBeenCalledWith({
        tool: expect.objectContaining({
          name: 'testTool',
          toolUseId: 'tool-1',
          input: { key: 'val' },
        }),
      })
      expect(tracer.endToolCallSpan).toHaveBeenCalledTimes(1)
      expect(tracer.endToolCallSpan).toHaveBeenCalledWith(
        { mock: 'toolSpan' },
        expect.objectContaining({
          toolResult: expect.objectContaining({ toolUseId: 'tool-1', status: 'success' }),
        })
      )
    })

    it('ends tool span with error when tool is not found', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'missingTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await agent.invoke('Use tool')

      expect(tracer.endToolCallSpan).toHaveBeenCalledWith(
        { mock: 'toolSpan' },
        expect.objectContaining({
          toolResult: expect.objectContaining({ status: 'error' }),
        })
      )
    })

    it('ends tool span with error when tool throws', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'failTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('failTool', () => {
        throw new Error('Tool exploded')
      })

      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()

      await agent.invoke('Use tool')

      expect(tracer.endToolCallSpan).toHaveBeenCalledWith(
        { mock: 'toolSpan' },
        expect.objectContaining({
          error: expect.any(Error),
          toolResult: expect.objectContaining({ status: 'error' }),
        })
      )
    })

    it('creates spans for multiple tool calls in a single turn', async () => {
      const model = new MockMessageModel()
        .addTurn([
          new ToolUseBlock({ name: 'tool1', toolUseId: 'id-1', input: {} }),
          new ToolUseBlock({ name: 'tool2', toolUseId: 'id-2', input: {} }),
        ])
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool1 = createMockTool(
        'tool1',
        () =>
          new ToolResultBlock({
            toolUseId: 'id-1',
            status: 'success',
            content: [new TextBlock('R1')],
          })
      )
      const tool2 = createMockTool(
        'tool2',
        () =>
          new ToolResultBlock({
            toolUseId: 'id-2',
            status: 'success',
            content: [new TextBlock('R2')],
          })
      )

      const agent = new Agent({ model, tools: [tool1, tool2] })
      const tracer = getLatestTracer()

      await agent.invoke('Use tools')

      expect(tracer.startToolCallSpan).toHaveBeenCalledTimes(2)
      expect(tracer.endToolCallSpan).toHaveBeenCalledTimes(2)
    })
  })

  describe('token usage accumulation', () => {
    it('passes accumulated usage to endAgentSpan', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.endAgentSpan).toHaveBeenCalledWith(
        { mock: 'agentSpan' },
        expect.objectContaining({
          accumulatedUsage: expect.objectContaining({
            inputTokens: expect.any(Number),
            outputTokens: expect.any(Number),
            totalTokens: expect.any(Number),
          }),
        })
      )
    })
  })

  describe('null span handling', () => {
    it('completes successfully when startAgentSpan returns null', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()
      tracer.startAgentSpan.mockReturnValue(null)

      const result = await agent.invoke('Hi')

      expect(result.stopReason).toBe('endTurn')
      expect(tracer.endAgentSpan).toHaveBeenCalledWith(null, expect.any(Object))
    })

    it('completes successfully when startAgentLoopSpan returns null', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()
      tracer.startAgentLoopSpan.mockReturnValue(null)

      const result = await agent.invoke('Hi')

      expect(result.stopReason).toBe('endTurn')
      expect(tracer.endAgentLoopSpan).toHaveBeenCalledWith(null)
    })

    it('completes successfully when startModelInvokeSpan returns null', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()
      tracer.startModelInvokeSpan.mockReturnValue(null)

      const result = await agent.invoke('Hi')

      expect(result.stopReason).toBe('endTurn')
    })

    it('completes successfully when startToolCallSpan returns null', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool(
        'testTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'tool-1',
            status: 'success',
            content: [new TextBlock('Result')],
          })
      )

      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()
      tracer.startToolCallSpan.mockReturnValue(null)

      const result = await agent.invoke('Use tool')

      expect(result.stopReason).toBe('endTurn')
      expect(tracer.endToolCallSpan).toHaveBeenCalledWith(null, expect.any(Object))
    })
  })

  describe('span context hierarchy', () => {
    it('resets accumulated usage on each invocation', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'textBlock', text: 'First' })
        .addTurn({ type: 'textBlock', text: 'Second' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await agent.invoke('First')
      await agent.invoke('Second')

      expect(tracer.startAgentSpan).toHaveBeenCalledTimes(2)
      expect(tracer.endAgentSpan).toHaveBeenCalledTimes(2)
    })
  })
})
