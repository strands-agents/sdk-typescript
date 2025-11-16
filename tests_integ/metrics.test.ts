import { describe, it, expect } from 'vitest'
import { Agent, TextBlock } from '@strands-agents/sdk'
// eslint-disable-next-line no-restricted-imports
import { MockMessageModel } from '../src/__fixtures__/mock-message-model.js'
// eslint-disable-next-line no-restricted-imports
import { createMockTool } from '../src/__fixtures__/tool-helpers.js'

describe('Agent Metrics Integration', () => {
  describe('with metrics enabled', () => {
    it('collects metrics for single cycle execution', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, enableMetrics: true })

      const result = await agent.invoke('Test prompt')

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.eventLoop.cycleCount).toBe(1)
      expect(result.metrics?.eventLoop.totalDurationMs).toBeGreaterThan(0)
      expect(result.metrics?.eventLoop.cycleDurationsMs).toHaveLength(1)
      expect(result.metrics?.traces).toHaveLength(1)
      expect(result.metrics?.traces[0].name).toMatch(/Cycle/)
    })

    it('collects metrics for multiple cycles with tool use', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Tool result processed' })

      const tool = createMockTool('testTool', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-1',
        status: 'success' as const,
        content: [new TextBlock('Tool executed')],
      }))

      const agent = new Agent({ model, tools: [tool], enableMetrics: true })

      const result = await agent.invoke('Use the tool')

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.eventLoop.cycleCount).toBe(2)
      expect(result.metrics?.eventLoop.cycleDurationsMs).toHaveLength(2)
      expect(result.metrics?.traces).toHaveLength(2)
    })

    it('collects tool execution metrics', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('testTool', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-1',
        status: 'success' as const,
        content: [new TextBlock('Success')],
      }))

      const agent = new Agent({ model, tools: [tool], enableMetrics: true })

      const result = await agent.invoke('Use the tool')

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.tools.testTool).toBeDefined()
      expect(result.metrics?.tools.testTool.callCount).toBe(1)
      expect(result.metrics?.tools.testTool.successCount).toBe(1)
      expect(result.metrics?.tools.testTool.errorCount).toBe(0)
      expect(result.metrics?.tools.testTool.totalDurationMs).toBeGreaterThan(0)
      expect(result.metrics?.tools.testTool.averageDurationMs).toBeGreaterThan(0)
    })

    it('builds correct trace tree structure', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('testTool', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-1',
        status: 'success' as const,
        content: [new TextBlock('Success')],
      }))

      const agent = new Agent({ model, tools: [tool], enableMetrics: true })

      const result = await agent.invoke('Use the tool')

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.traces).toHaveLength(2)

      // First cycle should have tool execution as child
      const firstCycle = result.metrics?.traces[0]
      expect(firstCycle?.children).toHaveLength(1)
      expect(firstCycle?.children[0].name).toBe('testTool')
      expect(firstCycle?.children[0].parentId).toBe(firstCycle?.id)
      expect(firstCycle?.children[0].metadata?.toolName).toBe('testTool')
      expect(firstCycle?.children[0].metadata?.success).toBe(true)
    })

    it('tracks multiple tool executions separately', async () => {
      const model = new MockMessageModel()
        .addTurn([
          { type: 'toolUseBlock', name: 'tool1', toolUseId: 'tool-1', input: {} },
          { type: 'toolUseBlock', name: 'tool2', toolUseId: 'tool-2', input: {} },
        ])
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool1 = createMockTool('tool1', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-1',
        status: 'success' as const,
        content: [new TextBlock('Success 1')],
      }))

      const tool2 = createMockTool('tool2', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-2',
        status: 'success' as const,
        content: [new TextBlock('Success 2')],
      }))

      const agent = new Agent({ model, tools: [tool1, tool2], enableMetrics: true })

      const result = await agent.invoke('Use both tools')

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.tools.tool1).toBeDefined()
      expect(result.metrics?.tools.tool2).toBeDefined()
      expect(result.metrics?.tools.tool1.callCount).toBe(1)
      expect(result.metrics?.tools.tool2.callCount).toBe(1)

      // First cycle should have both tool executions as children
      const firstCycle = result.metrics?.traces[0]
      expect(firstCycle?.children).toHaveLength(2)
      expect(firstCycle?.children.map((c) => c.name)).toEqual(['tool1', 'tool2'])
    })

    it('includes all required metric fields with correct types', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, enableMetrics: true })

      const result = await agent.invoke('Test')

      expect(result.metrics).toBeDefined()

      // EventLoop metrics
      expect(typeof result.metrics?.eventLoop.cycleCount).toBe('number')
      expect(typeof result.metrics?.eventLoop.totalDurationMs).toBe('number')
      expect(Array.isArray(result.metrics?.eventLoop.cycleDurationsMs)).toBe(true)

      // Model metrics
      expect(typeof result.metrics?.model.invocationCount).toBe('number')
      expect(typeof result.metrics?.model.totalLatencyMs).toBe('number')
      expect(result.metrics?.model.aggregatedUsage).toBeDefined()
      expect(typeof result.metrics?.model.aggregatedUsage.inputTokens).toBe('number')
      expect(typeof result.metrics?.model.aggregatedUsage.outputTokens).toBe('number')
      expect(typeof result.metrics?.model.aggregatedUsage.totalTokens).toBe('number')
      expect(Array.isArray(result.metrics?.model.invocations)).toBe(true)

      // Tools metrics
      expect(typeof result.metrics?.tools).toBe('object')

      // Traces
      expect(Array.isArray(result.metrics?.traces)).toBe(true)
      if (result.metrics?.traces && result.metrics.traces.length > 0) {
        const trace = result.metrics.traces[0]
        expect(typeof trace.id).toBe('string')
        expect(typeof trace.name).toBe('string')
        expect(typeof trace.startTime).toBe('number')
        expect(Array.isArray(trace.children)).toBe(true)
      }
    })
  })

  describe('with metrics disabled', () => {
    it('does not collect metrics when enableMetrics is false', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, enableMetrics: false })

      const result = await agent.invoke('Test prompt')

      expect(result.metrics).toBeUndefined()
    })

    it('does not collect metrics when enableMetrics is not specified (defaults to true)', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      const result = await agent.invoke('Test prompt')

      // Default is true, so metrics should be present
      expect(result.metrics).toBeDefined()
    })
  })

  describe('model metadata capture', () => {
    it('captures model invocation count', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool('testTool', () => ({
        type: 'toolResultBlock',
        toolUseId: 'tool-1',
        status: 'success' as const,
        content: [new TextBlock('Success')],
      }))

      const agent = new Agent({ model, tools: [tool], enableMetrics: true })

      const result = await agent.invoke('Test')

      expect(result.metrics).toBeDefined()
      // Two model invocations: one with tool use, one with final response
      expect(result.metrics?.model.invocationCount).toBe(2)
    })
  })

  describe('streaming with metrics', () => {
    it('collects metrics when using stream()', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, enableMetrics: true })

      let result
      for await (const _ of agent.stream('Test prompt')) {
        // Consume events
      }
      // Get result by manually collecting
      const gen = agent.stream('Another test')
      let streamResult = await gen.next()
      while (!streamResult.done) {
        streamResult = await gen.next()
      }
      result = streamResult.value

      expect(result.metrics).toBeDefined()
      expect(result.metrics?.eventLoop.cycleCount).toBeGreaterThan(0)
    })
  })
})
