/**
 * Integration tests for the interrupt system (human-in-the-loop).
 *
 * Uses a mock model so tests run without provider credentials.
 * Verifies interrupt raise from BeforeToolCallEvent and resume with interrupt responses.
 */

import { MockMessageModel } from '$/sdk/__fixtures__/mock-message-model.js'
import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { Agent, BeforeToolCallEvent, tool } from '@strands-agents/sdk-fork'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const echoTool = tool({
  name: 'echo',
  description: 'Echoes the input',
  inputSchema: z.object({ value: z.string() }),
  callback: async ({ value }) => value,
})

describe('Interrupt system', () => {
  it('raises interrupt from BeforeToolCallEvent and resumes with interrupt responses', async () => {
    const model = new MockMessageModel()
      .addTurn(
        {
          type: 'toolUseBlock',
          name: 'echo',
          toolUseId: 'call-1',
          input: { value: 'hello' },
        },
        'toolUse'
      )
      .addTurn({ type: 'textBlock', text: 'Done.' })

    const agent = new Agent({
      model,
      printer: false,
      tools: [echoTool],
    })

    agent.hooks.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
      event.interrupt('confirm-echo', 'Please confirm this tool call')
    })

    const { result: firstResult } = await collectGenerator(agent.stream('Echo hello'))

    expect(firstResult.stopReason).toBe('interrupt')
    expect(firstResult.interrupts).toBeDefined()
    expect(firstResult.interrupts!.length).toBeGreaterThanOrEqual(1)

    const responses = firstResult.interrupts!.map((i) => ({
      interruptResponse: {
        interruptId: i.id,
        response: [{ type: 'textBlock' as const, text: 'confirmed' }],
      },
    }))
    const finalResult = await agent.invoke(responses)
    expect(finalResult.stopReason).toBe('endTurn')
    expect(finalResult.lastMessage.role).toBe('assistant')
  })

  it('returns result with interrupts when hook raises on tool call', async () => {
    const model = new MockMessageModel()
      .addTurn({ type: 'toolUseBlock', name: 'echo', toolUseId: 'call-1', input: { value: 'a' } }, 'toolUse')
      .addTurn({ type: 'textBlock', text: 'Done.' })

    const agent = new Agent({
      model,
      printer: false,
      tools: [echoTool],
    })

    agent.hooks.addCallback(BeforeToolCallEvent, (event: BeforeToolCallEvent) => {
      event.interrupt('confirm', 'Confirm tool')
    })

    const { result } = await collectGenerator(agent.stream('Echo a'))

    expect(result.stopReason).toBe('interrupt')
    expect(result.interrupts!.length).toBeGreaterThanOrEqual(1)
    expect(result.interrupts!.some((i) => i.name === 'confirm')).toBe(true)
  })
})
