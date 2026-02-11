/**
 * Contains helpers for creating various model providers that work both in node & the browser
 */

import { inject } from 'vitest'
import { BedrockModel, type BedrockModelOptions } from '$/sdk/models/bedrock.js'
import { OpenAIModel, type OpenAIModelOptions } from '$/sdk/models/openai.js'
import { AnthropicModel, type AnthropicModelOptions } from '$/sdk/models/anthropic.js'
import { GeminiModel, type GeminiModelOptions } from '$/sdk/models/gemini/model.js'

/**
 * Feature support flags for model providers.
 * Used to conditionally run tests based on model capabilities.
 *
 * TODO: after https://github.com/strands-agents/sdk-python/issues/780 this config should be in src not test
 */
export interface ProviderFeatures {
  reasoning: boolean
  tools: boolean
  toolThinking: boolean
  builtInTools: boolean
  images: boolean
  documents: boolean
  video: boolean
}

export const bedrock = {
  name: 'BedrockModel',
  supports: {
    reasoning: true,
    tools: true,
    toolThinking: false,
    builtInTools: false,
    images: true,
    documents: true,
    video: true,
  } satisfies ProviderFeatures,
  models: {
    default: {},
    reasoning: {
      modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      additionalRequestFields: { thinking: { type: 'enabled', budget_tokens: 1024 } },
    },
    video: { modelId: 'us.amazon.nova-pro-v1:0' },
  },
  get skip() {
    return inject('provider-bedrock').shouldSkip
  },
  createModel: (options: BedrockModelOptions = {}): BedrockModel => {
    const credentials = inject('provider-bedrock')?.credentials
    if (!credentials) {
      throw new Error('No Bedrock credentials provided')
    }
    return new BedrockModel({
      ...options,
      clientConfig: { ...(options.clientConfig ?? {}), credentials },
    })
  },
}

export const openai = {
  name: 'OpenAIModel',
  supports: {
    reasoning: false,
    tools: true,
    toolThinking: false,
    builtInTools: false,
    images: true,
    documents: true,
    video: false,
  } satisfies ProviderFeatures,
  models: {
    default: {},
    reasoning: { modelId: 'o1-mini' },
    video: {},
  },
  get skip() {
    return inject('provider-openai').shouldSkip
  },
  createModel: (config: OpenAIModelOptions = {}): OpenAIModel => {
    const apiKey = inject('provider-openai')?.apiKey
    if (!apiKey) {
      throw new Error('No OpenAI apiKey provided')
    }
    return new OpenAIModel({
      ...config,
      apiKey,
      clientConfig: { ...(config.clientConfig ?? {}), dangerouslyAllowBrowser: true },
    })
  },
}

export const anthropic = {
  name: 'AnthropicModel',
  supports: {
    reasoning: true,
    tools: true,
    toolThinking: false,
    builtInTools: false,
    images: true,
    documents: true,
    video: false,
  } satisfies ProviderFeatures,
  models: {
    default: {},
    reasoning: {
      modelId: 'claude-sonnet-4-5-20250929',
      params: { thinking: { type: 'enabled', budget_tokens: 1024 } },
    },
    video: {},
  },
  get skip() {
    return inject('provider-anthropic').shouldSkip
  },
  createModel: (config: AnthropicModelOptions = {}): AnthropicModel => {
    const apiKey = inject('provider-anthropic')?.apiKey
    if (!apiKey) {
      throw new Error('No Anthropic apiKey provided')
    }

    return new AnthropicModel({
      ...config,
      apiKey: apiKey,
      clientConfig: {
        ...(config.clientConfig ?? {}),
        dangerouslyAllowBrowser: true,
      },
    })
  },
}

export const gemini = {
  name: 'GeminiModel',
  supports: {
    reasoning: true,
    tools: true,
    toolThinking: true,
    builtInTools: true,
    images: true,
    documents: true,
    video: true,
  } satisfies ProviderFeatures,
  models: {
    default: {},
    reasoning: {
      modelId: 'gemini-2.5-flash',
      params: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } },
    },
    builtInTools: {
      geminiTools: [{ codeExecution: {} }],
    },
    video: {},
  },
  get skip() {
    return inject('provider-gemini').shouldSkip
  },
  createModel: (config: GeminiModelOptions = {}): GeminiModel => {
    const apiKey = inject('provider-gemini').apiKey
    if (!apiKey) {
      throw new Error('No Gemini apiKey provided')
    }
    return new GeminiModel({ ...config, apiKey })
  },
}

export const allProviders = [bedrock, openai, anthropic, gemini]
