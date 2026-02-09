import { Agent } from '../../../agent/agent.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { think } from '../think.js'
import { collectToolStream, createMockToolContext, getToolResultText, runToolStream } from './test-helpers.js'

describe('think tool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('properties', () => {
    it('has correct name and description', () => {
      expect(think.name).toBe('think')
      expect(think.description).toContain('reasoning')
      const schema = think.toolSpec.inputSchema as { required?: string[] } | undefined
      expect(schema?.required).toContain('thought')
    })

    it('has inputSchema with thought, cycleCount, systemPrompt, tools', () => {
      const schema = think.toolSpec.inputSchema
      expect(schema).toBeDefined()
      expect(schema?.type).toBe('object')
      const props = (schema as { properties?: Record<string, unknown> }).properties
      expect(props?.thought).toBeDefined()
      expect(props?.cycleCount).toBeDefined()
      expect(props?.systemPrompt).toBeDefined()
      expect(props?.tools).toBeDefined()
    })
  })

  describe('invoke without parent agent', () => {
    it('returns error when agent context has no model and toolRegistry', async () => {
      const ctx = createMockToolContext('think', { thought: 'What is 2+2?' }, {})
      const block = await runToolStream(think, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('parent Agent instance')
    })

    it('returns error when agent is null', async () => {
      const ctx = createMockToolContext('think', { thought: 'Hello' }, null)
      const block = await runToolStream(think, ctx)
      const text = getToolResultText(block)
      expect(text).toContain('parent Agent instance')
    })
  })

  describe('streaming with parent agent', () => {
    it('forwards nested stream events and returns combined cycle output', async () => {
      const parent = new Agent()
      let callCount = 0
      const streamSpy = vi.spyOn(Agent.prototype, 'stream').mockImplementation(async function* () {
        callCount += 1
        yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: `cycle-${callCount}` } }
        return { toString: () => `response-${callCount}` }
      } as typeof Agent.prototype.stream)

      const ctx = createMockToolContext('think', { thought: 'Analyze this', cycleCount: 2 }, parent)
      const run = await collectToolStream(think, ctx)

      expect(streamSpy).toHaveBeenCalledTimes(2)
      expect(run.events.length).toBeGreaterThan(0)

      const text = getToolResultText(run.result)
      expect(text).toContain('Cycle 1/2')
      expect(text).toContain('Cycle 2/2')
      expect(text).toContain('response-1')
      expect(text).toContain('response-2')
    })
  })
})
