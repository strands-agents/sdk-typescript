/**
 * OpenAI model provider.
 *
 * Supports both the Chat Completions API (default) and the Responses API
 * (with server-managed conversation state).
 *
 * @example
 * ```typescript
 * import { OpenAIModel } from '@strands-agents/sdk/models/openai'
 *
 * // Chat Completions (default)
 * const model = new OpenAIModel({ modelId: 'gpt-5.4', apiKey: 'sk-...' })
 *
 * // Responses API (stateful)
 * const model = new OpenAIModel({ api: 'responses', modelId: 'gpt-4o', apiKey: 'sk-...' })
 * ```
 */

export { OpenAIModel } from './model.js'
export type {
  OpenAIApi,
  OpenAIChatConfig,
  OpenAIModelConfig,
  OpenAIModelOptions,
  OpenAIResponsesConfig,
} from './types.js'
