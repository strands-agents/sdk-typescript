import type { Plugin } from '../plugins/plugin.js'
import type { LocalAgent } from '../types/agent.js'
import type { Tool } from '../tools/tool.js'
import type {
  KnowledgeEntry,
  MemoryManagerConfig,
  MemorySearchOptions,
  MemoryStoreOptions,
  MemoryToolsConfig,
} from './types.js'
import type { JSONValue } from '../types/json.js'
import { tool } from '../tools/tool-factory.js'
import { z } from 'zod'
import { logger } from '../logging/logger.js'

const SEARCH_TOOL_DESCRIPTION =
  'Search long-term memory for facts, preferences, or context from previous conversations. Use when you need background about the user or topic that may have been discussed before.'

const STORE_TOOL_DESCRIPTION =
  'Store facts, preferences, or decisions that should be remembered across conversations. Use when the user shares something worth recalling later.'

/**
 * Provides cross-session knowledge retrieval and storage for agents.
 *
 * Manages one or more {@link KnowledgeStore} backends, exposing `search_memory` and
 * `store_memory` tools for agent-driven recall and persistence.
 *
 * @example
 * ```typescript
 * import { Agent, MemoryManager } from '@strands-agents/sdk'
 *
 * // Config shorthand
 * const agent = new Agent({
 *   model,
 *   memoryManager: { stores: [{ store: myKnowledgeBase }] },
 * })
 *
 * // Class instance (for programmatic access)
 * const memoryManager = new MemoryManager({ stores: [{ store: myKnowledgeBase }] })
 * const agent = new Agent({ model, memoryManager })
 * await memoryManager.search('user preferences')
 * ```
 */
export class MemoryManager implements Plugin {
  readonly name = 'strands:memory-manager'
  private readonly _config: MemoryManagerConfig
  private readonly _toolsConfig: MemoryToolsConfig | false

  constructor(config: MemoryManagerConfig) {
    if (config.stores.length === 0) {
      throw new Error('MemoryManager: at least one store is required')
    }

    this._config = config

    this._toolsConfig =
      config.includeTools === false ? false : typeof config.includeTools === 'object' ? config.includeTools : {}
  }

  /**
   * Registers lifecycle hooks with the agent.
   *
   * @param _agent - The agent to register hooks with
   */
  initAgent(_agent: LocalAgent): void {}

  /**
   * Returns tools registered by this plugin (controlled by `includeTools` config).
   *
   * @returns Array of tools to register with the agent
   */
  getTools(): Tool[] {
    if (this._toolsConfig === false) return []

    const tools: Tool[] = []

    const searchConfig = this._toolsConfig.search
    if (searchConfig !== false) {
      tools.push(this._createSearchTool(typeof searchConfig === 'object' ? searchConfig : undefined))
    }

    const storeConfig = this._toolsConfig.store
    if (storeConfig !== false && this._hasWritableStore()) {
      tools.push(this._createStoreTool(typeof storeConfig === 'object' ? storeConfig : undefined))
    }

    return tools
  }

