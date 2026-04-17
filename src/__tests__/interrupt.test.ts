import { describe, it, expect } from 'vitest'
import { Interrupt, InterruptException, _InterruptState, generateInterruptId } from '../interrupt.js'

describe('Interrupt', () => {
  it('creates with required fields', () => {
    const interrupt = new Interrupt({ id: 'test-id', name: 'approval' })
    expect(interrupt.id).toBe('test-id')
    expect(interrupt.name).toBe('approval')
    expect(interrupt.reason).toBeUndefined()
    expect(interrupt.response).toBeUndefined()
  })

  it('creates with all fields', () => {
    const interrupt = new Interrupt({ id: 'test-id', name: 'approval', reason: 'needs review', response: 'approved' })
    expect(interrupt.reason).toBe('needs review')
    expect(interrupt.response).toBe('approved')
  })

  it('serializes to JSON and back', () => {
    const interrupt = new Interrupt({ id: 'test-id', name: 'approval', reason: 'needs review' })
    const json = interrupt.toJSON()
    const restored = Interrupt.fromJSON(json)
    expect(restored.id).toBe('test-id')
    expect(restored.name).toBe('approval')
    expect(restored.reason).toBe('needs review')
  })
})

describe('InterruptException', () => {
  it('carries the interrupt', () => {
    const interrupt = new Interrupt({ id: 'test-id', name: 'approval' })
    const error = new InterruptException(interrupt)
    expect(error.interrupt).toBe(interrupt)
    expect(error.name).toBe('InterruptException')
    expect(error.message).toBe('Interrupt: approval')
  })
})

describe('_InterruptState', () => {
  it('starts deactivated', () => {
    const state = new _InterruptState()
    expect(state.activated).toBe(false)
    expect(state.interrupts.size).toBe(0)
  })

  it('activates and deactivates', () => {
    const state = new _InterruptState()
    state.activate()
    expect(state.activated).toBe(true)
    state.deactivate()
    expect(state.activated).toBe(false)
    expect(state.interrupts.size).toBe(0)
    expect(state.context).toEqual({})
  })

  it('resumes with responses', () => {
    const state = new _InterruptState()
    const interrupt = new Interrupt({ id: 'int-1', name: 'approval' })
    state.interrupts.set('int-1', interrupt)
    state.activate()

    state.resume([{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }])
    expect(interrupt.response).toBe('yes')
  })

  it('throws on resume with unknown interrupt id', () => {
    const state = new _InterruptState()
    state.activate()
    expect(() => state.resume([{ interruptResponse: { interruptId: 'unknown', response: 'yes' } }])).toThrow(
      'No interrupt found for id: unknown'
    )
  })

  it('does nothing on resume when not activated', () => {
    const state = new _InterruptState()
    // Should not throw
    state.resume([{ interruptResponse: { interruptId: 'int-1', response: 'yes' } }])
  })

  it('serializes to JSON and back', () => {
    const state = new _InterruptState()
    const interrupt = new Interrupt({ id: 'int-1', name: 'approval', reason: 'review' })
    state.interrupts.set('int-1', interrupt)
    state.context = { key: 'value' }
    state.activate()

    const json = state.toJSON()
    const restored = _InterruptState.fromJSON(json as Record<string, unknown>)
    expect(restored.activated).toBe(true)
    expect(restored.interrupts.get('int-1')?.name).toBe('approval')
    expect(restored.context).toEqual({ key: 'value' })
  })
})

describe('generateInterruptId', () => {
  it('generates deterministic IDs', async () => {
    const id1 = await generateInterruptId('tool-1', 'approval')
    const id2 = await generateInterruptId('tool-1', 'approval')
    expect(id1).toBe(id2)
  })

  it('generates different IDs for different names', async () => {
    const id1 = await generateInterruptId('tool-1', 'approval')
    const id2 = await generateInterruptId('tool-1', 'rejection')
    expect(id1).not.toBe(id2)
  })

  it('generates different IDs for different tool use IDs', async () => {
    const id1 = await generateInterruptId('tool-1', 'approval')
    const id2 = await generateInterruptId('tool-2', 'approval')
    expect(id1).not.toBe(id2)
  })

  it('includes version prefix', async () => {
    const id = await generateInterruptId('tool-1', 'approval')
    expect(id).toMatch(/^v1:before_tool_call:tool-1:/)
  })
})
