/**
 * Global setup that runs once before all integration tests and possibly runs in the *parent* process
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import type { TestProject } from 'vitest/node'
import type { ProvidedContext } from 'vitest'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'

/**
 * Load API keys as environment variables from AWS Secrets Manager
 */
async function loadApiKeysFromSecretsManager(): Promise<void> {
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
  })

  try {
    const secretName = 'model-provider-api-key'
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    })
    const response = await client.send(command)

    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString)
      // Only add API keys for currently supported providers
      const supportedProviders = ['openai']
      Object.entries(secret).forEach(([key, value]) => {
        if (supportedProviders.includes(key.toLowerCase())) {
          process.env[`${key.toUpperCase()}_API_KEY`] = String(value)
        }
      })
    }
  } catch (e) {
    console.warn('Error retrieving secret', e)
  }

  /*
   * Validate that required environment variables are set when running in GitHub Actions.
   * This prevents tests from being unintentionally skipped due to missing credentials.
   */
  if (process.env.GITHUB_ACTIONS !== 'true') {
    console.warn('Tests running outside GitHub Actions, skipping required provider validation')
    return
  }

  const requiredProviders: Set<string> = new Set(['OPENAI_API_KEY'])

  for (const provider of requiredProviders) {
    if (!process.env[provider]) {
      throw new Error(`Missing required environment variables for ${provider}`)
    }
  }
}

/**
 * Perform shared setup for the integration tests unless it's already been.
 */
export async function setup(project: TestProject): Promise<void> {
  console.log('Global setup: Loading API keys from Secrets Manager...')
  await loadApiKeysFromSecretsManager()
  console.log('Global setup: API keys loaded into environment')

  project.provide('isBrowser', project.isBrowserEnabled())
  project.provide('isCI', !!globalThis.process.env.CI)
  project.provide('provider-openai', await getOpenAITestContext())
  project.provide('provider-bedrock', await getBedrockTestContext())
}

async function getOpenAITestContext(): Promise<ProvidedContext['provider-openai']> {
  const apiKey = process.env.OPENAI_API_KEY
  const shouldSkip = !!apiKey

  if (shouldSkip) {
    console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
  } else {
    console.log('⏭️  OpenAI API key available - integration tests will run')
  }

  return {
    apiKey: apiKey,
    shouldSkip: shouldSkip,
  }
}

async function getBedrockTestContext(): Promise<ProvidedContext['provider-bedrock']> {
  try {
    const credentialProvider = fromNodeProviderChain()
    const credentials = await credentialProvider()
    console.log('⏭️  Bedrock credentials available - integration tests will run')
    return {
      shouldSkip: false,
      credentials: credentials,
    }
  } catch {
    console.log('⏭️  Bedrock credentials not available - integration tests will be skipped')
    return {
      shouldSkip: true,
      credentials: undefined,
    }
  }
}
