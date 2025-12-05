import type { AwsCredentialIdentity } from '@aws-sdk/types'

declare module 'vitest/browser' {
  interface BrowserCommands {
    getAwsCredentials: () => Promise<AwsCredentialIdentity>
    getOpenAIAPIKey: () => Promise<string>
  }
}
