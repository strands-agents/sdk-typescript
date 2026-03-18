/**
 * Type definitions for the Google GenAI model provider.
 */

import type { GoogleGenAI, GoogleGenAIOptions, Tool } from '@google/genai'
import type { BaseModelConfig } from '../model.js'

/**
 * Configuration interface for Google GenAI model provider.
 *
 * @example
 * ```typescript
 * const config: GoogleGenAIModelConfig = {
 *   modelId: 'gemini-2.5-flash',
 *   params: { temperature: 0.7, maxOutputTokens: 1024 }
 * }
 * ```
 *
 * @see https://ai.google.dev/api/generate-content#generationconfig
 */
export interface GoogleGenAIModelConfig extends BaseModelConfig {
  /**
   * Gemini model identifier (e.g., gemini-2.5-flash, gemini-2.5-pro).
   *
   * @defaultValue 'gemini-2.5-flash'
   * @see https://ai.google.dev/gemini-api/docs/models
   */
  modelId?: string

  /**
   * Additional parameters to pass to the Gemini API (e.g., temperature, maxOutputTokens).
   *
   * @see https://ai.google.dev/api/generate-content#generationconfig
   */
  params?: Record<string, unknown>

  /**
   * Gemini-specific built-in tools (e.g., GoogleSearch, CodeExecution, UrlContext).
   * These are appended as separate Tool objects alongside any functionDeclarations.
   *
   * @see https://ai.google.dev/gemini-api/docs/function-calling
   */
  builtInTools?: Tool[]
}

/**
 * Options interface for creating a GoogleGenAIModel instance.
 */
export interface GoogleGenAIModelOptions extends GoogleGenAIModelConfig {
  /**
   * Gemini API key (falls back to GEMINI_API_KEY environment variable).
   */
  apiKey?: string

  /**
   * Pre-configured Google GenAI client instance.
   * If provided, this client will be used instead of creating a new one.
   */
  client?: GoogleGenAI

  /**
   * Additional Google GenAI client configuration.
   * Only used if client is not provided.
   */
  clientConfig?: Omit<GoogleGenAIOptions, 'apiKey'>
}

/**
 * Internal state for tracking streaming progress.
 */
export interface GoogleGenAIStreamState {
  messageStarted: boolean
  textContentBlockStarted: boolean
  reasoningContentBlockStarted: boolean
  hasToolCalls: boolean
  inputTokens: number
  outputTokens: number
}
