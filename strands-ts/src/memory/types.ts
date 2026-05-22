/**
 * A single entry retrieved from or stored to a knowledge store.
 */
export interface KnowledgeEntry {
  /** Unique identifier for this entry, assigned by the store. */
  id: string
  /** The textual content of this knowledge entry. */
  content: string
  /** Optional metadata (e.g., score, source, timestamp). */
  metadata?: Record<string, unknown>
}

/**
 * Options passed to {@link KnowledgeStore.search}.
 * Store implementations may extend this with additional fields in their own signatures.
 */
export interface SearchOptions {
  /** Maximum number of results to return. */
  limit?: number
}

/**
 * Interface for a knowledge store backend.
 *
 * Only `search` is required. Stores that support mutation may additionally implement `add`.
 *
 * @example
 * ```typescript
 * const store: KnowledgeStore = {
 *   async search(query, options) {
 *     return myVectorDb.query(query, { topK: options?.limit ?? 10 })
 *   }
 * }
 * ```
 */
export interface KnowledgeStore {
  /** Search the store for entries matching the query, ordered by relevance. */
  search(query: string, options?: SearchOptions): Promise<KnowledgeEntry[]>
  /** Add content to the store. Optional — only present on mutable stores. */
  add?(content: string, metadata?: Record<string, unknown>): Promise<void>
}

/**
 * Options for {@link MemoryManager.search}.
 */
export interface MemorySearchOptions {
  /** Maximum number of results per store. */
  limit?: number
  /** Filter to specific stores by name. Omit to search all. */
  stores?: string[]
}

/**
 * Options for {@link MemoryManager.store}.
 */
export interface MemoryStoreOptions {
  /** Metadata to associate with the stored entry. */
  metadata?: Record<string, unknown>
  /** Filter to specific writable stores by name. Omit to write to all. */
  stores?: string[]
}

/**
 * Configuration for a single knowledge store within the memory manager.
 */
export interface StoreConfig {
  /** The knowledge store instance. */
  store: KnowledgeStore
  /** Identifier for this store, used to target specific stores in search. */
  name?: string
  /** Human-readable description of what this store contains. */
  description?: string
  /** Default max results per query for this store. Defaults to 10. */
  limit?: number
}

/**
 * Configuration for customizing a memory tool's name or description.
 */
export interface MemoryToolConfig {
  /** Custom tool name. */
  name?: string
  /** Custom tool description. */
  description?: string
}

/**
 * Configuration for which tools the memory manager exposes to the agent.
 */
export interface MemoryToolsConfig {
  /** Configuration for the search tool. `false` disables it. */
  search?: boolean | MemoryToolConfig
  /** Configuration for the store tool. `false` disables it. */
  store?: boolean | MemoryToolConfig
}

/**
 * Configuration for the {@link MemoryManager}.
 *
 * @example
 * ```typescript
 * // Config shorthand (auto-wrapped into MemoryManager)
 * const agent = new Agent({
 *   model,
 *   memoryManager: { stores: [{ store: myKnowledgeBase }] },
 * })
 * ```
 */
export interface MemoryManagerConfig {
  /** One or more knowledge stores to query. */
  stores: StoreConfig[]
  /** Whether to register tools for agent-driven search and storage. Defaults to `true`. */
  includeTools?: boolean | MemoryToolsConfig
}
