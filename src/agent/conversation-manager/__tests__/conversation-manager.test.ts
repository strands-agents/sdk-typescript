import { describe, it, expect } from 'vitest'
import { ConversationManager } from '../conversation-manager.js'
import type { Agent } from '../../agent.js'

describe('ConversationManager', () => {
  describe('properties', () => {
    it('subclasses inherit removedMessageCount property', () => {
      class TestManager extends ConversationManager {
        applyManagement(_agent: Agent): void {
          // no-op
        }
        reduceContext(_agent: Agent, _error?: Error): void {
          // no-op
        }
      }

      const manager = new TestManager()
      expect(manager.removedMessageCount).toBeDefined()
      expect(typeof manager.removedMessageCount).toBe('number')
    })

    it('removedMessageCount initializes to 0', () => {
      class TestManager extends ConversationManager {
        applyManagement(_agent: Agent): void {
          // no-op
        }
        reduceContext(_agent: Agent, _error?: Error): void {
          // no-op
        }
      }

      const manager = new TestManager()
      expect(manager.removedMessageCount).toBe(0)
    })
  })
})
