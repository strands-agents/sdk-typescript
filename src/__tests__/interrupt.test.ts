import { describe, expect, it } from 'vitest'
import { Interrupt, InterruptError, InterruptState } from '../interrupt.js'

describe('Interrupt', () => {
  describe('constructor', () => {
    it('creates instance with id and name', () => {
      const interrupt = new Interrupt({ id: 'int-1', name: 'confirm_action' })

      expect(interrupt).toEqual({
        id: 'int-1',
        name: 'confirm_action',
      })
    })

    it('creates instance with optional reason', () => {
      const interrupt = new Interrupt({
        id: 'int-1',
        name: 'confirm_action',
        reason: 'Please confirm this action',
      })

      expect(interrupt).toEqual({
        id: 'int-1',
        name: 'confirm_action',
        reason: 'Please confirm this action',
      })
    })

    it('creates instance with optional response', () => {
      const interrupt = new Interrupt({
        id: 'int-1',
        name: 'confirm_action',
        response: { approved: true },
      })

      expect(interrupt).toEqual({
        id: 'int-1',
        name: 'confirm_action',
        response: { approved: true },
      })
    })

    it('creates instance with all fields', () => {
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
    })
  })

  describe('toJSON', () => {
    it('serializes minimal interrupt', () => {
      const interrupt = new Interrupt({ id: 'int-1', name: 'test' })

      expect(interrupt.toJSON()).toStrictEqual({
        id: 'int-1',
        name: 'test',
      })
    })

    it('serializes interrupt with all fields', () => {
      const interrupt = new Interrupt({
        id: 'int-1',
        name: 'test',
        reason: { detail: 'confirm' },
        response: 'yes',
      })

      expect(interrupt.toJSON()).toStrictEqual({
        id: 'int-1',
        name: 'test',
        reason: { detail: 'confirm' },
        response: 'yes',
      })
    })
  })

  describe('fromJSON', () => {
    it('deserializes minimal interrupt', () => {
      const interrupt = Interrupt.fromJSON({ id: 'int-1', name: 'test' })

      expect(interrupt).toEqual({
        id: 'int-1',
        name: 'test',
      })
    })

    it('deserializes interrupt with all fields', () => {
      const interrupt = Interrupt.fromJSON({
        id: 'int-1',
        name: 'test',
        reason: { detail: 'confirm' },
        response: 'yes',
      })

      expect(interrupt).toEqual({
        id: 'int-1',
        name: 'test',
        reason: { detail: 'confirm' },
        response: 'yes',
      })
    })

    it('round-trips through JSON serialization', () => {
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
  })

  describe('response mutation', () => {
    it('allows setting response after construction', () => {
      const interrupt = new Interrupt({ id: 'int-1', name: 'test' })
      expect(interrupt.response).toBeUndefined()

      interrupt.response = 'user response'
      expect(interrupt.response).toBe('user response')
    })
  })
})

describe('InterruptError', () => {
  it('creates error with interrupt', () => {
    const interrupt = new Interrupt({ id: 'int-1', name: 'confirm_delete' })
    const error = new InterruptError(interrupt)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('InterruptError')
    expect(error.message).toBe('Interrupt raised: confirm_delete')
    expect(error.interrupt).toBe(interrupt)
  })

  it('can be caught and interrupt accessed', () => {
    const interrupt = new Interrupt({ id: 'int-1', name: 'test', reason: 'test reason' })

    try {
      throw new InterruptError(interrupt)
    } catch (e) {
      expect(e).toBeInstanceOf(InterruptError)
      const interruptError = e as InterruptError
      expect(interruptError.interrupt.name).toBe('test')
      expect(interruptError.interrupt.reason).toBe('test reason')
    }
  })
})

describe('InterruptState', () => {
  describe('initial state', () => {
    it('starts with empty interrupts and context', () => {
      const state = new InterruptState()

      expect(state.interrupts.size).toBe(0)
      expect(state.context.size).toBe(0)
      expect(state.activated).toBe(false)
    })
  })

  describe('activate', () => {
    it('sets activated to true', () => {
      const state = new InterruptState()
      expect(state.activated).toBe(false)

      state.activate()
      expect(state.activated).toBe(true)
    })
  })

  describe('deactivate', () => {
    it('clears interrupts, context, and sets activated to false', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')
      state.context.set('key', 'value')
      state.activate()

      state.deactivate()

      expect(state.interrupts.size).toBe(0)
      expect(state.context.size).toBe(0)
      expect(state.activated).toBe(false)
    })
  })

  describe('getOrCreateInterrupt', () => {
    it('creates new interrupt if not exists', () => {
      const state = new InterruptState()

      const interrupt = state.getOrCreateInterrupt('int-1', 'test', 'reason')

      expect(interrupt).toEqual({
        id: 'int-1',
        name: 'test',
        reason: 'reason',
      })
      expect(state.interrupts.get('int-1')).toBe(interrupt)
    })

    it('returns existing interrupt if exists', () => {
      const state = new InterruptState()
      const first = state.getOrCreateInterrupt('int-1', 'test', 'reason')
      first.response = 'user response'

      const second = state.getOrCreateInterrupt('int-1', 'different', 'different reason')

      expect(second).toBe(first)
      expect(second.response).toBe('user response')
    })
  })

  describe('getInterruptsList', () => {
    it('returns empty array when no interrupts', () => {
      const state = new InterruptState()

      expect(state.getInterruptsList()).toStrictEqual([])
    })

    it('returns array of all interrupts', () => {
      const state = new InterruptState()
      const int1 = state.getOrCreateInterrupt('int-1', 'first')
      const int2 = state.getOrCreateInterrupt('int-2', 'second')

      const list = state.getInterruptsList()

      expect(list).toHaveLength(2)
      expect(list).toContain(int1)
      expect(list).toContain(int2)
    })
  })

  describe('resume', () => {
    it('does nothing when not activated', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')

      state.resume([{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }])

      expect(state.interrupts.get('int-1')!.response).toBeUndefined()
    })

    it('populates interrupt responses when activated', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')
      state.activate()

      state.resume([{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }])

      expect(state.interrupts.get('int-1')!.response).toBe('yes')
    })

    it('handles multiple responses', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'first')
      state.getOrCreateInterrupt('int-2', 'second')
      state.activate()

      state.resume([
        { interruptResponse: { interruptId: 'int-1', response: 'response1' } },
        { interruptResponse: { interruptId: 'int-2', response: { complex: 'data' } } },
      ])

      expect(state.interrupts.get('int-1')!.response).toBe('response1')
      expect(state.interrupts.get('int-2')!.response).toStrictEqual({ complex: 'data' })
    })

    it('throws error for unknown interrupt ID', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')
      state.activate()

      expect(() => {
        state.resume([{ interruptResponse: { interruptId: 'unknown', response: 'yes' } }])
      }).toThrow('interrupt_id=<unknown> | no interrupt found')
    })

    it('stores responses in context', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test')
      state.activate()

      const responses = [{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }]
      state.resume(responses)

      expect(state.context.get('responses')).toBe(responses)
    })
  })

  describe('toJSON', () => {
    it('serializes empty state', () => {
      const state = new InterruptState()

      expect(state.toJSON()).toStrictEqual({
        interrupts: {},
        context: {},
        activated: false,
      })
    })

    it('serializes state with interrupts and context', () => {
      const state = new InterruptState()
      state.getOrCreateInterrupt('int-1', 'test', 'reason')
      state.context.set('key', 'value')
      state.activate()

      expect(state.toJSON()).toStrictEqual({
        interrupts: {
          'int-1': { id: 'int-1', name: 'test', reason: 'reason' },
        },
        context: { key: 'value' },
        activated: true,
      })
    })
  })

  describe('fromJSON', () => {
    it('deserializes empty state', () => {
      const state = InterruptState.fromJSON({
        interrupts: {},
        context: {},
        activated: false,
      })

      expect(state.interrupts.size).toBe(0)
      expect(state.context.size).toBe(0)
      expect(state.activated).toBe(false)
    })

    it('deserializes state with data', () => {
      const state = InterruptState.fromJSON({
        interrupts: {
          'int-1': { id: 'int-1', name: 'test', reason: 'reason', response: 'yes' },
        },
        context: { key: 'value' },
        activated: true,
      })

      expect(state.interrupts.size).toBe(1)
      expect(state.interrupts.get('int-1')).toEqual({
        id: 'int-1',
        name: 'test',
        reason: 'reason',
        response: 'yes',
      })
      expect(state.context.get('key')).toBe('value')
      expect(state.activated).toBe(true)
    })

    it('round-trips through JSON serialization', () => {
      const original = new InterruptState()
      original.getOrCreateInterrupt('int-1', 'test', { complex: 'reason' })
      original.interrupts.get('int-1')!.response = ['array', 'response']
      original.context.set('data', { nested: 'object' })
      original.activate()

      const serialized = JSON.stringify(original)
      const deserialized = InterruptState.fromJSON(JSON.parse(serialized))

      expect(deserialized.toJSON()).toStrictEqual(original.toJSON())
    })
  })
})
