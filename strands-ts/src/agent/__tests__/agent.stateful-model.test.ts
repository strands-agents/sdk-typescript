import { describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { SlidingWindowConversationManager } from '../../conversation-manager/sliding-window-conversation-manager.js'
import { NullConversationManager } from '../../conversation-manager/null-conversation-manager.js'
import type { Message, StreamOptions } from '../../index.js'
import type { ModelStreamEvent } from '../../models/streaming.js'

/**
 * Mock model that advertises itself as stateful and records the modelState
 * object it receives, so tests can verify the agent's modelState flows through.
 */
class StatefulMockModel extends MockMessageModel {
  readonly receivedOptions: StreamOptions[] = []
  private readonly _responseIds: string[]

  constructor(responseIds: string[] = ['resp_1', 'resp_2', 'resp_3']) {
    super()
    this._responseIds = responseIds
  }

  override get stateful(): boolean {
    return true
  }

  override async *stream(messages: Message[], options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.receivedOptions.push(options ?? {})
    // Simulate that the provider captured a fresh response id on the wire.
    if (options?.modelState) {
      const next = this._responseIds[this.receivedOptions.length - 1]
      if (next !== undefined) {
        options.modelState.responseId = next
      }
    }
    yield* super.stream(messages, options)
  }
}

describe('Agent with stateful model', () => {
  describe('constructor', () => {
    it('throws when a conversationManager is supplied alongside a stateful model', () => {
      const model = new StatefulMockModel()
      expect(
        () => new Agent({ model, conversationManager: new SlidingWindowConversationManager({ windowSize: 5 }) })
      ).toThrow(/stateful model/)
    })

    it('assigns NullConversationManager when the model is stateful', () => {
      const model = new StatefulMockModel()
      const agent = new Agent({ model, printer: false })
      // Private field; access through bracket notation to avoid making it public.
      expect((agent as unknown as { _conversationManager: unknown })._conversationManager).toBeInstanceOf(
        NullConversationManager
      )
    })

    it('initializes modelState as an empty object', () => {
      const model = new StatefulMockModel()
      const agent = new Agent({ model, printer: false })
      expect(agent.modelState).toEqual({})
    })
  })

  describe('invocation', () => {
    it('passes agent.modelState to the model via streamOptions.modelState', async () => {
      const model = new StatefulMockModel(['resp_first']).addTurn({ type: 'textBlock', text: 'Hi' })
      const agent = new Agent({ model, printer: false })
      await agent.invoke('Hello')
      expect(model.receivedOptions[0]?.modelState).toBe(agent.modelState)
      expect(agent.modelState).toEqual({ responseId: 'resp_first' })
    })

    it('clears messages after invocation since the server holds history', async () => {
      const model = new StatefulMockModel().addTurn({ type: 'textBlock', text: 'Hi there' })
      const agent = new Agent({ model, printer: false })
      await agent.invoke('First turn')
      expect(agent.messages).toEqual([])
    })

    it('preserves modelState across invocations so previous_response_id chains', async () => {
      const model = new StatefulMockModel(['resp_1', 'resp_2'])
        .addTurn({ type: 'textBlock', text: 'one' })
        .addTurn({ type: 'textBlock', text: 'two' })
      const agent = new Agent({ model, printer: false })

      await agent.invoke('turn 1')
      expect(agent.modelState).toEqual({ responseId: 'resp_1' })

      await agent.invoke('turn 2')
      expect(agent.modelState).toEqual({ responseId: 'resp_2' })

      // Both turns should have seen the state at invocation time.
      expect(model.receivedOptions).toHaveLength(2)
    })
  })

  describe('stateless model (default)', () => {
    it('does not clear messages after invocation', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, printer: false })
      await agent.invoke('Hi')
      // user message + assistant reply
      expect(agent.messages.length).toBe(2)
    })

    it('uses the caller-provided conversationManager', () => {
      const model = new MockMessageModel()
      const convo = new SlidingWindowConversationManager({ windowSize: 7 })
      const agent = new Agent({ model, conversationManager: convo })
      expect((agent as unknown as { _conversationManager: unknown })._conversationManager).toBe(convo)
    })
  })
})
