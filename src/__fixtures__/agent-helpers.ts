/**
 * Test fixtures and helpers for Agent testing.
 * This module provides utilities for testing Agent-related implementations.
 */

import type { Agent } from '../agent/agent.js'
import type { Message } from '../types/messages.js'
import { AgentState } from '../agent/state.js'

/**
 * Helper to create a mock Agent for testing.
 * Provides minimal Agent interface with messages and state.
 *
 * @param messages - Optional message array for the agent
 * @returns Mock Agent object
 */
export function createMockAgent(messages: Message[] = []): Agent {
  return {
    messages,
    state: new AgentState({}),
  } as unknown as Agent
}
