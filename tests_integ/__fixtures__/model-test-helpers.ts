/**
 * Test fixtures and helpers for Model testing.
 * This module provides utilities for testing Model implementations without
 * requiring actual API clients.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

async function loadApiKeysFromSecretsManager(): Promise<void> {
  // Load API keys as environment variables from AWS Secrets Manager
  // TEST
  console.log("All Environment Variables:");
  for (const key in process.env) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      console.log(`${key}`);
    }
  }
  // END_TEST
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1',
  })
  console.log('Loading API keys from Secrets Manager')

  if (process.env.STRANDS_TEST_API_KEYS_SECRET_NAME) {
    try {
      const secretName = process.env.STRANDS_TEST_API_KEYS_SECRET_NAME
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

export { loadApiKeysFromSecretsManager }
