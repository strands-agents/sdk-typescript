import { describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import {
  AfterToolCallEvent,
  AfterToolsEvent,
  BeforeToolCallEvent,
  BeforeToolsEvent,
  ToolResultEvent,
  ToolStreamUpdateEvent,
} from '../../hooks/index.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'
import { Tool, ToolStreamEvent, type ToolContext, type ToolStreamGenerator } from '../../tools/tool.js'
import type { ToolSpec } from '../../tools/types.js'

/**
 * A tool that sleeps for `delayMs` then returns, recording the start and end
 * timestamps on the provided tracker. Useful for asserting concurrency and
 * cooperative cancellation behavior.
 */
class TimedTool extends Tool {
  name: string
  description: string
  toolSpec: ToolSpec

  constructor(
    name: string,
    private readonly delayMs: number,
    private readonly tracker: { name: string; start: number; end: number; cancelled: boolean }[],
    private readonly honorCancelSignal = true
  ) {
    super()
    this.name = name
    this.description = `Timed tool ${name}`
    this.toolSpec = { name, description: this.description, inputSchema: { type: 'object', properties: {} } }
  }

  // eslint-disable-next-line require-yield
  async *stream(ctx: ToolContext): ToolStreamGenerator {
    const entry = { name: this.name, start: Date.now(), end: 0, cancelled: false }
    this.tracker.push(entry)
    if (this.honorCancelSignal) {
      // Cooperatively race sleep against the cancel signal.
      await new Promise<void>((resolve) => {
        const timer = globalThis.setTimeout(() => resolve(), this.delayMs)
        ctx.agent.cancelSignal.addEventListener(
          'abort',
          () => {
            globalThis.clearTimeout(timer)
            entry.cancelled = true
            resolve()
          },
          { once: true }
        )
      })
    } else {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, this.delayMs))
    }
    entry.end = Date.now()
    return new ToolResultBlock({
      toolUseId: ctx.toolUse.toolUseId,
      status: 'success',
      content: [new TextBlock(`${this.name} done`)],
    })
  }
}

/**
 * A tool that yields the specified number of `ToolStreamEvent`s before returning.
 * Used to exercise cross-tool interleaving of stream updates.
 */
class StreamingTool extends Tool {
  name: string
  description: string
  toolSpec: ToolSpec

  constructor(
    name: string,
    private readonly steps: number,
    private readonly stepDelayMs: number
  ) {
    super()
    this.name = name
    this.description = `Streaming tool ${name}`
    this.toolSpec = { name, description: this.description, inputSchema: { type: 'object', properties: {} } }
  }

  async *stream(ctx: ToolContext): ToolStreamGenerator {
    for (let i = 0; i < this.steps; i++) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, this.stepDelayMs))
      yield new ToolStreamEvent({ data: { tool: this.name, step: i } })
    }
    return new ToolResultBlock({
      toolUseId: ctx.toolUse.toolUseId,
      status: 'success',
      content: [new TextBlock(`${this.name} streamed ${this.steps}`)],
    })
  }
}

function twoToolTurn(): MockMessageModel {
  return new MockMessageModel()
    .addTurn([
      { type: 'toolUseBlock', name: 'toolA', toolUseId: 'a', input: {} },
      { type: 'toolUseBlock', name: 'toolB', toolUseId: 'b', input: {} },
    ])
    .addTurn({ type: 'textBlock', text: 'Done' })
}

