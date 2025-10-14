import type { Message } from '@/types/messages'
import type { ToolSpec, ToolChoice } from '@/tools/types'
import type { ModelProviderStreamEvent } from '@/models/streaming'

/**
 * Options for configuring a streaming model invocation.
 */
export interface StreamOptions {
  /**
   * System prompt to guide the model's behavior.
   */
  systemPrompt?: string

  /**
   * Array of tool specifications that the model can use.
   */
  toolSpecs?: ToolSpec[]

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
 *   private config: unknown = {}
 *
 *   updateConfig(modelConfig: unknown): void {
 *     this.config = { ...this.config as object, ...modelConfig as object }
 *   }
 *
 *   getConfig(): unknown {
 *     return this.config
 *   }
 *
 *   async *stream(
 *     messages: Message[],
 *     options?: StreamOptions
 *   ): AsyncIterable<ModelProviderStreamEvent> {
 *     // Implementation for streaming from LLM
 *     yield { type: 'modelMessageStartEvent', role: 'assistant' }
 *     yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'text', text: 'Hello' } }
 *     yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' }
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
  updateConfig(modelConfig: unknown): void

  /**
   * Retrieves the current model configuration.
   *
   * @returns The current configuration object
   */
  getConfig(): unknown

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
   *   { role: 'user', content: [{ type: 'text', text: 'Hello!' }] }
   * ]
   *
   * for await (const event of provider.stream(messages)) {
   *   if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'text') {
   *     process.stdout.write(event.delta.text)
   *   }
   * }
   * ```
   */
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelProviderStreamEvent>
}