  /**
   * Search configured stores for entries matching the query.
   *
   * Each store receives the `limit` individually — results are concatenated in store config order.
   * Stores that fail are logged and skipped.
   *
   * @param query - The search query string
   * @param options - Optional limit per-store and store name filter
   * @returns Array of knowledge entries from matching stores
   */
  async search(query: string, options?: MemorySearchOptions): Promise<KnowledgeEntry[]> {
    logger.debug(`query=<${query}>, limit=<${options?.limit}>, stores=<${options?.stores}> | searching stores`)

    const targetStores = options?.stores?.length
      ? this._config.stores.filter((s) => s.name && options.stores!.includes(s.name))
      : this._config.stores

    if (options?.stores?.length && targetStores.length === 0) {
      logger.warn(`stores=<${options.stores.join(', ')}> | no stores matched filter`)
    }

    const limit = options?.limit
    const settled = await Promise.allSettled(
      targetStores.map((config) => config.store.search(query, { limit: limit ?? config.limit ?? 10 }))
    )

    const results: KnowledgeEntry[] = []
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]!
      if (r.status === 'rejected') {
        logger.warn(`store=<${targetStores[i]!.name ?? i}>, reason=<${r.reason}> | store search failed`)
        continue
      }
      for (const entry of r.value) {
        results.push(entry)
      }
    }

    logger.debug(`results=<${results.length}> | search complete`)
    return results
  }

  /**
   * Store content in writable stores. If `stores` is provided, only writes to those named stores.
   *
   * Partial failures are logged. If all writes fail, throws an `AggregateError`.
   *
   * @param content - The text content to store
   * @param options - Optional metadata and store name filter
   */
  async store(content: string, options?: MemoryStoreOptions): Promise<void> {
    let writableStores = this._config.stores.filter((s) => s.store.add)

    if (options?.stores?.length) {
      writableStores = writableStores.filter((s) => s.name && options.stores!.includes(s.name))
    }

    if (writableStores.length === 0) {
      throw new Error('MemoryManager: no writable store configured')
    }

    const settled = await Promise.allSettled(writableStores.map((s) => s.store.add!(content, options?.metadata)))

    const failures: { store: string; reason: unknown }[] = []
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]!
      if (r.status === 'rejected') {
        const storeName = writableStores[i]!.name ?? String(i)
        logger.warn(`store=<${storeName}>, reason=<${r.reason}> | store write failed`)
        failures.push({ store: storeName, reason: r.reason })
      }
    }
    if (failures.length === writableStores.length) {
      throw new AggregateError(
        failures.map((f) => f.reason),
        'MemoryManager: all store writes failed'
      )
    }
  }

  private _hasWritableStore(): boolean {
    return this._config.stores.some((s) => s.store.add)
  }

  private _createSearchTool(config?: { name?: string; description?: string }): Tool {
    let description = config?.description ?? SEARCH_TOOL_DESCRIPTION
    const storeDescriptions = this._config.stores
      .filter((s) => s.name || s.description)
      .map((s) => `- ${s.name ?? 'unnamed'}${s.description ? `: ${s.description}` : ''}`)
    if (storeDescriptions.length > 0) {
      description += `\n\nAvailable memory stores:\n${storeDescriptions.join('\n')}`
      description +=
        '\n\nYou can target one or more memory stores by name if you know which domains are relevant, or omit the stores parameter to search all.'
    }

    const inputSchema = z.object({
      query: z.string().describe('What to search for'),
      limit: z.number().optional().describe('Maximum number of results per store'),
      stores: z.array(z.string()).optional().describe('Filter to specific stores by name, or omit to search all'),
    })

    return tool({
      name: config?.name ?? 'search_memory',
      description,
      inputSchema,
      callback: async (input) => {
        const results = await this.search(input.query, {
          ...(input.limit != null && { limit: input.limit }),
          ...(input.stores != null && { stores: input.stores }),
        })
        return results.map((entry) => ({
          id: entry.id,
          content: entry.content,
          ...(entry.metadata && { metadata: entry.metadata }),
        })) as JSONValue
      },
    })
  }

  private _createStoreTool(config?: { name?: string; description?: string }): Tool {
    const writableStores = this._config.stores.filter((s) => s.store.add)

    let description = config?.description ?? STORE_TOOL_DESCRIPTION
    const storeDescriptions = writableStores
      .filter((s) => s.name || s.description)
      .map((s) => `- ${s.name ?? 'unnamed'}${s.description ? `: ${s.description}` : ''}`)
    if (storeDescriptions.length > 0) {
      description += `\n\nAvailable writable stores:\n${storeDescriptions.join('\n')}`
      description +=
        '\n\nYou can target a specific store by name to route facts to the right place, or omit to store in all writable stores.'
    }

    const inputSchema = z.object({
      entries: z.array(z.string()).describe('Data to store in long-term memory'),
      stores: z.array(z.string()).optional().describe('Target specific stores by name, or omit to store in all'),
    })

    return tool({
      name: config?.name ?? 'store_memory',
      description,
      inputSchema,
      callback: async (input) => {
        const settled = await Promise.allSettled(
          input.entries.map((content) => this.store(content, input.stores ? { stores: input.stores } : undefined))
        )
        const stored = settled.filter((r) => r.status === 'fulfilled').length
        const failed = settled.filter((r) => r.status === 'rejected').length
        return { stored, failed } as JSONValue
      },
    })
  }
}
