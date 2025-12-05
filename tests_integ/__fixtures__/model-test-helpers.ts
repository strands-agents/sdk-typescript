import { BedrockModel, type BedrockModelOptions } from '@strands-agents/sdk'
import { OpenAIModel, type OpenAIModelOptions } from '@strands-agents/sdk/openai'

import type { Message, ContentBlock } from '@strands-agents/sdk'
import { isInBrowser } from './test-helpers.js'

export * from '../../src/__fixtures__/model-test-helpers.js'

/**
 * Determines whether AWS integration tests should run based on environment and credentials.
 *
 * In CI environments, tests always run (credentials are expected to be configured).
 * In local environments, tests run only if AWS credentials are available.
 *
 * @returns Promise<boolean> - true if tests should run, false if they should be skipped
 */
export async function shouldSkipBedrockTests(): Promise<boolean> {
  // In a CI environment, we ALWAYS expect credentials to be configured.
  // A failure is better than a skip.
  if (globalThis.process?.env?.CI) {
    console.log('✅ Running in CI environment, integration tests will run.')
    return false
  }

  // In a local environment, we check for credentials as a convenience.
  try {
    if (isInBrowser()) {
      const { commands } = await import('vitest/browser')
      await commands.getAwsCredentials()
      console.log('✅ credentials found via vitest, integration tests will run.')
      return false
    } else {
      const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers')
      const credentialProvider = fromNodeProviderChain()
      await credentialProvider()
      console.log('✅ AWS credentials found locally, integration tests will run.')
      return false
    }
  } catch {
    console.log('⏭️ AWS credentials not available, integration tests will be skipped.')
    return true
  }
}

/**
 * Determines if OpenAI integration tests should be skipped.
 * In CI environments, throws an error if API key is missing (tests should not be skipped).
 * In local development, skips tests if API key is not available.
 *
 * @returns true if tests should be skipped, false if they should run
 * @throws Error if running in CI and API key is missing
 */
export const shouldSkipOpenAITests = async (): Promise<boolean> => {
  const getApiKey = async (): Promise<string> => {
    if (isInBrowser()) {
      const { commands } = await import('vitest/browser')
      return await commands.getOpenAIAPIKey()
    } else {
      return globalThis.process.env.OPENAI_API_KEY as string
    }
  }

  // In a CI environment, we ALWAYS expect credentials to be configured.
  // A failure is better than a skip.
  if (globalThis.process?.env?.CI) {
    console.log('✅ Running in CI environment, integration tests will run.')
    const apiKey = await getApiKey()

    if (!apiKey) {
      throw new Error('OpenAI API key must be available in CI environments')
    }

    return false
  }

  const apiKey = await getApiKey()
  if (!apiKey) {
    console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
    return true
  } else {
    console.log('⏭️  OpenAI API key available - integration tests will run')
    return false
  }
}

/**
 * Extracts plain text content from a Message object.
 *
 * This helper function handles different message formats by:
 * - Extracting text from Message objects by filtering for textBlock content blocks
 * - Joining multiple text blocks with newlines
 *
 * @param message - The message to extract text from. Message object with content blocks
 * @returns The extracted text content as a string, or empty string if no content is found
 */
export const getMessageText = (message: Message): string => {
  if (!message.content) return ''

  return message.content
    .filter((block: ContentBlock) => block.type === 'textBlock')
    .map((block) => block.text)
    .join('\n')
}

export function createBedrockModel(options: BedrockModelOptions = {}) {
  if (isInBrowser()) {
    return new BedrockModel({
      ...options,
      clientConfig: {
        ...(options.clientConfig ?? {}),
        credentials: async () => {
          const { commands } = await import('vitest/browser')
          return await commands.getAwsCredentials()
        },
      },
    })
  } else {
    return new BedrockModel(options)
  }
}

export function createOpenAIModel(config: OpenAIModelOptions = {}) {
  if (isInBrowser()) {
    return new OpenAIModel({
      ...config,
      clientConfig: {
        ...(config.clientConfig ?? {}),
        apiKey: async (): Promise<string> => {
          const { commands } = await import('vitest/browser')
          return await commands.getOpenAIAPIKey()
        },
        dangerouslyAllowBrowser: true,
      },
    })
  } else {
    return new OpenAIModel(config)
  }
}
