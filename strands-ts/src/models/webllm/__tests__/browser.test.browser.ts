// ABOUTME: Browser-only smoke test for the WebLLM provider.
// ABOUTME: Verifies the public module imports cleanly and listWebLLMModels works
// ABOUTME: against the real @mlc-ai/web-llm prebuilt app config in a browser.

import { describe, it, expect } from 'vitest'
import { isBrowser } from '../../../__fixtures__/environment.js'
import { WebLLMModel, listWebLLMModels } from '../index.js'

describe('WebLLM browser smoke', () => {
  it('runs in a browser environment', () => {
    expect(isBrowser).toBe(true)
  })

  it('exposes WebLLMModel as a constructor', () => {
    expect(typeof WebLLMModel).toBe('function')
    const model = new WebLLMModel({ modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC' })
    expect(model.getConfig().modelId).toBe('Llama-3.1-8B-Instruct-q4f32_1-MLC')
  })

  it('lists prebuilt models', async () => {
    const models = await listWebLLMModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0]).toHaveProperty('modelId')
    expect(models[0]).toHaveProperty('modelUrl')
    expect(models[0]).toHaveProperty('modelLib')
  })
})
