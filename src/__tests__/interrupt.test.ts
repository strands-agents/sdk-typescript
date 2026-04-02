import { describe, expect, it } from 'vitest'
import { Interrupt, InterruptError, InterruptState } from '../interrupt.js'

describe('Interrupt', () => {
  it('constructs with all fields and supports response mutation', () => {
    const interrupt = new Interrupt({
      id: 'int-1',
      name: 'confirm_action',
      reason: 'Please confirm',
      response: 'approved',
    })

    expect(interrupt).toEqual({
      id: 'int-1',
      name: 'confirm_action',
      reason: 'Please confirm',
      response: 'approved',
    })

    // response is mutable after construction
    interrupt.response = 'changed'
    expect(interrupt.response).toBe('changed')
  })

  it('round-trips through JSON serialization with complex data', () => {
    const original = new Interrupt({
      id: 'int-1',
      name: 'test',
      reason: { complex: { nested: 'data' } },
      response: ['array', 'response'],
    })

    const serialized = JSON.stringify(original)
    const deserialized = Interrupt.fromJSON(JSON.parse(serialized))

    expect(deserialized).toEqual(original)
  })

  it('omits undefined reason/response from toJSON', () => {
    const interrupt = new Interrupt({ id: 'int-1', name: 'test' })

    const json = interrupt.toJSON()
    expect(json).toStrictEqual({ id: 'int-1', name: 'test' })
    expect('reason' in json).toBe(false)
    expect('response' in json).toBe(false)
  })
})

describe('InterruptError', () => {
  it('creates catchable error with interrupt reference', () => {
    const interrupt = new Interrupt({ id: 'int-1', name: 'confirm_delete' })
    const error = new InterruptError(interrupt)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('InterruptError')
    expect(error.message).toBe('Interrupt raised: confirm_delete')
    expect(error.interrupt).toBe(interrupt)
  })
})

describe('InterruptState', () => {
  describe('getOrCreateInterrupt', () => {
    it('creates new interrupt and stores it', () => {
      const state = new InterruptState()

      const interrupt = state.getOrCreateInterrupt('int-1', 'test', 'reason')

      expect(interrupt).toEqual({ id: 'int-1', name: 'test', reason: 'reason' })
      expect(state.interrupts.get('int-1')).toBe(interrupt)
      expect(state.getInterruptsList()).toStrictEqual([interrupt])
    })

    it('returns existing interrupt by ID without overwriting', () => {
      const state = new InterruptState()
      const first = state.getOrCreateInterrupt('int-1', 'test', 'reason')
      first.response = 'user response'

      const second = state.getOrCreateInterrupt('int-1', 'different', 'different reason')

      expect(second).toBe(first)
      expect(second.response).toBe('user response')
    })

    it('inherits response from matching name when activated and ID differs', () => {
      const state = new InterruptState()
      const first = state.getOrCreateInterrupt('tool:tool-1:0:confirm', 'confirm', 'reason')
      state.activate()
      first.response = { approved: true }

      const second = state.getOrCreateInterrupt('tool:tool-2:0:confirm', 'confirm', 'reason')

      expect(second.id).toBe('tool:tool-2:0:confirm')
      expect(second.response).toEqual({ approved: true })
    })

    it('does not inherit response when not activated', () => {
      const state = new InterruptState()
      const first = state.getOrCreateInterrupt('tool:tool-1:0:confirm', 'confirm', 'reason')
      first.response = { approved: true }

      const second = state.getOrCreateInterrupt('tool:tool-2:0:confirm', 'confirm', 'reason')

      expect(second.response).toBeUndefined()
    })
  })

  describe('activate / deactivate', () => {
    it('deactivate clears all state', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')
      state.activate()
      expect(state.activated).toBe(true)

      state.deactivate()

      expect(state.interrupts.size).toBe(0)
      expect(state.resumeResponses).toBeUndefined()
      expect(state.activated).toBe(false)
    })
  })

  describe('resume', () => {
    it('does nothing when not activated', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')

      state.resume([{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }])

      expect(state.interrupts.get('int-1')!.response).toBeUndefined()
    })

    it('populates interrupt responses and stores resumeResponses when activated', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'first')
      state.getOrCreateInterrupt('int-2', 'second')
      state.activate()

      const responses = [
        { interruptResponse: { interruptId: 'int-1', response: 'response1' } },
        { interruptResponse: { interruptId: 'int-2', response: { complex: 'data' } } },
      ]
      state.resume(responses)

      expect(state.interrupts.get('int-1')!.response).toBe('response1')
      expect(state.interrupts.get('int-2')!.response).toStrictEqual({ complex: 'data' })
      expect(state.resumeResponses).toBe(responses)
    })

    it('throws error for unknown interrupt ID', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')
      state.activate()

      expect(() => {
        state.resume([{ interruptResponse: { interruptId: 'unknown', response: 'yes' } }])
      }).toThrow('interrupt_id=<unknown> | no interrupt found')
    })
  })

  describe('serialization', () => {
    it('round-trips through JSON with full state', () => {
      const original = new InterruptState()
      original.getOrCreateInterrupt('int-1', 'test', { complex: 'reason' })
      original.interrupts.get('int-1')!.response = ['array', 'response']
      original.activate()

      const serialized = JSON.stringify(original)
      const deserialized = InterruptState.fromJSON(JSON.parse(serialized))

      expect(deserialized.toJSON()).toStrictEqual(original.toJSON())
    })

    it('deserializes state with resumeResponses', () => {
      const state = InterruptState.fromJSON({
        interrupts: {
          'int-1': { id: 'int-1', name: 'test', reason: 'reason', response: 'yes' },
        },
        resumeResponses: [{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }],
        activated: true,
      })

      expect(state.interrupts.size).toBe(1)
      expect(state.interrupts.get('int-1')).toEqual({
        id: 'int-1',
        name: 'test',
        reason: 'reason',
        response: 'yes',
      })
      expect(state.resumeResponses).toStrictEqual([{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }])
      expect(state.activated).toBe(true)
    })
  })
})
