/**
 * Strands → Gemini: Converts Strands SDK types to Gemini API format for requests.
 */

import { type Content, type Part } from '@google/genai'
import type { Message } from '../../types/messages.js'

/**
 * Formats an array of messages for the Gemini API.
 *
 * @param messages - SDK messages to format
 * @returns Gemini-formatted contents array
 */
export function formatMessages(messages: Message[]): Content[] {
  const contents: Content[] = []

  for (const message of messages) {
    const parts: Part[] = []

    for (const block of message.content) {
      if (block.type === 'textBlock') {
        parts.push({ text: block.text })
      }
    }

    if (parts.length > 0) {
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts,
      })
    }
  }

  return contents
}
