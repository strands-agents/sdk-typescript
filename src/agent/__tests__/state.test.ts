import { describe, expect, it } from 'vitest'
import { AgentState } from '../state.js'

describe('AgentState', () => {
  describe('constructor', () => {
    it('creates empty state when no initial state provided', () => {
      const state = new AgentState()
      expect(state.keys()).toEqual([])
    })

    it('creates state with initial values', () => {
      const state = new AgentState({ key1: 'value1', key2: 42 })
      expect(state.get('key1')).toBe('value1')
      expect(state.get('key2')).toBe(42)
    })

    it('stores deep copy of initial state', () => {
      const initial = { nested: { value: 'test' } }
      const state = new AgentState(initial)

      // Mutate original
      initial.nested.value = 'changed'

      // State should not be affected
      expect(state.get('nested')).toEqual({ value: 'test' })
    })

    it('silently drops functions in initial state', () => {
      const invalidState = { func: () => 'test', value: 'keep' }
      const state = new AgentState(invalidState as never)
      expect(state.get('func')).toBeUndefined()
      expect(state.get('value')).toBe('keep')
    })
  })

  describe('get', () => {
    it('throws error when key is null or undefined', () => {
      const state = new AgentState()
      expect(() => state.get(null as any)).toThrow('key is required')
      expect(() => state.get(undefined as any)).toThrow('key is required')
    })

    it('returns undefined when key does not exist', () => {
      const state = new AgentState()
      expect(state.get('nonexistent')).toBeUndefined()
    })

    it('returns value when key exists', () => {
      const state = new AgentState({ key1: 'value1' })
      expect(state.get('key1')).toBe('value1')
    })

    it('returns deep copy that cannot mutate stored state', () => {
      const state = new AgentState({ nested: { value: 'test' } })
      const retrieved = state.get('nested') as { value: string }

      // Mutate retrieved value
      retrieved.value = 'changed'

      // Stored state should not be affected
      expect(state.get('nested')).toEqual({ value: 'test' })
    })
  })

  describe('set', () => {
    it('sets string value successfully', () => {
      const state = new AgentState()
      state.set('key1', 'value1')
      expect(state.get('key1')).toBe('value1')
    })

    it('sets number value successfully', () => {
      const state = new AgentState()
      state.set('key1', 42)
      expect(state.get('key1')).toBe(42)
    })

    it('sets boolean value successfully', () => {
      const state = new AgentState()
      state.set('key1', true)
      expect(state.get('key1')).toBe(true)
    })

    it('sets null value successfully', () => {
      const state = new AgentState()
      state.set('key1', null)
      expect(state.get('key1')).toBeNull()
    })

    it('sets object value successfully', () => {
      const state = new AgentState()
      state.set('key1', { nested: 'value' })
      expect(state.get('key1')).toEqual({ nested: 'value' })
    })

    it('sets array value successfully', () => {
      const state = new AgentState()
      state.set('key1', [1, 2, 3])
      expect(state.get('key1')).toEqual([1, 2, 3])
    })

    it('overwrites existing value', () => {
      const state = new AgentState({ key1: 'old' })
      state.set('key1', 'new')
      expect(state.get('key1')).toBe('new')
    })

    it('stores deep copy that cannot mutate stored state', () => {
      const state = new AgentState()
      const value = { nested: { value: 'test' } }
      state.set('key1', value)

      // Mutate original
      value.nested.value = 'changed'

      // Stored state should not be affected
      expect(state.get('key1')).toEqual({ nested: { value: 'test' } })
    })

    it('silently drops function properties in objects', () => {
      const state = new AgentState({ existing: 'value' })
      const obj = { func: () => 'test', value: 'keep' }
      state.set('key1', obj)
      const result = state.get('key1') as Record<string, unknown>
      expect(result.func).toBeUndefined()
      expect(result.value).toBe('keep')
      expect(state.get('existing')).toBe('value')
    })

    it('throws error for top-level symbol values', () => {
      const state = new AgentState()
      expect(() => state.set('key1', Symbol('test'))).toThrow()
    })

    it('throws error for top-level undefined values', () => {
      const state = new AgentState()
      expect(() => state.set('key1', undefined)).toThrow()
    })

    it('silently drops non-serializable properties in nested objects', () => {
      const state = new AgentState()
      const obj = { func: () => 'test', value: 'keep', nested: { data: 42, func2: () => 'test2' } }
      state.set('key1', obj)
      const result = state.get('key1') as Record<string, unknown>
      expect(result.func).toBeUndefined()
      expect(result.value).toBe('keep')
      const nested = result.nested as Record<string, unknown>
      expect(nested.data).toBe(42)
      expect(nested.func2).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('removes existing key', () => {
      const state = new AgentState({ key1: 'value1', key2: 'value2' })
      state.delete('key1')
      expect(state.get('key1')).toBeUndefined()
      expect(state.get('key2')).toBe('value2')
    })

    it('does not throw error for non-existent key', () => {
      const state = new AgentState()
      expect(() => state.delete('nonexistent')).not.toThrow()
    })
  })

  describe('clear', () => {
    it('removes all values', () => {
      const state = new AgentState({ key1: 'value1', key2: 'value2' })
      state.clear()
      expect(state.keys()).toEqual([])
      expect(state.get('key1')).toBeUndefined()
      expect(state.get('key2')).toBeUndefined()
    })

    it('works on empty state', () => {
      const state = new AgentState()
      expect(() => state.clear()).not.toThrow()
      expect(state.keys()).toEqual([])
    })
  })

  describe('getAll', () => {
    it('returns object with all state', () => {
      const state = new AgentState({ key1: 'value1', key2: 42 })
      expect(state.getAll()).toEqual({ key1: 'value1', key2: 42 })
    })

    it('returns empty object for empty state', () => {
      const state = new AgentState()
      expect(state.getAll()).toEqual({})
    })
  })

  describe('keys', () => {
    it('returns array of all keys', () => {
      const state = new AgentState({ key1: 'value1', key2: 'value2' })
      expect(state.keys().sort()).toEqual(['key1', 'key2'])
    })

    it('returns empty array for empty state', () => {
      const state = new AgentState()
      expect(state.keys()).toEqual([])
    })

    it('returns new array each time', () => {
      const state = new AgentState({ key1: 'value1' })
      const keys1 = state.keys()
      const keys2 = state.keys()
      expect(keys1).not.toBe(keys2)
    })
  })
})
