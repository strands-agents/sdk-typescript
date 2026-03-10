/**
 * A2A (Agent-to-Agent) protocol support for the Strands Agents SDK.
 *
 * This module provides server and client components for the A2A protocol,
 * allowing Strands agents to communicate with other agents across platforms.
 *
 * @remarks
 * The A2A protocol is experimental, so breaking changes in the underlying SDK
 * may require breaking changes in this module.
 */

export { A2AServer, type A2AServerConfig } from './server.js'
export { A2AAgent, type A2AAgentConfig } from './a2a-agent.js'
export { A2AStreamUpdateEvent, type A2AEventData } from './events.js'
export { StrandsA2AExecutor } from './executor.js'
