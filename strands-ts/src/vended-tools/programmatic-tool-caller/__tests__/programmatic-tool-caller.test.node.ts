import { beforeEach, describe, expect, it, vi } from 'vitest'
import { programmaticToolCaller } from '../programmatic-tool-caller.js'
import { Agent } from '../../../agent/agent.js'
import { MockMessageModel } from '../../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../../__fixtures__/tool-helpers.js'
import { TextBlock, ToolResultBlock } from '../../../types/messages.js'

/**
 * Helper to invoke the programmatic_tool_caller tool against an Agent and
 * return the resulting ToolResultBlock.
 */
async function runCode(
  agent: Agent,
  code: string,
  options?: { recordDirectToolCall?: boolean }
): Promise<ToolResultBlock> {
  return await agent.tool.programmatic_tool_caller!.invoke({ code }, options)
}

/**
 * Creates an Agent pre-loaded with the programmatic_tool_caller tool plus the
 * supplied additional tools.
 */
function makeAgent(extraTools: ReturnType<typeof createMockTool>[] = []): Agent {
  const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
  return new Agent({ model, tools: [programmaticToolCaller, ...extraTools] })
}

/**
 * Extracts the joined text of all TextBlocks in a ToolResultBlock's content.
 */
function getText(result: ToolResultBlock): string {
  return result.content
    .filter((b): b is TextBlock => b instanceof TextBlock)
    .map((b) => b.text)
    .join('\n')
}

