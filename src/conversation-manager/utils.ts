/**
 * Shared utilities for conversation managers.
 */

import type { Message } from '../types/messages.js'

/**
 * Find a valid split point that doesn't break ToolUse/ToolResult pairs.
 *
 * Walks forward from the initial split point, skipping positions where:
 * - The message starts with a toolResultBlock (orphaned result)
 * - The message has a toolUseBlock without a paired toolResult following it
 *
 * @param messages - The full list of messages.
 * @param initialSplitPoint - The starting split point to adjust from.
 * @returns The adjusted split point, or -1 if no valid point exists.
 */
export function findValidSplitPoint(messages: Message[], initialSplitPoint: number): number {
  let splitPoint = initialSplitPoint

  while (splitPoint < messages.length) {
    const message = messages[splitPoint]
    if (!message) break

    const hasToolResult = message.content.some((block) => block.type === 'toolResultBlock')
    if (hasToolResult) {
      splitPoint++
      continue
    }

    const hasToolUse = message.content.some((block) => block.type === 'toolUseBlock')
    if (hasToolUse) {
      const nextMessage = messages[splitPoint + 1]
      const nextHasToolResult = nextMessage?.content.some((block) => block.type === 'toolResultBlock')
      if (!nextHasToolResult) {
        splitPoint++
        continue
      }
    }

    break
  }

  return splitPoint >= messages.length ? -1 : splitPoint
}
