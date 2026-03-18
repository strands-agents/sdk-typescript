/**
 * Contains helpers for creating various model providers that work both in node & the browser
 */

import { inject } from 'vitest'
import { ConverseModel, type ConverseModelOptions } from '$/sdk/models/bedrock.js'
import { ChatModel, type ChatModelOptions } from '$/sdk/models/openai.js'
import { MessagesModel, type MessagesModelOptions } from '$/sdk/models/anthropic.js'
import { GenAIModel, type GenAIModelOptions } from '$/sdk/models/google/model.js'

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
  citations: boolean
}

export const bedrock = {
  name: 'ConverseModel',
  supports: {
    reasoning: true,
    tools: true,
    toolThinking: false,
    builtInTools: false,
    images: true,
    documents: true,
    video: true,
    citations: true,
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
  createModel: (options: ConverseModelOptions = {}): ConverseModel => {
    const credentials = inject('provider-bedrock')?.credentials
    if (!credentials) {
      throw new Error('No Bedrock credentials provided')
    }
    return new ConverseModel({
      ...options,
      clientConfig: { ...(options.clientConfig ?? {}), credentials },
    })
  },
}

export const openai = {
  name: 'ChatModel',
  supports: {
    reasoning: false,
    tools: true,
    toolThinking: false,
    builtInTools: false,
    images: true,
    documents: true,
    video: false,
    citations: false,
  } satisfies ProviderFeatures,
  models: {
    default: {},
    reasoning: { modelId: 'o1-mini' },
    video: {},
  },
  get skip() {
    return inject('provider-openai').shouldSkip
  },
  createModel: (config: ChatModelOptions = {}): ChatModel => {
    const apiKey = inject('provider-openai')?.apiKey
    if (!apiKey) {
      throw new Error('No OpenAI apiKey provided')
    }
    return new ChatModel({
      ...config,
      apiKey,
      clientConfig: { ...(config.clientConfig ?? {}), dangerouslyAllowBrowser: true },
    })
  },
}

export const anthropic = {
  name: 'MessagesModel',
  supports: {
    reasoning: true,
    tools: true,
    toolThinking: false,
    builtInTools: false,
    images: true,
    documents: true,
    video: false,
    citations: false,
  } satisfies ProviderFeatures,
  models: {
    default: {},
    reasoning: {
      modelId: 'claude-sonnet-4-6',
      params: { thinking: { type: 'enabled', budget_tokens: 1024 } },
    },
    video: {},
  },
  get skip() {
    return inject('provider-anthropic').shouldSkip
  },
  createModel: (config: MessagesModelOptions = {}): MessagesModel => {
    const apiKey = inject('provider-anthropic')?.apiKey
    if (!apiKey) {
      throw new Error('No Anthropic apiKey provided')
    }

    return new MessagesModel({
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
  name: 'GenAIModel',
  supports: {
    reasoning: true,
    tools: true,
    toolThinking: true,
    builtInTools: true,
    images: true,
    documents: true,
    video: true,
    citations: false,
  } satisfies ProviderFeatures,
  models: {
    default: {},
    reasoning: {
      modelId: 'gemini-2.5-flash',
      params: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } },
    },
    builtInTools: {
      builtInTools: [{ codeExecution: {} }],
    },
    video: {},
  },
  get skip() {
    return inject('provider-gemini').shouldSkip
  },
  createModel: (config: GenAIModelOptions = {}): GenAIModel => {
    const apiKey = inject('provider-gemini').apiKey
    if (!apiKey) {
      throw new Error('No Gemini apiKey provided')
    }
    return new GenAIModel({ ...config, apiKey })
  },
}

export const allProviders = [bedrock, openai, anthropic, gemini]
