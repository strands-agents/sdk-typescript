import type { Message } from '@/types/messages'
import type { ToolSpec, ToolChoice } from '@/tools/types'
import type { StreamEvent } from '@/streaming/events'

/**
 * Options for configuring a streaming model invocation.
 */
export interface StreamOptions {
  /**
   * Array of tool specifications that the model can use.
   */
  toolSpecs?: ToolSpec[]

  /**
   * System prompt to guide the model's behavior.
   */
  systemPrompt?: string

  /**
   * Controls how the model selects tools to use.
   */
  toolChoice?: ToolChoice
}

/**
 * Base interface for model providers.
 * Defines the contract that all model provider implementations must follow.
 *
 * Model providers handle communication with LLM APIs and implement streaming
 * responses using async iterables.
 *
 * @example
 * ```typescript
 * class MyProvider implements ModelProvider {
 *   private config: Record<string, unknown> = {}
 *
 *   updateConfig(modelConfig: Record<string, unknown>): void {
 *     this.config = { ...this.config, ...modelConfig }
 *   }
 *
 *   getConfig(): Record<string, unknown> {
 *     return this.config
 *   }
 *
 *   async *stream(
 *     messages: Message[],
 *     options?: StreamOptions
 *   ): AsyncIterable<StreamEvent> {
 *     // Implementation for streaming from LLM
 *     yield { messageStart: { role: 'assistant' } }
 *     yield { contentBlockDelta: { delta: { text: 'Hello' } } }
 *     yield { messageStop: { stopReason: 'end_turn' } }
 *   }
 * }
 * ```
 */
export interface ModelProvider {
  /**
   * Updates the model configuration.
   * Merges the provided configuration with existing settings.
   *
   * @param modelConfig - Configuration object with model-specific settings
   */
  updateConfig(modelConfig: Record<string, unknown>): void

  /**
   * Retrieves the current model configuration.
   *
   * @returns The current configuration object
   */
  getConfig(): Record<string, unknown>

  /**
   * Streams a conversation with the model.
   * Returns an async iterable that yields streaming events as they occur.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional streaming configuration
   * @returns Async iterable of streaming events
   *
   * @example
   * ```typescript
   * const messages: Message[] = [
   *   { role: 'user', content: [{ text: 'Hello!' }] }
   * ]
   *
   * for await (const event of provider.stream(messages)) {
   *   if ('contentBlockDelta' in event) {
   *     process.stdout.write(event.contentBlockDelta.delta.text || '')
   *   }
   * }
   * ```
   */
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamEvent>
}
