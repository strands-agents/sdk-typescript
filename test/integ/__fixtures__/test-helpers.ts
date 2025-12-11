/**
 * Checks whether we're running tests in the browser.
 */
export const isInBrowser = () => {
  return globalThis?.process?.env == null
}

/**
 * Helper to load fixture files from Vite URL imports.
 * Vite ?url imports return paths like '/test/integ/__resources__/file.png' in test environment.
 *
 * @param url - The URL from a Vite ?url import
 * @returns The file contents as a Uint8Array
 */
export async function loadFixture(url: string): Promise<Uint8Array> {
  if (isInBrowser()) {
    const response = await globalThis.fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  } else {
    const { join } = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const relativePath = url.startsWith('/') ? url.slice(1) : url
    const filePath = join(process.cwd(), relativePath)
    return new Uint8Array(await readFile(filePath))
  }
}
