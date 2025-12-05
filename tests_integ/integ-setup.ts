/**
 * Global setup that runs once before all integration tests
 *  Loads API keys from AWS Secrets Manager into environment variables
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

async function loadApiKeysFromSecretsManager(): Promise<void> {
  // Load API keys as environment variables from AWS Secrets Manager
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
  })
  console.log('Loading API keys from Secrets Manager')

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

let didSetup = false

export async function setup(): Promise<void> {
  if (didSetup) {
    return
  }

  console.log('Global setup: Loading API keys from Secrets Manager...')

  try {
    await loadApiKeysFromSecretsManager()
    console.log('Global setup complete: API keys loaded into environment')
  } catch (error) {
    console.error('Global setup failed:', error)
  } finally {
    didSetup = true
  }
}
