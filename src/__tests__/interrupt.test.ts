import { describe, it, expect } from 'vitest'
import { Interrupt, InterruptException, InterruptState } from '../interrupt.js'
import { isInterruptResponseArray } from '../types/interrupt.js'

describe('Interrupt', () => {
  it('stores id, name, reason, and response', () => {
    const interrupt = new Interrupt({ id: 'i-1', name: 'approve', reason: 'needs approval', response: 'yes' })

    expect(interrupt.id).toBe('i-1')
    expect(interrupt.name).toBe('approve')
    expect(interrupt.reason).toBe('needs approval')
    expect(interrupt.response).toBe('yes')
  })

  it('defaults reason and response to null', () => {
    const interrupt = new Interrupt({ id: 'i-1', name: 'approve' })

    expect(interrupt.reason).toBeNull()
    expect(interrupt.response).toBeNull()
  })

  describe('toDict', () => {
    it('serializes to a plain object', () => {
      const interrupt = new Interrupt({ id: 'i-1', name: 'approve', reason: 'test', response: 'yes' })

      expect(interrupt.toDict()).toStrictEqual({
        id: 'i-1',
        name: 'approve',
        reason: 'test',
        response: 'yes',
      })
    })
  })

  describe('fromDict', () => {
    it('deserializes from a plain object', () => {
      const interrupt = Interrupt.fromDict({ id: 'i-2', name: 'confirm', reason: 'danger', response: 'ok' })

      expect(interrupt).toBeInstanceOf(Interrupt)
      expect(interrupt.id).toBe('i-2')
      expect(interrupt.name).toBe('confirm')
      expect(interrupt.reason).toBe('danger')
      expect(interrupt.response).toBe('ok')
    })

    it('roundtrips through toDict and fromDict', () => {
      const original = new Interrupt({ id: 'i-3', name: 'check', reason: { key: 'value' }, response: [1, 2, 3] })
      const restored = Interrupt.fromDict(original.toDict())

      expect(restored.toDict()).toStrictEqual(original.toDict())
    })
  })
})

describe('InterruptException', () => {
  it('holds an interrupt reference', () => {
    const interrupt = new Interrupt({ id: 'i-1', name: 'test' })
    const exception = new InterruptException(interrupt)

    expect(exception).toBeInstanceOf(Error)
    expect(exception.name).toBe('InterruptException')
    expect(exception.interrupt).toBe(interrupt)
    expect(exception.message).toBe('Interrupt raised: test')
  })
})

