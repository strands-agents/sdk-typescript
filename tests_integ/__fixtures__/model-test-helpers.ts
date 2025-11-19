import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import type { Message, ContentBlock } from '../../src/types/messages.js'
import type { Agent, ToolResultBlock } from '../../src/index.js'

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

/**
 * Extracts all tool result blocks from an agent's message history.
 *
 * Tool results are contained in user messages (messages with role='user') that the agent
 * sends back to the model after executing tools.
 *
 * @param agent - The agent to extract tool results from
 * @returns Array of all ToolResultBlock objects from the agent's conversation history
 */
export function extractToolResults(agent: Agent): ToolResultBlock[] {
  return agent['_messages']
    .filter((msg) => msg.role === 'user')
    .flatMap((msg) => msg.content.filter((block): block is ToolResultBlock => block.type === 'toolResultBlock'))
}
