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
    video: false, // Bedrock/Claude doesn't support video content blocks
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
    return bedrock.createModel({
      ...options,
      // Claude Sonnet 4 supports extended thinking
      modelId: options.modelId ?? 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      additionalRequestFields: {
        ...(options.additionalRequestFields as Record<string, unknown> | undefined),
        thinking: { type: 'enabled', budget_tokens: 1024 },
      },
    })
  },
}

export const openai = {
  name: 'OpenAIModel',
  supports: {
    // OpenAI o1 models have internal reasoning but don't expose it in the streaming API yet
    reasoning: false,
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
    if (!openai.supports.reasoning) {
      throw new Error('OpenAI reasoning is not currently supported')
    }
    return openai.createModel({
      ...config,
      modelId: config.modelId ?? 'o1-mini',
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
    return gemini.createModel({
      ...config,
      modelId: config.modelId ?? 'gemini-2.5-flash',
      params: {
        ...((config.params as Record<string, unknown>) ?? {}),
        thinkingConfig: {
          thinkingBudget: 1024,
          includeThoughts: true,
        },
      },
    })
  },
}

export const allProviders = [bedrock, openai, anthropic, gemini]
