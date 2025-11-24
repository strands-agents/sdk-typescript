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
 * Determines if OpenAI integration tests should be skipped.
 * Checks for the presence of OPENAI_API_KEY environment variable.
 *
 * @returns true if tests should be skipped, false if they should run
 */
export const shouldSkipOpenAITests = (): boolean => {
  try {
    if (process.env.OPENAI_API_KEY) {
      if (process.env.CI) {
        console.log('✅ Running in CI environment with OpenAI API key - tests will run')
      } else {
        console.log('✅ OpenAI API key found for integration tests')
      }
      return false
    } else {
      console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
      return true
    }
  } catch {
    console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
    return true
  }
}
