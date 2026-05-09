/**
 * WebLLM model provider — on-device inference in the browser via WebGPU.
 *
 * Powered by `@mlc-ai/web-llm`, this provider lets agents run LLMs locally
 * without sending requests to a remote API. Models are downloaded on first
 * use and cached in browser storage for subsequent runs.
 *
 * @example
 * ```typescript
 * import { Agent } from '@strands-agents/sdk'
 * import { WebLLMModel } from '@strands-agents/sdk/models/webllm'
 *
 * const model = new WebLLMModel({
 *   modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
 *   onProgress: (r) => console.log(r.text, r.progress),
 * })
 * const agent = new Agent({ model })
 * const result = await agent.invoke('Hello!')
 * ```
 *
 * @example
 * ```typescript
 * // Pre-download a model independently of an Agent, e.g. from a settings UI
 * import { downloadWebLLMModel, isWebLLMModelCached } from '@strands-agents/sdk/models/webllm'
 *
 * if (!(await isWebLLMModelCached('Phi-3.5-mini-instruct-q4f16_1-MLC'))) {
 *   await downloadWebLLMModel({
 *     modelId: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
 *     onProgress: (r) => updateProgressBar(r.progress, r.text),
 *   })
 * }
 * ```
 */

export { WebLLMModel } from './model.js'
export type { WebLLMModelConfig, WebLLMModelOptions } from './model.js'
export {
  deleteWebLLMModel,
  downloadWebLLMModel,
  isWebLLMModelCached,
  listWebLLMModels,
  WebLLMModelNotFoundError,
  WebLLMUnavailableError,
} from './cache.js'
export type { DownloadWebLLMModelOptions, WebLLMModelInfo } from './cache.js'
