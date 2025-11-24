import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Helper to load fixture files from Vite URL imports.
 * Vite ?url imports return paths like '/tests_integ/__resources__/file.png' in test environment.
 *
 * @param url - The URL from a Vite ?url import
 * @returns The file contents as a Uint8Array
 */
export const loadFixture = (url: string): Uint8Array => {
  const relativePath = url.startsWith('/') ? url.slice(1) : url
  const filePath = join(process.cwd(), relativePath)
  return new Uint8Array(readFileSync(filePath))
}

/**
 * Checks if OpenAI API key is available for integration tests.
 *
 * @returns true if OpenAI API key is available, false otherwise
 */
export const hasOpenAIApiKey = (): boolean => {
  try {
    if (process.env.OPENAI_API_KEY) {
      console.log('✅ OpenAI API key found for integration tests')
      return true
    } else {
      console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
      return false
    }
  } catch {
    console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
    return false
  }
}
