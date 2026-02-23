/**
 * Test fixtures and helpers for Agent testing.
 * This module provides utilities for testing Agent-related implementations.
 */

import type { Agent } from '../agent/agent.js'
import type { Message } from '../types/messages.js'
import { AgentState } from '../agent/state.js'
import type { JSONValue } from '../types/json.js'

/**
 * Data for creating a mock Agent.
 */
export interface MockAgentData {
  /**
   * Messages for the agent.
   */
  messages?: Message[]
  /**
   * Initial state for the agent.
   */
  state?: Record<string, JSONValue>
}

/**
 * Helper to create a mock Agent for testing.
 * Provides minimal Agent interface with messages and state.
 *
 * @param data - Optional mock agent data
 * @returns Mock Agent object
 */
export function createMockAgent(data?: MockAgentData): Agent {
  return {
    messages: data?.messages ?? [],
    state: new AgentState(data?.state ?? {}),
  } as unknown as Agent
}
