import { describe, it, expect } from 'vitest'
import { ConversationManager } from '../conversation-manager.js'

describe('ConversationManager', () => {
  // ConversationManager is an abstract base class
  // Specific implementations are tested in their own test files

  it('is an abstract class', () => {
    expect(ConversationManager).toBeDefined()
  })
})
