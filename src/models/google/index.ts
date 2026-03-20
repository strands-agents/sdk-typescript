/**
 * Google GenAI model provider.
 *
 * @example
 * ```typescript
 * import { GenAIModel } from '@strands-agents/sdk/models/google'
 *
 * const model = new GenAIModel({
 *   apiKey: 'your-api-key',
 *   modelId: 'gemini-2.5-flash',
 * })
 * ```
 */

export { GenAIModel, type GenAIModelConfig, type GenAIModelOptions } from './model.js'
