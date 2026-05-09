/**
 * WebLLM model cache and download helpers.
 *
 * These helpers are independent of an Agent or {@link WebLLMModel} — use them
 * from a settings UI to inspect, pre-download, or evict models before wiring
 * them into an agent.
 */

import type { AppConfig, ChatOptions, InitProgressReport, MLCEngineInterface, ModelRecord } from '@mlc-ai/web-llm'
import { logger } from '../../logging/logger.js'
import { ModelError, normalizeError } from '../../errors.js'

/**
 * Thrown when WebLLM cannot run in the current environment (no WebGPU,
 * no browser globals, or the `@mlc-ai/web-llm` package is missing).
 */
export class WebLLMUnavailableError extends ModelError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WebLLMUnavailableError'
  }
}

/**
 * Thrown when a requested model ID is not present in the active app config.
 */
export class WebLLMModelNotFoundError extends ModelError {
  /**
   * The model ID that could not be found.
   */
  public readonly modelId: string

  constructor(modelId: string, message?: string) {
    super(message ?? `WebLLM model '${modelId}' is not in the active appConfig.model_list`)
    this.name = 'WebLLMModelNotFoundError'
    this.modelId = modelId
  }
}

/**
 * Options for pre-downloading a WebLLM model without constructing a
 * {@link WebLLMModel}.
 */
export interface DownloadWebLLMModelOptions {
  /**
   * WebLLM model identifier to download.
   */
  modelId: string

  /**
   * Custom `AppConfig`. Defaults to WebLLM's `prebuiltAppConfig`.
   */
  appConfig?: AppConfig

  /**
   * Baseline `ChatConfig` overrides.
   */
  chatOpts?: ChatOptions

  /**
   * Progress callback with percent-complete, text, and elapsed time.
   */
  onProgress?: (report: InitProgressReport) => void

  /**
   * Signal to cancel the download. When aborted, the temporary engine is
   * unloaded and an `AbortError` is thrown.
   */
  signal?: AbortSignal
}

/**
 * Summary of a model entry in the WebLLM app config.
 */
export interface WebLLMModelInfo {
  /**
   * WebLLM model identifier (e.g. `Llama-3.1-8B-Instruct-q4f32_1-MLC`).
   */
  modelId: string

  /**
   * Model weights URL (from `ModelRecord.model`).
   */
  modelUrl: string

  /**
   * Model library (wasm) URL.
   */
  modelLib: string

  /**
   * Estimated VRAM requirement in megabytes, if provided by the registry.
   */
  vramMB?: number

  /**
   * Optional model type (e.g. `LLM`, `embedding`) from the registry.
   */
  modelType?: string
}

/**
 * Shape of the subset of `@mlc-ai/web-llm` exports used by this provider.
 *
 * @internal
 */
interface WebLLMModule {
  CreateMLCEngine: (
    modelId: string | string[],
    engineConfig?: {
      appConfig?: AppConfig
      initProgressCallback?: (report: InitProgressReport) => void
      logLevel?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SILENT'
    },
    chatOpts?: unknown
  ) => Promise<MLCEngineInterface>
  prebuiltAppConfig: AppConfig
  hasModelInCache: (modelId: string, appConfig?: AppConfig) => Promise<boolean>
  deleteModelAllInfoInCache: (modelId: string, appConfig?: AppConfig) => Promise<void>
}

let cachedModule: WebLLMModule | undefined

/**
 * Dynamically imports `@mlc-ai/web-llm`. Caches the module after first import.
 *
 * @throws {@link WebLLMUnavailableError} when the package is not installed
 * or the current environment does not support it.
 *
 * @internal
 */
export async function loadWebLLMModule(): Promise<WebLLMModule> {
  if (cachedModule) return cachedModule
  try {
    const mod = (await import('@mlc-ai/web-llm')) as unknown as WebLLMModule
    cachedModule = mod
    return mod
  } catch (error) {
    throw new WebLLMUnavailableError(
      "Failed to load '@mlc-ai/web-llm'. Install it as a peer dependency and ensure this code runs in a browser with WebGPU support.",
      { cause: error }
    )
  }
}

/**
 * Resets the cached WebLLM module reference. Intended for tests only.
 *
 * @internal
 */
export function resetWebLLMModuleCache(): void {
  cachedModule = undefined
}

/**
 * Verifies the current environment can run WebLLM and throws with a clear
 * message otherwise. Does not verify WebGPU — that check is deferred to
 * engine creation to surface WebLLM's own diagnostics.
 *
 * @internal
 */
export function assertBrowserEnvironment(): void {
  if (typeof window === 'undefined') {
    throw new WebLLMUnavailableError('WebLLM requires a browser environment with WebGPU. Run this code in a browser.')
  }
}

/**
 * Returns true if the model is already cached locally (no download needed).
 *
 * @param modelId - WebLLM model ID to check
 * @param appConfig - Optional custom app config. Defaults to `prebuiltAppConfig`.
 * @returns `true` if cached, `false` otherwise
 *
 * @throws {@link WebLLMModelNotFoundError} when `modelId` is not in the app config.
 * @throws {@link WebLLMUnavailableError} when WebLLM cannot be loaded.
 */
