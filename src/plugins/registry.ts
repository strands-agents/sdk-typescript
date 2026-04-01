/**
 * Plugin registry for managing plugins attached to an agent.
 */

import type { Plugin } from './plugin.js'
import type { LocalAgent } from '../types/agent.js'

/**
 * Registry for managing plugins attached to an agent.
 *
 * Holds pending plugins and initializes them on first use.
 * Handles duplicate detection, tool registration, and calls each plugin's initAgent method.
 */
export class PluginRegistry {
  private readonly _plugins: Map<string, Plugin>
  private readonly _pending: Plugin[]

  constructor(plugins: Plugin[] = []) {
    this._plugins = new Map()
    this._pending = [...plugins]
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

  /**
   * Checks whether any registered or pending plugin is an instance of the given class.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hasPluginOfType(ctor: abstract new (...args: any[]) => Plugin): boolean {
    for (const p of this._plugins.values()) {
      if (p instanceof ctor) return true
    }
    return this._pending.some((p) => p instanceof ctor)
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

    await plugin.initAgent(agent)
  }
}
