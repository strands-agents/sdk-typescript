/**
 * Contains helpers for creating various model providers that work both in node & the browser
 */

import { inject } from 'vitest'
import { BedrockModel, type BedrockModelOptions } from '$/sdk/models/bedrock.js'
import { OpenAIModel, type OpenAIModelOptions } from '$/sdk/models/openai.js'
import { AnthropicModel, type AnthropicModelOptions } from '$/sdk/models/anthropic.js'
import { GeminiModel, type GeminiModelOptions } from '$/sdk/models/gemini/model.js'

export const bedrock = {
  name: 'BedrockModel',
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
}

export const openai = {
  name: 'OpenAIModel',
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
}

export const allProviders = [bedrock, openai, anthropic, gemini]