describe('Agent concurrent tool execution', () => {
  it('runs multiple tools in parallel', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 80, tracker), new TimedTool('toolB', 80, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    await agent.invoke('Go')

    expect(tracker).toHaveLength(2)
    const [first, second] = tracker.sort((a, b) => a.start - b.start)
    // B started before A finished — proves the tools ran concurrently.
    expect(second!.start).toBeLessThan(first!.end)
  })

  it('runs tools sequentially under default executor', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 40, tracker), new TimedTool('toolB', 40, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      // default (sequential)
      printer: false,
    })

    await agent.invoke('Go')
    const [first, second] = tracker.sort((a, b) => a.start - b.start)
    // B did not start until A finished
    expect(second!.start).toBeGreaterThanOrEqual(first!.end)
  })

  it('preserves per-tool event ordering while interleaving across tools', async () => {
    const tools = [new StreamingTool('toolA', 3, 10), new StreamingTool('toolB', 3, 10)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    const events: { kind: string; toolUseId?: string; tool?: string }[] = []
    agent.addHook(BeforeToolCallEvent, (e) => void events.push({ kind: 'before', toolUseId: e.toolUse.toolUseId }))
    agent.addHook(AfterToolCallEvent, (e) => void events.push({ kind: 'after', toolUseId: e.toolUse.toolUseId }))
    agent.addHook(ToolResultEvent, (e) => void events.push({ kind: 'result', toolUseId: e.result.toolUseId }))
    agent.addHook(ToolStreamUpdateEvent, (e) => {
      const data = e.event.data as { tool: string } | undefined
      events.push(data?.tool !== undefined ? { kind: 'stream', tool: data.tool } : { kind: 'stream' })
    })

    await agent.invoke('Go')

    // Extract per-tool subsequence and validate its shape.
    for (const toolUseId of ['a', 'b']) {
      const subseq = events.filter(
        (e) => e.toolUseId === toolUseId || (e.kind === 'stream' && e.tool === (toolUseId === 'a' ? 'toolA' : 'toolB'))
      )
      const kinds = subseq.map((e) => e.kind)
      // First event for a tool is its BeforeToolCallEvent
      expect(kinds[0]).toBe('before')
      // Last two are AfterToolCallEvent then ToolResultEvent
      expect(kinds.slice(-2)).toEqual(['after', 'result'])
      // Middle events (if any) are all stream updates
      for (const k of kinds.slice(1, -2)) {
        expect(k).toBe('stream')
      }
    }

    // Cross-tool interleaving: collapse consecutive same-tool events into runs.
    // Strictly sequential execution produces 2 runs (e.g. [A,A,A,B,B,B]);
    // anything > 2 means the stream alternated between tools at least once.
    const streamTools = events.filter((e) => e.kind === 'stream').map((e) => e.tool)
    const runs = streamTools.reduce<(string | undefined)[]>((acc, t) => {
      if (acc.length === 0 || acc[acc.length - 1] !== t) acc.push(t)
      return acc
    }, [])
    expect(runs.length).toBeGreaterThan(2)
  })

  it('retries one tool independently from the other', async () => {
    let retriesA = 0
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 5, tracker), new TimedTool('toolB', 5, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    const beforeCalls: string[] = []
    agent.addHook(BeforeToolCallEvent, (e) => void beforeCalls.push(e.toolUse.name))
    agent.addHook(AfterToolCallEvent, (e) => {
      if (e.toolUse.name === 'toolA' && retriesA === 0) {
        retriesA++
        e.retry = true
      }
    })

    await agent.invoke('Go')

    expect(beforeCalls.filter((n) => n === 'toolA')).toHaveLength(2)
    expect(beforeCalls.filter((n) => n === 'toolB')).toHaveLength(1)
  })

  it('cancels all tools when BeforeToolsEvent.cancel is set (concurrent mode)', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 100, tracker), new TimedTool('toolB', 100, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    agent.addHook(BeforeToolsEvent, (e) => {
      e.cancel = 'hook cancelled'
    })

    let afterMessage: import('../../types/messages.js').Message | undefined
    agent.addHook(AfterToolsEvent, (e) => {
      afterMessage = e.message
    })

    await agent.invoke('Go')

    // No tool ever ran
    expect(tracker).toHaveLength(0)
    // Both tool use ids produced error results in source order
    expect(afterMessage!.content).toHaveLength(2)
    const r0 = afterMessage!.content[0] as ToolResultBlock
    const r1 = afterMessage!.content[1] as ToolResultBlock
    expect(r0.status).toBe('error')
    expect(r1.status).toBe('error')
    expect(r0.toolUseId).toBe('a')
    expect(r1.toolUseId).toBe('b')
  })

  it('cancels all tools when agent is cancelled before launch (concurrent mode)', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 100, tracker), new TimedTool('toolB', 100, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    agent.addHook(BeforeToolsEvent, () => {
      agent.cancel()
    })

    await agent.invoke('Go')
    // No tool was invoked.
    expect(tracker).toHaveLength(0)
  })

  it('cooperative mid-flight cancel — tools honor cancelSignal and exit', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [
      new TimedTool('toolA', 200, tracker, /* honorCancelSignal */ true),
      new TimedTool('toolB', 200, tracker, true),
    ]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    // Fire cancel shortly after both tools have started.
    agent.addHook(BeforeToolCallEvent, () => {
      globalThis.setTimeout(() => agent.cancel(), 20)
    })

    await agent.invoke('Go')

    expect(tracker).toHaveLength(2)
    // Both tools observed the abort signal and exited cooperatively.
    expect(tracker.every((t) => t.cancelled)).toBe(true)
  })

  it('handles a throwing tool without affecting siblings', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 20, tracker), new TimedTool('toolB', 20, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    // A throwing tool.stream is caught by executeTool's own try/catch and
    // normalized to an error ToolResultBlock, so the race loop never sees the
    // rejection. This test verifies that normalization path keeps the sibling
    // unaffected in concurrent mode. The race loop's `kind: 'throw'` fallback
    // is a defensive backstop for generator-level rejections that escape
    // executeTool entirely — not expected in normal operation and not exercised
    // here.
    const results: ToolResultBlock[] = []
    agent.addHook(AfterToolsEvent, (e) => {
      for (const b of e.message.content) {
        if (b.type === 'toolResultBlock') results.push(b)
      }
    })

    // Replace toolA's stream implementation with one that throws.
    const broken = tools[0]!
    // eslint-disable-next-line require-yield
    broken.stream = async function* () {
      throw new Error('boom')
    }

    await agent.invoke('Go')

    const [a, b] = results.sort((x, y) => x.toolUseId.localeCompare(y.toolUseId))
    expect(a!.status).toBe('error')
    expect(b!.status).toBe('success')
  })

  it('handles an unknown tool in a batch without affecting siblings', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 10, tracker)] // no 'toolB' registered
    const agent = new Agent({
      model: new MockMessageModel()
        .addTurn([
          { type: 'toolUseBlock', name: 'toolA', toolUseId: 'a', input: {} },
          { type: 'toolUseBlock', name: 'unknownTool', toolUseId: 'b', input: {} },
        ])
        .addTurn({ type: 'textBlock', text: 'Done' }),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    let afterMessage: import('../../types/messages.js').Message | undefined
    agent.addHook(AfterToolsEvent, (e) => {
      afterMessage = e.message
    })

    await agent.invoke('Go')
    expect(afterMessage!.content).toHaveLength(2)
    const blocks = afterMessage!.content as ToolResultBlock[]
    expect(blocks.find((r) => r.toolUseId === 'a')!.status).toBe('success')
    expect(blocks.find((r) => r.toolUseId === 'b')!.status).toBe('error')
  })

  it('preserves source order of tool results in AfterToolsEvent.message', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    // toolA is slow, toolB is fast — concurrent completion order will be B then A.
    const tools = [new TimedTool('toolA', 60, tracker), new TimedTool('toolB', 5, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    let afterMessage: import('../../types/messages.js').Message | undefined
    agent.addHook(AfterToolsEvent, (e) => {
      afterMessage = e.message
    })

    await agent.invoke('Go')
    const blocks = afterMessage!.content as ToolResultBlock[]
    expect(blocks.map((b) => b.toolUseId)).toEqual(['a', 'b'])
  })

  it('AfterToolsEvent.message contains completed results when consumer breaks mid-stream', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 1, tracker, true), new TimedTool('toolB', 50, tracker, true)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    let afterToolsMessage: import('../../types/messages.js').Message | undefined
    agent.addHook(AfterToolsEvent, (e) => {
      afterToolsMessage = e.message
    })

    let toolResultsSeen = 0
    for await (const event of agent.stream('Go')) {
      if (event.type === 'toolResultEvent') {
        toolResultsSeen++
        if (toolResultsSeen === 1) break
      }
    }

    expect(afterToolsMessage).toBeDefined()
    const blocks = afterToolsMessage!.content.filter((b): b is ToolResultBlock => b.type === 'toolResultBlock')
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks.some((b) => b.toolUseId === 'a')).toBe(true)
  })

  it('pre-launch agent.cancel() during BeforeToolsEvent produces "Tool execution cancelled" (concurrent)', async () => {
    const tracker: { name: string; start: number; end: number; cancelled: boolean }[] = []
    const tools = [new TimedTool('toolA', 100, tracker), new TimedTool('toolB', 100, tracker)]
    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    agent.addHook(BeforeToolsEvent, () => {
      agent.cancel()
    })

    let afterMessage: import('../../types/messages.js').Message | undefined
    agent.addHook(AfterToolsEvent, (e) => {
      afterMessage = e.message
    })

    await agent.invoke('Go')

    expect(tracker).toHaveLength(0)
    const blocks = afterMessage!.content as ToolResultBlock[]
    expect(blocks).toHaveLength(2)
    for (const b of blocks) {
      expect((b.content[0] as TextBlock).text).toBe('Tool execution cancelled')
    }
  })

  it('closes in-flight generators and includes fallback results when consumer breaks', async () => {
    const tools = [new TimedTool('toolA', 1, []), new StreamingTool('toolB', 20, 2)]

    const agent = new Agent({
      model: twoToolTurn(),
      tools,
      toolExecutor: 'concurrent',
      printer: false,
    })

    let afterToolsMessage: import('../../types/messages.js').Message | undefined
    agent.addHook(AfterToolsEvent, (e) => {
      afterToolsMessage = e.message
    })

    let toolResultsSeen = 0
    for await (const event of agent.stream('Go')) {
      if (event.type === 'toolResultEvent') {
        toolResultsSeen++
        if (toolResultsSeen === 1) break
      }
    }

    // AfterToolsEvent.message should have entries for both tools:
    // toolA completed normally, toolB gets a fallback "interrupted" result.
    expect(afterToolsMessage).toBeDefined()
    const blocks = afterToolsMessage!.content as ToolResultBlock[]
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => b.toolUseId)).toEqual(['a', 'b'])
    expect(blocks.find((b) => b.toolUseId === 'a')!.status).toBe('success')
    expect(blocks.find((b) => b.toolUseId === 'b')!.status).toBe('error')
  })
})
