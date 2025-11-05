/**
 * Test message model provider for simplified agent testing.
 * This module provides a message-level test model that generates appropriate
 * ModelStreamEvents from Message objects, eliminating the need to manually
 * construct events in tests.
 */

import { Model } from '../models/model'
import type { Message, ContentBlock } from '../types/messages'
import type { ModelStreamEvent } from '../models/streaming'
import type { BaseModelConfig, StreamOptions } from '../models/model'

/**
 * Represents a single turn in the test sequence.
 * Can be either a Message with stopReason, or an Error to throw.
 */
type Turn = { type: 'message'; message: Message; stopReason: string } | { type: 'error'; error: Error }

/**
 * Test model provider that operates at the message level.
 * Simplifies agent loop tests by allowing specification of complete messages
 * instead of manually yielding individual ModelStreamEvents.
 *
 * Features:
 * - Builder pattern API with constructor and addTurn() method
 * - Auto-derives stopReason from message content (toolUse vs endTurn)
 * - Multi-turn support with single-turn reuse and multi-turn exhaustion
 * - Error handling support for testing error scenarios
 *
 * @example
 * ```typescript
 * // Simple single-turn test
 * const provider = new TestMessageModelProvider({
 *   type: 'message',
 *   role: 'assistant',
 *   content: [{ type: 'textBlock', text: 'Hello' }]
 * })
 *
 * // Multi-turn with builder pattern
 * const provider = new TestMessageModelProvider()
 *   .addTurn(toolUseMessage)  // Auto-derives 'toolUse'
 *   .addTurn(finalMessage)     // Auto-derives 'endTurn'
 *
 * // With explicit stopReason
 * const provider = new TestMessageModelProvider()
 *   .addTurn(message, 'maxTokens')
 *
 * // With error handling
 * const provider = new TestMessageModelProvider()
 *   .addTurn(successMessage)
 *   .addTurn(new Error('Model failed'))
 * ```
 */
export class TestMessageModelProvider extends Model<BaseModelConfig> {
  private _turns: Turn[]
  private _currentTurnIndex: number
  private _config: BaseModelConfig

  /**
   * Creates a new TestMessageModelProvider.
   *
   * @param turns - Variable number of Message or Error objects representing turns
   *
   * @example
   * ```typescript
   * // No arguments - use addTurn() to add turns
   * new TestMessageModelProvider()
   *
   * // Single message - stopReason auto-derived
   * new TestMessageModelProvider(message)
   *
   * // Multiple messages
   * new TestMessageModelProvider(message1, message2)
   *
   * // With errors
   * new TestMessageModelProvider(message, new Error('Failed'))
   * ```
   */
  constructor(...turns: (Message | Error)[]) {
    super()
    this._config = { modelId: 'test-model' }
    this._currentTurnIndex = 0
    this._turns = turns.map((turn) => this._createTurn(turn))
  }

  /**
   * Adds a turn to the test sequence.
   * Returns this for method chaining.
   *
   * @param turn - Message or Error to add
   * @param stopReason - Optional explicit stopReason (overrides auto-derivation)
   * @returns This provider for chaining
   *
   * @example
   * ```typescript
   * provider
   *   .addTurn(assistantMessage)  // Auto-derive stopReason
   *   .addTurn(assistantMessage, 'maxTokens')  // Explicit stopReason
   *   .addTurn(new Error('Failed'))  // Error turn
   * ```
   */
  addTurn(turn: Message | Error, stopReason?: string): this {
    this._turns.push(this._createTurn(turn, stopReason))
    return this
  }

  /**
   * Updates the model configuration.
   *
   * @param modelConfig - Configuration to merge with existing config
   */
  updateConfig(modelConfig: BaseModelConfig): void {
    this._config = { ...this._config, ...modelConfig }
  }

  /**
   * Retrieves the current model configuration.
   *
   * @returns Current configuration object
   */
  getConfig(): BaseModelConfig {
    return this._config
  }

