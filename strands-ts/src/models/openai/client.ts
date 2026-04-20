/**
 * Shared OpenAI client construction.
 *
 * @internal
 */

import OpenAI from 'openai'
import type { ApiKeySetter } from 'openai/client'
import type { ClientOptions } from 'openai'

interface CreateClientOptions {
  apiKey?: string | ApiKeySetter | undefined
  client?: OpenAI | undefined
  clientConfig?: ClientOptions | undefined
}

/**
 * Returns the provided client if given; otherwise constructs a new OpenAI client,
 * falling back to the `OPENAI_API_KEY` environment variable when no `apiKey` is provided.
 *
 * @internal
 */
export function createOpenAIClient({ apiKey, client, clientConfig }: CreateClientOptions): OpenAI {
  if (client) {
    return client
  }

  const hasEnvKey = typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.OPENAI_API_KEY
  if (!apiKey && !hasEnvKey) {
    throw new Error(
      "OpenAI API key is required. Provide it via the 'apiKey' option (string or function) or set the OPENAI_API_KEY environment variable."
    )
  }

  return new OpenAI({
    ...(apiKey ? { apiKey } : {}),
    ...clientConfig,
  })
}
