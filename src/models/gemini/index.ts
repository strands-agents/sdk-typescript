/**
 * Google Gemini model provider.
 *
 * @example
 * ```typescript
 * import { GeminiModel } from '@strands-agents/sdk/gemini'
 *
 * const model = new GeminiModel({
 *   apiKey: 'your-api-key',
 *   modelId: 'gemini-2.5-flash'
 * })
 * ```
 */

export { GeminiModel } from './gemini-model.js'
export type { GeminiModelConfig, GeminiModelOptions } from './types.js'
