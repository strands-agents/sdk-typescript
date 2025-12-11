import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import type { ContentBlock, Message } from '$/sdk/types/messages.js'

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
  if (process.env.CI) {
    console.log('✅ Running in CI environment, integration tests will run.')
    return false
  }

  // In a local environment, we check for credentials as a convenience.
  try {
    const credentialProvider = fromNodeProviderChain()
    await credentialProvider()
    console.log('✅ AWS credentials found locally, integration tests will run.')
    return false
  } catch {
    console.log('⏭️ AWS credentials not available locally, integration tests will be skipped.')
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
export function shouldSkipOpenAITests(): boolean {
  try {
    const isCI = !!process.env.CI
    const hasKey = !!process.env.OPENAI_API_KEY

    if (isCI && !hasKey) {
      throw new Error('OpenAI API key must be available in CI environments')
    }

    if (hasKey) {
      if (isCI) {
        console.log('✅ Running in CI environment with OpenAI API key - tests will run')
      } else {
        console.log('✅ OpenAI API key found for integration tests')
      }
      return false
    } else {
      console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
      return true
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('CI environments')) {
      throw error
    }
    console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
    return true
  }
}