describe('programmatic_tool_caller tool', () => {
  // vitest config has `unstubEnvs: true`, so vi.stubEnv() values are
  // automatically restored after each test. We just zero-out the two
  // env vars we care about at the start of every test so values from
  // a previous run (or the host) cannot leak in.
  beforeEach(() => {
    vi.stubEnv('PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS', '')
    vi.stubEnv('PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES', '')
  })

  describe('tool surface', () => {
    it('exposes the canonical name', () => {
      expect(programmaticToolCaller.name).toBe('programmatic_tool_caller')
    })

    it('declares a `code` string parameter in its tool spec', () => {
      const schema = programmaticToolCaller.toolSpec.inputSchema as {
        properties?: { code?: { type?: string } }
      }
      expect(schema.properties?.code?.type).toBe('string')
    })
  })

  describe('basic execution', () => {
    it('captures a simple console.log expression', async () => {
      const agent = makeAgent()
      const result = await runCode(agent, 'console.log(1 + 1)')
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('2')
    })

    it('returns "(no output)" when nothing is logged', async () => {
      const agent = makeAgent()
      const result = await runCode(agent, 'const x = 1 + 1')
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('(no output)')
    })

    it('captures console.error and console.warn separately', async () => {
      const agent = makeAgent()
      const result = await runCode(
        agent,
        `
          console.log('log line')
          console.error('error line')
          console.warn('warn line')
          console.info('info line')
        `
      )
      expect(result.status).toBe('success')
      expect(getText(result)).toBe(['log line', 'error line', 'warn line', 'info line'].join('\n'))
    })

    it('coerces non-string console arguments via util.inspect', async () => {
      const agent = makeAgent()
      const result = await runCode(agent, 'console.log({ a: 1, b: [2, 3] })')
      expect(result.status).toBe('success')
      // util.inspect format ⇒ no surrounding JSON quotes
      expect(getText(result)).toContain('a: 1')
      expect(getText(result)).toContain('b: [ 2, 3 ]')
    })
  })

  describe('tool invocation from user code', () => {
    it('awaits a tool that returns text', async () => {
      const agent = makeAgent([
        createMockTool(
          'echo',
          () =>
            new ToolResultBlock({
              toolUseId: 'echo-id',
              status: 'success',
              content: [new TextBlock('hello world')],
            })
        ),
      ])
      const result = await runCode(agent, 'console.log(await echo({}))')
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('hello world')
    })

    it('throws when an awaited tool returns an error result (user can try/catch)', async () => {
      const agent = makeAgent([
        createMockTool(
          'failing',
          () =>
            new ToolResultBlock({
              toolUseId: 'fail-id',
              status: 'error',
              content: [new TextBlock('boom')],
            })
        ),
      ])
      const result = await runCode(
        agent,
        `
          try {
            await failing({})
            console.log('should not reach')
          } catch (e) {
            console.log('caught:', e.message)
          }
        `
      )
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('caught: boom')
    })

    it('runs Promise.all in parallel', async () => {
      const calls: string[] = []
      const agent = makeAgent([
        createMockTool('first', (ctx) => {
          calls.push('first')
          return new ToolResultBlock({
            toolUseId: ctx.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock('A')],
          })
        }),
        createMockTool('second', (ctx) => {
          calls.push('second')
          return new ToolResultBlock({
            toolUseId: ctx.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock('B')],
          })
        }),
      ])
      const result = await runCode(
        agent,
        `
          const [a, b] = await Promise.all([first({}), second({})])
          console.log(a, b)
        `
      )
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('A B')
      expect(calls.sort()).toEqual(['first', 'second'])
    })

    it('iterates a for-loop with N tool calls', async () => {
      let counter = 0
      const agent = makeAgent([
        createMockTool('count', (ctx) => {
          counter += 1
          return new ToolResultBlock({
            toolUseId: ctx.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock(String(counter))],
          })
        }),
      ])
      const result = await runCode(
        agent,
        `
          for (let i = 0; i < 3; i++) {
            const v = await count({})
            console.log('step', v)
          }
        `
      )
      expect(result.status).toBe('success')
      expect(getText(result)).toBe(['step 1', 'step 2', 'step 3'].join('\n'))
      expect(counter).toBe(3)
    })

    it('exposes hyphen-named tools via underscore alias', async () => {
      const agent = makeAgent([
        createMockTool(
          'my-tool',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('via-underscore')],
            })
        ),
      ])
      const result = await runCode(agent, 'console.log(await my_tool({}))')
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('via-underscore')
    })

    it('passes the user-supplied input to the underlying tool', async () => {
      let captured: unknown = null
      const agent = makeAgent([
        createMockTool('echo-input', (ctx) => {
          captured = ctx.toolUse.input
          return new ToolResultBlock({
            toolUseId: ctx.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock('ok')],
          })
        }),
      ])
      const result = await runCode(agent, "await echo_input({ a: 1, b: 'two' })")
      expect(result.status).toBe('success')
      expect(captured).toStrictEqual({ a: 1, b: 'two' })
    })
  })

  describe('namespace policy', () => {
    it('respects PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS as a positive filter', async () => {
      vi.stubEnv('PROGRAMMATIC_TOOL_CALLER_ALLOWED_TOOLS', 'allowed_only')
      const agent = makeAgent([
        createMockTool(
          'allowed_only',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('yes')],
            })
        ),
        createMockTool(
          'excluded',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('should-not-run')],
            })
        ),
      ])

      // Allowed tool resolves; excluded raises a ReferenceError captured as error result.
      const ok = await runCode(agent, 'console.log(await allowed_only({}))')
      expect(ok.status).toBe('success')
      expect(getText(ok)).toBe('yes')

      const fail = await runCode(agent, 'await excluded({})')
      expect(fail.status).toBe('error')
      expect(getText(fail)).toMatch(/excluded is not defined/)
    })

    it('throws when a tool name conflicts with the reserved `console` identifier', async () => {
      const agent = makeAgent([
        createMockTool(
          'console',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('shouldnt')],
            })
        ),
      ])
      const result = await runCode(agent, 'console.log(1)')
      expect(result.status).toBe('error')
      expect(getText(result)).toMatch(/conflict with reserved namespace entries/)
    })

    it('loads allow-listed Node built-ins when requested via env', async () => {
      vi.stubEnv('PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES', 'path,os')
      const agent = makeAgent()
      const result = await runCode(
        agent,
        `
          console.log(typeof path.join)
          console.log(typeof os.platform)
        `
      )
      expect(result.status).toBe('success')
      expect(getText(result)).toBe(['function', 'function'].join('\n'))
    })

    it('normalizes module names with non-identifier chars (fs/promises -> fs_promises)', async () => {
      // `fs/promises` would otherwise crash `new AsyncFunction('fs/promises', ...)`
      // with `SyntaxError: Arg string terminates parameters early`, since `/`
      // is not a valid character in a JS identifier. We normalize to
      // `fs_promises` before injection.
      vi.stubEnv('PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES', 'fs/promises')
      const agent = makeAgent()
      const result = await runCode(
        agent,
        `
          console.log(typeof fs_promises)
          console.log(typeof fs_promises.readFile)
        `
      )
      expect(result.status).toBe('success')
      expect(getText(result)).toBe(['object', 'function'].join('\n'))
    })

    it('skips and warns on disallowed extra modules without exposing them', async () => {
      vi.stubEnv('PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES', 'child_process')
      const agent = makeAgent()
      const result = await runCode(agent, 'console.log(child_process.exec)')
      // child_process is not exposed → ReferenceError captured.
      expect(result.status).toBe('error')
      expect(getText(result)).toMatch(/child_process is not defined/)
    })
  })

  describe('error handling', () => {
    it('returns status=error for a syntax error in the user code', async () => {
      const agent = makeAgent()
      const result = await runCode(agent, 'this is not valid javascript ::::')
      expect(result.status).toBe('error')
      expect(getText(result)).toMatch(/SyntaxError|Unexpected/)
    })

    it('returns status=error with a stack trace for runtime errors', async () => {
      const agent = makeAgent()
      const result = await runCode(agent, 'throw new Error("kaboom")')
      expect(result.status).toBe('error')
      const text = getText(result)
      expect(text).toContain('kaboom')
      // Stack trace should be present (formatted under "Execution error:").
      expect(text).toContain('Execution error:')
    })

    it('captures errors thrown inside tool calls when not handled', async () => {
      const agent = makeAgent([
        createMockTool(
          'always-fails',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'error',
              content: [new TextBlock('upstream failure')],
            })
        ),
      ])
      const result = await runCode(agent, 'await always_fails({})')
      expect(result.status).toBe('error')
      expect(getText(result)).toContain('upstream failure')
    })
  })

  describe('message recording', () => {
    it('does NOT mutate agent.messages when invoking with recordDirectToolCall=false', async () => {
      const agent = makeAgent([
        createMockTool(
          'inner',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('called')],
            })
        ),
      ])
      const before = agent.messages.length
      const result = await agent.tool.programmatic_tool_caller!.invoke(
        { code: 'await inner({})' },
        { recordDirectToolCall: false }
      )
      expect(result.status).toBe('success')
      // No messages were recorded for either the outer call or the inner tool call.
      expect(agent.messages.length).toBe(before)
    })

    it('records only the outer programmatic_tool_caller call when recording is enabled', async () => {
      const agent = makeAgent([
        createMockTool(
          'inner',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('called')],
            })
        ),
      ])
      const before = agent.messages.length
      // Default recordDirectToolCall=true ⇒ exactly 3 messages added (toolUse, toolResult, ack).
      // The INNER tool call must NOT add additional messages because programmatic_tool_caller
      // forwards `recordDirectToolCall: false` to nested invocations.
      await agent.tool.programmatic_tool_caller!.invoke({ code: 'await inner({})' })
      expect(agent.messages.length).toBe(before + 3)
    })
  })

  describe('robustness against bad tool names', () => {
    it('skips a tool whose name is a JS reserved word and keeps other tools working', async () => {
      // `return` is a strict-mode reserved word; using it as an AsyncFunction
      // parameter name would throw SyntaxError on every execution.
      const agent = makeAgent([
        createMockTool(
          'return',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('should-not-be-callable')],
            })
        ),
        createMockTool(
          'good',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('ok')],
            })
        ),
      ])
      const result = await runCode(agent, 'console.log(await good({}))')
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('ok')

      const blocked = await runCode(agent, "await this['return']({})")
      expect(blocked.status).toBe('error')
    })

    it('skips a tool whose name starts with a digit and keeps other tools working', async () => {
      const agent = makeAgent([
        createMockTool(
          '1bad',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('nope')],
            })
        ),
        createMockTool(
          'good',
          (ctx) =>
            new ToolResultBlock({
              toolUseId: ctx.toolUse.toolUseId,
              status: 'success',
              content: [new TextBlock('ok')],
            })
        ),
      ])
      const result = await runCode(agent, 'console.log(await good({}))')
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('ok')
    })
  })

  describe('console capture is immune to util.inspect mutation', () => {
    it('keeps formatting non-string args even when user code reassigns util.inspect', async () => {
      vi.stubEnv('PROGRAMMATIC_TOOL_CALLER_EXTRA_MODULES', 'util')
      const agent = makeAgent()
      // First execution: poison `util.inspect` (which is exposed as the
      // namespace binding `util` — its `inspect` field is mutable).
      const poison = await runCode(
        agent,
        `
          util.inspect = () => 'POISONED'
          console.log('first', { foo: 'bar' })
        `
      )
      expect(poison.status).toBe('success')
      // First-run output uses the snapshotted inspect, not the poisoned one.
      expect(getText(poison)).toContain("foo: 'bar'")

      // Second, independent execution must still format objects correctly —
      // proving the mutation did not leak into the capture console.
      const after = await runCode(agent, "console.log({ foo: 'baz' })")
      expect(after.status).toBe('success')
      expect(getText(after)).toContain("foo: 'baz'")
      expect(getText(after)).not.toContain('POISONED')
    })
  })

  describe('post-return async writes are silently dropped (documented)', () => {
    it('drops console.log scheduled with setTimeout that resolves after the tool returns', async () => {
      const agent = makeAgent()
      // We schedule a write 50ms in the future but DO NOT await it.
      // The tool will return immediately; the scheduled write hits the
      // (now-unread) buffer with no effect on the returned text. This
      // documents the boundary so future regressions are visible.
      const result = await runCode(
        agent,
        `
          setTimeout(() => console.log('LATE'), 50)
          console.log('on time')
        `
      )
      expect(result.status).toBe('success')
      expect(getText(result)).toBe('on time')
      // Wait long enough for the unawaited timeout to fire — the test
      // would only fail here if 'LATE' somehow leaked into the next
      // capture (cross-run pollution) or to real stdout.
      await new Promise((r) => setTimeout(r, 80))

      const next = await runCode(agent, "console.log('next')")
      expect(getText(next)).toBe('next')
    })
  })
})
