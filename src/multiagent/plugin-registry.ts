/**
 * Plugin registry for managing plugins attached to a multi-agent orchestrator.
 */

import type { MultiAgentPlugin } from './plugin.js'
import type { MultiAgentBase } from './base.js'

/**
 * Registry for managing plugins attached to a multi-agent orchestrator.
 *
 * Holds pending plugins and initializes them on first use.
 * Handles duplicate detection and calls each plugin's initMultiAgent method.
 */
export class MultiAgentPluginRegistry {
  private readonly _plugins: Map<string, MultiAgentPlugin>
  private readonly _pending: MultiAgentPlugin[]

  constructor(plugins: MultiAgentPlugin[] = []) {
    this._plugins = new Map()
    this._pending = [...plugins]
  }

  /**
   * Initialize all pending plugins with the orchestrator.
   * Safe to call multiple times — only runs once.
   *
   * @param orchestrator - The orchestrator instance to initialize plugins with
   */
  async initialize(orchestrator: MultiAgentBase): Promise<void> {
    while (this._pending.length > 0) {
      const plugin = this._pending.shift()!
      await this._addAndInit(plugin, orchestrator)
    }
  }

  private async _addAndInit(plugin: MultiAgentPlugin, orchestrator: MultiAgentBase): Promise<void> {
    if (this._plugins.has(plugin.name)) {
      throw new Error(`plugin_name=<${plugin.name}> | plugin already registered`)
    }
    this._plugins.set(plugin.name, plugin)
    await plugin.initMultiAgent(orchestrator)
  }
}
