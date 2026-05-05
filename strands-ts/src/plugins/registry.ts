/**
 * Plugin registry for managing plugins attached to an agent.
 */

import type { Plugin } from './plugin.js'
import type { LocalAgent } from '../types/agent.js'
import type { HookRegistryImplementation } from '../hooks/registry.js'

/**
 * Registry for managing plugins attached to an agent.
 *
 * Holds pending plugins and initializes them on first use.
 * Handles duplicate detection, tool registration, and calls each plugin's initAgent method.
 */
export class PluginRegistry {
  private readonly _plugins: Map<string, Plugin>
  private readonly _pending: Plugin[]
  private readonly _hookRegistry: HookRegistryImplementation

  constructor(plugins: Plugin[] = [], hookRegistry: HookRegistryImplementation) {
    this._plugins = new Map()
    this._pending = [...plugins]
    this._hookRegistry = hookRegistry
  }

  /**
   * Initialize all pending plugins with the agent.
   * Safe to call multiple times — only runs once per pending batch.
   *
   * @param agent - The agent instance to initialize plugins with
   */
  async initialize(agent: LocalAgent): Promise<void> {
    while (this._pending.length > 0) {
      const plugin = this._pending.shift()!
      await this._addAndInit(plugin, agent)
    }
  }

  private async _addAndInit(plugin: Plugin, agent: LocalAgent): Promise<void> {
    if (this._plugins.has(plugin.name)) {
      throw new Error(`plugin_name=<${plugin.name}> | plugin already registered`)
    }
    this._plugins.set(plugin.name, plugin)

    const tools = plugin.getTools?.() ?? []
    if (tools.length > 0) {
      agent.toolRegistry.add(tools)
    }

    // Safe: plugins initialize sequentially; no concurrent addCallback calls during init
    if (plugin.order !== undefined) {
      this._hookRegistry._setDefaultOrder(plugin.order)
    }
    try {
      await plugin.initAgent(agent)
    } finally {
      this._hookRegistry._setDefaultOrder(0)
    }
  }
}
