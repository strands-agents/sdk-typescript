/**
 * Base configuration interface for model providers.
 * Contains common configuration fields that apply to most LLM providers.
 * Provider-specific implementations can extend this interface with additional fields.
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   modelId: 'anthropic.claude-v3-sonnet',
 *   maxTokens: 2048,
 *   temperature: 0.7,
 *   topP: 0.9,
 *   stopSequences: ['END']
 * }
 * ```
 */
export interface ModelConfig {
  /**
   * The identifier of the model to use.
   * Format varies by provider (e.g., 'gpt-4', 'anthropic.claude-v3-sonnet').
   */
  modelId: string

  /**
   * Maximum number of tokens to generate in the response.
   * Controls the length of the model's output.
   */
  maxTokens?: number

  /**
   * Sampling temperature (typically 0.0 to 1.0).
   * Higher values make output more random, lower values more deterministic.
   */
  temperature?: number

  /**
   * Top-p (nucleus) sampling parameter (0.0 to 1.0).
   * Controls diversity by limiting cumulative probability of token choices.
   */
  topP?: number

  /**
   * Array of strings that will stop generation when encountered.
   * Useful for controlling output format or length.
   */
  stopSequences?: string[]
}
