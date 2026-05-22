import { describe, it, expect, vi } from 'vitest'
import { Agent } from '../../agent/agent.js'
import { MemoryManager } from '../memory-manager.js'
import type { KnowledgeStore, KnowledgeEntry } from '../types.js'

function createMockStore(entries: KnowledgeEntry[] = [], writable = false): KnowledgeStore {
  const store: KnowledgeStore = {
    search: vi.fn().mockResolvedValue(entries),
  }
  if (writable) {
    store.add = vi.fn().mockResolvedValue(undefined)
  }
  return store
}

describe('MemoryManager', () => {
  describe('constructor', () => {
    it('throws when stores array is empty', () => {
      expect(() => new MemoryManager({ stores: [] })).toThrow('at least one store is required')
    })

    it('creates instance with valid config', () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore() }] })
      expect(mm.name).toBe('strands:memory-manager')
    })
  })

  describe('getTools', () => {
    it('registers search tool by default', () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore() }] })
      const tools = mm.getTools()
      expect(tools).toHaveLength(1)
      expect(tools[0]!.name).toBe('search_memory')
    })

    it('registers both search and store tools when a writable store exists', () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore([], true) }] })
      const tools = mm.getTools()
      expect(tools).toHaveLength(2)
      expect(tools.map((t) => t.name)).toStrictEqual(['search_memory', 'store_memory'])
    })

    it('does not register store tool when no writable stores exist', () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore() }] })
      const tools = mm.getTools()
      expect(tools.map((t) => t.name)).toStrictEqual(['search_memory'])
    })

    it('returns empty array when includeTools is false', () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore([], true) }], includeTools: false })
      expect(mm.getTools()).toStrictEqual([])
    })

    it('respects ToolsConfig to disable search', () => {
      const mm = new MemoryManager({
        stores: [{ store: createMockStore([], true) }],
        includeTools: { search: false },
      })
      const tools = mm.getTools()
      expect(tools.map((t) => t.name)).toStrictEqual(['store_memory'])
    })

    it('respects ToolsConfig to disable store', () => {
      const mm = new MemoryManager({
        stores: [{ store: createMockStore([], true) }],
        includeTools: { store: false },
      })
      const tools = mm.getTools()
      expect(tools.map((t) => t.name)).toStrictEqual(['search_memory'])
    })

    it('uses custom tool names from MemoryToolsConfig', () => {
      const mm = new MemoryManager({
        stores: [{ store: createMockStore([], true) }],
        includeTools: { search: { name: 'recall' }, store: { name: 'remember' } },
      })
      const tools = mm.getTools()
      expect(tools.map((t) => t.name)).toStrictEqual(['recall', 'remember'])
    })

    it('includes store descriptions in search tool description when stores are named', () => {
      const mm = new MemoryManager({
        stores: [{ store: createMockStore(), name: 'personal', description: 'User preferences' }],
      })
      const tools = mm.getTools()
      expect(tools[0]!.description).toContain('personal: User preferences')
      expect(tools[0]!.description).toContain('target one or more memory stores by name')
    })

    it('includes store descriptions in store tool description when writable stores are named', () => {
      const mm = new MemoryManager({
        stores: [{ store: createMockStore([], true), name: 'notes', description: 'Personal notes' }],
      })
      const tools = mm.getTools()
      const storeTool = tools.find((t) => t.name === 'store_memory')!
      expect(storeTool.description).toContain('notes: Personal notes')
      expect(storeTool.description).toContain('target a specific store by name')
    })
  })

  describe('search', () => {
    it('queries all stores and concatenates results', async () => {
      const store1 = createMockStore([{ id: '1', content: 'fact one' }])
      const store2 = createMockStore([{ id: '2', content: 'fact two' }])
      const mm = new MemoryManager({ stores: [{ store: store1 }, { store: store2 }] })

      const results = await mm.search('query')
      expect(results).toStrictEqual([
        { id: '1', content: 'fact one' },
        { id: '2', content: 'fact two' },
      ])
    })

    it('passes limit to each store', async () => {
      const store = createMockStore()
      const mm = new MemoryManager({ stores: [{ store, limit: 5 }] })

      await mm.search('query')
      expect(store.search).toHaveBeenCalledWith('query', { limit: 5 })
    })

    it('overrides per-store limit with options.limit', async () => {
      const store = createMockStore()
      const mm = new MemoryManager({ stores: [{ store, limit: 5 }] })

      await mm.search('query', { limit: 3 })
      expect(store.search).toHaveBeenCalledWith('query', { limit: 3 })
    })

    it('defaults to limit of 10 when no limit configured', async () => {
      const store = createMockStore()
      const mm = new MemoryManager({ stores: [{ store }] })

      await mm.search('query')
      expect(store.search).toHaveBeenCalledWith('query', { limit: 10 })
    })

    it('filters to named stores when options.stores is provided', async () => {
      const store1 = createMockStore([{ id: '1', content: 'personal fact' }])
      const store2 = createMockStore([{ id: '2', content: 'team fact' }])
      const mm = new MemoryManager({
        stores: [
          { store: store1, name: 'personal' },
          { store: store2, name: 'team' },
        ],
      })

      const results = await mm.search('query', { stores: ['personal'] })
      expect(results).toStrictEqual([{ id: '1', content: 'personal fact' }])
      expect(store2.search).not.toHaveBeenCalled()
    })

    it('gracefully handles store failures', async () => {
      const store1: KnowledgeStore = { search: vi.fn().mockRejectedValue(new Error('network error')) }
      const store2 = createMockStore([{ id: '2', content: 'fact' }])
      const mm = new MemoryManager({ stores: [{ store: store1 }, { store: store2 }] })

      const results = await mm.search('query')
      expect(results).toStrictEqual([{ id: '2', content: 'fact' }])
    })
  })

  describe('store', () => {
    it('writes to all writable stores', async () => {
      const store1 = createMockStore([], true)
      const store2 = createMockStore([], true)
      const mm = new MemoryManager({ stores: [{ store: store1 }, { store: store2 }] })

      await mm.store('user likes coffee')
      expect(store1.add).toHaveBeenCalledWith('user likes coffee', undefined)
      expect(store2.add).toHaveBeenCalledWith('user likes coffee', undefined)
    })

    it('passes metadata to stores', async () => {
      const store = createMockStore([], true)
      const mm = new MemoryManager({ stores: [{ store }] })

      await mm.store('fact', { metadata: { source: 'user' } })
      expect(store.add).toHaveBeenCalledWith('fact', { source: 'user' })
    })

    it('filters to named stores when options.stores is provided', async () => {
      const store1 = createMockStore([], true)
      const store2 = createMockStore([], true)
      const mm = new MemoryManager({
        stores: [
          { store: store1, name: 'personal' },
          { store: store2, name: 'team' },
        ],
      })

      await mm.store('my preference', { stores: ['personal'] })
      expect(store1.add).toHaveBeenCalledWith('my preference', undefined)
      expect(store2.add).not.toHaveBeenCalled()
    })

    it('throws when no writable stores are configured', async () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore() }] })
      await expect(mm.store('fact')).rejects.toThrow('no writable store configured')
    })

    it('throws when named stores filter matches no writable stores', async () => {
      const store = createMockStore([], true)
      const mm = new MemoryManager({ stores: [{ store, name: 'personal' }] })
      await expect(mm.store('fact', { stores: ['nonexistent'] })).rejects.toThrow('no writable store configured')
    })

    it('succeeds with partial write failures (some stores fail, some succeed)', async () => {
      const store1: KnowledgeStore = {
        search: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockRejectedValue(new Error('write error')),
      }
      const store2 = createMockStore([], true)
      const mm = new MemoryManager({ stores: [{ store: store1 }, { store: store2 }] })

      await mm.store('fact')
      expect(store2.add).toHaveBeenCalledWith('fact', undefined)
    })

    it('throws AggregateError when all writes fail', async () => {
      const store: KnowledgeStore = {
        search: vi.fn().mockResolvedValue([]),
        add: vi.fn().mockRejectedValue(new Error('write error')),
      }
      const mm = new MemoryManager({ stores: [{ store }] })

      await expect(mm.store('fact')).rejects.toThrow('all store writes failed')
    })
  })

  describe('initAgent', () => {
    it('does not throw', () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore() }] })
      expect(() => mm.initAgent({} as any)).not.toThrow()
    })
  })

  describe('AgentConfig integration', () => {
    it('auto-wraps MemoryManagerConfig into MemoryManager instance', () => {
      const store = createMockStore()
      const agent = new Agent({ memoryManager: { stores: [{ store }] } })
      expect(agent.memoryManager).toBeInstanceOf(MemoryManager)
    })

    it('passes through MemoryManager instance unchanged', () => {
      const mm = new MemoryManager({ stores: [{ store: createMockStore() }] })
      const agent = new Agent({ memoryManager: mm })
      expect(agent.memoryManager).toBe(mm)
    })

    it('sets memoryManager to undefined when not configured', () => {
      const agent = new Agent({})
      expect(agent.memoryManager).toBeUndefined()
    })
  })
})
