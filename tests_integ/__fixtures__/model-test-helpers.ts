import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import type { Message, ContentBlock } from '$/sdk/types/messages.js'

/**
 * Determines whether AWS integration tests should run based on environment and credentials.
 *
 * In CI environments, tests always run (credentials are expected to be configured).
 * In local environments, tests run only if AWS credentials are available.
 *
 * @returns Promise<boolean> - true if tests should run, false if they should be skipped
 */
export async function shouldRunTests(): Promise<boolean> {
  // In a CI environment, we ALWAYS expect credentials to be configured.
  // A failure is better than a skip.
  if (process.env.CI) {
    console.log('✅ Running in CI environment, integration tests will run.')
    return true
  }

  // In a local environment, we check for credentials as a convenience.
  try {
    const credentialProvider = fromNodeProviderChain()
    await credentialProvider()
    console.log('✅ AWS credentials found locally, integration tests will run.')
    return true
  } catch {
    console.log('⏭️ AWS credentials not available locally, integration tests will be skipped.')
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