  /**
   * Streams a conversation with the model.
   * Generates appropriate ModelStreamEvents from the Message objects.
   *
   * Single-turn behavior: Reuses the same turn indefinitely
   * Multi-turn behavior: Advances through turns and throws when exhausted
   *
   * @param _messages - Conversation messages (ignored by test provider)
   * @param _options - Streaming options (ignored by test provider)
   * @returns Async iterable of ModelStreamEvents
   */
  async *stream(_messages: Message[], _options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    // Determine which turn index to use
    // For single turn, always use 0. For multiple turns, use current index
    const turnIndex = this._turns.length === 1 ? 0 : this._currentTurnIndex

    // Advance turn index immediately for multi-turn scenarios
    // This ensures that the next call to stream() will use the next turn
    if (this._turns.length > 1) {
      this._currentTurnIndex++
    }

    // Check if we've exhausted all turns (after potential increment)
    if (turnIndex >= this._turns.length) {
      throw new Error('All turns have been consumed')
    }

    // Get the current turn
    const turn = this._turns[turnIndex]!

    // Handle error turns
    if (turn.type === 'error') {
      throw turn.error
    }

    // Generate events for message turn
    yield* this._generateEventsForMessage(turn.message, turn.stopReason)
  }

  /**
   * Creates a Turn object from a Message or Error.
   */
  private _createTurn(turn: Message | Error, explicitStopReason?: string): Turn {
    if (turn instanceof Error) {
      return { type: 'error', error: turn }
    }
    return {
      type: 'message',
      message: turn,
      stopReason: explicitStopReason ?? this._deriveStopReason(turn),
    }
  }

  /**
   * Auto-derives stopReason from message content.
   * Returns 'toolUse' if message contains any ToolUseBlock, otherwise 'endTurn'.
   */
  private _deriveStopReason(message: Message): string {
    const hasToolUse = message.content.some((block) => block.type === 'toolUseBlock')
    return hasToolUse ? 'toolUse' : 'endTurn'
  }

  /**
   * Generates appropriate ModelStreamEvents for a message.
   */
  private async *_generateEventsForMessage(message: Message, stopReason: string): AsyncGenerator<ModelStreamEvent> {
    // Yield message start event
    yield { type: 'modelMessageStartEvent', role: message.role }

    // Yield events for each content block
    for (let i = 0; i < message.content.length; i++) {
      const block = message.content[i]!
      yield* this._generateEventsForBlock(block, i)
    }

    // Yield message stop event
    yield { type: 'modelMessageStopEvent', stopReason }
  }

  /**
   * Generates appropriate ModelStreamEvents for a content block.
   */
  private async *_generateEventsForBlock(
    block: ContentBlock,
    contentBlockIndex: number
  ): AsyncGenerator<ModelStreamEvent> {
    switch (block.type) {
      case 'textBlock':
        yield { type: 'modelContentBlockStartEvent', contentBlockIndex }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'textDelta', text: block.text },
          contentBlockIndex,
        }
        yield { type: 'modelContentBlockStopEvent', contentBlockIndex }
        break

      case 'toolUseBlock':
        yield {
          type: 'modelContentBlockStartEvent',
          contentBlockIndex,
          start: { type: 'toolUseStart', name: block.name, toolUseId: block.toolUseId },
        }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta: { type: 'toolUseInputDelta', input: JSON.stringify(block.input) },
          contentBlockIndex,
        }
        yield { type: 'modelContentBlockStopEvent', contentBlockIndex }
        break

      case 'reasoningBlock': {
        yield { type: 'modelContentBlockStartEvent', contentBlockIndex }
        // Build delta object with only defined properties
        const delta: {
          type: 'reasoningContentDelta'
          text?: string
          signature?: string
          redactedContent?: Uint8Array
        } = {
          type: 'reasoningContentDelta',
        }
        if (block.text !== undefined) {
          delta.text = block.text
        }
        if (block.signature !== undefined) {
          delta.signature = block.signature
        }
        if (block.redactedContent !== undefined) {
          delta.redactedContent = block.redactedContent
        }
        yield {
          type: 'modelContentBlockDeltaEvent',
          delta,
          contentBlockIndex,
        }
        yield { type: 'modelContentBlockStopEvent', contentBlockIndex }
        break
      }

      case 'cachePointBlock':
        // CachePointBlock doesn't generate delta events
        yield { type: 'modelContentBlockStartEvent', contentBlockIndex }
        yield { type: 'modelContentBlockStopEvent', contentBlockIndex }
        break

      case 'toolResultBlock':
        // ToolResultBlock appears in user messages and doesn't generate model events
        // This shouldn't normally be in assistant messages, but we'll handle it gracefully
        break

      default: {
        // Exhaustive check
        const _exhaustive: never = block
        throw new Error(`Unknown content block type: ${(_exhaustive as ContentBlock).type}`)
      }
    }
  }
}
