import 'vitest'
import type { AwsCredentialIdentity } from '@aws-sdk/types'

declare module 'vitest' {
  export interface ProvidedContext {
    isCI: boolean
    isBrowser: boolean
    ['provider-openai']: {
      shouldSkip: boolean
      apiKey: string | undefined
    }
    ['provider-bedrock']: {
      shouldSkip: boolean
      credentials: AwsCredentialIdentity | undefined
    }
  }
}
