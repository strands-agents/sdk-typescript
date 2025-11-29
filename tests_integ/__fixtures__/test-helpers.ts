/**
 * Helper to load fixture files from Vite URL imports.
 * Works in both Node.js and browser environments with a unified async API.
 *
 * @param url - The URL from a Vite ?url import
 * @returns Promise resolving to the file contents as a Uint8Array
 *
 * @remarks
 * Implementation uses environment-specific approaches:
 * - **Browser**: Uses fetch() with HTTP URLs from Vite dev server
 * - **Node.js**: Uses fs.readFile since Node's fetch() doesn't support file:// protocol
 *
 * Note: Node.js's native fetch() (v18+) explicitly does not support file:// URLs.
 * This limitation is documented in the Node.js fetch implementation and returns
 * "not implemented... yet..." error. The hybrid approach is necessary until Node.js
 * adds file:// protocol support to fetch().
 */
export const loadFixture = async (url: string): Promise<Uint8Array> => {
  // Browser environment: Vite serves files over HTTP during development
  if (url.startsWith('http')) {
    const arrayBuffer = await fetch(url).then((b) => b.arrayBuffer())
    return new Uint8Array(arrayBuffer)
  }

  // Node.js environment: Use file system since fetch() doesn't support file:// protocol
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const relativePath = url.startsWith('/') ? url.slice(1) : url
  const filePath = join(process.cwd(), relativePath)
  const buffer = await readFile(filePath)
  return new Uint8Array(buffer)
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
