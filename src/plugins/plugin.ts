/**
 * Plugin base class for extending agent functionality.
 *
 * This module defines the Plugin base class, which provides a composable way to
 * add behavior changes to agents through hook registration and custom initialization.
 */

import type { Tool } from '../tools/tool.js'
import type { AgentData } from '../types/agent.js'

/**
 * Abstract base class for objects that extend agent functionality.
 *
 * Plugins provide a composable way to add behavior changes to agents by registering
 * hook callbacks in their `initAgent` method. Each plugin must have a unique name
 * for identification, logging, and duplicate prevention.
 *
 * @example
 * ```typescript
 * class LoggingPlugin extends Plugin {
 *   get name(): string {
 *     return 'logging-plugin'
 *   }
 *
 *   override initAgent(agent: AgentData): void {
 *     agent.addHook(BeforeInvocationEvent, (event) => {
 *       console.log('Agent invocation started')
 *     })
 *   }
 * }
 *
 * const agent = new Agent({
 *   model,
 *   plugins: [new LoggingPlugin()],
 * })
 * ```
 *
 * @example With tools
 * ```typescript
 * class MyToolPlugin extends Plugin {
 *   get name(): string {
 *     return 'my-tool-plugin'
 *   }
 *
 *   override getTools(): Tool[] {
 *     return [myTool]
 *   }
 * }
 * ```
 */
export abstract class Plugin {
  /**
   * A stable string identifier for the plugin.
   * Used for logging, duplicate detection, and plugin management.
   *
   * For strands-vended plugins, names should be prefixed with `strands:`.
   */
  abstract get name(): string

  /**
   * Initialize the plugin with the agent instance.
   *
   * Override this method to register hooks and perform custom initialization.
   * When overriding, call `super.initAgent(agent)` to ensure tools from
   * {@link getTools} are registered automatically.
   *
   * @param agent - The agent instance this plugin is being attached to
   */
  initAgent(agent: AgentData): void | Promise<void> {
    const tools = this.getTools()
    if (tools.length > 0) {
      agent.toolRegistry.add(tools)
    }
  }

  /**
   * Returns tools provided by this plugin for auto-registration.
   * Override to provide plugin-specific tools.
   *
   * @returns Array of tools to register with the agent
   */
  getTools(): Tool[] {
    return []
  }
}
