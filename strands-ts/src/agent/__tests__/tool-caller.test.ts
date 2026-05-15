import { describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { ToolResultBlock, TextBlock, ToolUseBlock } from '../../types/messages.js'
import { ConcurrentInvocationError, ToolNotFoundError } from '../../errors.js'
import { ToolStreamEvent } from '../../tools/tool.js'
import type { ToolContext } from '../../tools/tool.js'

describe('ToolCaller', () => {
  describe('basic tool calling', () => {
    it('calls a tool by name and returns the result', async () => {
      const tool = createMockTool(
        'calculator',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('8')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      const result = await agent.tool.calculator!({ a: 5, b: 3 })

      expect(result).toStrictEqual(
        new ToolResultBlock({
          toolUseId: 'test-id',
          status: 'success',
          content: [new TextBlock('8')],
        })
      )
    })

    it('calls a tool with empty input when no input provided', async () => {
      const tool = createMockTool(
        'ping',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('pong')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      const result = await agent.tool.ping!()

      expect(result).toStrictEqual(
        new ToolResultBlock({
          toolUseId: 'test-id',
          status: 'success',
          content: [new TextBlock('pong')],
        })
      )
    })

    it('throws when tool is not found', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [] })

      await expect(agent.tool.nonexistent!()).rejects.toThrow(ToolNotFoundError)
      await expect(agent.tool.nonexistent!()).rejects.toThrow("Tool 'nonexistent' not found")
    })
  })

  describe('underscore-to-hyphen normalization', () => {
    it('resolves underscore names to hyphenated tool names', async () => {
      const tool = createMockTool(
        'my-tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('ok')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      const result = await agent.tool.my_tool!()

      expect(result.status).toBe('success')
    })

    it('prefers exact name match over normalized match', async () => {
      const exactTool = createMockTool(
        'my_tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('exact')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [exactTool] })

      const result = await agent.tool.my_tool!()

      expect(result).toStrictEqual(
        new ToolResultBlock({
          toolUseId: 'test-id',
          status: 'success',
          content: [new TextBlock('exact')],
        })
      )
    })
  })

  describe('case-insensitive name resolution', () => {
    it('resolves tool names case-insensitively', async () => {
      const tool = createMockTool(
        'MyTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('ok')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      const result = await agent.tool.mytool!()

      expect(result.status).toBe('success')
    })

    it('prefers exact match over case-insensitive match', async () => {
      const exactTool = createMockTool(
        'myTool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('exact')],
          })
      )
      const upperTool = createMockTool(
        'MYTOOL',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('upper')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [exactTool, upperTool] })

      const result = await agent.tool.myTool!()

      expect(result.content[0]).toStrictEqual(new TextBlock('exact'))
    })
  })

  describe('message history recording', () => {
    it('records tool call in message history by default', async () => {
      const tool = createMockTool(
        'calculator',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('8')],
          })
      )
      // Override toolSpec to include input properties so params survive filtering
      Object.defineProperty(tool, 'toolSpec', {
        value: {
          name: 'calculator',
          description: 'Mock tool calculator',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
          },
        },
      })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      await agent.tool.calculator!({ a: 5, b: 3 })

      // Should have 3 messages: assistant (tool use), user (tool result), assistant (acknowledgement)
      expect(agent.messages).toHaveLength(3)

      // Message 0: Assistant message with ToolUseBlock
      const toolUseMsg = agent.messages[0]!
      expect(toolUseMsg.role).toBe('assistant')
      const toolUseBlock = toolUseMsg.content[0] as ToolUseBlock
      expect(toolUseBlock).toBeInstanceOf(ToolUseBlock)
      expect(toolUseBlock.name).toBe('calculator')
      expect(toolUseBlock.input).toStrictEqual({ a: 5, b: 3 })
      expect(toolUseBlock.toolUseId).toMatch(/^tooluse_/)

      // Message 1: User message with ToolResultBlock
      const toolResultMsg = agent.messages[1]!
      expect(toolResultMsg.role).toBe('user')
      const toolResultBlock = toolResultMsg.content[0] as ToolResultBlock
      expect(toolResultBlock).toBeInstanceOf(ToolResultBlock)
      expect(toolResultBlock.status).toBe('success')

      // Message 2: Assistant acknowledgement
      const ackMsg = agent.messages[2]!
      expect(ackMsg.role).toBe('assistant')
      const ackBlock = ackMsg.content[0] as TextBlock
      expect(ackBlock).toBeInstanceOf(TextBlock)
      expect(ackBlock.text).toBe('agent.tool.calculator was called.')
    })

    it('does not record when recordDirectToolCall is false per-call', async () => {
      const tool = createMockTool(
        'calculator',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('8')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      await agent.tool.calculator!({ a: 5, b: 3 }, { recordDirectToolCall: false })

      expect(agent.messages).toHaveLength(0)
    })

    it('records when explicitly set to true per-call', async () => {
      const tool = createMockTool(
        'calculator',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('8')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      await agent.tool.calculator!({ a: 5, b: 3 }, { recordDirectToolCall: true })

      expect(agent.messages).toHaveLength(3)
    })
  })

  describe('concurrency protection', () => {
    it('throws ConcurrentInvocationError when agent is invoking and recording is enabled', async () => {
      const tool = createMockTool(
        'slow-tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('done')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      // Simulate the agent being in the middle of an invocation by mocking isInvoking
      Object.defineProperty(agent, 'isInvoking', { get: () => true })

      await expect(agent.tool.slow_tool!()).rejects.toThrow(ConcurrentInvocationError)
      await expect(agent.tool.slow_tool!()).rejects.toThrow(
        'Direct tool call cannot be made while the agent is in the middle of an invocation'
      )
    })

    it('allows direct tool call during invocation when recordDirectToolCall is false', async () => {
      const tool = createMockTool(
        'quick-tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('ok')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      // Simulate the agent being in the middle of an invocation
      Object.defineProperty(agent, 'isInvoking', { get: () => true })

      // Should NOT throw when recording is disabled
      const result = await agent.tool.quick_tool!({}, { recordDirectToolCall: false })
      expect(result.status).toBe('success')
    })

    it('isInvoking is false on a fresh agent', () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      expect(agent.isInvoking).toBe(false)
    })
  })

  describe('tool error handling', () => {
    it('propagates errors when tool throws', async () => {
      const throwingTool = createMockTool('thrower', () => {
        throw new Error('Boom!')
      })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [throwingTool] })

      await expect(agent.tool.thrower!()).rejects.toThrow('Boom!')
    })
  })

  describe('parameter filtering', () => {
    it('filters parameters not in tool spec when recording', async () => {
      const tool = createMockTool(
        'strict-tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('ok')],
          })
      )
      // Override the toolSpec to include input schema with specific properties
      Object.defineProperty(tool, 'toolSpec', {
        value: {
          name: 'strict-tool',
          description: 'Tool with strict schema',
          inputSchema: {
            type: 'object',
            properties: {
              allowed: { type: 'string' },
            },
          },
        },
      })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      await agent.tool.strict_tool!({ allowed: 'yes', extra: 'no' })

      // Verify the recorded message only has schema-defined parameters
      const recToolUseBlock = agent.messages[0]!.content[0] as ToolUseBlock
      expect(recToolUseBlock).toBeInstanceOf(ToolUseBlock)
      expect(recToolUseBlock.input).toStrictEqual({ allowed: 'yes' })
    })
  })

  describe('agent.tool accessor', () => {
    it('is accessible as a property', () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      expect(agent.tool).toBeDefined()
    })

    it('returns same instance on multiple accesses', () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })

      expect(agent.tool).toBe(agent.tool)
    })
  })

  describe('tool use ID generation', () => {
    it('generates unique tool use IDs using crypto.randomUUID', async () => {
      const tool = createMockTool(
        'id-tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('ok')],
          })
      )
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      await agent.tool.id_tool!()
      await agent.tool.id_tool!()

      // Each call records 3 messages: [0]=assistant(toolUse), [1]=user(toolResult), [2]=assistant(ack)
      // Second call: [3]=assistant(toolUse), [4]=user(toolResult), [5]=assistant(ack)
      expect(agent.messages).toHaveLength(6)

      const toolUse1 = agent.messages[0]!.content[0] as ToolUseBlock
      const toolUse2 = agent.messages[3]!.content[0] as ToolUseBlock

      // Verify both are ToolUseBlocks at the correct indices
      expect(toolUse1).toBeInstanceOf(ToolUseBlock)
      expect(toolUse2).toBeInstanceOf(ToolUseBlock)

      // Verify IDs are unique and follow the expected format
      expect(toolUse1.toolUseId).toMatch(/^tooluse_/)
      expect(toolUse2.toolUseId).toMatch(/^tooluse_/)
      expect(toolUse1.toolUseId).not.toBe(toolUse2.toolUseId)
    })
  })

  describe('streaming generator consumption', () => {
    it('fully consumes multi-yield generator before returning final result', async () => {
      const yields: string[] = []
      const streamingTool = {
        name: 'streamer',
        description: 'A tool that yields progress events',
        toolSpec: {
          name: 'streamer',
          description: 'A tool that yields progress events',
          inputSchema: { type: 'object' as const, properties: {} },
        },
        async *stream(): AsyncGenerator<ToolStreamEvent, ToolResultBlock, undefined> {
          yields.push('first')
          yield new ToolStreamEvent({ data: 'step 1' })
          yields.push('second')
          yield new ToolStreamEvent({ data: 'step 2' })
          yields.push('third')
          yield new ToolStreamEvent({ data: 'step 3' })
          return new ToolResultBlock({
            toolUseId: 'stream-id',
            status: 'success',
            content: [new TextBlock('complete')],
          })
        },
      }
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [streamingTool] })

      const result = await agent.tool.streamer!()

      expect(result.status).toBe('success')
      expect(result.content[0]).toStrictEqual(new TextBlock('complete'))
      // Verify all yields were consumed (generator fully iterated)
      expect(yields).toStrictEqual(['first', 'second', 'third'])
    })
  })

  describe('parameter filtering contract', () => {
    it('passes ALL parameters to tool but filters when recording in history', async () => {
      let receivedInput: unknown = null
      const tool = createMockTool(
        'capture-tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('captured')],
          })
      )
      // Override stream to capture input
      const originalStream = tool.stream.bind(tool)
      tool.stream = function (context: ToolContext) {
        receivedInput = context.toolUse.input
        return originalStream(context)
      }
      // Override toolSpec to include inputSchema with specific properties
      Object.defineProperty(tool, 'toolSpec', {
        value: {
          name: 'capture-tool',
          description: 'Captures input for verification',
          inputSchema: {
            type: 'object',
            properties: {
              allowed: { type: 'string' },
            },
          },
        },
      })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [tool] })

      await agent.tool.capture_tool!({ allowed: 'yes', extra: 'should-pass-through' })

      // Tool MUST receive ALL parameters (including extra)
      expect(receivedInput).toStrictEqual({ allowed: 'yes', extra: 'should-pass-through' })

      // But recorded history should only contain filtered parameters
      const recToolUseBlock = agent.messages[0]!.content[0] as ToolUseBlock
      expect(recToolUseBlock).toBeInstanceOf(ToolUseBlock)
      expect(recToolUseBlock.input).toStrictEqual({ allowed: 'yes' })
    })
  })

  describe('dynamically added tools', () => {
    it('can call a tool that was added after agent creation', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, tools: [] })

      // Add tool after creation
      const laterTool = createMockTool(
        'later-tool',
        () =>
          new ToolResultBlock({
            toolUseId: 'test-id',
            status: 'success',
            content: [new TextBlock('dynamic')],
          })
      )
      agent.toolRegistry.add(laterTool)

      const result = await agent.tool.later_tool!()

      expect(result.status).toBe('success')
      expect(result.content[0]).toStrictEqual(new TextBlock('dynamic'))
    })
  })
})