export async function isWebLLMModelCached(modelId: string, appConfig?: AppConfig): Promise<boolean> {
  assertBrowserEnvironment()
  const mod = await loadWebLLMModule()
  const config = appConfig ?? mod.prebuiltAppConfig
  ensureModelInConfig(modelId, config)
  try {
    return await mod.hasModelInCache(modelId, config)
  } catch (error) {
    logger.debug(`model_id=<${modelId}> | hasModelInCache failed, treating as not cached | error=<${error}>`)
    return false
  }
}

/**
 * Deletes all cached data for a model (weights, tokenizer, wasm, chat config).
 *
 * @param modelId - WebLLM model ID to evict
 * @param appConfig - Optional custom app config. Defaults to `prebuiltAppConfig`.
 *
 * @throws {@link WebLLMModelNotFoundError} when `modelId` is not in the app config.
 * @throws {@link WebLLMUnavailableError} when WebLLM cannot be loaded.
 */
export async function deleteWebLLMModel(modelId: string, appConfig?: AppConfig): Promise<void> {
  assertBrowserEnvironment()
  const mod = await loadWebLLMModule()
  const config = appConfig ?? mod.prebuiltAppConfig
  ensureModelInConfig(modelId, config)
  await mod.deleteModelAllInfoInCache(modelId, config)
}

/**
 * Lists models available in the active app config.
 *
 * @param appConfig - Optional custom app config. Defaults to `prebuiltAppConfig`.
 * @returns Array of {@link WebLLMModelInfo} entries.
 *
 * @throws {@link WebLLMUnavailableError} when WebLLM cannot be loaded.
 */
export async function listWebLLMModels(appConfig?: AppConfig): Promise<WebLLMModelInfo[]> {
  const mod = await loadWebLLMModule()
  const config = appConfig ?? mod.prebuiltAppConfig
  return config.model_list.map(toModelInfo)
}

/**
 * Pre-downloads a WebLLM model by creating a temporary engine, waiting for
 * the model to load, and then unloading the engine. The model weights remain
 * in browser cache (IndexedDB / CacheStorage) for subsequent use.
 *
 * Supports cancellation via `AbortSignal` — on abort, the engine is unloaded
 * and an `AbortError` is thrown. Note that in-flight chunk fetches may continue
 * briefly before fully stopping.
 *
 * @param options - Download options
 *
 * @throws {@link WebLLMModelNotFoundError} when `modelId` is not in the app config.
 * @throws {@link WebLLMUnavailableError} when WebLLM cannot be loaded.
 *
 * @example
 * ```typescript
 * await downloadWebLLMModel({
 *   modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
 *   onProgress: (r) => console.log(r.text, r.progress),
 * })
 * ```
 */
export async function downloadWebLLMModel(options: DownloadWebLLMModelOptions): Promise<void> {
  assertBrowserEnvironment()
  const mod = await loadWebLLMModule()
  const config = options.appConfig ?? mod.prebuiltAppConfig
  ensureModelInConfig(options.modelId, config)

  if (options.signal?.aborted) {
    throw abortError()
  }

  let engine: MLCEngineInterface | undefined
  const abortHandler = (): void => {
    if (engine) {
      engine.unload().catch((error: unknown) => {
        logger.debug(`model_id=<${options.modelId}> | unload on abort failed | error=<${error}>`)
      })
    }
  }
  options.signal?.addEventListener('abort', abortHandler, { once: true })

  try {
    const engineConfig: Parameters<typeof mod.CreateMLCEngine>[1] = { appConfig: config }
    if (options.onProgress) engineConfig.initProgressCallback = options.onProgress
    engine = await mod.CreateMLCEngine(options.modelId, engineConfig, options.chatOpts)
    if (options.signal?.aborted) {
      throw abortError()
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw abortError()
    }
    throw normalizeError(error)
  } finally {
    options.signal?.removeEventListener('abort', abortHandler)
    if (engine) {
      try {
        await engine.unload()
      } catch (error) {
        logger.debug(`model_id=<${options.modelId}> | unload after download failed | error=<${error}>`)
      }
    }
  }
}

function ensureModelInConfig(modelId: string, appConfig: AppConfig): void {
  if (!appConfig.model_list.some((m: ModelRecord) => m.model_id === modelId)) {
    throw new WebLLMModelNotFoundError(modelId)
  }
}

function toModelInfo(record: ModelRecord): WebLLMModelInfo {
  const info: WebLLMModelInfo = {
    modelId: record.model_id,
    modelUrl: record.model,
    modelLib: record.model_lib,
  }
  if (record.vram_required_MB !== undefined) info.vramMB = record.vram_required_MB
  if (typeof (record as unknown as { model_type?: string }).model_type === 'string') {
    info.modelType = (record as unknown as { model_type: string }).model_type
  }
  return info
}

function abortError(): Error {
  const err = new Error('WebLLM download aborted')
  err.name = 'AbortError'
  return err
}
