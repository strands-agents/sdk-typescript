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
 */
export interface ProviderFeatures {
  /** Whether the model supports reasoning/thinking content */
  reasoning: boolean
  /** Whether the model supports tool use */
  tools: boolean
  /** Whether the model supports image input */
  images: boolean
  /** Whether the model supports document input */
  documents: boolean
  /** Whether the model supports video input */
  video: boolean
}

export const bedrock = {
  name: 'BedrockModel',
  supports: {
    reasoning: true,
    tools: true,
    images: true,
    documents: true,
    video: true,
  } satisfies ProviderFeatures,
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
      clientConfig: {
        ...(options.clientConfig ?? {}),
        credentials: credentials,
      },
    })
  },
  /** Creates a model configured for reasoning/thinking tests */
  createReasoningModel: (options: BedrockModelOptions = {}): BedrockModel => {
    const credentials = inject('provider-bedrock').credentials
    if (!credentials) {
      throw new Error('No Bedrock credentials provided')
    }

    return new BedrockModel({
      ...options,
      // Claude 3.5 Sonnet supports extended thinking
      modelId: options.modelId ?? 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      // Enable extended thinking via additionalRequestFields
      additionalRequestFields: {
        ...(options.additionalRequestFields as Record<string, unknown> | undefined),
        thinking: { type: 'enabled', budget_tokens: 1024 },
      },
      clientConfig: {
        ...(options.clientConfig ?? {}),
        credentials: credentials,
      },
    })
  },
}

export const openai = {
  name: 'OpenAIModel',
  supports: {
    reasoning: true,
    tools: true,
    images: true,
    documents: true,
    video: false,
  } satisfies ProviderFeatures,
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
      apiKey: apiKey,
      clientConfig: {
        ...(config.clientConfig ?? {}),
        dangerouslyAllowBrowser: true,
      },
    })
  },
  /** Creates a model configured for reasoning/thinking tests */
  createReasoningModel: (config: OpenAIModelOptions = {}): OpenAIModel => {
    const apiKey = inject('provider-openai').apiKey
    if (!apiKey) {
      throw new Error('No OpenAI apiKey provided')
    }

    return new OpenAIModel({
      ...config,
      // o1 models support reasoning
      modelId: config.modelId ?? 'o1-mini',
      apiKey: apiKey,
      clientConfig: {
        ...(config.clientConfig ?? {}),
        dangerouslyAllowBrowser: true,
      },
    })
  },
}

export const anthropic = {
  name: 'AnthropicModel',
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
    tools: false, // Not yet implemented
    images: true,
    documents: true,
    video: true,
  } satisfies ProviderFeatures,
  get skip() {
    return inject('provider-gemini').shouldSkip
  },
  createModel: (config: GeminiModelOptions = {}): GeminiModel => {
    const apiKey = inject('provider-gemini').apiKey
    if (!apiKey) {
      throw new Error('No Gemini apiKey provided')
    }

    return new GeminiModel({
      ...config,
      apiKey: apiKey,
    })
  },
  /** Creates a model configured for reasoning/thinking tests */
  createReasoningModel: (config: GeminiModelOptions = {}): GeminiModel => {
    const apiKey = inject('provider-gemini').apiKey
    if (!apiKey) {
      throw new Error('No Gemini apiKey provided')
    }

    return new GeminiModel({
      ...config,
      // Gemini thinking model
      modelId: config.modelId ?? 'gemini-2.0-flash-thinking-exp',
      apiKey: apiKey,
    })
  },
}

export const allProviders = [bedrock, openai, anthropic, gemini]
