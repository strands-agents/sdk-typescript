/**
 * Global setup that runs once before all integration tests
 *  Loads API keys from AWS Secrets Manager into environment variables
 */

import { loadApiKeysFromSecretsManager } from './__fixtures__/model-test-helpers'

export async function setup(): Promise<void> {
  console.log('Global setup: Loading API keys from Secrets Manager...')

  try {
    await loadApiKeysFromSecretsManager()
    console.log('Global setup complete: API keys loaded into environment')
  } catch (error) {
    console.error('Global setup failed:', error)
    throw error
  }
}
