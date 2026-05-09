// ABOUTME: Unit tests for WebLLM cache / download helpers.
// ABOUTME: The `@mlc-ai/web-llm` module is mocked so these run in node without WebGPU.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import {
  deleteWebLLMModel,
  downloadWebLLMModel,
  isWebLLMModelCached,
  listWebLLMModels,
  resetWebLLMModuleCache,
  WebLLMModelNotFoundError,
  WebLLMUnavailableError,
} from '../cache.js'

// A minimal mock of the `@mlc-ai/web-llm` module surface we depend on.
const mockPrebuiltAppConfig = {
  model_list: [
    {
      model_id: 'test-model',
      model: 'https://example.com/test-model',
      model_lib: 'https://example.com/test-model.wasm',
      vram_required_MB: 2048,
    },
    {
      model_id: 'other-model',
      model: 'https://example.com/other',
      model_lib: 'https://example.com/other.wasm',
    },
  ],
}

const mockCreateEngine = vi.fn(
  async (
    _modelId: string | string[],
    _engineConfig?: { initProgressCallback?: (report: unknown) => void },
    _chatOpts?: unknown
  ) => ({
    unload: vi.fn(async () => undefined),
    chat: { completions: { create: vi.fn() } },
  })
)
const mockHasModelInCache = vi.fn(async () => false)
const mockDeleteModelAllInfoInCache = vi.fn(async () => undefined)

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: mockCreateEngine,
  prebuiltAppConfig: mockPrebuiltAppConfig,
  hasModelInCache: mockHasModelInCache,
  deleteModelAllInfoInCache: mockDeleteModelAllInfoInCache,
}))

// Fake out the browser environment check so these helpers run in node.
const originalWindow = globalThis.window
beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = {} as unknown
  vi.clearAllMocks()
  resetWebLLMModuleCache()
  mockHasModelInCache.mockResolvedValue(false)
  mockDeleteModelAllInfoInCache.mockResolvedValue(undefined)
  mockCreateEngine.mockImplementation(async () => ({
    unload: vi.fn(async () => undefined),
    chat: { completions: { create: vi.fn() } },
  }))
})
afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window
  } else {
    ;(globalThis as { window?: unknown }).window = originalWindow
  }
})

describe('isWebLLMModelCached', () => {
  it('returns true when the model is in cache', async () => {
    mockHasModelInCache.mockResolvedValueOnce(true)
    const result = await isWebLLMModelCached('test-model')
    expect(result).toBe(true)
    expect(mockHasModelInCache).toHaveBeenCalledWith('test-model', mockPrebuiltAppConfig)
  })

  it('returns false when the model is not in cache', async () => {
    const result = await isWebLLMModelCached('test-model')
    expect(result).toBe(false)
  })

  it('returns false when hasModelInCache throws (treats as not cached)', async () => {
    mockHasModelInCache.mockRejectedValueOnce(new Error('storage error'))
    const result = await isWebLLMModelCached('test-model')
    expect(result).toBe(false)
  })

  it('throws WebLLMModelNotFoundError for unknown modelId', async () => {
    await expect(isWebLLMModelCached('nonexistent-model')).rejects.toBeInstanceOf(WebLLMModelNotFoundError)
  })

  it('throws WebLLMUnavailableError when not in browser environment', async () => {
    delete (globalThis as { window?: unknown }).window
    await expect(isWebLLMModelCached('test-model')).rejects.toBeInstanceOf(WebLLMUnavailableError)
  })
})

describe('deleteWebLLMModel', () => {
  it('delegates to deleteModelAllInfoInCache', async () => {
    await deleteWebLLMModel('test-model')
    expect(mockDeleteModelAllInfoInCache).toHaveBeenCalledWith('test-model', mockPrebuiltAppConfig)
  })

  it('throws for unknown model', async () => {
    await expect(deleteWebLLMModel('nonexistent')).rejects.toBeInstanceOf(WebLLMModelNotFoundError)
  })
})

describe('listWebLLMModels', () => {
  it('returns all models from prebuiltAppConfig', async () => {
    const models = await listWebLLMModels()
    expect(models).toHaveLength(2)
    expect(models[0]).toEqual({
      modelId: 'test-model',
      modelUrl: 'https://example.com/test-model',
      modelLib: 'https://example.com/test-model.wasm',
      vramMB: 2048,
    })
    expect(models[1]).toEqual({
      modelId: 'other-model',
      modelUrl: 'https://example.com/other',
      modelLib: 'https://example.com/other.wasm',
    })
  })

  it('uses custom appConfig when provided', async () => {
    const custom = {
      model_list: [{ model_id: 'custom', model: 'x', model_lib: 'y' }],
    }
    const models = await listWebLLMModels(custom as never)
    expect(models).toEqual([{ modelId: 'custom', modelUrl: 'x', modelLib: 'y' }])
  })
})

describe('downloadWebLLMModel', () => {
  it('creates a temporary engine and unloads it after load', async () => {
    const unload = vi.fn(async () => undefined)
    mockCreateEngine.mockImplementationOnce(async () => ({
      unload,
      chat: { completions: { create: vi.fn() } },
    }))
    await downloadWebLLMModel({ modelId: 'test-model' })
    expect(mockCreateEngine).toHaveBeenCalledTimes(1)
    expect(mockCreateEngine).toHaveBeenCalledWith('test-model', { appConfig: mockPrebuiltAppConfig }, undefined)
    expect(unload).toHaveBeenCalledTimes(1)
  })

  it('forwards onProgress as the engine initProgressCallback', async () => {
    const onProgress = vi.fn()
    const unload = vi.fn(async () => undefined)
    mockCreateEngine.mockImplementationOnce(async (_modelId, engineConfig) => {
      ;(engineConfig as { initProgressCallback?: (r: unknown) => void }).initProgressCallback?.({
        progress: 0.5,
        text: 'loading',
        timeElapsed: 1,
      })
      return { unload, chat: { completions: { create: vi.fn() } } }
    })
    await downloadWebLLMModel({ modelId: 'test-model', onProgress })
    expect(onProgress).toHaveBeenCalledWith({ progress: 0.5, text: 'loading', timeElapsed: 1 })
  })

  it('throws AbortError when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(downloadWebLLMModel({ modelId: 'test-model', signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mockCreateEngine).not.toHaveBeenCalled()
  })

  it('throws AbortError when aborted mid-download', async () => {
    const controller = new AbortController()
    const unload = vi.fn(async () => undefined)
    mockCreateEngine.mockImplementationOnce(async () => {
      controller.abort()
      return { unload, chat: { completions: { create: vi.fn() } } }
    })
    await expect(downloadWebLLMModel({ modelId: 'test-model', signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(unload).toHaveBeenCalled()
  })

  it('throws when model is not in app config', async () => {
    await expect(downloadWebLLMModel({ modelId: 'nonexistent' })).rejects.toBeInstanceOf(WebLLMModelNotFoundError)
  })

  it('surfaces engine errors via normalizeError', async () => {
    mockCreateEngine.mockImplementationOnce(async () => {
      throw new Error('webgpu unavailable')
    })
    await expect(downloadWebLLMModel({ modelId: 'test-model' })).rejects.toThrow('webgpu unavailable')
  })
})

describe('loadWebLLMModule error handling', () => {
  it('throws WebLLMUnavailableError when environment is not a browser', async () => {
    delete (globalThis as { window?: unknown }).window
    await expect(downloadWebLLMModel({ modelId: 'test-model' })).rejects.toBeInstanceOf(WebLLMUnavailableError)
  })
})

// Silence unused-helper lint noise
export type _Unused = MockedFunction<typeof mockCreateEngine>
