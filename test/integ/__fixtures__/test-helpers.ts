import { inject } from 'vitest'
import type { Message } from '@strands-agents/sdk'

/**
 * Checks whether we're running tests in the browser.
 */
export const isInBrowser = () => {
  return inject('isBrowser')
}

export function isCI() {
  return inject('isCI')
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

// ================================
// Agent Message Helpers
// ================================

/**
 * Checks if any message contains a toolUseBlock with the specified tool name.
 */
export function hasToolUse(messages: Message[], toolName: string): boolean {
  return messages.some((msg) => msg.content.some((block) => block.type === 'toolUseBlock' && block.name === toolName))
}

/**
 * Counts messages containing toolResultBlocks with the specified status.
 */
export function countToolResults(messages: Message[], status: 'success' | 'error'): number {
  return messages.filter((msg) =>
    msg.content.some((block) => block.type === 'toolResultBlock' && block.status === status)
  ).length
}