describe('InterruptState', () => {
  it('initializes with empty state', () => {
    const state = new InterruptState()

    expect(state.interrupts.size).toBe(0)
    expect(state.context).toStrictEqual({})
    expect(state.activated).toBe(false)
  })

  describe('activate', () => {
    it('sets activated to true', () => {
      const state = new InterruptState()
      state.activate()
      expect(state.activated).toBe(true)
    })
  })

  describe('deactivate', () => {
    it('clears interrupts, context, and sets activated to false', () => {
      const state = new InterruptState()
      state.interrupts.set('i-1', new Interrupt({ id: 'i-1', name: 'test' }))
      state.context['key'] = 'value'
      state.activate()

      state.deactivate()

      expect(state.interrupts.size).toBe(0)
      expect(state.context).toStrictEqual({})
      expect(state.activated).toBe(false)
    })
  })

  describe('resume', () => {
    it('is a no-op when not activated', () => {
      const state = new InterruptState()
      state.resume('anything')
      expect(state.activated).toBe(false)
    })

    it('throws TypeError when activated but prompt is not an array', () => {
      const state = new InterruptState()
      state.activate()

      expect(() => state.resume('not-an-array')).toThrow(TypeError)
      expect(() => state.resume('not-an-array')).toThrow("must resume from interrupt with list of interruptResponse's")
    })

    it('throws TypeError when array element is not an object or is null', () => {
      const state = new InterruptState()
      state.activate()

      expect(() => state.resume([null])).toThrow(TypeError)
      expect(() => state.resume([null])).toThrow("must resume from interrupt with list of interruptResponse's")
      expect(() => state.resume(['not an object'])).toThrow(TypeError)
    })

    it('throws TypeError when array contains non-interruptResponse keys', () => {
      const state = new InterruptState()
      state.activate()

      expect(() => state.resume([{ badKey: 'value' }])).toThrow(TypeError)
      expect(() => state.resume([{ badKey: 'value' }])).toThrow(
        "must resume from interrupt with list of interruptResponse's"
      )
    })

    it('throws Error when interrupt ID not found', () => {
      const state = new InterruptState()
      state.activate()

      expect(() => state.resume([{ interruptResponse: { interruptId: 'unknown-id', response: 'yes' } }])).toThrow(
        'interrupt_id=<unknown-id> | no interrupt found'
      )
    })

    it('maps responses to interrupts by ID', () => {
      const state = new InterruptState()
      const interrupt = new Interrupt({ id: 'i-1', name: 'approve' })
      state.interrupts.set('i-1', interrupt)
      state.activate()

      state.resume([{ interruptResponse: { interruptId: 'i-1', response: 'approved' } }])

      expect(interrupt.response).toBe('approved')
      expect(state.context['responses']).toStrictEqual([
        { interruptResponse: { interruptId: 'i-1', response: 'approved' } },
      ])
    })

    it('maps multiple responses to multiple interrupts', () => {
      const state = new InterruptState()
      const interrupt1 = new Interrupt({ id: 'i-1', name: 'approve' })
      const interrupt2 = new Interrupt({ id: 'i-2', name: 'confirm' })
      state.interrupts.set('i-1', interrupt1)
      state.interrupts.set('i-2', interrupt2)
      state.activate()

      state.resume([
        { interruptResponse: { interruptId: 'i-1', response: 'yes' } },
        { interruptResponse: { interruptId: 'i-2', response: 'no' } },
      ])

      expect(interrupt1.response).toBe('yes')
      expect(interrupt2.response).toBe('no')
    })
  })

  describe('toDict', () => {
    it('serializes to a plain object', () => {
      const state = new InterruptState()
      state.interrupts.set('i-1', new Interrupt({ id: 'i-1', name: 'test', reason: 'r', response: 's' }))
      state.context['key'] = 'value'
      state.activate()

      expect(state.toDict()).toStrictEqual({
        interrupts: {
          'i-1': { id: 'i-1', name: 'test', reason: 'r', response: 's' },
        },
        context: { key: 'value' },
        activated: true,
      })
    })
  })

  describe('fromDict', () => {
    it('deserializes from a plain object', () => {
      const state = InterruptState.fromDict({
        interrupts: {
          'i-1': { id: 'i-1', name: 'test', reason: 'r', response: 's' },
        },
        context: { key: 'value' },
        activated: true,
      })

      expect(state.interrupts.size).toBe(1)
      expect(state.interrupts.get('i-1')).toBeInstanceOf(Interrupt)
      expect(state.interrupts.get('i-1')!.name).toBe('test')
      expect(state.context).toStrictEqual({ key: 'value' })
      expect(state.activated).toBe(true)
    })

    it('roundtrips through toDict and fromDict', () => {
      const original = new InterruptState()
      original.interrupts.set('i-1', new Interrupt({ id: 'i-1', name: 'a', reason: 1, response: 2 }))
      original.interrupts.set('i-2', new Interrupt({ id: 'i-2', name: 'b', reason: null, response: null }))
      original.context['tool_use_message'] = { role: 'assistant' }
      original.activate()

      const restored = InterruptState.fromDict(original.toDict())

      expect(restored.toDict()).toStrictEqual(original.toDict())
    })
  })
})

describe('isInterruptResponseArray', () => {
  it('returns false for non-array', () => {
    expect(isInterruptResponseArray(null)).toBe(false)
    expect(isInterruptResponseArray(undefined)).toBe(false)
    expect(isInterruptResponseArray('')).toBe(false)
    expect(isInterruptResponseArray({})).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(isInterruptResponseArray([])).toBe(false)
  })

  it('returns false when element has no interruptResponse', () => {
    expect(isInterruptResponseArray([{}])).toBe(false)
    expect(isInterruptResponseArray([{ other: 1 }])).toBe(false)
  })

  it('returns false when interruptResponse is not an object or is null', () => {
    expect(isInterruptResponseArray([{ interruptResponse: null }])).toBe(false)
    expect(isInterruptResponseArray([{ interruptResponse: 'string' }])).toBe(false)
  })

  it('returns false when interruptResponse has no interruptId or non-string interruptId', () => {
    expect(isInterruptResponseArray([{ interruptResponse: {} }])).toBe(false)
    expect(isInterruptResponseArray([{ interruptResponse: { interruptId: 123, response: 'x' } }])).toBe(false)
  })

  it('returns true for valid InterruptResponseContent array', () => {
    expect(isInterruptResponseArray([{ interruptResponse: { interruptId: 'i-1', response: 'yes' } }])).toBe(true)
    expect(
      isInterruptResponseArray([
        { interruptResponse: { interruptId: 'i-1', response: 'a' } },
        { interruptResponse: { interruptId: 'i-2', response: 'b' } },
      ])
    ).toBe(true)
  })
})
