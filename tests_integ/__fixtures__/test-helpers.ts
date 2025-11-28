/**
 * Helper to load fixture files from Vite URL imports using fetch().
 * Works in both Node.js (20+) and browser environments.
 * Vite ?url imports return paths that can be fetched directly.
 *
 * @param url - The URL from a Vite ?url import
 * @returns Promise resolving to the file contents as a Uint8Array
 */
export const loadFixture = async (url: string): Promise<Uint8Array> => {
  const arrayBuffer = await fetch(url).then((b) => b.arrayBuffer())
  return new Uint8Array(arrayBuffer)
}

/**
 * Determines if OpenAI integration tests should be skipped.
 * In CI environments, throws an error if API key is missing (tests should not be skipped).
 * In local development, skips tests if API key is not available.
 *
 * @returns true if tests should be skipped, false if they should run
 * @throws Error if running in CI and API key is missing
 */
export const shouldSkipOpenAITests = (): boolean => {
  try {
    const isCI = !!process.env.CI
    const hasKey = !!process.env.OPENAI_API_KEY

    if (isCI && !hasKey) {
      throw new Error('OpenAI API key must be available in CI environments')
    }

    if (hasKey) {
      if (isCI) {
        console.log('✅ Running in CI environment with OpenAI API key - tests will run')
      } else {
        console.log('✅ OpenAI API key found for integration tests')
      }
      return false
    } else {
      console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
      return true
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('CI environments')) {
      throw error
    }
    console.log('⏭️  OpenAI API key not available - integration tests will be skipped')
    return true
  }
}
